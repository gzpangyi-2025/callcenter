import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { BadRequestException } from '@nestjs/common';

describe('ReportService', () => {
  let service: ReportService;
  let ticketRepo: any;
  let userRepo: any;

  const mockQb = () => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(5),
    getRawOne: jest.fn().mockResolvedValue({ avgHours: '2.5' }),
    getRawMany: jest.fn().mockResolvedValue([]),
    getMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(async () => {
    ticketRepo = {
      createQueryBuilder: jest.fn(() => mockQb()),
      find: jest.fn().mockResolvedValue([]),
    };
    userRepo = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        whereInIds: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSummary', () => {
    it('should return summary with status counts and avgHours', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([
        { status: 'pending', count: '3' },
        { status: 'closed', count: '2' },
      ]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSummary('2026-01-01', '2026-12-31');
      expect(result.total).toBeDefined();
      expect(result).toHaveProperty('pending');
      expect(result).toHaveProperty('closed');
      expect(result).toHaveProperty('avgHours');
    });
  });

  describe('getCategoryStats', () => {
    it('should return category1 and category2 arrays', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([{ category1: 'IT', total: '10' }]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getCategoryStats();
      expect(result).toHaveProperty('category1');
      expect(result).toHaveProperty('category2');
    });
  });

  describe('getByPerson', () => {
    it('should return creators, assignees, participants', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([{ userId: '1', count: '5' }]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);
      userRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        whereInIds: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 1, username: 'test', realName: 'Test' }]),
      });

      const result = await service.getByPerson(10);
      expect(result).toHaveProperty('creators');
      expect(result).toHaveProperty('assignees');
      expect(result).toHaveProperty('participants');
    });
  });

  describe('getByCustomer', () => {
    it('should return customer stats', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([
        { customerName: 'ACME', total: '5', closed: '3', active: '2' },
      ]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getByCustomer();
      expect(result).toHaveLength(1);
      expect(result[0].customerName).toBe('ACME');
      expect(result[0].total).toBe(5);
    });
  });

  describe('getTimeSeries', () => {
    it('should apply default date filter for day dimension', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([{ date: '2026-05-01', count: '3' }]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTimeSeries('day');
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(3);
      expect(qb.andWhere).toHaveBeenCalled();
    });

    it('should use custom dates when provided', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getTimeSeries('month', '2026-01-01', '2026-06-01');
      // 2 calls: one for startDate, one for endDate
      expect(qb.andWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCrossMatrix — SQL injection protection', () => {
    it('should accept valid column category2', async () => {
      const qb = mockQb();
      ticketRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.getCrossMatrix('Network', 'category2')).resolves.toBeDefined();
    });

    it('should accept valid column category3', async () => {
      const qb = mockQb();
      ticketRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.getCrossMatrix('IBM', 'category3')).resolves.toBeDefined();
    });

    it('should reject invalid column name', async () => {
      await expect(
        service.getCrossMatrix('test', 'id; DROP TABLE tickets--' as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('drillPersonTickets — SQL injection protection', () => {
    it('should reject invalid categoryLevel', async () => {
      await expect(
        service.drillPersonTickets(1, 'creator', 'test', 'malicious' as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should work with valid categoryLevel', async () => {
      const qb = mockQb();
      ticketRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(
        service.drillPersonTickets(1, 'assignee', 'Network', 'category2'),
      ).resolves.toBeDefined();
    });
  });

  describe('getCategory2Stats', () => {
    it('should drill down by category1', async () => {
      const qb = mockQb();
      qb.getRawMany.mockResolvedValue([{ category2: 'VPN', total: '3' }]);
      ticketRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getCategory2Stats('IT');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('VPN');
    });
  });
});
