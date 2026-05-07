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
});
