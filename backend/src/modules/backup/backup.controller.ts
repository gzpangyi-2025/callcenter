import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import type { Response } from 'express';
import { BackupService } from './backup.service';

const backupsDir = join(process.cwd(), 'backups');

@Controller('backup')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /**
   * Get current system statistics (table counts, file counts)
   */
  @Get('stats')
  @Permissions('admin:access')
  async getStats() {
    return this.backupService.getStats();
  }

  /**
   * Create a new backup
   */
  @Post('create')
  @Permissions('admin:access')
  async createBackup(
    @Body()
    body: {
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
  @Permissions('admin:access')
  async listBackups() {
    return this.backupService.listBackups();
  }

  /**
   * Download a backup file
   */
  @Get('download/:filename')
  @Permissions('admin:access')
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
          cb(
            null,
            `_upload_restore_${Date.now()}${extname(file.originalname)}`,
          );
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    }),
  )
  @Permissions('admin:access')
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
  @Permissions('admin:access')
  async deleteBackup(@Param('filename') filename: string) {
    return this.backupService.deleteBackup(filename);
  }

  /**
   * Scan and clean orphan OSS files (not referenced by any DB record)
   */
  @Post('clean-orphans')
  @Permissions('admin:access')
  async cleanOrphans() {
    const result = await this.backupService.cleanOrphanFiles();
    return {
      code: 0,
      message: `已清理 ${result.deletedCount} 个孤儿文件，释放 ${(result.freedSize / 1024 / 1024).toFixed(2)} MB`,
      data: result,
    };
  }

  /**
   * 扫描 COS 存储桶，找出未被数据库引用的孤儿对象（不执行删除）
   */
  @Get('cos-orphans')
  @Permissions('admin:access')
  async getCosOrphans() {
    const result = await this.backupService.getCosOrphanFiles();
    return {
      code: 0,
      data: { orphanCount: result.count, orphanFiles: result.files },
    };
  }

  /**
   * 删除 COS 存储桶中的所有孤儿对象
   */
  @Post('clean-cos-orphans')
  @Permissions('admin:access')
  async cleanCosOrphans() {
    const result = await this.backupService.cleanCosOrphanFiles();
    return {
      code: 0,
      message: `已删除 ${result.deletedCount} 个云端孤儿文件，失败 ${result.failedCount} 个`,
      data: result,
    };
  }
}
