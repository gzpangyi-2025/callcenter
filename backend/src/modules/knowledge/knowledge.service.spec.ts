import { Test, TestingModule } from '@nestjs/testing';
import { KnowledgeService } from './knowledge.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message } from '../../entities/message.entity';
import { SettingsService } from '../settings/settings.service';
import { FilesService } from '../files/files.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let mockKnowledgeRepo: any;
  let mockTicketRepo: any;
  let mockMessageRepo: any;
  let mockSettingsService: any;
  let mockFilesService: any;

  beforeEach(async () => {
    mockKnowledgeRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: 1 })),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[{ id: 1, ticketId: 1 }], 1]),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockTicketRepo = {
      findOne: jest.fn(),
    };

    mockMessageRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockSettingsService = {
      getAll: jest.fn().mockResolvedValue({
        'ai.visionApiKey': 'test-key',
        'ai.systemPrompt': 'test-prompt',
      }),
    };

    mockFilesService = {
      getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
      uploadToCos: jest.fn().mockResolvedValue('http://test.url/img.png'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: getRepositoryToken(KnowledgeDoc), useValue: mockKnowledgeRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: FilesService, useValue: mockFilesService },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);
  });

  describe('saveKnowledge', () => {
    it('should save knowledge', async () => {
      const dto = { ticketId: 1, title: 'Title', content: 'Content' };
      const result = await service.saveKnowledge(dto);
      expect(result).toHaveProperty('id', 1);
      expect(mockKnowledgeRepo.save).toHaveBeenCalled();
    });
  });

  describe('getByTicketId', () => {
    it('should return doc by ticket id', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1 });
      const result = await service.getByTicketId(1);
      expect(result).toHaveProperty('id', 1);
    });
  });

  describe('getByTicketIdAndType', () => {
    it('should return doc by ticket id and type', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1 });
      const result = await service.getByTicketIdAndType(1, 'ai_doc');
      expect(result).toHaveProperty('id', 1);
    });
  });

  describe('getDocById', () => {
    it('should return doc when found', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1 });
      const result = await service.getDocById(1);
      expect(result).toHaveProperty('id', 1);
    });

    it('should throw NotFoundException if not found', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue(null);
      await expect(service.getDocById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDocAndSafeName', () => {
    it('should return doc and safe name', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1, ticketId: 1, title: 'Test Doc' });
      mockTicketRepo.findOne.mockResolvedValue({ id: 1, ticketNo: 'TK-1', title: 'Ticket Title' });
      const result = await service.getDocAndSafeName(1);
      expect(result.doc).toBeDefined();
      expect(result.safeName).toBe('TK-1_Ticket Title');
    });
  });

  describe('searchKnowledge', () => {
    it('should search without keyword', async () => {
      const result = await service.searchKnowledge('');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should search with keyword', async () => {
      const result = await service.searchKnowledge('test');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('exportChatHistory', () => {
    it('should export chat history', async () => {
      mockTicketRepo.findOne.mockResolvedValue({
        id: 1,
        ticketNo: 'TK-1',
        title: 'Title',
        messages: [{ id: 1, content: 'msg', createdAt: new Date() }],
      });
      const result = await service.exportChatHistory(1, 'admin');
      expect(result).toHaveProperty('id', 1);
    });

    it('should throw NotFoundException if ticket missing', async () => {
      mockTicketRepo.findOne.mockResolvedValue(null);
      await expect(service.exportChatHistory(999, 'admin')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateKnowledge', () => {
    it('should update knowledge doc', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1, content: 'old' });
      mockKnowledgeRepo.save.mockImplementation(async (doc) => doc);
      const result = await service.updateKnowledge(1, 'new content', 'new title', 'tag1');
      expect(result.content).toBe('new content');
      expect(result.title).toBe('new title');
    });
  });

  describe('deleteKnowledge', () => {
    it('should delete knowledge doc', async () => {
      await service.deleteKnowledge(1);
      expect(mockKnowledgeRepo.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('generateKnowledge', () => {
    it('should throw NotFoundException if ticket not found', async () => {
      mockTicketRepo.findOne.mockResolvedValue(null);
      await expect(service.generateKnowledge(999)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if ticket not closed', async () => {
      mockTicketRepo.findOne.mockResolvedValue({
        id: 1, status: 'in_progress', ticketNo: 'TK-1',
      });
      await expect(service.generateKnowledge(1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if no AI API key', async () => {
      mockTicketRepo.findOne.mockResolvedValue({
        id: 1, status: 'closed', ticketNo: 'TK-1',
      });
      mockSettingsService.getAll.mockResolvedValue({});
      await expect(service.generateKnowledge(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateKnowledge (without optional params)', () => {
    it('should update content only when title/tags not provided', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1, title: 'Old', content: 'old', tags: 't' });
      mockKnowledgeRepo.save.mockImplementation(async (doc) => doc);
      const result = await service.updateKnowledge(1, 'new content');
      expect(result.content).toBe('new content');
      expect(result.title).toBe('Old'); // unchanged
    });
  });

  describe('getDocAndSafeName (no ticket)', () => {
    it('should fallback to doc title when ticket not found', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue({ id: 1, ticketId: 999, title: 'Doc Title' });
      mockTicketRepo.findOne.mockResolvedValue(null);
      const result = await service.getDocAndSafeName(1);
      expect(result.safeName).toContain('Doc Title');
    });
  });

  describe('searchKnowledge with docType', () => {
    it('should filter by specified docType', async () => {
      const result = await service.searchKnowledge('', 1, 20, 'chat_history');
      expect(result.items).toBeDefined();
    });
  });

  describe('getByTicketId (null case)', () => {
    it('should return null when no doc exists', async () => {
      mockKnowledgeRepo.findOne.mockResolvedValue(null);
      const result = await service.getByTicketId(999);
      expect(result).toBeNull();
    });
  });
});
