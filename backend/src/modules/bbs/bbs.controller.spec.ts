import { Test, TestingModule } from '@nestjs/testing';
import { BbsController } from './bbs.controller';
import { BbsService } from './bbs.service';
import { UnauthorizedException } from '@nestjs/common';

describe('BbsController', () => {
  let controller: BbsController;
  let service: BbsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BbsController],
      providers: [
        {
          provide: BbsService,
          useValue: {
            findAllSections: jest.fn(),
            createSection: jest.fn(),
            updateSection: jest.fn(),
            removeSection: jest.fn(),
            findAllTags: jest.fn(),
            createTag: jest.fn(),
            removeTag: jest.fn(),
            migrateToSection: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            incrementView: jest.fn(),
            generateShareToken: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            batchRemove: jest.fn(),
            remove: jest.fn(),
            togglePin: jest.fn(),
            archive: jest.fn(),
            getComments: jest.fn(),
            addComment: jest.fn(),
            getUnreadNotifications: jest.fn(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
            getSubscriptionStatus: jest.fn(),
            clearUnread: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<BbsController>(BbsController);
    service = module.get<BbsService>(BbsService);
  });

  describe('findOne', () => {
    it('should return post and increment view', async () => {
      const mockPost = { id: 1, title: 'test' };
      (service.findOne as jest.Mock).mockResolvedValue(mockPost);
      
      const result = await controller.findOne(1, { user: { id: 1, role: { name: 'user' } } });
      
      expect(result).toEqual(mockPost);
      expect(service.incrementView).toHaveBeenCalledWith(1);
    });

    it('should throw if external user accesses unshared post', async () => {
      const req = { user: { id: 1, role: { name: 'external' }, bbsId: 2 } };
      await expect(controller.findOne(1, req)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('update', () => {
    it('should pass bypassOwnership flag correctly', async () => {
      await controller.update(1, { title: 'new' }, { user: { id: 1, role: { name: 'admin' } } });
      expect(service.update).toHaveBeenCalledWith(1, { title: 'new' }, 1, true);

      await controller.update(1, { title: 'new' }, { user: { id: 2, role: { name: 'user', permissions: [] } } });
      expect(service.update).toHaveBeenCalledWith(1, { title: 'new' }, 2, false);
    });
  });
});
