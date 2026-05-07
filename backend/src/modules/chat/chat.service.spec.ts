import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Message } from '../../entities/message.entity';
import { Ticket } from '../../entities/ticket.entity';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';

import { SearchService } from '../search/search.service';
import { FilesService } from '../files/files.service';

describe('ChatService', () => {
  let service: ChatService;
  let mockMessageRepo: any;
  let mockTicketRepo: any;

  beforeEach(async () => {
    mockMessageRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: 1 })),
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[{ id: 1, createdAt: new Date() }], 1]),
    };
    mockTicketRepo = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: SearchService, useValue: { indexMessage: jest.fn().mockResolvedValue(true) } },
        { provide: FilesService, useValue: {} },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('createMessage', () => {
    it('should create message and return it', async () => {
      mockMessageRepo.findOne.mockResolvedValue({ id: 1, content: 'test', type: 'text' });
      const data = { ticketId: 1, senderId: 1, content: 'test', type: 'text' as any };
      const result = await service.createMessage(data);
      expect(result).toHaveProperty('id', 1);
      expect(mockMessageRepo.save).toHaveBeenCalled();
    });
  });

  describe('recallMessage', () => {
    it('should recall message successfully', async () => {
      const tenMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
      mockMessageRepo.findOne.mockResolvedValue({
        id: 1, 
        senderId: 1, 
        ticketId: 1, 
        type: 'text', 
        content: 'old',
        createdAt: tenMinsAgo
      });
      
      await service.recallMessage(1, 1, 'admin');
      
      expect(mockMessageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('已被撤回'),
        isRecalled: true
      }));
    });

    it('should throw if message not found', async () => {
      mockMessageRepo.findOne.mockResolvedValue(null);
      await expect(service.recallMessage(1, 1, 'admin')).rejects.toThrow(NotFoundException);
    });

    it('should throw if wrong sender', async () => {
      mockMessageRepo.findOne.mockResolvedValue({
        id: 1, 
        senderId: 2, 
        ticketId: 1, 
        type: 'text', 
        content: 'old',
        createdAt: new Date()
      });
      await expect(service.recallMessage(1, 1, 'admin')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMessagesByTicket', () => {
    it('should get messages by ticket', async () => {
      const result = await service.getMessagesByTicket(1);
      expect(result.items).toHaveLength(1);
      expect(mockMessageRepo.findAndCount).toHaveBeenCalled();
    });
  });
});
