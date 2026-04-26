import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../../entities/post.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message, MessageType } from '../../entities/message.entity';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';

/** Elasticsearch search hit shape */
interface EsSearchHit {
  _id: string;
  _index: string;
  _source: Record<string, unknown>;
  highlight?: Record<string, string[]>;
}

/** Elasticsearch total shape */
interface EsTotal {
  value: number;
  relation: string;
}

/** Elasticsearch error with meta */
interface EsError extends Error {
  meta?: { statusCode?: number; body?: unknown };
  stack?: string;
}

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private readonly INDICES = {
    post: 'callcenter-posts',
    ticket: 'callcenter-tickets',
    message: 'callcenter-messages',
    knowledge: 'callcenter-knowledge',
  };

  constructor(
    private readonly esService: ElasticsearchService,
    @InjectRepository(Post) private postRepo: Repository<Post>,
    @InjectRepository(Ticket) private ticketRepo: Repository<Ticket>,
    @InjectRepository(Message) private messageRepo: Repository<Message>,
    @InjectRepository(KnowledgeDoc)
    private knowledgeRepo: Repository<KnowledgeDoc>,
  ) {}

  private getTextFieldMapping() {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      return {
        type: 'text',
        analyzer: 'ik_max_word',
        search_analyzer: 'ik_smart',
      };
    }
    return { type: 'text', analyzer: 'standard' };
  }

  async onModuleInit() {
    this.logger.log('Initializing Elasticsearch indices...');
    try {
      const textMapping = this.getTextFieldMapping();

      await this.initIndex(this.INDICES.post, {
        properties: {
          title: textMapping,
          content: textMapping,
          type: { type: 'keyword' },
          sectionName: { type: 'keyword' },
          tags: { type: 'keyword' },
          authorName: { type: 'keyword' },
          createdAt: { type: 'date' },
        },
      });

      await this.initIndex(this.INDICES.ticket, {
        properties: {
          title: textMapping,
          content: textMapping, // description mapped as content
          type: { type: 'keyword' },
          ticketNo: { type: 'keyword' },
          serviceNo: { type: 'keyword' },
          customerName: { type: 'keyword' },
          status: { type: 'keyword' },
          category: { type: 'keyword' },
          createdAt: { type: 'date' },
        },
      });

      await this.initIndex(this.INDICES.message, {
        properties: {
          content: textMapping,
          type: { type: 'keyword' },
          ticketId: { type: 'integer' },
          senderName: { type: 'keyword' },
          createdAt: { type: 'date' },
        },
      });

      await this.initIndex(this.INDICES.knowledge, {
        properties: {
          title: textMapping,
          content: textMapping,
          type: { type: 'keyword' },
          aiSummary: textMapping,
          createdAt: { type: 'date' },
        },
      });
      this.logger.log('Elasticsearch indices ready.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      this.logger.warn(
        `Elasticsearch 尚未配置或无法连接，全局搜索功能将受限: ${msg}`,
      );
    }
  }

  private async initIndex(index: string, mapping: Record<string, unknown>) {
    const exists = await this.esService.indices.exists({ index });
    if (!exists) {
      await this.esService.indices.create({
        index,
        body: { mappings: mapping },
      });
      this.logger.log(`Created index: ${index}`);
    }
  }

  // ---- 索引单个文档 ----

  async indexPost(post: Post) {
    try {
      await this.esService.index({
        index: this.INDICES.post,
        id: post.id.toString(),
        body: {
          type: 'post',
          title: post.title,
          content: post.content,
          sectionName: post.section?.name || '未分类',
          tags: post.tags || [],
          authorName: post.author?.realName || post.author?.username || '未知',
          createdAt: post.createdAt,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to index post ${post.id}`, e);
    }
  }

  async removePost(id: number) {
    try {
      await this.esService.delete({
        index: this.INDICES.post,
        id: id.toString(),
      });
    } catch (e: unknown) {
      const esErr = e as EsError;
      if (esErr.meta?.statusCode !== 404)
        this.logger.warn(`Failed to remove post ${id}`, e);
    }
  }

  async indexTicket(ticket: Ticket) {
    try {
      await this.esService.index({
        index: this.INDICES.ticket,
        id: ticket.id.toString(),
        body: {
          type: 'ticket',
          title: ticket.title,
          content: ticket.description,
          ticketNo: ticket.ticketNo,
          serviceNo: ticket.serviceNo || '',
          customerName: ticket.customerName,
          status: ticket.status,
          category: ticket.category1 || ticket.type || '未分类',
          createdAt: ticket.createdAt,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to index ticket ${ticket.id}`, e);
    }
  }

  async removeTicket(id: number) {
    try {
      await this.esService.delete({
        index: this.INDICES.ticket,
        id: id.toString(),
      });
    } catch (e: unknown) {
      const esErr = e as EsError;
      if (esErr.meta?.statusCode !== 404)
        this.logger.warn(`Failed to remove ticket ${id}`, e);
    }
  }

  async indexMessage(msg: Message) {
    if (msg.type !== 'text') {
      this.logger.warn(
        `indexMessage: skipping non-text message #${msg.id}, type=${msg.type}`,
      );
      return;
    }
    try {
      await this.esService.index({
        index: this.INDICES.message,
        id: msg.id.toString(),
        body: {
          type: 'message',
          content: msg.content,
          ticketId: msg.ticketId,
          senderName:
            msg.sender?.realName || msg.sender?.username || '系统/外部',
          createdAt: msg.createdAt,
        },
      });
      this.logger.debug(
        `indexMessage: successfully wrote message #${msg.id} to ES`,
      );
    } catch (e: unknown) {
      const esErr = e as EsError;
      this.logger.error(
        `Failed to index message ${msg.id}: ${esErr.message}`,
        esErr.meta?.body || esErr.stack,
      );
    }
  }

  async removeMessage(id: number) {
    try {
      await this.esService.delete({
        index: this.INDICES.message,
        id: id.toString(),
      });
    } catch (e: unknown) {
      const esErr = e as EsError;
      if (esErr.meta?.statusCode !== 404)
        this.logger.warn(`Failed to remove message ${id}`, e);
    }
  }

  async indexKnowledge(doc: KnowledgeDoc) {
    try {
      await this.esService.index({
        index: this.INDICES.knowledge,
        id: doc.id.toString(),
        body: {
          type: 'knowledge',
          title: doc.title,
          content: doc.content,
          createdAt: doc.createdAt,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to index knowledge ${doc.id}`, e);
    }
  }

  async removeKnowledge(id: number) {
    try {
      await this.esService.delete({
        index: this.INDICES.knowledge,
        id: id.toString(),
      });
    } catch (e: unknown) {
      const esErr = e as EsError;
      if (esErr.meta?.statusCode !== 404)
        this.logger.warn(`Failed to remove knowledge ${id}`, e);
    }
  }

  // ---- 全文搜索 ----

  async search(query: string, type: string = 'all', page = 1, pageSize = 20) {
    let index = 'callcenter-*';
    if (type !== 'all' && this.INDICES[type as keyof typeof this.INDICES]) {
      index = this.INDICES[type as keyof typeof this.INDICES];
    }

    const body: Record<string, unknown> = {
      from: (page - 1) * pageSize,
      size: pageSize,
      query: {
        multi_match: {
          query,
          fields: [
            'title^3',
            'content',
            'aiSummary',
            'customerName',
            'ticketNo',
            'serviceNo',
          ],
        },
      },
      highlight: {
        pre_tags: ['<em>'],
        post_tags: ['</em>'],
        fields: {
          title: {},
          content: {
            fragment_size: 150,
            number_of_fragments: 3,
            no_match_size: 150,
          },
          aiSummary: {},
        },
      },
      aggs: {
        types: { terms: { field: 'type' } },
        sections: { terms: { field: 'sectionName' } },
      },
    };

    try {
      const res = await this.esService.search({ index, body });

      const hits = (res.hits.hits as EsSearchHit[]).map((hit) => ({
        id: hit._id,
        _index: hit._index,
        ...hit._source,
        highlight: hit.highlight,
      }));

      return {
        total: (res.hits.total as EsTotal).value,
        items: hits,
        aggregations: (res.aggregations as Record<string, unknown>) || {},
      };
    } catch (e: unknown) {
      const esErr = e as EsError;
      this.logger.error('Search failed', esErr.stack);
      return { total: 0, items: [], aggregations: {} };
    }
  }

  // ---- 全量同步 ----

  async syncAll() {
    this.logger.log('Starting full sync to ES...');
    let totalSynced = 0;

    // 1. Posts
    const posts = await this.postRepo.find({
      relations: ['section', 'author'],
    });
    for (const post of posts) {
      await this.indexPost(post);
      totalSynced++;
    }

    // 2. Tickets
    const tickets = await this.ticketRepo.find();
    for (const ticket of tickets) {
      await this.indexTicket(ticket);
      totalSynced++;
    }

    // 3. Messages
    const messages = await this.messageRepo.find({
      relations: ['sender'],
      where: { type: 'text' as MessageType },
    });
    for (const msg of messages) {
      await this.indexMessage(msg);
      totalSynced++;
    }

    // 4. Knowledge
    const docs = await this.knowledgeRepo.find();
    for (const doc of docs) {
      await this.indexKnowledge(doc);
      totalSynced++;
    }

    this.logger.log(`Full sync completed. Total records: ${totalSynced}`);
    return { success: true, count: totalSynced };
  }
}
