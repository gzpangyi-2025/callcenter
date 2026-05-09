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
import { AuthenticatedUser } from '../../common/types/auth.types';
import { CreateTicketDto, UpdateTicketDto } from './dto/ticket.dto';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

type MockRepository = Record<string, jest.Mock>;
type MockGateway = {
  server: {
    emit: jest.Mock;
    to: jest.Mock;
  };
};

describe('TicketsService', () => {
  let service: TicketsService;
  let mockTicketRepo: MockRepository;
  let mockUserRepo: MockRepository;
  let mockReadStateRepo: MockRepository;
  let mockMessageRepo: MockRepository;
  let mockChatGateway: MockGateway;
  let mockChatService: MockRepository;
  let mockAuditService: MockRepository;

  beforeEach(async () => {
    mockTicketRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 1 })),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ ...entity, id: entity.id || 1 }),
        ),
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
        {
          provide: getRepositoryToken(TicketReadState),
          useValue: mockReadStateRepo,
        },
        { provide: getRepositoryToken(Message), useValue: mockMessageRepo },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: ChatService, useValue: mockChatService },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('token') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);

    // Override the findOne method to avoid QueryBuilder mocking issues
    service.findOne = jest.fn().mockResolvedValue({
      id: 1,
      ticketNo: 'TK-001',
      title: 'Test',
      creatorId: 99,
      assigneeId: null,
      status: TicketStatus.PENDING,
      participants: [],
    });
  });

  describe('create', () => {
    it('should create a ticket', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 1, role: { id: 3 } });
      const createDto = { title: 'Test', description: 'Desc' };
      const result = await service.create(createDto as CreateTicketDto, 1);
      expect(result).toHaveProperty('id', 1);
      expect(result).toHaveProperty('title', 'Test');
      expect(mockTicketRepo.save).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('deleteTicket', () => {
    const adminUser: AuthenticatedUser = {
      id: 1,
      username: 'admin',
      role: { id: 1, name: 'admin', permissions: [] },
    };
    const normalUser: AuthenticatedUser = {
      id: 2,
      username: 'user',
      role: { id: 2, name: 'user', permissions: [] },
    };

    it('should allow admin to delete any ticket', async () => {
      await expect(service.deleteTicket(1, adminUser)).resolves.not.toThrow();
      expect(mockTicketRepo.remove).toHaveBeenCalled();
    });

    it("should deny user from deleting another user's ticket", async () => {
      await expect(service.deleteTicket(1, normalUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('batchDelete', () => {
    it('should delete all tickets when admin', async () => {
      const tickets = [
        { id: 1, ticketNo: 'TK-001', title: 'A', creatorId: 99 },
        { id: 2, ticketNo: 'TK-002', title: 'B', creatorId: 88 },
      ];
      mockTicketRepo.find.mockResolvedValue(tickets);
      const adminUser: AuthenticatedUser = {
        id: 1,
        username: 'admin',
        role: { id: 1, name: 'admin', permissions: [] },
      };
      await service.batchDelete([1, 2], adminUser);
      expect(mockTicketRepo.remove).toHaveBeenCalledTimes(2);
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it("should throw ForbiddenException when user tries to delete others' tickets", async () => {
      const tickets = [
        { id: 1, ticketNo: 'TK-001', title: 'A', creatorId: 99 },
      ];
      mockTicketRepo.find.mockResolvedValue(tickets);
      const normalUser: AuthenticatedUser = {
        id: 2,
        username: 'user',
        role: { id: 2, name: 'user', permissions: [] },
      };
      await expect(service.batchDelete([1], normalUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findOne', () => {
    beforeEach(() => {
      // Restore real findOne for these tests
      service.findOne = TicketsService.prototype.findOne.bind(service);
    });

    it('should throw NotFoundException when ticket not found', async () => {
      mockTicketRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('should return ticket when found', async () => {
      const ticket = { id: 1, title: 'Test', status: TicketStatus.PENDING };
      mockTicketRepo.findOne.mockResolvedValue(ticket);
      const result = await service.findOne(1);
      expect(result.id).toBe(1);
    });
  });

  describe('findByTicketNo', () => {
    it('should throw NotFoundException when not found', async () => {
      mockTicketRepo.findOne.mockResolvedValue(null);
      await expect(service.findByTicketNo('TK-FAKE')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return ticket when found', async () => {
      mockTicketRepo.findOne.mockResolvedValue({ id: 1, ticketNo: 'TK-001' });
      const result = await service.findByTicketNo('TK-001');
      expect(result.ticketNo).toBe('TK-001');
    });
  });

  describe('update', () => {
    it('should allow creator to update', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        status: TicketStatus.IN_PROGRESS,
        participants: [],
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      const user: AuthenticatedUser = {
        id: 10,
        username: 'user',
        role: { id: 2, name: 'user', permissions: [] },
      };
      const result = await service.update(
        1,
        { title: 'Updated' } as UpdateTicketDto,
        user,
      );
      expect(result).toBeDefined();
    });

    it('should deny non-creator without edit permission', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        status: TicketStatus.IN_PROGRESS,
        participants: [],
      });
      const user: AuthenticatedUser = {
        id: 99,
        username: 'user',
        role: { id: 2, name: 'user', permissions: [] },
      };
      await expect(
        service.update(1, { title: 'X' } as UpdateTicketDto, user),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject update on closed ticket', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        status: TicketStatus.CLOSED,
        participants: [],
      });
      const user: AuthenticatedUser = {
        id: 10,
        username: 'user',
        role: { id: 2, name: 'user', permissions: [] },
      };
      await expect(
        service.update(1, { title: 'X' } as UpdateTicketDto, user),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assign', () => {
    it('should assign and change status to IN_PROGRESS', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        ticketNo: 'TK-001',
        title: 'T',
        status: TicketStatus.PENDING,
        creatorId: 10,
        participants: [],
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      mockUserRepo.findOne.mockResolvedValue({ id: 20, username: 'eng' });
      const result = await service.assign(1, 20);
      expect(result).toBeDefined();
      expect(mockAuditService.log).toHaveBeenCalled();
    });

    it('should reject assign on non-pending ticket', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        status: TicketStatus.IN_PROGRESS,
      });
      await expect(service.assign(1, 20)).rejects.toThrow(BadRequestException);
    });
  });

  describe('requestClose', () => {
    it('should allow assignee to request close', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        ticketNo: 'TK-001',
        title: 'T',
        status: TicketStatus.IN_PROGRESS,
        assigneeId: 20,
        participants: [],
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      mockUserRepo.findOne.mockResolvedValue({ id: 20, username: 'eng' });
      const result = await service.requestClose(1, 20);
      expect(result).toBeDefined();
    });

    it('should deny non-assignee', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        status: TicketStatus.IN_PROGRESS,
        assigneeId: 20,
      });
      await expect(service.requestClose(1, 99)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject if not in_progress', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        status: TicketStatus.PENDING,
        assigneeId: 20,
      });
      await expect(service.requestClose(1, 20)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('confirmClose', () => {
    it('should allow creator to confirm close', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        ticketNo: 'TK-001',
        title: 'T',
        status: TicketStatus.CLOSING,
        creatorId: 10,
        participants: [],
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      mockUserRepo.findOne.mockResolvedValue({ id: 10, username: 'creator' });
      const result = await service.confirmClose(1, 10);
      expect(result).toBeDefined();
    });

    it('should deny non-creator', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        status: TicketStatus.CLOSING,
        creatorId: 10,
      });
      await expect(service.confirmClose(1, 99)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('generateShareToken', () => {
    it('should return a JWT token', async () => {
      const result = await service.generateShareToken(1);
      expect(result).toBe('token');
    });
  });

  describe('getMyTickets', () => {
    it('should query by creator role', async () => {
      mockTicketRepo.find.mockResolvedValue([{ id: 1 }]);
      const result = await service.getMyTickets(10, 'creator');
      expect(result).toHaveLength(1);
    });

    it('should query by participant role', async () => {
      mockTicketRepo.find.mockResolvedValue([{ id: 2 }]);
      const result = await service.getMyTickets(10, 'participant');
      expect(result).toHaveLength(1);
    });
  });

  describe('toggleRoomLock', () => {
    it('should allow creator to lock room', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        assigneeId: 20,
        participants: [],
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      const result = await service.toggleRoomLock(1, 10, true, false);
      expect(result).toBeDefined();
    });

    it('should deny unrelated user', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        assigneeId: 20,
      });
      await expect(service.toggleRoomLock(1, 99, true, false)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('inviteParticipant', () => {
    it('should allow creator to invite', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        assigneeId: 20,
        participants: [],
      });
      mockUserRepo.findOne.mockResolvedValue({
        id: 30,
        username: 'expert',
        realName: 'Expert',
      });
      mockTicketRepo.save.mockResolvedValue({ id: 1 });
      mockChatService.createMessage.mockResolvedValue({ id: 1 });
      const result = await service.inviteParticipant(1, 10, 30);
      expect(result).toBeDefined();
    });

    it('should deny unrelated user from inviting', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        assigneeId: 20,
        participants: [],
      });
      await expect(service.inviteParticipant(1, 99, 30)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject duplicate participant', async () => {
      (service.findOne as jest.Mock).mockResolvedValue({
        id: 1,
        creatorId: 10,
        assigneeId: 20,
        participants: [{ id: 30 }],
      });
      await expect(service.inviteParticipant(1, 10, 30)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getBatchSummary', () => {
    it('should return empty for empty ids', async () => {
      const result = await service.getBatchSummary([]);
      expect(result).toEqual([]);
    });
  });
});
