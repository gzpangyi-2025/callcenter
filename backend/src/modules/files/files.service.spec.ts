import { Test, TestingModule } from '@nestjs/testing';
import { FilesService } from './files.service';
import { SettingsService } from '../settings/settings.service';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { InternalServerErrorException } from '@nestjs/common';
import * as COS from 'cos-nodejs-sdk-v5';

jest.mock('@aws-sdk/client-s3');
jest.mock('cos-nodejs-sdk-v5');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3-signed-url.com/file.png'),
}));
jest.mock('qcloud-cos-sts', () => ({
  getCredential: jest.fn().mockImplementation((opt, cb) => cb(null, { credentials: { tmpSecretId: 'tmpId', tmpSecretKey: 'tmpKey', sessionToken: 'token' } })),
}));

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
    
    // Default mocks
    (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
      const config: Record<string, string> = {
        'storage.provider': 'local',
      };
      return config[key];
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getS3Instance', () => {
    it('should return null if provider is not s3', async () => {
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
  });

  describe('getCosInstance', () => {
    it('should return null if provider is not cos', async () => {
      const result = await (service as any).getCosInstance();
      expect(result).toBeNull();
    });

    it('should throw error if credentials are missing', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 'cos',
        };
        return config[key];
      });

      await expect((service as any).getCosInstance()).rejects.toThrow(InternalServerErrorException);
    });

    it('should initialize COS when provider is cos', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 'cos',
          'storage.cos.secretId': 'test-id',
          'storage.cos.secretKey': 'test-key',
          'storage.cos.region': 'ap-guangzhou',
          'storage.cos.bucket': 'test-bucket',
        };
        return config[key];
      });

      const result = await (service as any).getCosInstance();
      expect(result).not.toBeNull();
      expect(result.bucket).toBe('test-bucket');
    });
  });

  describe('getPresignedUrl', () => {
    it('should return local static url for local provider', async () => {
      const url = await service.getPresignedUrl('test.png');
      expect(url).toBe('/api/files/static/test.png');
    });

    it('should return s3 presigned url', async () => {
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

      const url = await service.getPresignedUrl('test.png');
      expect(url).toBe('https://s3-signed-url.com/file.png');
    });

    it('should return cos url', async () => {
      (settingsService.get as jest.Mock).mockImplementation(async (key: string) => {
        const config: Record<string, string> = {
          'storage.provider': 'cos',
          'storage.cos.secretId': 'test-id',
          'storage.cos.secretKey': 'test-key',
          'storage.cos.region': 'ap-guangzhou',
          'storage.cos.bucket': 'test-bucket',
        };
        return config[key];
      });

      COS.prototype.getObjectUrl = jest.fn().mockReturnValue('https://cos-url.com/test.png');

      const url = await service.getPresignedUrl('test.png');
      expect(url).toBe('https://cos-url.com/test.png');
    });
  });

  describe('deleteFromCos', () => {
    it('should delete from local (noop for this mock)', async () => {
      await expect(service.deleteFromCos('test.png')).resolves.not.toThrow();
    });

    it('should delete from s3', async () => {
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

      await expect(service.deleteFromCos('test.png')).resolves.not.toThrow();
    });
  });

  describe('generateUploadCredentials', () => {
    it('should throw for local provider', async () => {
      const result = await service.generateUploadCredentials('test.png');
      expect(result).toEqual({ provider: 'local' });
    });
  });
});
