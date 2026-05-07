import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from './backup.service';
import { DataSource } from 'typeorm';
import { SearchService } from '../search/search.service';
import { FilesService } from '../files/files.service';
import * as fs from 'fs';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn().mockReturnValue([]),
    readFileSync: jest.fn().mockReturnValue('{}'),
    unlinkSync: jest.fn(),
    statSync: jest.fn().mockReturnValue({ isFile: () => true, size: 1024, mtime: new Date() }),
    rmSync: jest.fn(),
    createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
    createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn().mockReturnValue({ on: jest.fn() }) }),
  };
});

jest.mock('archiver', () => ({
  default: jest.fn().mockReturnValue({
    pointer: jest.fn().mockReturnValue(100),
    on: jest.fn(),
    pipe: jest.fn(),
    append: jest.fn(),
    finalize: jest.fn(),
  }),
}));

describe('BackupService', () => {
  let service: BackupService;
  let dataSource: any;
  let searchService: any;
  let filesService: any;

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    searchService = {
      syncAll: jest.fn().mockResolvedValue(true),
    };

    filesService = {
      getStorageStats: jest.fn().mockResolvedValue({
        imageCount: 1,
        imageSize: 1024,
        fileCount: 1,
        fileSize: 1024,
        provider: 'local',
      }),
      listAllCosKeys: jest.fn().mockResolvedValue(['file1.png', 'file2.png']),
      deleteCosObjects: jest.fn().mockResolvedValue({ deleted: 2, failed: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: DataSource, useValue: dataSource },
        { provide: SearchService, useValue: searchService },
        { provide: FilesService, useValue: filesService },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrphanFiles', () => {
    it('should calculate orphans correctly', async () => {
      (fs.readdirSync as jest.Mock).mockReturnValue(['orphan.png']);
      (fs.statSync as jest.Mock).mockReturnValue({ isFile: () => true, size: 1000 });
      dataSource.query.mockResolvedValue([]); // No references
      const result = await service.getOrphanFiles();
      expect(result.count).toBe(1);
      expect(result.files).toContain('orphan.png');
    });
  });

  describe('cleanOrphanFiles', () => {
    it('should delete orphan files', async () => {
      jest.spyOn(service, 'getOrphanFiles').mockResolvedValue({ files: ['orphan.png'], count: 1, totalSize: 1000 });
      const result = await service.cleanOrphanFiles();
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.deletedCount).toBe(1);
    });
  });

  describe('getCosOrphanFiles', () => {
    it('should return COS orphans', async () => {
      filesService.listAllCosKeys.mockResolvedValue(['cos-orphan.png']);
      dataSource.query.mockResolvedValue([]); // No references
      const result = await service.getCosOrphanFiles();
      expect(result.count).toBe(1);
      expect(result.files).toContain('cos-orphan.png');
    });
  });

  describe('cleanCosOrphanFiles', () => {
    it('should call deleteCosObjects', async () => {
      jest.spyOn(service, 'getCosOrphanFiles').mockResolvedValue({ count: 1, files: ['cos-orphan.png'] });
      const result = await service.cleanCosOrphanFiles();
      expect(filesService.deleteCosObjects).toHaveBeenCalledWith(['cos-orphan.png']);
      expect(result.deletedCount).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return system stats', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ Tables_in_db: 'users' }]) // SHOW TABLES
        .mockResolvedValueOnce([{ cnt: '5' }]); // COUNT(*)
      
      const result = await service.getStats();
      expect(result.code).toBe(0);
      expect(result.data.tableCount).toBe(1);
      expect(result.data.provider).toBe('local');
    });
  });

  describe('deleteBackup', () => {
    it('should delete a file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = service.deleteBackup('b1.zip');
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.code).toBe(0);
    });

    it('should return error if not exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = service.deleteBackup('b1.zip');
      expect(result.code).toBe(1);
    });
  });

  describe('getBackupPath', () => {
    it('should return path if exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = service.getBackupPath('test.zip');
      expect(result).toContain('test.zip');
    });

    it('should return null if not exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = service.getBackupPath('test.zip');
      expect(result).toBeNull();
    });
  });
});
