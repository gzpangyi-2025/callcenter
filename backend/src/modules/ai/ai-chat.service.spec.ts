import { Test, TestingModule } from '@nestjs/testing';
import { AiChatService } from './ai-chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiChatSession } from '../../entities/ai-chat-session.entity';
import { AiChatMessage } from '../../entities/ai-chat-message.entity';
import { SettingsService } from '../settings/settings.service';
import { AiService } from './ai.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai');

describe('AiChatService', () => {
  let service: AiChatService;
  let sessionRepo: any;
  let messageRepo: any;
  let settingsService: any;
  let aiService: any;

  beforeEach(async () => {
    sessionRepo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'session-1' })),
      find: jest.fn(),
      remove: jest.fn(),
    };

    messageRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'msg-1' })),
      find: jest.fn().mockResolvedValue([]),
    };

    settingsService = {
      getAll: jest.fn().mockResolvedValue({
        'ai.chatApiKey': 'test-key',
        'ai.chatModel': 'gemini-test',
      }),
    };

    aiService = {
      createTask: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiChatService,
        {
          provide: getRepositoryToken(AiChatSession),
          useValue: sessionRepo,
        },
        {
          provide: getRepositoryToken(AiChatMessage),
          useValue: messageRepo,
        },
        {
          provide: SettingsService,
          useValue: settingsService,
        },
        {
          provide: AiService,
          useValue: aiService,
        },
      ],
    }).compile();

    service = module.get<AiChatService>(AiChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listSessions', () => {
    it('should return user sessions', async () => {
      sessionRepo.find.mockResolvedValue([{ id: 'session-1' }]);
      const sessions = await service.listSessions(1);
      expect(sessions).toEqual([{ id: 'session-1' }]);
      expect(sessionRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1 } }));
    });
  });

  describe('getSession', () => {
    it('should return session and messages', async () => {
      sessionRepo.findOne.mockResolvedValue({ id: 'session-1' });
      messageRepo.find.mockResolvedValue([{ id: 'msg-1', content: 'hello' }]);

      const result = await service.getSession('session-1', 1);
      expect(result.id).toBe('session-1');
      expect(result.messages).toHaveLength(1);
    });

    it('should throw if session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.getSession('nonexistent', 1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteSession', () => {
    it('should delete session', async () => {
      sessionRepo.findOne.mockResolvedValue({ id: 'session-1' });
      await service.deleteSession('session-1', 1);
      expect(sessionRepo.remove).toHaveBeenCalled();
    });
  });

  describe('injectMessage', () => {
    it('should inject a message and update session', async () => {
      const session = { id: 'session-1', updatedAt: new Date() };
      sessionRepo.findOne.mockResolvedValue(session);

      await service.injectMessage('session-1', 1, 'system', 'test msg');

      expect(sessionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
      expect(messageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        role: 'system',
        content: 'test msg',
      }));
    });

    it('should throw NotFoundException if session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      await expect(service.injectMessage('session-1', 1, 'system', 'test msg')).rejects.toThrow(NotFoundException);
    });
  });
});
