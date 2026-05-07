import { Test, TestingModule } from '@nestjs/testing';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketsExportService } from './tickets-export.service';
import { ConfigService } from '@nestjs/config';

describe('TicketsController', () => {
  let controller: TicketsController;
  let mockTicketsService: any;
  let mockExportService: any;

  beforeEach(async () => {
    mockTicketsService = {
      create: jest.fn().mockResolvedValue({ id: 1, title: 'Test Ticket' }),
      findAll: jest.fn().mockResolvedValue({ data: [{ id: 1 }], total: 1 }),
      getAggregates: jest.fn().mockResolvedValue([{ status: 'pending', count: 1 }]),
      findOne: jest.fn().mockResolvedValue({ id: 1 }),
      update: jest.fn().mockResolvedValue({ id: 1, title: 'Updated' }),
      assign: jest.fn().mockResolvedValue({ id: 1, assigneeId: 2 }),
      requestClose: jest.fn().mockResolvedValue({ id: 1, status: 'closing' }),
      confirmClose: jest.fn().mockResolvedValue({ id: 1, status: 'closed' }),
      getMyTickets: jest.fn().mockResolvedValue([{ id: 1 }]),
      deleteTicket: jest.fn().mockResolvedValue(undefined),
      batchDelete: jest.fn().mockResolvedValue(undefined),
      generateShareToken: jest.fn().mockResolvedValue('token123'),
      inviteParticipant: jest.fn().mockResolvedValue({ id: 1, participants: [] }),
      removeParticipant: jest.fn().mockResolvedValue({ id: 1 }),
      toggleRoomLock: jest.fn().mockResolvedValue({ id: 1, isRoomLocked: true }),
      getMyBadges: jest.fn().mockResolvedValue({ pending: 1 }),
      readTicket: jest.fn().mockResolvedValue(undefined),
      getBatchSummary: jest.fn().mockResolvedValue([{ id: 1 }]),
    };

    mockExportService = {
      exportTickets: jest.fn().mockResolvedValue(Buffer.from('export')),
      getExportConfig: jest.fn().mockResolvedValue({ id: 1 }),
      updateExportConfig: jest.fn().mockResolvedValue({ id: 1 }),
      exportChatZip: jest.fn().mockResolvedValue(Buffer.from('zip')),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [
        { provide: TicketsService, useValue: mockTicketsService },
        { provide: TicketsExportService, useValue: mockExportService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
      ],
    }).compile();

    controller = module.get<TicketsController>(TicketsController);
  });

  describe('create', () => {
    it('should create a ticket', async () => {
      const dto = { title: 'Test', description: 'Desc', category1: 'A' };
      const req = { user: { id: 1 } };
      const result = await controller.create(dto as any, req as any);
      expect(result.data.id).toBe(1);
      expect(mockTicketsService.create).toHaveBeenCalledWith(dto, 1);
    });
  });

  describe('findAll', () => {
    it('should return all tickets', async () => {
      const req = { user: { id: 1, role: { name: 'admin' } } };
      const query = { page: '1', limit: '10' };
      const result = await controller.findAll(query as any, req as any);
      expect(result.data.total).toBe(1);
      expect(mockTicketsService.findAll).toHaveBeenCalled();
    });
  });

  describe('getAggregates', () => {
    it('should return aggregates', async () => {
      const req = { user: { id: 1, role: { name: 'admin' } } };
      const result = await controller.getAggregates({}, req as any);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return a ticket', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.findOne(1, req as any);
      expect(result.data.id).toBe(1);
    });
  });

  describe('update', () => {
    it('should update a ticket', async () => {
      const req = { user: { id: 1 } };
      const dto = { title: 'Updated' };
      const result = await controller.update(1, dto as any, req as any);
      expect(result.data.title).toBe('Updated');
    });
  });

  describe('assign', () => {
    it('should assign a ticket', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.assign(1, req as any);
      expect(result.data.assigneeId).toBe(2);
    });
  });

  describe('requestClose', () => {
    it('should request close', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.requestClose(1, req as any);
      expect(result.data.status).toBe('closing');
    });
  });

  describe('confirmClose', () => {
    it('should confirm close', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.confirmClose(1, req as any);
      expect(result.data.status).toBe('closed');
    });
  });

  describe('myCreated', () => {
    it('should return my created tickets', async () => {
      const req = { user: { id: 1 } };
      const result = await controller.myCreated(req as any);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('deleteTicket', () => {
    it('should delete ticket', async () => {
      const req = { user: { id: 1 } };
      await controller.deleteTicket(1, req as any);
      expect(mockTicketsService.deleteTicket).toHaveBeenCalledWith(1, req.user);
    });
  });

  describe('deleteBatch', () => {
    it('should batch delete tickets', async () => {
      const req = { user: { id: 1 } };
      await controller.deleteBatch([1, 2], req as any);
      expect(mockTicketsService.batchDelete).toHaveBeenCalledWith([1, 2], req.user);
    });
  });


});
