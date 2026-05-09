import { Test, TestingModule } from '@nestjs/testing';
import { ExtTicketsService, PushTicketDto } from './ext-tickets.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ExtTicketsService', () => {
  let service: ExtTicketsService;

  const mockTicketRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtTicketsService,
        {
          provide: getRepositoryToken(Ticket),
          useValue: mockTicketRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<ExtTicketsService>(ExtTicketsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTicketFromOMM', () => {
    const dto: PushTicketDto = {
      title: 'Fix issue',
      description: 'System down',
      serviceNo: 'OMM123456',
      customerName: 'Test Customer',
      creatorEmployeeId: 'E001',
      assigneeEmployeeId: 'E002',
    };

    it('should throw BadRequestException if missing required fields', async () => {
      const invalidDto = { ...dto, title: '' };
      await expect(service.createTicketFromOMM(invalidDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if creator is not found', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null); // Creator lookup fails
      await expect(service.createTicketFromOMM(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if assignee is not found', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({ id: 1 }); // Creator found
      mockUserRepository.findOne.mockResolvedValueOnce(null); // Assignee lookup fails
      await expect(service.createTicketFromOMM(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create and return a new ticket on success', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 1, employeeId: 'E001' }) // creator
        .mockResolvedValueOnce({ id: 2, employeeId: 'E002' }); // assignee
      mockTicketRepository.findOne.mockResolvedValueOnce(null); // existingTicket

      mockTicketRepository.create.mockReturnValue({ id: 10, ...dto });
      mockTicketRepository.save.mockResolvedValue({
        id: 10,
        ticketNo: 'TK202611119999',
        ...dto,
      });

      const result = await service.createTicketFromOMM(dto);

      expect(result.id).toBe(10);
      expect(result.ticketNo).toBe('TK202611119999');
      expect(mockTicketRepository.create).toHaveBeenCalled();
      expect(mockTicketRepository.save).toHaveBeenCalled();
    });

    it('should update existing ticket if serviceNo exists', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 1, employeeId: 'E001' }) // creator
        .mockResolvedValueOnce({ id: 2, employeeId: 'E002' }); // assignee

      mockTicketRepository.findOne.mockResolvedValueOnce({
        id: 1,
        serviceNo: dto.serviceNo,
        creatorId: 2,
        participants: [],
      });

      mockTicketRepository.save.mockResolvedValue({
        id: 1,
        ticketNo: 'TK202611119999',
        ...dto,
      });

      const result = await service.createTicketFromOMM(dto);

      expect(result.id).toBe(1);
      expect(mockTicketRepository.save).toHaveBeenCalled();
    });
  });

  describe('getTicketStatus', () => {
    it('should throw NotFoundException if ticket not found', async () => {
      mockTicketRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.getTicketStatus('NONEXISTENT')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return ticket status on success', async () => {
      const ticket = {
        id: 1,
        ticketNo: 'TK001',
        serviceNo: 'OMM001',
        status: 'pending',
        assignee: { realName: 'Assignee', employeeId: 'E002' },
        createdAt: new Date(),
        assignedAt: new Date(),
      };
      mockTicketRepository.findOne.mockResolvedValueOnce(ticket);

      const result = await service.getTicketStatus('OMM001');
      expect(result.ticketNo).toBe('TK001');
      expect(result.assignee).toEqual({
        realName: 'Assignee',
        employeeId: 'E002',
      });
    });
  });
});
