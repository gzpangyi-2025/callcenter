import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Ticket, TicketStatus } from '../../entities/ticket.entity';
import { CreateTicketDto, UpdateTicketDto } from './dto/ticket.dto';
import { ChatGateway } from '../chat/chat.gateway';
import { v4 as uuidv4 } from 'uuid';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../../entities/user.entity';
import { ChatService } from '../chat/chat.service';
import { MessageType } from '../../entities/message.entity';
import { AuditService } from '../audit/audit.service';
import { AuditType } from '../../entities/audit-log.entity';
import { TicketReadState } from '../../entities/ticket-read-state.entity';
import { Message } from '../../entities/message.entity';
import { AuthenticatedUser } from '../../common/types/auth.types';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly chatGateway: ChatGateway,
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TicketReadState)
    private readonly ticketReadStateRepo: Repository<TicketReadState>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 通过 ChatGateway 的 WebSocket server 向所有在线客户端广播工单事件
   */
  private broadcastTicketEvent(action: string, ticket: Partial<Ticket> & { id: number }) {
    try {
      // 使用 /chat namespace 的 server 实例全局广播
      this.chatGateway.server.emit('ticketEvent', {
        action,
        data: {
          id: ticket.id,
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          description: ticket.description,
          type: ticket.type,
          status: ticket.status,
          customerName: ticket.customerName,
          serviceNo: ticket.serviceNo,
          creatorId: ticket.creatorId,
          assigneeId: ticket.assigneeId,
          assignedAt: ticket.assignedAt,
          closedAt: ticket.closedAt,
          createdAt: ticket.createdAt,
          creator: ticket.creator
            ? { id: ticket.creator.id, username: ticket.creator.username, displayName: ticket.creator.displayName, realName: ticket.creator.realName }
            : null,
          assignee: ticket.assignee
            ? { id: ticket.assignee.id, username: ticket.assignee.username, displayName: ticket.assignee.displayName, realName: ticket.assignee.realName }
            : null,
          participants: Array.isArray(ticket.participants)
            ? ticket.participants.map((p: User) => ({ id: p.id, username: p.username, displayName: p.displayName, realName: p.realName }))
            : [],
        },
      });
    } catch (err) {
      this.logger.error('广播工单事件失败:', err);
    }
  }

  async create(createDto: CreateTicketDto, userId: number): Promise<Ticket> {
    const ticketNo = `TK-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 4).toUpperCase()}`;
    const externalLink = `/external/ticket/${ticketNo}`;

    const isDirected = !!createDto.assigneeId;

    const ticket = this.ticketRepository.create({
      ...createDto,
      ticketNo,
      externalLink,
      creatorId: userId,
      status: isDirected ? TicketStatus.PENDING : TicketStatus.PENDING,
      assigneeId: createDto.assigneeId || undefined,
    });

    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne((saved as any).id || (saved as any)[0]?.id);
    this.broadcastTicketEvent('created', fullTicket);

    // 审计：工单创建
    this.auditService.log({
      type: AuditType.TICKET_STATUS,
      action: 'created',
      userId: userId,
      targetId: fullTicket.id,
      targetName: fullTicket.ticketNo,
      detail: `创建工单「${fullTicket.title}」(${fullTicket.ticketNo})`,
    });

    return fullTicket;
  }

  async findAll(query: {
    page?: number;
    pageSize?: number;
    status?: TicketStatus;
    type?: string;
    keyword?: string;
    category1?: string;
    category2?: string;
    category3?: string;
    creatorId?: number;
    assigneeId?: number;
    isDashboard?: boolean;
  }) {
    const { page = 1, pageSize = 10, status, type, keyword, category1, category2, category3, creatorId, assigneeId, isDashboard } = query;

    const qb = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.creator', 'creator')
      .leftJoinAndSelect('ticket.assignee', 'assignee')
      .leftJoinAndSelect('ticket.participants', 'participants')
      .orderBy('ticket.createdAt', 'DESC');

    if (status) {
      qb.andWhere('ticket.status = :status', { status });
    } else if (!isDashboard) {
      // 广场模式（非 Dashboard 全部概览模式时）：排除已指定接单人的待接单工单（这些只在个人主页展示）
      qb.andWhere(
        '(ticket.assigneeId IS NULL OR ticket.status != :pendingStatus)',
        { pendingStatus: TicketStatus.PENDING },
      );
    }
    if (type) {
      qb.andWhere('ticket.type = :type', { type });
    }
    if (category1) {
      qb.andWhere('ticket.category1 = :category1', { category1 });
    }
    if (category2) {
      qb.andWhere('ticket.category2 = :category2', { category2 });
    }
    if (category3) {
      qb.andWhere('ticket.category3 = :category3', { category3 });
    }
    if (creatorId) {
      qb.andWhere('ticket.creatorId = :creatorId', { creatorId });
    }
    if (assigneeId) {
      qb.andWhere('ticket.assigneeId = :assigneeId', { assigneeId });
    }
    if (keyword) {
      qb.andWhere(
        '(ticket.title LIKE :keyword OR ticket.description LIKE :keyword OR ticket.ticketNo LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      items: items.map((item) => ({
        ...item,
        creator: item.creator
          ? { id: item.creator.id, username: item.creator.username, displayName: item.creator.displayName, realName: item.creator.realName }
          : null,
        assignee: item.assignee
          ? { id: item.assignee.id, username: item.assignee.username, displayName: item.assignee.displayName, realName: item.assignee.realName }
          : null,
        participants: Array.isArray(item.participants)
          ? item.participants.map((p: User) => ({ id: p.id, username: p.username, displayName: p.displayName, realName: p.realName }))
          : [],
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: number): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id },
      relations: ['creator', 'assignee', 'participants'],
    });
    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }
    return ticket;
  }

  async findByTicketNo(ticketNo: string): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOne({
      where: { ticketNo },
      relations: ['creator', 'assignee'],
    });
    if (!ticket) {
      throw new NotFoundException('工单不存在');
    }
    return ticket;
  }

  async update(id: number, updateDto: UpdateTicketDto, user: AuthenticatedUser): Promise<Ticket> {
    const ticket = await this.findOne(id);

    // 权限判断：创建人可以编辑，或拥有 tickets:edit 权限的用户可以编辑
    const isCreator = ticket.creatorId === user.id;
    const roleName = user.role?.name || '';
    const userPermissions = user.role?.permissions || [];
    const hasEditPerm = roleName === 'admin' || userPermissions.some((p: { code?: string; resource?: string; action?: string }) => {
      const code = p.code || `${p.resource}:${p.action}`;
      return code === 'tickets:edit';
    });

    if (!isCreator && !hasEditPerm) {
      throw new ForbiddenException('您没有权限编辑此工单');
    }
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('已关闭的工单不可修改');
    }
    Object.assign(ticket, updateDto);
    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);
    this.broadcastTicketEvent('updated', fullTicket);
    return fullTicket;
  }

  async assign(id: number, userId: number): Promise<Ticket> {
    const ticket = await this.findOne(id);
    if (ticket.status !== TicketStatus.PENDING) {
      throw new BadRequestException('只有待接单的工单可以接单');
    }
    ticket.assigneeId = userId;
    ticket.status = TicketStatus.IN_PROGRESS;
    ticket.assignedAt = new Date();
    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);
    this.broadcastTicketEvent('assigned', fullTicket);

    // 审计：工单接单
    this.auditService.log({
      type: AuditType.TICKET_STATUS,
      action: 'assigned',
      userId: userId,
      targetId: fullTicket.id,
      targetName: fullTicket.ticketNo,
      detail: `工单「${fullTicket.title}」被接单，状态: pending → in_progress`,
    });

    return fullTicket;
  }

  async requestClose(id: number, userId: number): Promise<Ticket> {
    const ticket = await this.findOne(id);
    if (ticket.status !== TicketStatus.IN_PROGRESS) {
      throw new BadRequestException('只有服务中的工单可以申请关单');
    }
    if (ticket.assigneeId !== userId) {
      throw new ForbiddenException('只有接单人员可以申请关单');
    }
    ticket.status = TicketStatus.CLOSING;
    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);
    this.broadcastTicketEvent('requestClose', fullTicket);

    // 审计：申请关单
    this.auditService.log({
      type: AuditType.TICKET_STATUS,
      action: 'requestClose',
      userId: userId,
      targetId: fullTicket.id,
      targetName: fullTicket.ticketNo,
      detail: `工单「${fullTicket.title}」申请关单，状态: in_progress → closing`,
    });

    return fullTicket;
  }

  async confirmClose(id: number, userId: number): Promise<Ticket> {
    const ticket = await this.findOne(id);
    if (ticket.status !== TicketStatus.CLOSING) {
      throw new BadRequestException('只有待确认关单的工单可以确认');
    }
    if (ticket.creatorId !== userId) {
      throw new ForbiddenException('只有创建者可以确认关单');
    }
    ticket.status = TicketStatus.CLOSED;
    ticket.closedAt = new Date();
    ticket.confirmedAt = new Date();
    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);
    this.broadcastTicketEvent('closed', fullTicket);

    // 审计：确认关单
    this.auditService.log({
      type: AuditType.TICKET_STATUS,
      action: 'closed',
      userId: userId,
      targetId: fullTicket.id,
      targetName: fullTicket.ticketNo,
      detail: `工单「${fullTicket.title}」已确认关闭，状态: closing → closed`,
    });

    return fullTicket;
  }

  async getMyTickets(userId: number, role: 'creator' | 'assignee' | 'participant') {
    if (role === 'participant') {
      return this.ticketRepository.find({
        where: { participants: { id: userId } },
        relations: ['creator', 'assignee', 'participants'],
        order: { createdAt: 'DESC' },
      });
    }

    const where = role === 'creator'
      ? { creatorId: userId }
      : { assigneeId: userId };

    return this.ticketRepository.find({
      where,
      relations: ['creator', 'assignee'],
      order: { createdAt: 'DESC' },
    });
  }

  async deleteTicket(id: number, user: AuthenticatedUser): Promise<void> {
    const ticket = await this.findOne(id);
    
    // 如果是 user 角色，只能删除自己创建的，其它高级角色 (admin, tech, director) 可以删除全部
    const roleName = user.role?.name || '';
    if (roleName === 'user' && ticket.creatorId !== user.id) {
      throw new ForbiddenException('您只能删除自己创建的工单');
    }
    
    // 保存删除前的信息用于审计
    const ticketNo = ticket.ticketNo;
    const ticketTitle = ticket.title;
    const ticketId = ticket.id;

    await this.ticketRepository.remove(ticket);
    this.broadcastTicketEvent('deleted', { id: ticketId });

    // 审计：工单删除
    this.auditService.log({
      type: AuditType.TICKET_STATUS,
      action: 'deleted',
      userId: user.id,
      username: user.realName || user.displayName || user.username,
      targetId: ticketId,
      targetName: ticketNo,
      detail: `删除工单「${ticketTitle}」(${ticketNo})`,
    });
  }

  async batchDelete(ids: number[], user: AuthenticatedUser): Promise<void> {
    const roleName = user.role?.name || '';
    
    // 一次性查询所有工单，避免 N+1 查询
    const tickets = await this.ticketRepository.find({ where: { id: In(ids) } });
    
    // 权限检验
    for (const ticket of tickets) {
      if (roleName === 'user' && ticket.creatorId !== user.id) {
        throw new ForbiddenException(`工单 ${ticket.ticketNo} 属于他人，您无权批量删除。操作已整体中止。`);
      }
    }
    
    // 执行删除
    const deletedNames: string[] = [];
    for (const ticket of tickets) {
      deletedNames.push(`${ticket.ticketNo}(${ticket.title})`);
      await this.ticketRepository.remove(ticket);
      this.broadcastTicketEvent('deleted', { id: ticket.id });
    }

    // 审计：批量删除
    if (deletedNames.length > 0) {
      this.auditService.log({
        type: AuditType.TICKET_STATUS,
        action: 'batchDeleted',
        userId: user.id,
        username: user.realName || user.displayName || user.username,
        detail: `批量删除 ${deletedNames.length} 个工单: ${deletedNames.join(', ')}`,
      });
    }
  }

  async generateShareToken(id: number): Promise<string> {
    const ticket = await this.findOne(id);
    const payload = {
      sub: `anonymous-${uuidv4().substring(0, 8)}`,
      username: `外部用户-${ticket.ticketNo}`,
      role: 'external',
      ticketId: ticket.id,
    };
    
    // 生成一个有效期较短/或者配置有效期的 token
    return this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '7d', // 分享外链默认有效期 7 天
    });
  }

  async inviteParticipant(ticketId: number, inviterId: number, targetUserId: number): Promise<Ticket> {
    const ticket = await this.findOne(ticketId);
    
    // Authorization: Only creator or assignee can invite others
    if (ticket.creatorId !== inviterId && ticket.assigneeId !== inviterId) {
      throw new ForbiddenException('您没有权限邀请他人参与该工单');
    }

    // Checking if already participated
    const isAlreadyParticipating = ticket.participants && ticket.participants.some(p => p.id === targetUserId);
    if (isAlreadyParticipating) {
      throw new BadRequestException('该工程师已在工单中');
    }

    const targetUser = await this.userRepository.findOne({ where: { id: targetUserId } });
    if (!targetUser) throw new NotFoundException('受邀工程师不存在');

    const inviter = await this.userRepository.findOne({ where: { id: inviterId } });

    // Initialize array if empty
    if (!ticket.participants) ticket.participants = [];
    ticket.participants.push(targetUser);

    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);

    // Broadcast ticket change so UI updates
    this.broadcastTicketEvent('updated', fullTicket);

    // Send a system message to the chat
    if (inviter) {
      const inviterName = inviter.realName || inviter.displayName || inviter.username;
      const targetName = targetUser.realName || targetUser.displayName || targetUser.username;
      
      const message = await this.chatService.createMessage({
        ticketId: ticket.id,
        senderId: null,
        senderName: '系统通知',
        content: `人员变动: 【${inviterName}】邀请专家【${targetName}】加入了工单`,
        type: MessageType.SYSTEM,
      });
      this.chatGateway.server.to(`ticket_${ticket.id}`).emit('newMessage', message);
    }

    return fullTicket;
  }

  async removeParticipant(ticketId: number, operatorId: number, targetUserId: number): Promise<Ticket> {
    const ticket = await this.findOne(ticketId);
    
    const operator = await this.userRepository.findOne({ where: { id: operatorId }, relations: ['role'] });
    if (!operator) throw new ForbiddenException('Invalid operator');

    const roleName = typeof operator.role === 'string' ? operator.role : operator.role?.name;
    if (roleName !== 'admin' && ticket.creatorId !== operatorId && ticket.assigneeId !== operatorId && operatorId !== targetUserId) {
      throw new ForbiddenException('您没有权限移除该专家');
    }

    if (!ticket.participants) {
      throw new BadRequestException('该工程师不在工单中');
    }

    const index = ticket.participants.findIndex(p => p.id === targetUserId);
    if (index === -1) {
      throw new BadRequestException('该工程师不在工单中');
    }

    const targetUser = ticket.participants[index];
    ticket.participants.splice(index, 1);

    const saved = await this.ticketRepository.save(ticket);
    const fullTicket = await this.findOne(saved.id);

    // Broadcast ticket change
    this.broadcastTicketEvent('updated', fullTicket);

    const operatorName = operator.realName || operator.displayName || operator.username;
    const targetName = targetUser.realName || targetUser.displayName || targetUser.username;
    
    const message = await this.chatService.createMessage({
      ticketId: ticket.id,
      senderId: null,
      senderName: '系统通知',
      content: `人员变动: 【${operatorName}】将专家【${targetName}】移出了工单`,
      type: MessageType.SYSTEM,
    });
    this.chatGateway.server.to(`ticket_${ticket.id}`).emit('newMessage', message);

    // Command the target user's socket to leave the room and get kicked
    this.chatGateway.kickUserFromRoom(ticketId, targetUserId, '您已被移除该工单讨论组');

    return fullTicket;
  }

  async toggleRoomLock(ticketId: number, userId: number, locked: boolean, disableExternal: boolean): Promise<Ticket> {
    const ticket = await this.findOne(ticketId);

    if (ticket.creatorId !== userId && ticket.assigneeId !== userId) {
      throw new ForbiddenException('仅工单创建人或接单人可操作房间锁定');
    }

    ticket.isRoomLocked = locked;
    ticket.isExternalLinkDisabled = locked ? disableExternal : false;
    await this.ticketRepository.save(ticket);
    return this.findOne(ticketId);
  }

  // -------------------------
  // 持久化消息提示与红点系统
  // -------------------------

  /**
   * 获取用户的未读消息 Map 及新分配红点工单 ID 列表
   */
  async getMyBadges(userId: number) {
    // 找出所有与该用户相关的工单：我创建的、分配给我的、我参与的
    const relatedTickets = await this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoin('ticket.participants', 'participant')
      .where('ticket.creatorId = :userId', { userId })
      .orWhere('ticket.assigneeId = :userId', { userId })
      .orWhere('participant.id = :userId', { userId })
      .getMany();

    const ticketIds = relatedTickets.map(t => t.id);
    const unreadMap: Record<number, number> = {};
    const newTicketIds: number[] = [];

    if (ticketIds.length === 0) {
      return { unreadMap, newTicketIds };
    }

    // 批量查询当前用户对这些工单的阅读指针状态
    const readStates = await this.ticketReadStateRepo
      .createQueryBuilder('state')
      .where('state.userId = :userId AND state.ticketId IN (:...ticketIds)', { userId, ticketIds })
      .getMany();

    const stateMap = new Map(readStates.map(s => [s.ticketId, s]));

    for (const ticket of relatedTickets) {
      const state = stateMap.get(ticket.id);
      
      let lastReadMessageId = 0;
      if (state) {
        lastReadMessageId = state.lastReadMessageId || 0;
      } else {
        // 【兼容老数据平滑过渡】：如果该工单存在且用户从未点开过，理论上所有的消息都是未读的。
        // 但为了防止系统刚升级导致历史几百个工单满屏红点，当缺少 read 记录时我们假定它全读了（不报错红点）。
        // 唯独如果这是一个全新分配的工单，我们需要报错红点。
      }

      // 计算未读消息数
      const unreadCount = await this.messageRepo
        .createQueryBuilder('msg')
        .where('msg.ticketId = :ticketId', { ticketId: ticket.id })
        .andWhere('msg.id > :lastReadMessageId', { lastReadMessageId })
        // 自己发的消息不算未读
        .andWhere('(msg.senderId IS NULL OR msg.senderId != :userId)', { userId })
        .getCount();

      if (unreadCount > 0) {
        unreadMap[ticket.id] = unreadCount;
      }

      // 判断是否是“NEW”工单 (没有阅读记录，或者有阅读记录但之后被重新分配或有新动作)
      // 注意：自己创建的工单不视为新到达的 NEW
      if (ticket.creatorId !== userId) {
        if (!state) {
          // 如果这工单创建在上线之前很久，不弹 NEW。简单处理：最近 24 小时内的算 NEW
          const hoursSinceCreated = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000;
          if (hoursSinceCreated < 24) {
            newTicketIds.push(ticket.id);
          }
        }
      }
    }

    return { unreadMap, newTicketIds };
  }

  /**
   * 用户上报进入工单 / 已读
   */
  async readTicket(ticketId: number, userId: number) {
    // 找出工单下的最后一条消息
    const lastMessage = await this.messageRepo
      .createQueryBuilder('msg')
      .where('msg.ticketId = :ticketId', { ticketId })
      .orderBy('msg.id', 'DESC')
      .limit(1)
      .getOne();

    const lastReadMessageId = lastMessage ? lastMessage.id : 0;

    let state = await this.ticketReadStateRepo.findOne({
      where: { userId, ticketId }
    });

    if (!state) {
      state = this.ticketReadStateRepo.create({
        userId,
        ticketId,
        lastReadMessageId,
        lastReadAt: new Date(),
      });
    } else {
      if (lastReadMessageId > (state.lastReadMessageId || 0)) {
        state.lastReadMessageId = lastReadMessageId;
      }
      state.lastReadAt = new Date();
    }

    await this.ticketReadStateRepo.save(state);

    // 跨端清红点：通知该用户的所有终端消除本地红点
    this.chatGateway.emitToUser(userId, 'ticketReadCleared', { ticketId });
  }

  /**
   * 批量获取工单简要信息，用于全局通知中心下拉展示
   */
  async getBatchSummary(ticketIds: number[]) {
    if (!ticketIds || ticketIds.length === 0) return [];
    return this.ticketRepository
      .createQueryBuilder('ticket')
      .select([
        'ticket.id',
        'ticket.ticketNo',
        'ticket.title',
        'ticket.status',
        'ticket.type',
        'ticket.creatorId',
        'ticket.assigneeId',
        'ticket.createdAt'
      ])
      .where('ticket.id IN (:...ticketIds)', { ticketIds })
      .getMany();
  }
}
