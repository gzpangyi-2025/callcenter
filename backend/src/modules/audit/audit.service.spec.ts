import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog, AuditType } from '../../entities/audit-log.entity';
import { Setting } from '../../entities/setting.entity';

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: any;
  let settingRepo: any;

  beforeEach(async () => {
    const qbMock = {
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(10),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 1 }]),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };

    auditRepo = {
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn(),
      createQueryBuilder: jest.fn(() => qbMock),
    };

    settingRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Setting), useValue: settingRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should log event if setting is not false', async () => {
      settingRepo.findOne.mockResolvedValue({ value: 'true' });
      await service.log({ type: AuditType.AI_TASK, action: 'test' });
      expect(auditRepo.create).toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('should not log event if setting is false', async () => {
      settingRepo.findOne.mockResolvedValue({ value: 'false' });
      await service.log({ type: AuditType.AI_TASK, action: 'test' });
      expect(auditRepo.create).not.toHaveBeenCalled();
      expect(auditRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated logs', async () => {
      const result = await service.findAll({ page: 1, pageSize: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(10);
    });
  });

  describe('batchDelete', () => {
    it('should delete logs by criteria', async () => {
      const result = await service.batchDelete({ type: 'ai_task' });
      expect(result.deleted).toBe(10);
      expect(auditRepo.createQueryBuilder().execute).toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('should save settings properly', async () => {
      settingRepo.findOne.mockResolvedValue(null);
      await service.updateSettings({ ai_task: false });
      expect(settingRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        key: 'audit.ai_task',
        value: 'false',
      }));
    });
  });
});
