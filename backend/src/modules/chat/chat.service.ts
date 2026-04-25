import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageType } from '../../entities/message.entity';
import { SearchService } from '../search/search.service';
import { FilesService } from '../files/files.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    private readonly searchService: SearchService,
    private readonly filesService: FilesService,
  ) {}

  async createMessage(data: {
    ticketId: number;
    senderId: number | null;
    senderName?: string;
    content: string;
    type?: MessageType;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
  }): Promise<Message> {
    const message = this.messageRepository.create(data);
    const saved = await this.messageRepository.save(message);

    // 重新查询以获取关联的发送者信息
    const fullMessage = await this.messageRepository.findOne({
      where: { id: saved.id },
      relations: ['sender'],
    }) as Message;

    // 显式同步到 Elasticsearch（不依赖 Subscriber）
    if (fullMessage) {
      this.searchService.indexMessage(fullMessage).catch(e => {
        this.logger.warn(`ES sync failed for message #${fullMessage.id}: ${e.message}`);
      });
    }

    return fullMessage;
  }

  async recallMessage(messageId: number, userId: number | string, username?: string): Promise<Message> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['sender'],
    });
    if (!message) throw new NotFoundException('消息不存在');

    // 权限校验
    if (typeof userId === 'string' && userId.startsWith('ext-')) {
      if (message.senderId !== null || message.senderName !== username) {
        throw new ForbiddenException('只能撤回自己的消息');
      }
    } else {
      if (message.senderId !== Number(userId)) {
        throw new ForbiddenException('只能撤回自己的消息');
      }
    }
    if (message.isRecalled) throw new BadRequestException('消息已被撤回');

    // 检查 10 分钟时间窗口
    const elapsed = Date.now() - new Date(message.createdAt).getTime();
    if (elapsed > 10 * 60 * 1000) {
      throw new BadRequestException('只能撤回 10 分钟内的消息');
    }

    // 删除云端文件
    if (message.fileUrl && (message.type === MessageType.IMAGE || message.type === MessageType.FILE)) {
      try {
        const filename = message.fileUrl.split('/').pop();
        if (filename) {
          // 这里使用不等待的异步调用或等待都可
          this.filesService.deleteFromCos(filename).catch(err => {
            this.logger.error('Delete recalled file from COS failed:', err);
          });
        }
      } catch (err) {
        this.logger.error('Delete recalled file failed:', err);
      }
    }

    message.isRecalled = true;
    message.content = '该消息已被撤回';
    message.fileUrl = '';
    message.fileName = '';
    message.fileSize = 0;
    return this.messageRepository.save(message);
  }

  async getMessagesByTicket(
    ticketId: number,
    page = 1,
    pageSize = 200,
  ) {
    const [messages, total] = await this.messageRepository.findAndCount({
      where: { ticketId },
      relations: ['sender'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    messages.reverse();

    return {
      items: messages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        type: msg.type,
        fileUrl: msg.isRecalled ? null : msg.fileUrl,
        fileName: msg.isRecalled ? null : msg.fileName,
        fileSize: msg.isRecalled ? null : msg.fileSize,
        senderName: msg.senderName,
        isRecalled: msg.isRecalled || false,
        createdAt: msg.createdAt,
        sender: msg.sender
          ? {
              id: msg.sender.id,
              username: msg.sender.username,
              displayName: msg.sender.displayName,
              realName: msg.sender.realName,
              avatar: msg.sender.avatar,
            }
          : null,
      })),
      total,
    };
  }
}
