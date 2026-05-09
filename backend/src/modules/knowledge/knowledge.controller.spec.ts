import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

type MockService = Record<string, jest.Mock>;
type MockResponse = Response & {
  setHeader: jest.Mock;
  send: jest.Mock;
};

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  let mockKnowledgeService: MockService;

  beforeEach(async () => {
    mockKnowledgeService = {
      generateKnowledge: jest.fn().mockResolvedValue({ content: 'draft' }),
      exportChatHistory: jest.fn().mockResolvedValue({ id: 1 }),
      saveKnowledge: jest.fn().mockResolvedValue({ id: 1 }),
      updateKnowledge: jest.fn().mockResolvedValue({ id: 1 }),
      searchKnowledge: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getByTicketId: jest.fn().mockResolvedValue({ id: 1 }),
      getByTicketIdAndType: jest.fn().mockResolvedValue(null),
      getDocById: jest.fn().mockResolvedValue({ id: 1 }),
      deleteKnowledge: jest.fn().mockResolvedValue(undefined),
      getDocAndSafeName: jest.fn().mockResolvedValue({
        doc: { content: 'md content' },
        safeName: 'doc',
      }),
      exportDocx: jest.fn().mockResolvedValue(Buffer.from('docx')),
      exportZip: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeService, useValue: mockKnowledgeService },
      ],
    }).compile();

    controller = module.get<KnowledgeController>(KnowledgeController);
  });

  describe('generateDraft', () => {
    it('should generate draft', async () => {
      const result = await controller.generateDraft('1');
      expect(result.data.content).toBe('draft');
    });
  });

  describe('exportChat', () => {
    it('should export chat', async () => {
      const req = { user: { username: 'admin' } } as Request;
      const result = await controller.exportChat('1', req);
      expect(result.data.id).toBe(1);
    });
  });

  describe('saveKnowledge', () => {
    it('should save knowledge', async () => {
      const dto = { ticketId: 1, title: 'Test', content: 'Content' };
      const result = await controller.saveKnowledge(dto);
      expect(result.data.id).toBe(1);
    });
  });

  describe('updateKnowledge', () => {
    it('should update knowledge', async () => {
      const result = await controller.updateKnowledge('1', { content: 'new' });
      expect(result.data.id).toBe(1);
    });
  });

  describe('search', () => {
    it('should search knowledge', async () => {
      const result = await controller.search('q', '1', '10', 'ai_doc');
      expect(result.data.total).toBe(0);
    });
  });

  describe('getByTicket', () => {
    it('should get by ticket', async () => {
      const result = await controller.getByTicket('1');
      expect(result.data.id).toBe(1);
    });
  });

  describe('getOne', () => {
    it('should get one', async () => {
      const result = await controller.getOne('1');
      expect(result.data.id).toBe(1);
    });
  });

  describe('deleteOne', () => {
    it('should delete one', async () => {
      const result = await controller.deleteOne('1');
      expect(result.code).toBe(0);
    });
  });

  describe('exportMd', () => {
    it('should export md', async () => {
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as MockResponse;
      await controller.exportMd('1', res);
      expect(res.send).toHaveBeenCalledWith('md content');
    });
  });

  describe('exportDocx', () => {
    it('should export docx', async () => {
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as unknown as MockResponse;
      await controller.exportDocx('1', res);
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('exportZip', () => {
    it('should export zip', async () => {
      const res = {} as Response;
      await controller.exportZip('1', res);
      expect(mockKnowledgeService.exportZip).toHaveBeenCalledWith(1, res);
    });
  });
});
