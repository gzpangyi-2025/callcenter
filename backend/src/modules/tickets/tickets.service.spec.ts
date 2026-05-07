import { Test, TestingModule } from '@nestjs/testing';
import { TicketsService } from './tickets.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Ticket, TicketStatus } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { TicketReadState } from '../../entities/ticket-read-state.entity';
import { Message } from '../../entities/message.entity';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('TicketsService', () => {
  let service: TicketsService;
  let mockTicketRepo: any;
  let mockUserRepo: any;
  let mockReadStateRepo: any;
  let mockMessageRepo: any;
  let mockChatGateway: any;
  let mockChatService: any;
  let mockAuditService: any;

  beforeEach(async () => {
    mockTicketRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 1 })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 1 })),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      remove: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(0),
    };

    mockUserRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockReadStateRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    };

    mockMessageRepo = {
      count: jest.fn().mockResolvedValue(0),
    };

    mockChatGateway = {
      server: {
        emit: jest.fn(),
        to: jest.fn().mockReturnValue({ emit: jest.fn() }),
      },
    };

    mockChatService = {
      createMessage: jest.fn(),
      getUnreadCounts: jest.fn().mockResolvedValue({}),
    };

    mockAuditService = {
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getRepositoryToken(Ticket), useValue: mockTicketRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(TicketReadState), useValue: mockReadStateRepo },
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('token') } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
    
    // Override the findOne method to avoid QueryBuilder mocking issues
    service.findOne = jest.fn().mockResolvedValue({ id: 1, ticketNo: 'TK-001', title: 'Test', creatorId: 99, assigneeId: null, status: TicketStatus.PENDING, participants: [] });
  });

  describe('create', () => {
    it('should create a ticket', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, role: { id: 3 } });
      const createDto = { title: 'Test', description: 'Desc' };
      const result = await service.create(createDto as any, 1);
      expect(result).toHaveProperty('id', 1);
      expect(result).toHaveProperty('title', 'Test');
      expect(mockTicketRepo.save).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('deleteTicket', () => {
    const adminUser = { id: 1, role: { name: 'admin', permissions: [] } };
    const normalUser = { id: 2, role: { name: 'user', permissions: [] } };

    it('should allow admin to delete any ticket', async () => {
      await expect(service.deleteTicket(1, adminUser as any)).resolves.not.toThrow();
      expect(mockTicketRepo.remove).toHaveBeenCalled();
    });

    it("should deny user from deleting another user's ticket", async () => {
      await expect(service.deleteTicket(1, normalUser as any)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('batchDelete', () => {
    it('should delete all tickets when admin', async () => {
      const tickets = [
        { id: 1, ticketNo: 'TK-001', title: 'A', creatorId: 99 },
        { id: 2, ticketNo: 'TK-002', title: 'B', creatorId: 88 },
      ];
      mockTicketRepo.find.mockResolvedValue(tickets);
      const adminUser = { id: 1, role: { name: 'admin', permissions: [] } };
      await service.batchDelete([1, 2], adminUser as any);
      expect(mockTicketRepo.remove).toHaveBeenCalledTimes(2);
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it("should throw ForbiddenException when user tries to delete others' tickets", async () => {
      const tickets = [{ id: 1, ticketNo: 'TK-001', title: 'A', creatorId: 99 }];
      mockTicketRepo.find.mockResolvedValue(tickets);
      const normalUser = { id: 2, role: { name: 'user', permissions: [] } };
      await expect(service.batchDelete([1], normalUser as any)).rejects.toThrow(ForbiddenException);
    });
  });
});
