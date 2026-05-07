import { Test, TestingModule } from '@nestjs/testing';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { BadRequestException } from '@nestjs/common';

describe('CategoryController', () => {
  let controller: CategoryController;
  let service: CategoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            importFromExcel: jest.fn(),
            getTree: jest.fn(),
            findAll: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CategoryController>(CategoryController);
    service = module.get<CategoryService>(CategoryService);
  });

  describe('importExcel', () => {
    it('should throw if no file', async () => {
      await expect(controller.importExcel(null as any)).rejects.toThrow(BadRequestException);
    });

    it('should import and return result', async () => {
      const mockFile = { buffer: Buffer.from('test') } as Express.Multer.File;
      (service.importFromExcel as jest.Mock).mockResolvedValue({ imported: 10 });
      
      const result = await controller.importExcel(mockFile);
      expect(result.code).toBe(0);
      expect(result.data.imported).toBe(10);
    });
  });

  describe('getTree', () => {
    it('should return tree', async () => {
      (service.getTree as jest.Mock).mockResolvedValue([{ label: 't1' }]);
      const result = await controller.getTree();
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findAll', () => {
    it('should return all', async () => {
      (service.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
      const result = await controller.findAll();
      expect(result.data).toHaveLength(1);
    });
  });
});
