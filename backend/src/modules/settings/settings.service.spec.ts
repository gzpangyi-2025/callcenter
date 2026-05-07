import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Setting } from '../../entities/setting.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        {
          provide: getRepositoryToken(Setting),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  describe('onModuleInit', () => {
    it('should refresh cache on module init', async () => {
      repo.find.mockResolvedValue([{ key: 'testKey', value: 'testValue' }]);
      await service.onModuleInit();
      const all = await service.getAll();
      expect(all).toEqual({ testKey: 'testValue' });
    });
  });

  describe('refreshCache', () => {
    it('should load settings into cache', async () => {
      repo.find.mockResolvedValue([{ key: 'k1', value: 'v1' }]);
      await service.refreshCache();
      expect(await service.get('k1')).toBe('v1');
    });
  });

  describe('saveMany', () => {
    it('should save multiple settings and refresh cache', async () => {
      repo.find.mockResolvedValue([
        { key: 'k1', value: 'v1' },
        { key: 'k2', value: 'v2' }
      ]);
      await service.saveMany({ k1: 'v1', k2: 'v2' });
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(await service.get('k1')).toBe('v1');
    });
  });

  describe('set', () => {
    it('should save single setting and refresh cache', async () => {
      repo.find.mockResolvedValue([{ key: 'k1', value: 'v1' }]);
      await service.set('k1', 'v1');
      expect(repo.save).toHaveBeenCalledWith({ key: 'k1', value: 'v1' });
      expect(await service.get('k1')).toBe('v1');
    });
  });
});
