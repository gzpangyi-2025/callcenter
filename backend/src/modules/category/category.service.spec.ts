import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from './category.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TicketCategory } from '../../entities/ticket-category.entity';
import * as XLSX from 'xlsx';

jest.mock('xlsx');

describe('CategoryService', () => {
  let service: CategoryService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      clear: jest.fn(),
      save: jest.fn(),
      create: jest.fn().mockImplementation(dto => dto),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        {
          provide: getRepositoryToken(TicketCategory),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('importFromExcel', () => {
    it('should parse excel and save categories', async () => {
      const mockBuffer = Buffer.from('test');
      (XLSX.read as jest.Mock).mockReturnValue({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      (XLSX.utils.sheet_to_json as jest.Mock).mockReturnValue([
        ['Header1', 'Header2', 'Header3'],
        ['L1', 'L2', 'L3'],
        ['L1', 'L2_2', ''],
      ]);

      const result = await service.importFromExcel(mockBuffer);
      expect(result.imported).toBe(2);
      expect(repo.clear).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('getTree', () => {
    it('should return nested tree structure', async () => {
      repo.find.mockResolvedValue([
        { level1: 'IT', level2: 'Network', level3: 'VPN' },
        { level1: 'IT', level2: 'Hardware', level3: 'Mouse' },
        { level1: 'HR', level2: 'Payroll', level3: '' },
      ]);

      const tree = await service.getTree();
      expect(tree).toHaveLength(2);
      const itNode = tree.find(t => t.value === 'IT');
      expect(itNode.children).toHaveLength(2);
    });
  });
});
