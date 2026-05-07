import { Test, TestingModule } from '@nestjs/testing';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';

describe('FilesController', () => {
  let controller: FilesController;
  let filesService: FilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        {
          provide: FilesService,
          useValue: {
            getPresignedUrl: jest.fn(),
            generateUploadCredentials: jest.fn(),
            confirmUpload: jest.fn(),
            uploadToCos: jest.fn(),
            migrationState: { isMigrating: false },
          },
        },
      ],
    }).compile();

    controller = module.get<FilesController>(FilesController);
    filesService = module.get<FilesService>(FilesService);
  });

  describe('downloadFile', () => {
    it('should redirect to URL', async () => {
      const mockRes = {
        redirect: jest.fn(),
      } as unknown as Response;
      (filesService.getPresignedUrl as jest.Mock).mockResolvedValue('https://cos-url.com/test.png');

      await controller.downloadFile({ path: '/api/files/download/test.png' } as any, 'test.png', mockRes);
      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'https://cos-url.com/test.png');
    });
  });

  describe('serveStatic', () => {
    it('should throw if not a public preview image', async () => {
      const mockRes = {} as Response;
      await expect(controller.serveStatic({ path: '/api/files/static/test.pdf' } as any, mockRes)).rejects.toThrow(ForbiddenException);
    });

    it('should redirect to presigned URL', async () => {
      const mockRes = {
        redirect: jest.fn(),
      } as unknown as Response;
      (filesService.getPresignedUrl as jest.Mock).mockResolvedValue('https://cos-url.com/test.png');

      await controller.serveStatic({ path: '/api/files/static/test.png' } as any, mockRes);
      expect(mockRes.redirect).toHaveBeenCalledWith(302, 'https://cos-url.com/test.png');
    });
  });

  describe('getUploadCredentials', () => {
    it('should throw if no filename', async () => {
      await expect(controller.getUploadCredentials('')).rejects.toThrow(BadRequestException);
    });

    it('should return credentials', async () => {
      (filesService.generateUploadCredentials as jest.Mock).mockResolvedValue({ tmpSecretId: 'tmp' });
      const result = await controller.getUploadCredentials('test.png');
      expect(result.code).toBe(0);
      expect(result.data).toBeDefined();
      expect(filesService.generateUploadCredentials).toHaveBeenCalledWith(expect.stringContaining('callcenter/others/'));
    });

    it('should include module directory prefix if moduleName is provided', async () => {
      (filesService.generateUploadCredentials as jest.Mock).mockResolvedValue({ tmpSecretId: 'tmp' });
      const result = await controller.getUploadCredentials('test.png', 'tickets');
      expect(result.code).toBe(0);
      expect(filesService.generateUploadCredentials).toHaveBeenCalledWith(expect.stringContaining('callcenter/tickets/'));
    });
  });

  describe('confirmUpload', () => {
    it('should confirm successfully', async () => {
      (filesService.confirmUpload as jest.Mock).mockResolvedValue(true);
      const result = await controller.confirmUpload('test.png', 'test.png', 100, 'image/png');
      expect(result.code).toBe(0);
    });

    it('should throw if invalid file type', async () => {
      await expect(controller.confirmUpload('test.exe', 'test.exe', 100, 'application/exe')).rejects.toThrow(BadRequestException);
    });
  });

  describe('uploadFile', () => {
    it('should throw if no file', async () => {
      await expect(controller.uploadFile(null as any)).rejects.toThrow(BadRequestException);
    });

    it('should upload successfully', async () => {
      const mockFile = {
        originalname: 'test.png',
        mimetype: 'image/png',
        buffer: Buffer.from('test'),
        size: 100,
      } as Express.Multer.File;

      const result = await controller.uploadFile(mockFile);
      expect(result.code).toBe(0);
      expect(result.data.filename).toContain('.png');
      expect(result.data.filename).toContain('callcenter/others/');
      expect(filesService.uploadToCos).toHaveBeenCalled();
    });

    it('should upload successfully with module prefix', async () => {
      const mockFile = {
        originalname: 'test.png',
        mimetype: 'image/png',
        buffer: Buffer.from('test'),
        size: 100,
      } as Express.Multer.File;

      const result = await controller.uploadFile(mockFile, 'bbs');
      expect(result.code).toBe(0);
      expect(result.data.filename).toContain('callcenter/bbs/');
      expect(filesService.uploadToCos).toHaveBeenCalled();
    });
  });
});
