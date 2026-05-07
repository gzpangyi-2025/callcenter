import { Test, TestingModule } from '@nestjs/testing';
import { SearchSubscriber } from './search.subscriber';
import { SearchService } from './search.service';
import { DataSource } from 'typeorm';

describe('SearchSubscriber', () => {
  let subscriber: SearchSubscriber;
  let dataSource: any;
  let searchService: any;

  beforeEach(async () => {
    dataSource = {
      subscribers: [],
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ id: 1 }),
      }),
    };

    searchService = {
      indexPost: jest.fn(),
      indexTicket: jest.fn(),
      indexKnowledge: jest.fn(),
      removePost: jest.fn(),
      removeTicket: jest.fn(),
      removeMessage: jest.fn(),
      removeKnowledge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchSubscriber,
        { provide: DataSource, useValue: dataSource },
        { provide: SearchService, useValue: searchService },
      ],
    }).compile();

    subscriber = module.get<SearchSubscriber>(SearchSubscriber);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('afterInsert', () => {
    it('should trigger syncEntity for Post', async () => {
      const event = {
        metadata: { targetName: 'Post' },
        entity: { id: 1 },
      } as any;
      subscriber.afterInsert(event);
      // Wait for async call to finish
      await new Promise(r => setTimeout(r, 10));
      expect(searchService.indexPost).toHaveBeenCalled();
    });

    it('should skip Message', async () => {
      const event = {
        metadata: { targetName: 'Message' },
        entity: { id: 1 },
      } as any;
      subscriber.afterInsert(event);
      await new Promise(r => setTimeout(r, 10));
      expect(searchService.indexPost).not.toHaveBeenCalled();
      expect(searchService.indexTicket).not.toHaveBeenCalled();
    });
  });

  describe('afterRemove', () => {
    it('should remove from ES', async () => {
      const event = {
        metadata: { targetName: 'Post' },
        databaseEntity: { id: 1 },
      } as any;
      subscriber.afterRemove(event);
      await new Promise(r => setTimeout(r, 10));
      expect(searchService.removePost).toHaveBeenCalledWith(1);
    });
  });
});
