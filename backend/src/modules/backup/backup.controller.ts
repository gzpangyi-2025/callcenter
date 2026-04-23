import {
  Controller, Post, Get, Delete, Param,
  UseGuards, UseInterceptors, UploadedFile,
  Res, Body, NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import type { Response } from 'express';
import { BackupService } from './backup.service';

const backupsDir = join(process.cwd(), 'backups');

@Controller('backup')
@UseGuards(AuthGuard('jwt'))
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Get current system statistics (table counts, file counts)
   */
  @Get('stats')
  async getStats() {
    return this.backupService.getStats();
  }

  /**
   * Create a new backup
   */
  @Post('create')
  async createBackup(
    @Body() body: {
      includeImages?: boolean;
      includeFiles?: boolean;
      includeAuditLogs?: boolean;
    },
  ) {
    return this.backupService.createBackup({
      includeImages: body.includeImages ?? true,
      includeFiles: body.includeFiles ?? true,
      includeAuditLogs: body.includeAuditLogs ?? false,
    });
  }

  /**
   * List all backup files
   */
  @Get('list')
  async listBackups() {
    return this.backupService.listBackups();
  }

  /**
   * Download a backup file
   */
  @Get('download/:filename')
  async downloadBackup(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filePath = this.backupService.getBackupPath(filename);
    if (!filePath) {
      throw new NotFoundException('备份文件不存在');
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Content-Type', 'application/zip');
    res.sendFile(filePath);
  }

  /**
   * Upload and restore from a backup file
   */
  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: backupsDir,
        filename: (_req, file, cb) => {
          cb(null, `_upload_restore_${Date.now()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    }),
  )
  async restoreBackup(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { code: 1, message: '请上传备份文件' };
    }
    return this.backupService.restoreBackup(file.path);
  }

  /**
   * Delete a backup file
   */
  @Delete(':filename')
  async deleteBackup(@Param('filename') filename: string) {
    return this.backupService.deleteBackup(filename);
  }
}
