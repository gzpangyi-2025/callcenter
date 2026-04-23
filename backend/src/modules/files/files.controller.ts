import {
  Controller, Post, Get, UseInterceptors, UploadedFile,
  UseGuards, BadRequestException, NotFoundException,
  Param, Query, Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';

const ossDir = join(process.cwd(), 'oss');

@Controller('files')
@UseGuards(AuthGuard('jwt'))
export class FilesController {
  /**
   * 下载文件，支持通过 query 参数 name 指定原始文件名
   * 使用 inline 方式：浏览器可预览的文件（PDF/图片/文本）直接打开，其余触发下载
   * 所有情况下 "另存为" 时都会使用原始文件名
   */
  @Get('download/:filename')
  async downloadFile(
    @Param('filename') filename: string,
    @Query('name') originalName: string,
    @Res() res: Response,
  ) {
    // 防止路径穿越攻击
    const safeName = filename.replace(/[/\\]/g, '');
    const filePath = join(ossDir, safeName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('文件不存在');
    }
    const downloadName = originalName || safeName;
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    );
    res.sendFile(filePath);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: ossDir,
        filename: (_req, file, cb) => {
          const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
          cb(null, uniqueName);
        },
      }),
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

    return {
      code: 0,
      message: '上传成功',
      data: {
        url: `/api/files/static/${file.filename}`,
        originalName: file.originalname,
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      },
    };
  }
}
