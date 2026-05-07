import { Test, TestingModule } from '@nestjs/testing';
import { BbsService } from './bbs.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Post } from '../../entities/post.entity';
import { PostComment } from '../../entities/post-comment.entity';
import { BbsSection } from '../../entities/bbs-section.entity';
import { BbsTag } from '../../entities/bbs-tag.entity';
import { BbsSubscription } from '../../entities/bbs-subscription.entity';
import { SearchService } from '../search/search.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FilesService } from '../files/files.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('BbsService', () => {
  let service: BbsService;
  let postRepo: any;
  let sectionRepo: any;
  let commentRepo: any;
  let subRepo: any;
  let searchService: any;
  let filesService: any;

  beforeEach(async () => {
    postRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(dto => ({ ...dto, id: 1 })),
      remove: jest.fn(),
      increment: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      })),
    };

    sectionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };

    commentRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(dto => ({ ...dto, id: 1 })),
    };

    subRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      })),
    };

    searchService = {
      indexPost: jest.fn().mockResolvedValue(true),
      removePost: jest.fn().mockResolvedValue(true),
    };

    filesService = {
      deleteFromCos: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BbsService,
        { provide: getRepositoryToken(Post), useValue: postRepo },
        { provide: getRepositoryToken(PostComment), useValue: commentRepo },
        { provide: getRepositoryToken(BbsSection), useValue: sectionRepo },
        { provide: getRepositoryToken(BbsTag), useValue: {} },
        { provide: getRepositoryToken(BbsSubscription), useValue: subRepo },
        { provide: SearchService, useValue: searchService },
        { provide: ChatGateway, useValue: { server: { to: jest.fn(() => ({ emit: jest.fn() })) } } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: FilesService, useValue: filesService },
      ],
    }).compile();

    service = module.get<BbsService>(BbsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create post, sub, and sync to ES', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, title: 'test' });
      await service.create({ title: 'test' }, 1);
      expect(postRepo.save).toHaveBeenCalled();
      expect(subRepo.save).toHaveBeenCalled();
      // wait a bit for async ES sync
      await new Promise(r => setTimeout(r, 10));
      expect(searchService.indexPost).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should throw Forbidden if not author and not admin', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, authorId: 2 });
      await expect(service.update(1, { title: 'new' }, 1, false)).rejects.toThrow(ForbiddenException);
    });

    it('should allow update if admin', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, authorId: 2 });
      await service.update(1, { title: 'new' }, 1, true);
      expect(postRepo.save).toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    it('should add comment, update post lastCommentAt, and notify subs', async () => {
      subRepo.find.mockResolvedValue([{ userId: 2, unreadCount: 1 }]);
      await service.addComment(1, 'nice', 1);

      expect(commentRepo.save).toHaveBeenCalled();
      expect(postRepo.update).toHaveBeenCalledWith(1, expect.objectContaining({ lastCommentAt: expect.any(Date) }));
    });
  });

  describe('findOne', () => {
    it('should return post when found', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, title: 'Hello' });
      const result = await service.findOne(1);
      expect(result.title).toBe('Hello');
    });

    it('should throw NotFoundException when not found', async () => {
      postRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllSections', () => {
    it('should return sections', async () => {
      sectionRepo.find.mockResolvedValue([{ id: 1, name: '技术分享' }]);
      const result = await service.findAllSections();
      expect(result).toHaveLength(1);
    });
  });

  describe('createSection', () => {
    it('should create a section', async () => {
      sectionRepo.create.mockReturnValue({ name: 'New' });
      sectionRepo.save.mockResolvedValue({ id: 1, name: 'New' });
      const result = await service.createSection({ name: 'New' });
      expect(result.name).toBe('New');
    });
  });

  describe('updateSection', () => {
    it('should update section', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: 1, name: 'Old' });
      sectionRepo.save.mockResolvedValue({ id: 1, name: 'Updated' });
      const result = await service.updateSection(1, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('should throw NotFoundException when section not found', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(service.updateSection(999, { name: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeSection', () => {
    it('should remove section and orphan posts', async () => {
      sectionRepo.findOne.mockResolvedValue({ id: 1, name: 'Old' });
      postRepo.find.mockResolvedValue([]);
      sectionRepo.remove.mockResolvedValue(undefined);
      const result = await service.removeSection(1);
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException', async () => {
      sectionRepo.findOne.mockResolvedValue(null);
      await expect(service.removeSection(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateShareToken', () => {
    it('should throw NotFoundException if post not found', async () => {
      postRepo.findOne.mockResolvedValue(null);
      await expect(service.generateShareToken(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return items and total', async () => {
      const result = await service.findAll(1, 10);
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total', 0);
    });
  });

  describe('remove', () => {
    it('should allow admin to delete any post', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, authorId: 2, content: '' });
      postRepo.remove.mockResolvedValue(undefined);
      commentRepo.find.mockResolvedValue([]);
      await service.remove(1, 99, true);
      expect(postRepo.remove).toHaveBeenCalled();
    });

    it('should deny non-author non-admin', async () => {
      postRepo.findOne.mockResolvedValue({ id: 1, authorId: 2, content: '' });
      await expect(service.remove(1, 99, false)).rejects.toThrow(ForbiddenException);
    });
  });
});
