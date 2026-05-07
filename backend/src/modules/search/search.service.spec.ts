import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Post } from '../../entities/post.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message } from '../../entities/message.entity';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';

describe('SearchService', () => {
  let service: SearchService;
  let esService: any;
  let postRepo: any;

  beforeEach(async () => {
    esService = {
      indices: {
        exists: jest.fn().mockResolvedValue(true),
        create: jest.fn(),
      },
      index: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      search: jest.fn().mockResolvedValue({
        hits: { hits: [], total: { value: 0, relation: 'eq' } },
        aggregations: {},
      }),
    };

    postRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ElasticsearchService, useValue: esService },
        { provide: getRepositoryToken(Post), useValue: postRepo },
        { provide: getRepositoryToken(Ticket), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Message), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(KnowledgeDoc), useValue: { find: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should initialize indices if they do not exist', async () => {
      esService.indices.exists.mockResolvedValue(false);
      await service.onModuleInit();
      expect(esService.indices.create).toHaveBeenCalledTimes(4);
    });
  });

  describe('indexPost', () => {
    it('should index a post successfully', async () => {
      const post = { id: 1, title: 'test', content: 'test content', tags: ['a'], author: { realName: 'testUser' } } as any;
      await service.indexPost(post);
      expect(esService.index).toHaveBeenCalledWith(expect.objectContaining({
        index: 'callcenter-posts',
        id: '1',
        body: expect.objectContaining({ title: 'test', type: 'post' }),
      }));
    });
  });

  describe('search', () => {
    it('should query elasticsearch and format results', async () => {
      esService.search.mockResolvedValue({
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _id: '1', _index: 'callcenter-posts', _source: { title: 'test' } }],
        },
      });

      const result = await service.search('test', 'post');
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(expect.objectContaining({ id: '1', title: 'test' }));
      expect(esService.search).toHaveBeenCalledWith(expect.objectContaining({ index: 'callcenter-posts' }));
    });
  });

  describe('syncAll', () => {
    it('should sync all entities', async () => {
      postRepo.find.mockResolvedValue([{ id: 1, title: 'post1' }]);
      const result = await service.syncAll();
      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(esService.index).toHaveBeenCalled();
    });
  });
});
