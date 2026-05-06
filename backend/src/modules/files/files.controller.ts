import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Param,
  Query,
  Res,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';
import { FilesService } from './files.service';
import * as multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

import { Logger } from '@nestjs/common';

const PUBLIC_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ...PUBLIC_IMAGE_EXTENSIONS,
  '.pdf',
  '.doc',
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.xltx',
  '.xltm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.potx',
  '.potm',
  '.ppsx',
  '.ppsm',
  '.rtf',
  '.txt',
  '.csv',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.ini',
  '.conf',
  '.cfg',
  '.properties',
  '.sql',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.log',
  '.trc',
  '.trace',
  '.out',
  '.dmp',
  '.bak',
  '.wps',
  '.et',
  '.dps',
  '.vsd',
  '.vsdx',
  '.eml',
  '.msg',
]);

const BLOCKED_MIME_TYPES = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'text/javascript',
]);

const INLINE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\]/g, '');
}

function getExtension(filename: string): string {
  return extname(filename).toLowerCase();
}

function isPublicPreviewImage(filename: string): boolean {
  return PUBLIC_IMAGE_EXTENSIONS.has(getExtension(filename));
}

function assertAllowedUpload(filename: string, mimetype?: string): void {
  const ext = getExtension(filename);
  const normalizedMime = (mimetype || '').toLowerCase();

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new BadRequestException('不支持的文件类型');
  }

  if (BLOCKED_MIME_TYPES.has(normalizedMime)) {
    throw new BadRequestException('该文件类型存在安全风险，禁止上传');
  }

  if (normalizedMime.includes('svg') || normalizedMime.includes('html')) {
    throw new BadRequestException('该文件类型存在安全风险，禁止上传');
  }
}

@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(private readonly filesService: FilesService) {}

  /**
   * 下载文件，支持通过 query 参数 name 指定原始文件名
   * 我们通过预签名链接重定向到腾讯云 COS，实现鉴权下载
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('download/:filename')
  async downloadFile(
    @Param('filename') filename: string,
    @Query('name') originalName: string,
    @Res() res: Response,
  ) {
    const safeName = sanitizeFilename(filename);
    const downloadName = originalName || safeName;
    const url = await this.filesService.getPresignedUrl(
      safeName,
      downloadName,
      false,
    );

    if (url.startsWith('/api/files/static/')) {
      const localPath = path.join(process.cwd(), 'oss', safeName);
      if (fs.existsSync(localPath)) {
        res.download(localPath, downloadName);
        return;
      } else {
        return res.status(404).send('Not Found');
      }
    }

    res.redirect(302, url);
  }

  /**
   * 静态资源访问代理，重定向到 COS 预签名链接
   * 前端渲染图片（/api/files/static/xxx.png）会走到这里
   */
  @Get('static/:filename')
  async serveStatic(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = sanitizeFilename(filename);
    if (!isPublicPreviewImage(safeName)) {
      throw new ForbiddenException('该文件类型不允许公开预览，请使用鉴权下载');
    }

    const url = await this.filesService.getPresignedUrl(
      safeName,
      safeName,
      true,
    );

    if (url.startsWith('/api/files/static/')) {
      const localPath = path.join(process.cwd(), 'oss', safeName);
      if (fs.existsSync(localPath)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        res.type(INLINE_MIME_BY_EXTENSION[getExtension(safeName)]);
        return res.sendFile(localPath);
      } else {
        return res.status(404).send('Not Found');
      }
    }

    res.redirect(302, url);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('upload-credentials')
  async getUploadCredentials(@Query('filename') filename: string) {
    if (!filename) {
      throw new BadRequestException('请提供文件名');
    }
    assertAllowedUpload(filename);
    const uniqueName = `${uuidv4()}${extname(filename)}`;
    const result = await this.filesService.generateUploadCredentials(uniqueName);
    return {
      code: 0,
      data: result,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('confirm')
  async confirmUpload(
    @Body('key') key: string,
    @Body('originalName') originalName: string,
    @Body('size') size: number,
    @Body('mimetype') mimetype: string,
  ) {
    if (!key || !originalName) {
      throw new BadRequestException('参数不完整');
    }
    assertAllowedUpload(originalName, mimetype);
    assertAllowedUpload(key, mimetype);
    const result = await this.filesService.confirmUpload(
      key,
      originalName,
      size,
      mimetype,
    );
    return {
      code: 0,
      message: '确认成功',
      data: result,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(), // 使用内存存储，随后流式推送到 COS/Local
      limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
      fileFilter: (_req, file, cb) => {
        if (!file) {
          cb(new BadRequestException('请选择文件'), false);
          return;
        }
        try {
          assertAllowedUpload(file.originalname, file.mimetype);
          cb(null, true);
        } catch (err) {
          cb(err as BadRequestException, false);
        }
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('文件上传失败');
    }
    assertAllowedUpload(file.originalname, file.mimetype);

    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;

    await this.filesService.uploadToCos(uniqueName, file.buffer, file.mimetype);

    return {
      code: 0,
      message: '上传成功',
      data: {
        url: `/api/files/static/${uniqueName}`,
        originalName: file.originalname,
        filename: uniqueName,
        size: file.size,
        mimetype: file.mimetype,
      },
    };
  }

  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('admin:access')
  @Get('migration-stats')
  async getMigrationStats() {
    const localDir = path.join(process.cwd(), 'oss');
    let localCount = 0;
    if (fs.existsSync(localDir)) {
      const files = await fs.promises.readdir(localDir);
      localCount = files.length;
    }

    return {
      code: 0,
      data: {
        localFiles: localCount,
        migrationState: this.filesService.migrationState,
      },
    };
  }

  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('admin:access')
  @Post('migrate')
  async migrateStorage() {
    if (this.filesService.migrationState.isMigrating) {
      return { code: -1, message: '已有迁移任务正在进行中' };
    }

    const localDir = path.join(process.cwd(), 'oss');
    if (!fs.existsSync(localDir)) {
      return { code: -1, message: '本地存储目录不存在' };
    }

    const files = await fs.promises.readdir(localDir);
    if (files.length === 0) {
      return { code: 0, message: '本地没有需要迁移的文件' };
    }

    // 初始化迁移状态
    this.filesService.migrationState = {
      isMigrating: true,
      total: files.length,
      current: 0,
      failed: 0,
      message: '迁移中...',
    };

    setImmediate(() => {
      void (async () => {
        for (const file of files) {
          const filePath = path.join(localDir, file);
          try {
            const buffer = await fs.promises.readFile(filePath);
            let mime = 'application/octet-stream';
            const ext = extname(file).toLowerCase();
            if (['.png'].includes(ext)) mime = 'image/png';
            if (['.jpg', '.jpeg'].includes(ext)) mime = 'image/jpeg';
            if (['.gif'].includes(ext)) mime = 'image/gif';
            if (['.pdf'].includes(ext)) mime = 'application/pdf';

            await this.filesService.uploadToCos(file, buffer, mime);
            this.filesService.migrationState.current++;
            // 上传成功后删除本地文件
            try {
              await fs.promises.unlink(filePath);
            } catch (delErr) {
              this.logger.warn(`Local file delete failed: ${file}`, delErr);
            }
          } catch (e) {
            this.logger.error(`Migration failed for ${file}:`, e);
            this.filesService.migrationState.failed++;
          }
        }

        this.filesService.migrationState.isMigrating = false;
        this.filesService.migrationState.message = '迁移完成';
      })();
    });

    return { code: 0, message: '迁移任务已在后台启动，您可以稍后查看同步状态' };
  }
}
