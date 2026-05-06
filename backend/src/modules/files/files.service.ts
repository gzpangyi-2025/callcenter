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

  public migrationState = {
    isMigrating: false,
    total: 0,
    current: 0,
    failed: 0,
    message: '',
  };

  constructor(private readonly settingsService: SettingsService) {
    // 确保本地目录存在
    const localDir = path.join(process.cwd(), 'oss');
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
  }

  private async getStorageConfig() {
    const provider =
      (await this.settingsService.get('storage.provider')) || 'local';
    const secretId =
      (await this.settingsService.get('storage.cos.secretId')) || '';
    const secretKey =
      (await this.settingsService.get('storage.cos.secretKey')) || '';
    const bucket = (await this.settingsService.get('storage.cos.bucket')) || '';
    const region = (await this.settingsService.get('storage.cos.region')) || '';
    return { provider, secretId, secretKey, bucket, region };
  }

  private async getCosInstance() {
    const config = await this.getStorageConfig();
    if (config.provider !== 'cos') return null;

    const configStr = `${config.secretId}:${config.secretKey}`;
    if (this._cosInstance && this._lastCosConfigStr === configStr) {
      return {
        cos: this._cosInstance,
        bucket: config.bucket,
        region: config.region,
      };
    }

    if (!config.secretId || !config.secretKey) {
      throw new InternalServerErrorException('COS 凭据未配置');
    }

    this._cosInstance = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
    this._lastCosConfigStr = configStr;

    return {
      cos: this._cosInstance,
      bucket: config.bucket,
      region: config.region,
    };
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
        fs.writeFileSync(localPath, buffer);
        return `/api/files/static/${filename}`;
      } catch (err) {
        this.logger.error(`Local upload error: ${err.message}`, err);
        throw new InternalServerErrorException('文件保存到本地失败');
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
        // 对于下载请求，指定附件名
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
   * 列出 COS 中所有对象的 key（分页遍历）
   */
  async listAllCosKeys(): Promise<string[]> {
    const cosContext = await this.getCosInstance();
    if (!cosContext) return [];

    const allKeys: string[] = [];
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
   * 批量删除 COS 中的对象（传入 key 数组）
   */
  async deleteCosObjects(
    keys: string[],
  ): Promise<{ deleted: number; failed: number }> {
    if (keys.length === 0) return { deleted: 0, failed: 0 };
    const cosContext = await this.getCosInstance();
    if (!cosContext) return { deleted: 0, failed: keys.length };

    let deleted = 0;
    let failed = 0;
    // COS 批量删除每次最多 1000 个
    const chunkSize = 1000;
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
   * 生成前端直传 COS 的临时凭证
   */
  async generateUploadCredentials(filename: string) {
    const config = await this.getStorageConfig();
    if (config.provider === 'local') {
      return { provider: 'local' };
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
   * 确认 COS 直传文件
   */
  async confirmUpload(key: string, originalName: string, size: number, mimetype: string) {
    const config = await this.getStorageConfig();
    if (config.provider === 'local') {
      throw new BadRequestException('本地存储不支持直传确认');
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
