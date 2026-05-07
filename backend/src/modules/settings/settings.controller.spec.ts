import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');

describe('SettingsController', () => {
  let controller: SettingsController;
  let settingsService: SettingsService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: SettingsService,
          useValue: {
            getAll: jest.fn(),
            saveMany: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key, defaultValue) => defaultValue),
          },
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    settingsService = module.get<SettingsService>(SettingsService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('saveCodexConfig', () => {
    it('should save to DB and push config to Worker successfully', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { success: true } });

      const body = {
        concurrency: 4,
        maxResumeAttempts: 5,
        storageProvider: 's3',
        s3Endpoint: 'test',
      };

      const result = await controller.saveCodexConfig(body);

      expect(settingsService.saveMany).toHaveBeenCalledWith({
        'codex.concurrency': '4',
        'codex.maxResumeAttempts': '5',
      });

      expect(axios.post).toHaveBeenCalledWith(
        'http://43.130.240.106:3100/api/config',
        {
          concurrency: 4,
          maxResumeAttempts: 5,
          storageProvider: 's3',
          s3Endpoint: 'test',
        },
        expect.any(Object)
      );

      expect(result.data.workerUpdated).toBe(true);
    });

    it('should gracefully handle Worker unreachable', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('Network Error'));

      const body = { concurrency: 2 };
      const result = await controller.saveCodexConfig(body);

      expect(settingsService.saveMany).toHaveBeenCalled();
      expect(result.data.workerUpdated).toBe(false);
    });
  });
});
