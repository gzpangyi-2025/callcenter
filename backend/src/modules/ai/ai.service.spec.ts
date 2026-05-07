import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { FilesService } from '../files/files.service';
import axios from 'axios';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

jest.mock('axios');

describe('AiService', () => {
  let service: AiService;
  let configService: ConfigService;
  let mockAxiosInstance: any;

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue),
          },
        },
        {
          provide: FilesService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTask', () => {
    it('should successfully post a task', async () => {
      const dto = { type: 'test', params: {} };
      mockAxiosInstance.post.mockResolvedValue({ data: { id: 'task-1' } });
      const result = await service.createTask(dto, 1);
      expect(result).toEqual({ id: 'task-1' });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/tasks', { ...dto, userId: 1 });
    });

    it('should throw ServiceUnavailableException on network error', async () => {
      mockAxiosInstance.post.mockRejectedValue({ code: 'ECONNREFUSED', message: 'Connection refused' });
      await expect(service.createTask({ type: 'test', params: {} }, 1)).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getTask', () => {
    it('should return task data', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: { id: 'task-1' } });
      const result = await service.getTask('task-1');
      expect(result).toEqual({ id: 'task-1' });
    });

    it('should throw NotFoundException on 404', async () => {
      mockAxiosInstance.get.mockRejectedValue({ response: { status: 404 } });
      await expect(service.getTask('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTask', () => {
    it('should delete task successfully', async () => {
      mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });
      const result = await service.deleteTask('task-1');
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDirectDownloadUrl', () => {
    it('should extract correct file url', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [{ name: 'test.png', url: 'http://cos.url/test.png', size: 100 }],
      });
      const result = await service.getDirectDownloadUrl('task-1', 'test.png');
      expect(result.url).toBe('http://cos.url/test.png');
    });

    it('should throw NotFoundException if file not in list', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: [{ name: 'other.png', url: 'http://cos.url/other.png', size: 100 }],
      });
      await expect(service.getDirectDownloadUrl('task-1', 'test.png')).rejects.toThrow(NotFoundException);
    });
  });
});
