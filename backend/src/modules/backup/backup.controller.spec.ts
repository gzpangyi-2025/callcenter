import { Test, TestingModule } from '@nestjs/testing';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { NotFoundException } from '@nestjs/common';
import { Response } from 'express';

describe('BackupController', () => {
  let controller: BackupController;
  let backupService: BackupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        {
          provide: BackupService,
          useValue: {
            getStats: jest.fn(),
            createBackup: jest.fn(),
            listBackups: jest.fn(),
            getBackupPath: jest.fn(),
            restoreBackup: jest.fn(),
            deleteBackup: jest.fn(),
            cleanOrphanFiles: jest.fn(),
            getCosOrphanFiles: jest.fn(),
            cleanCosOrphanFiles: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BackupController>(BackupController);
    backupService = module.get<BackupService>(BackupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should get stats', async () => {
    (backupService.getStats as jest.Mock).mockResolvedValue({ users: 10 });
    expect(await controller.getStats()).toEqual({ users: 10 });
  });

  it('should create backup', async () => {
    (backupService.createBackup as jest.Mock).mockResolvedValue({ success: true });
    expect(await controller.createBackup({ includeImages: true })).toEqual({ success: true });
    expect(backupService.createBackup).toHaveBeenCalledWith({ includeImages: true, includeFiles: true, includeAuditLogs: false });
  });

  it('should list backups', async () => {
    (backupService.listBackups as jest.Mock).mockResolvedValue(['b1.zip']);
    expect(await controller.listBackups()).toEqual(['b1.zip']);
  });

  describe('downloadBackup', () => {
    it('should throw if file not found', () => {
      (backupService.getBackupPath as jest.Mock).mockReturnValue(null);
      const res = {} as Response;
      expect(() => controller.downloadBackup('b1.zip', res)).toThrow(NotFoundException);
    });

    it('should send file if exists', () => {
      (backupService.getBackupPath as jest.Mock).mockReturnValue('/path/to/b1.zip');
      const res = {
        setHeader: jest.fn(),
        sendFile: jest.fn(),
      } as unknown as Response;
      
      controller.downloadBackup('b1.zip', res);
      expect(res.setHeader).toHaveBeenCalledTimes(2);
      expect(res.sendFile).toHaveBeenCalledWith('/path/to/b1.zip');
    });
  });

  describe('restoreBackup', () => {
    it('should return error if no file', async () => {
      const result = await controller.restoreBackup(null as any);
      expect(result.code).toBe(1);
    });

    it('should call service if file uploaded', async () => {
      (backupService.restoreBackup as jest.Mock).mockResolvedValue({ success: true });
      const file = { path: '/tmp/test.zip' } as any;
      expect(await controller.restoreBackup(file)).toEqual({ success: true });
      expect(backupService.restoreBackup).toHaveBeenCalledWith('/tmp/test.zip');
    });
  });

  it('should delete backup', async () => {
    (backupService.deleteBackup as jest.Mock).mockResolvedValue({ code: 0 });
    expect(await controller.deleteBackup('b1.zip')).toEqual({ code: 0 });
  });

  it('should clean local orphans', async () => {
    (backupService.cleanOrphanFiles as jest.Mock).mockResolvedValue({ deletedCount: 5, freedSize: 1024 * 1024 });
    const result = await controller.cleanOrphans();
    expect(result.code).toBe(0);
    expect(result.message).toContain('清理 5 个孤儿文件，释放 1.00 MB');
  });

  it('should get cos orphans', async () => {
    (backupService.getCosOrphanFiles as jest.Mock).mockResolvedValue({ count: 2, files: ['f1', 'f2'] });
    const result = await controller.getCosOrphans();
    expect(result.data.orphanCount).toBe(2);
  });

  it('should clean cos orphans', async () => {
    (backupService.cleanCosOrphanFiles as jest.Mock).mockResolvedValue({ deletedCount: 3, failedCount: 1 });
    const result = await controller.cleanCosOrphans();
    expect(result.message).toContain('删除 3 个云端孤儿文件，失败 1 个');
  });
});
