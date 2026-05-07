import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import COS = require('cos-nodejs-sdk-v5');
import STS = require('qcloud-cos-sts');
import { SettingsService } from '../settings/settings.service';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
];
let proxyEnvBypassDepth = 0;
let proxyEnvSnapshot: Map<string, string | undefined> | null = null;

function acquireDirectCloudProxyBypass(): () => void {
  if (proxyEnvBypassDepth === 0) {
    proxyEnvSnapshot = new Map<string, string | undefined>();
    for (const key of PROXY_ENV_KEYS) {
      proxyEnvSnapshot.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  proxyEnvBypassDepth++;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    proxyEnvBypassDepth = Math.max(0, proxyEnvBypassDepth - 1);

    if (proxyEnvBypassDepth === 0 && proxyEnvSnapshot) {
      for (const [key, value] of proxyEnvSnapshot.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      proxyEnvSnapshot = null;
    }
  };
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private _cosInstance: COS | null = null;
  private _lastCosConfigStr: string = '';
  private _s3Instance: S3Client | null = null;
  private _lastS3ConfigStr: string = '';

  public migrationState = {
    isMigrating: false,
    total: 0,
    current: 0,
    failed: 0,
    message: '',
  };

  constructor(private readonly settingsService: SettingsService) {
    const localDir = path.join(process.cwd(), 'oss');
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
  }

  private async getStorageConfig() {
    const provider = (await this.settingsService.get('storage.provider')) || 'local';
    const secretId = (await this.settingsService.get('storage.cos.secretId')) || '';
    const secretKey = (await this.settingsService.get('storage.cos.secretKey')) || '';
    const bucket = (await this.settingsService.get('storage.cos.bucket')) || '';
    const region = (await this.settingsService.get('storage.cos.region')) || '';

    const s3Endpoint = (await this.settingsService.get('storage.s3.endpoint')) || '';
    const s3AccessKey = (await this.settingsService.get('storage.s3.accessKey')) || '';
    const s3SecretKey = (await this.settingsService.get('storage.s3.secretKey')) || '';
    const s3Bucket = (await this.settingsService.get('storage.s3.bucket')) || '';
    const s3Region = (await this.settingsService.get('storage.s3.region')) || '';

    return { provider, secretId, secretKey, bucket, region, s3Endpoint, s3AccessKey, s3SecretKey, s3Bucket, s3Region };
  }

  private async getCosInstance() {
    const config = await this.getStorageConfig();
    if (config.provider !== 'cos') return null;

    const configStr = `${config.secretId}:${config.secretKey}`;
    if (this._cosInstance && this._lastCosConfigStr === configStr) {
      return {
        cos: this._cosInstance,
        bucket: config.bucket as string,
        region: config.region as string,
      };
    }

    if (!config.secretId || !config.secretKey) {
      throw new InternalServerErrorException('COS 凭据未配置');
    }

    this._cosInstance = new COS({
      SecretId: config.secretId as string,
      SecretKey: config.secretKey as string,
    });
    this._lastCosConfigStr = configStr;

    return {
      cos: this._cosInstance,
      bucket: config.bucket as string,
      region: config.region as string,
    };
  }

  private async getS3Instance() {
    const config = await this.getStorageConfig();
    if (config.provider !== 's3') return null;

    const configStr = `${config.s3Endpoint}:${config.s3AccessKey}:${config.s3SecretKey}:${config.s3Region}`;
    if (this._s3Instance && this._lastS3ConfigStr === configStr) {
      return { s3: this._s3Instance, bucket: config.s3Bucket as string };
    }

    if (!config.s3AccessKey || !config.s3SecretKey || !config.s3Endpoint) {
      throw new InternalServerErrorException('S3 凭据未配置');
    }

    this._s3Instance = new S3Client({
      region: (config.s3Region as string) || 'us-east-1',
      endpoint: config.s3Endpoint as string,
      credentials: {
        accessKeyId: config.s3AccessKey as string,
        secretAccessKey: config.s3SecretKey as string,
      },
      forcePathStyle: true,
    });
    this._lastS3ConfigStr = configStr;

    return { s3: this._s3Instance, bucket: config.s3Bucket as string };
  }

  async uploadToCos(
    filename: string,
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const config = await this.getStorageConfig();

    if (config.provider === 'local') {
      const localPath = path.join(process.cwd(), 'oss', filename);
      try {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, buffer);
        return `/api/files/static/${filename}`;
      } catch (err: any) {
        this.logger.error(`Local upload error: ${err.message}`, err);
        throw new InternalServerErrorException('文件保存到本地失败');
      }
    } else if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) throw new InternalServerErrorException('S3 配置异常');
      try {
        await s3Context.s3.send(
          new PutObjectCommand({
            Bucket: s3Context.bucket,
            Key: filename,
            Body: buffer,
            ContentType: mimetype,
          }),
        );
        return `/api/files/static/${filename}`;
      } catch (err: any) {
        this.logger.error(`S3 upload error: ${err.message}`, err);
        throw new InternalServerErrorException('文件上传到云存储失败');
      }
    } else {
      const cosContext = await this.getCosInstance();
      if (!cosContext) throw new InternalServerErrorException('COS 配置异常');
      return new Promise((resolve, reject) => {
        cosContext.cos.putObject(
          {
            Bucket: cosContext.bucket,
            Region: cosContext.region,
            Key: filename,
            Body: buffer,
            ContentType: mimetype,
          },
          (err, _data) => {
            if (err) {
              this.logger.error(`COS upload error: ${err.message}`, err);
              reject(new InternalServerErrorException('文件上传到云存储失败'));
            } else {
              resolve(`/api/files/static/${filename}`);
            }
          },
        );
      });
    }
  }

  async getPresignedUrl(
    filename: string,
    originalName?: string,
    inline: boolean = true,
  ): Promise<string> {
    const config = await this.getStorageConfig();

    if (config.provider === 'local') {
      return `/api/files/static/${filename}`;
    }

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) throw new InternalServerErrorException('S3 配置异常');
      try {
        const command = new GetObjectCommand({
          Bucket: s3Context.bucket,
          Key: filename,
          ResponseContentDisposition: originalName ? `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(originalName)}` : undefined,
        });
        return await getSignedUrl(s3Context.s3, command, { expiresIn: 3600 });
      } catch (e: any) {
        this.logger.error(`Error generating S3 presigned URL: ${e.message}`);
        throw new InternalServerErrorException('无法获取文件链接');
      }
    }

    try {
      const cosContext = await this.getCosInstance();
      if (!cosContext) throw new InternalServerErrorException('COS 配置异常');

      const params: COS.GetObjectUrlParams = {
        Bucket: cosContext.bucket,
        Region: cosContext.region,
        Key: filename,
        Sign: true,
        Expires: 3600, // 1小时有效
      };

      if (originalName) {
        params.Query = {
          'response-content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(originalName)}`,
        };
      }

      const url = cosContext.cos.getObjectUrl(params);
      return url;
    } catch (e: any) {
      this.logger.error(`Error generating presigned URL: ${e.message}`);
      throw new InternalServerErrorException('无法获取文件链接');
    }
  }

  async getFileBuffer(filename: string): Promise<Buffer> {
    const config = await this.getStorageConfig();

    if (config.provider === 'local') {
      const localPath = path.join(process.cwd(), 'oss', filename);
      if (!fs.existsSync(localPath))
        throw new InternalServerErrorException('本地文件不存在');
      return fs.readFileSync(localPath);
    }

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) throw new InternalServerErrorException('S3 配置异常');
      try {
        const responseData = await s3Context.s3.send(new GetObjectCommand({
          Bucket: s3Context.bucket,
          Key: filename,
        }));
        const stream = responseData.Body as Readable;
        return new Promise((resolve, reject) => {
          const chunks: any[] = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
      } catch (e: any) {
        this.logger.error(`Error fetching file from S3: ${e.message}`);
        throw new InternalServerErrorException('文件拉取失败');
      }
    }

    const cosContext = await this.getCosInstance();
    if (!cosContext) throw new InternalServerErrorException('COS 配置异常');

    return new Promise((resolve, reject) => {
      cosContext.cos.getObject(
        {
          Bucket: cosContext.bucket,
          Region: cosContext.region,
          Key: filename,
          DataType: 'buffer',
        } as any,
        (err, data) => {
          if (err) {
            this.logger.error(`Error fetching file from COS: ${err.message}`);
            reject(new InternalServerErrorException('文件拉取失败'));
          } else {
            resolve(data.Body);
          }
        },
      );
    });
  }

  async deleteFromCos(filename: string): Promise<void> {
    const config = await this.getStorageConfig();

    if (config.provider === 'local') {
      const localPath = path.join(process.cwd(), 'oss', filename);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        this.logger.log(`Local delete success: ${filename}`);
      }
      return;
    }

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) return;
      try {
        await s3Context.s3.send(new DeleteObjectCommand({
          Bucket: s3Context.bucket,
          Key: filename,
        }));
        this.logger.log(`S3 delete success: ${filename}`);
      } catch (e: any) {
        this.logger.error(`S3 delete error: ${e.message}`, e);
      }
      return;
    }

    const cosContext = await this.getCosInstance();
    if (!cosContext) {
      return;
    }

    return new Promise((resolve) => {
      cosContext.cos.deleteObject(
        {
          Bucket: cosContext.bucket,
          Region: cosContext.region,
          Key: filename,
        },
        (err, _data) => {
          if (err) {
            this.logger.error(`COS delete error: ${err.message}`, err);
            resolve(); // 吞掉错误
          } else {
            this.logger.log(`COS delete success: ${filename}`);
            resolve();
          }
        },
      );
    });
  }

  async getStorageStats(): Promise<{
    imageCount: number;
    imageSize: number;
    fileCount: number;
    fileSize: number;
    provider: string;
  }> {
    const config = await this.getStorageConfig();
    let imageCount = 0,
      imageSize = 0,
      fileCount = 0,
      fileSize = 0;
    const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

    if (config.provider === 'local') {
      const localPath = path.join(process.cwd(), 'oss');
      if (fs.existsSync(localPath)) {
        const files = fs.readdirSync(localPath);
        for (const f of files) {
          try {
            const size = fs.statSync(path.join(localPath, f)).size;
            const ext = path.extname(f).toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
              imageCount++;
              imageSize += size;
            } else {
              fileCount++;
              fileSize += size;
            }
          } catch (err) {
            this.logger.warn(
              `Failed to stat file ${f}: ${err instanceof Error ? err.message : 'unknown'}`,
            );
          }
        }
      }
      return { imageCount, imageSize, fileCount, fileSize, provider: 'local' };
    } else if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) return { imageCount: 0, imageSize: 0, fileCount: 0, fileSize: 0, provider: 's3' };

      let isTruncated = true;
      let continuationToken: string | undefined = undefined;

      while (isTruncated) {
        try {
          const responseData: any = await s3Context.s3.send(new ListObjectsV2Command({
            Bucket: s3Context.bucket,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }));
          
          for (const item of responseData.Contents || []) {
            const size = item.Size || 0;
            const ext = path.extname(item.Key || '').toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
              imageCount++;
              imageSize += size;
            } else {
              fileCount++;
              fileSize += size;
            }
          }
          isTruncated = responseData.IsTruncated ?? false;
          continuationToken = responseData.NextContinuationToken;
        } catch (e: any) {
          this.logger.error('Failed to get S3 bucket stats', e);
          break;
        }
      }
      return { imageCount, imageSize, fileCount, fileSize, provider: 's3' };
    } else {
      const cosContext = await this.getCosInstance();
      if (!cosContext)
        return {
          imageCount: 0,
          imageSize: 0,
          fileCount: 0,
          fileSize: 0,
          provider: 'cos',
        };

      let isTruncated = true;
      let marker: string | undefined = undefined;

      while (isTruncated) {
        try {
          const data: any = await new Promise((resolve, reject) => {
            cosContext.cos.getBucket(
              {
                Bucket: cosContext.bucket,
                Region: cosContext.region,
                Marker: marker,
                MaxKeys: 1000,
              },
              (err, data) => (err ? reject(err) : resolve(data)),
            );
          });

          for (const item of data.Contents || []) {
            const size = parseInt(item.Size, 10) || 0;
            const ext = path.extname(item.Key).toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
              imageCount++;
              imageSize += size;
            } else {
              fileCount++;
              fileSize += size;
            }
          }
          isTruncated = data.IsTruncated === 'true';
          marker = data.NextMarker;
        } catch (e) {
          this.logger.error('Failed to get bucket stats', e);
          break;
        }
      }
      return { imageCount, imageSize, fileCount, fileSize, provider: 'cos' };
    }
  }

  /**
   * 列出 COS/S3 中所有对象的 key（分页遍历）
   */
  async listAllCosKeys(): Promise<string[]> {
    const config = await this.getStorageConfig();
    const allKeys: string[] = [];

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) return [];
      let isTruncated = true;
      let continuationToken: string | undefined = undefined;
      while (isTruncated) {
        try {
          const responseData: any = await s3Context.s3.send(new ListObjectsV2Command({
            Bucket: s3Context.bucket,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          }));
          for (const item of responseData.Contents || []) {
            if (item.Key) allKeys.push(item.Key);
          }
          isTruncated = responseData.IsTruncated ?? false;
          continuationToken = responseData.NextContinuationToken;
        } catch (e: any) {
          this.logger.error('Failed to list S3 bucket', e);
          break;
        }
      }
      return allKeys;
    }

    const cosContext = await this.getCosInstance();
    if (!cosContext) return [];

    let isTruncated = true;
    let marker: string | undefined = undefined;

    while (isTruncated) {
      try {
        const data: any = await new Promise((resolve, reject) => {
          cosContext.cos.getBucket(
            {
              Bucket: cosContext.bucket,
              Region: cosContext.region,
              Marker: marker,
              MaxKeys: 1000,
            },
            (err, data) => (err ? reject(err) : resolve(data)),
          );
        });
        for (const item of data.Contents || []) {
          allKeys.push(item.Key);
        }
        isTruncated = data.IsTruncated === 'true';
        marker = data.NextMarker;
      } catch (e) {
        this.logger.error('Failed to list COS bucket', e);
        break;
      }
    }
    return allKeys;
  }

  /**
   * 批量删除 COS/S3 中的对象（传入 key 数组）
   */
  async deleteCosObjects(
    keys: string[],
  ): Promise<{ deleted: number; failed: number }> {
    if (keys.length === 0) return { deleted: 0, failed: 0 };
    const config = await this.getStorageConfig();

    let deleted = 0;
    let failed = 0;
    const chunkSize = 1000;

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) return { deleted: 0, failed: keys.length };
      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        try {
          const responseData = await s3Context.s3.send(new DeleteObjectsCommand({
            Bucket: s3Context.bucket,
            Delete: {
              Objects: chunk.map(k => ({ Key: k })),
            }
          }));
          deleted += (responseData.Deleted || []).length;
          failed += (responseData.Errors || []).length;
        } catch (e: any) {
          this.logger.error(`S3 batch delete failed for chunk starting at ${i}`, e);
          failed += chunk.length;
        }
      }
      return { deleted, failed };
    }

    const cosContext = await this.getCosInstance();
    if (!cosContext) return { deleted: 0, failed: keys.length };

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      try {
        await new Promise<void>((resolve, reject) => {
          cosContext.cos.deleteMultipleObject(
            {
              Bucket: cosContext.bucket,
              Region: cosContext.region,
              Objects: chunk.map((k) => ({ Key: k })),
            },
            (err, data) => {
              if (err) {
                reject(err);
                return;
              }
              deleted += (data.Deleted || []).length;
              failed += (data.Error || []).length;
              resolve();
            },
          );
        });
      } catch (e) {
        this.logger.error(`Batch delete failed for chunk starting at ${i}`, e);
        failed += chunk.length;
      }
    }
    return { deleted, failed };
  }

  /**
   * 生成前端直传 COS/S3 的临时凭证或 Presigned URL
   */
  async generateUploadCredentials(filename: string) {
    const config = await this.getStorageConfig();
    if (config.provider === 'local') {
      return { provider: 'local' };
    }

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) throw new InternalServerErrorException('S3 配置异常');
      try {
        const command = new PutObjectCommand({
          Bucket: s3Context.bucket,
          Key: filename,
        });
        const presignedUrl = await getSignedUrl(s3Context.s3, command, { expiresIn: 1800 });
        return {
          provider: 's3',
          presignedUrl,
          key: filename,
        };
      } catch (e: any) {
        this.logger.error(`Error generating S3 presigned PUT URL: ${e.message}`, e);
        throw new InternalServerErrorException('获取上传凭证失败');
      }
    }

    if (!config.secretId || !config.secretKey || !config.bucket || !config.region) {
      throw new InternalServerErrorException('COS 配置异常');
    }

    // 解析 appId
    const shortBucketName = config.bucket.substr(0, config.bucket.lastIndexOf('-'));
    const appId = config.bucket.substr(config.bucket.lastIndexOf('-') + 1);

    const policy = {
      version: '2.0',
      statement: [
        {
          action: [
            'name/cos:PutObject',
            'name/cos:InitiateMultipartUpload',
            'name/cos:ListMultipartUploads',
            'name/cos:ListParts',
            'name/cos:UploadPart',
            'name/cos:CompleteMultipartUpload',
            'name/cos:AbortMultipartUpload',
          ],
          effect: 'allow',
          resource: [
            `qcs::cos:${config.region}:uid/${appId}:${config.bucket}/${filename}`,
          ],
        },
      ],
    };

    return new Promise((resolve, reject) => {
      const releaseProxyBypass = acquireDirectCloudProxyBypass();
      try {
        STS.getCredential(
          {
            secretId: config.secretId,
            secretKey: config.secretKey,
            policy: policy,
            durationSeconds: 1800, // 30 mins
            proxy: '',
          },
          (err: any, credential: any) => {
            releaseProxyBypass();
            if (err) {
              this.logger.error(`STS Error: ${err.message}`, err);
              reject(new InternalServerErrorException('获取上传凭证失败'));
            } else {
              resolve({
                provider: 'cos',
                credentials: credential.credentials,
                startTime: credential.startTime,
                expiredTime: credential.expiredTime,
                bucket: config.bucket,
                region: config.region,
                key: filename,
              });
            }
          },
        );
      } catch (err) {
        releaseProxyBypass();
        reject(err);
      }
    });
  }

  /**
   * 确认 COS/S3 直传文件
   */
  async confirmUpload(key: string, originalName: string, size: number, mimetype: string) {
    const config = await this.getStorageConfig();
    if (config.provider === 'local') {
      throw new BadRequestException('本地存储不支持直传确认');
    }

    if (config.provider === 's3') {
      const s3Context = await this.getS3Instance();
      if (!s3Context) throw new InternalServerErrorException('S3 配置异常');
      try {
        await s3Context.s3.send(new HeadObjectCommand({
          Bucket: s3Context.bucket,
          Key: key,
        }));
        return {
          url: `/api/files/static/${key}`,
          originalName: originalName,
          filename: key,
          size: size,
          mimetype: mimetype,
        };
      } catch (e: any) {
        this.logger.error(`S3 HeadObject Error: ${e.message}`, e);
        throw new BadRequestException('未在云端找到该文件，上传可能未完成');
      }
    }

    const cosContext = await this.getCosInstance();
    if (!cosContext) throw new InternalServerErrorException('COS 配置异常');

    return new Promise((resolve, reject) => {
      cosContext.cos.headObject(
        {
          Bucket: cosContext.bucket,
          Region: cosContext.region,
          Key: key,
        },
        (err: any, _data: any) => {
          if (err) {
            this.logger.error(`COS HeadObject Error: ${err.message}`, err);
            reject(new BadRequestException('未在云端找到该文件，上传可能未完成'));
          } else {
            resolve({
              url: `/api/files/static/${key}`,
              originalName: originalName,
              filename: key,
              size: size,
              mimetype: mimetype,
            });
          }
        },
      );
    });
  }
}
