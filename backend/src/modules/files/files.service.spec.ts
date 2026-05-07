import { Test, TestingModule } from '@nestjs/testing';
import { FilesService } from './files.service';
import { SettingsService } from '../settings/settings.service';
import { S3Client } from '@aws-sdk/client-s3';
import { InternalServerErrorException } from '@nestjs/common';

describe('FilesService', () => {
  let service: FilesService;
  let settingsService: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        {
          provide: SettingsService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getS3Instance', () => {
    it('should return null if provider is not s3', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 'local',
        };
        return config[key];
      });

      const result = await (service as any).getS3Instance();
      expect(result).toBeNull();
    });

    it('should initialize S3Client when provider is s3', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 's3',
          'storage.s3.endpoint': 'https://s3.example.com',
          'storage.s3.accessKey': 'test-ak',
          'storage.s3.secretKey': 'test-sk',
          'storage.s3.region': 'us-east-1',
          'storage.s3.bucket': 'test-bucket',
        };
        return config[key];
      });

      const result = await (service as any).getS3Instance();
      
      expect(result).not.toBeNull();
      expect(result.s3).toBeInstanceOf(S3Client);
      expect(result.bucket).toBe('test-bucket');
    });

    it('should throw error if credentials are missing', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 's3',
        };
        return config[key];
      });

      await expect((service as any).getS3Instance()).rejects.toThrow(InternalServerErrorException);
    });

    it('should cache S3Client instance if config string matches', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 's3',
          'storage.s3.endpoint': 'https://s3.example.com',
          'storage.s3.accessKey': 'test-ak',
          'storage.s3.secretKey': 'test-sk',
          'storage.s3.region': 'us-east-1',
          'storage.s3.bucket': 'test-bucket',
        };
        return config[key];
      });

      const result1 = await (service as any).getS3Instance();
      const result2 = await (service as any).getS3Instance();
      
      expect(result1.s3).toBe(result2.s3); // Same instance
    });
  });
});
