import { Injectable, Logger } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Post } from '../../entities/post.entity';
import { Ticket } from '../../entities/ticket.entity';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';
import { SearchService } from './search.service';

/** Common entity shape with id */
interface EntityWithId {
  id: number;
}

@Injectable()
export class SearchSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(SearchSubscriber.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly searchService: SearchService,
  ) {
    this.dataSource.subscribers.push(this);
    this.logger.log('SearchSubscriber registered successfully');
  }

  afterInsert(event: InsertEvent<EntityWithId>) {
    const entityName = event.metadata?.targetName;
    const entityId = event.entity?.id ?? (event.entityId as number | undefined);
    this.logger.debug(`afterInsert triggered: ${entityName} #${entityId}`);
    void this.syncEntity(entityId, entityName);
  }

  afterUpdate(event: UpdateEvent<EntityWithId>) {
    const entityName = event.metadata?.targetName;
    const entityId = event.entity?.id ?? event.databaseEntity?.id;
    this.logger.debug(`afterUpdate triggered: ${entityName} #${entityId}`);
    void this.syncEntity(entityId, entityName);
  }

  afterRemove(event: RemoveEvent<EntityWithId>) {
    const entityId =
      (event.entityId as number | undefined) ?? event.databaseEntity?.id;
    void this.removeEntity(entityId, event.metadata?.targetName);
  }

  private async syncEntity(entityId: number | undefined, type: string) {
    if (!entityId) {
      this.logger.warn(
        `syncEntity called with no id for type=${type}, skipping`,
      );
      return;
    }
    try {
      switch (type) {
        case 'Post': {
          const post = await this.dataSource.getRepository(Post).findOne({
            where: { id: entityId },
            relations: ['section', 'author'],
          });
          if (post) await this.searchService.indexPost(post);
          this.logger.debug(`Synced Post #${entityId} to ES`);
          break;
        }
        case 'Ticket': {
          const ticket = await this.dataSource
            .getRepository(Ticket)
            .findOne({ where: { id: entityId } });
          if (ticket) await this.searchService.indexTicket(ticket);
          this.logger.debug(`Synced Ticket #${entityId} to ES`);
          break;
        }
        case 'Message':
          // Message 的 ES 同步已由 ChatService.createMessage 直接调用 indexMessage 处理
          // Subscriber 因事务隔离问题无法可靠读取未提交数据，故此处跳过
          this.logger.debug(
            `Message #${entityId} ES sync handled by ChatService, skipping subscriber`,
          );
          break;
        case 'KnowledgeDoc': {
          const doc = await this.dataSource
            .getRepository(KnowledgeDoc)
            .findOne({ where: { id: entityId } });
          if (doc) await this.searchService.indexKnowledge(doc);
          this.logger.debug(`Synced KnowledgeDoc #${entityId} to ES`);
          break;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      this.logger.warn(`Failed to sync ${type} #${entityId} to ES: ${msg}`);
    }
  }

  private async removeEntity(id: number, type: string) {
    if (!id) return;
    try {
      switch (type) {
        case 'Post':
          await this.searchService.removePost(id);
          break;
        case 'Ticket':
          await this.searchService.removeTicket(id);
          break;
        case 'Message':
          await this.searchService.removeMessage(id);
          break;
        case 'KnowledgeDoc':
          await this.searchService.removeKnowledge(id);
          break;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      this.logger.warn(`Failed to remove ${type} ${id} from ES: ${msg}`);
    }
  }
}
