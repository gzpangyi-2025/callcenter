import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiChatService } from './ai-chat.service';
import { AuditService } from '../audit/audit.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';

describe('AiController', () => {
  let controller: AiController;
  let aiService: AiService;
  let aiChatService: AiChatService;
  let auditService: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        {
          provide: AiService,
          useValue: {
            workerHealth: jest.fn(),
            getTemplates: jest.fn(),
            getUploadUrl: jest.fn(),
            createTask: jest.fn(),
            listTasks: jest.fn(),
            getTask: jest.fn(),
            cancelTask: jest.fn(),
            deleteTask: jest.fn(),
            resumeTask: jest.fn(),
            getTaskFiles: jest.fn(),
            getDirectDownloadUrl: jest.fn(),
            proxyDownload: jest.fn(),
            proxyLogStream: jest.fn(),
          },
        },
        {
          provide: AiChatService,
          useValue: {
            chatStream: jest.fn(),
            listSessions: jest.fn(),
            getSession: jest.fn(),
            injectMessage: jest.fn(),
            deleteSession: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AiController>(AiController);
    aiService = module.get<AiService>(AiService);
    aiChatService = module.get<AiChatService>(AiChatService);
    auditService = module.get<AuditService>(AuditService);
  });

  describe('createTask', () => {
    it('should create a task and log audit', async () => {
      const mockUser = { id: 1, username: 'testuser' };
      const req = { user: mockUser, ip: '127.0.0.1' } as any;
      const body = { type: 'test-type', params: {} };

      (aiService.createTask as jest.Mock).mockResolvedValue({ code: 0, data: { id: 'task-1' } });

      const result = await controller.createTask(body, req);

      expect(result.code).toBe(0);
      expect(aiService.createTask).toHaveBeenCalledWith(body, 1);
      expect(auditService.log).toHaveBeenCalled();
    });
  });

  describe('listTasks', () => {
    it('should list tasks for current user', async () => {
      const mockUser = { id: 1, role: { name: 'user' } };
      const req = { user: mockUser } as any;

      (aiService.listTasks as jest.Mock).mockResolvedValue({ code: 0, data: [] });

      const result = await controller.listTasks(req, '1', '10');

      expect(result.code).toBe(0);
      expect(aiService.listTasks).toHaveBeenCalledWith({ page: 1, limit: 10, userId: 1 });
    });
  });

  describe('chatSessions', () => {
    it('should return user chat sessions', async () => {
      const mockUser = { id: 1 };
      const req = { user: mockUser } as any;

      (aiChatService.listSessions as jest.Mock).mockResolvedValue([]);

      const result = await controller.chatSessions(req);

      expect(result.code).toBe(0);
      expect(result.data).toEqual([]);
      expect(aiChatService.listSessions).toHaveBeenCalledWith(1);
    });
  });
});
