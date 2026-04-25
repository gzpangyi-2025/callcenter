import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';
import { FilesService } from './files.service';
import * as multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';

@Controller('files')
export class FilesController {
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
    const safeName = filename.replace(/[/\\]/g, '');
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
    const safeName = filename.replace(/[/\\]/g, '');
    const url = await this.filesService.getPresignedUrl(
      safeName,
      undefined,
      true,
    );

    if (url.startsWith('/api/files/static/')) {
      const localPath = path.join(process.cwd(), 'oss', safeName);
      if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
      } else {
        return res.status(404).send('Not Found');
      }
    }

    res.redirect(302, url);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(), // 使用内存存储，随后流式推送到 COS/Local
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
      fileFilter: (_req, file, cb) => {
        if (!file) {
          cb(new BadRequestException('请选择文件'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('文件上传失败');
    }

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

  @UseGuards(AuthGuard('jwt'))
  @Get('migration-stats')
  async getMigrationStats() {
    const localDir = path.join(process.cwd(), 'oss');
    let localCount = 0;
    if (fs.existsSync(localDir)) {
      localCount = fs.readdirSync(localDir).length;
    }

    return {
      code: 0,
      data: {
        localFiles: localCount,
        migrationState: this.filesService.migrationState,
      },
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('migrate')
  async migrateStorage() {
    if (this.filesService.migrationState.isMigrating) {
      return { code: -1, message: '已有迁移任务正在进行中' };
    }

    const localDir = path.join(process.cwd(), 'oss');
    if (!fs.existsSync(localDir)) {
      return { code: -1, message: '本地存储目录不存在' };
    }

    const files = fs.readdirSync(localDir);
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

    setImmediate(async () => {
      for (const file of files) {
        const filePath = path.join(localDir, file);
        try {
          const buffer = fs.readFileSync(filePath);
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
            fs.unlinkSync(filePath);
          } catch (delErr) {
            console.warn(`Local file delete failed: ${file}`, delErr);
          }
        } catch (e) {
          console.error(`Migration failed for ${file}:`, e);
          this.filesService.migrationState.failed++;
        }
      }

      this.filesService.migrationState.isMigrating = false;
      this.filesService.migrationState.message = '迁移完成';
    });

    return { code: 0, message: '迁移任务已在后台启动，您可以稍后查看同步状态' };
  }
}
