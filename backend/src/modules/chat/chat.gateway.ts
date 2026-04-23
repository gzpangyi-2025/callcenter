import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { SettingsService } from '../settings/settings.service';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3001'],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // 在线用户映射: visitorKey -> socketId
  private onlineUsers = new Map<string | number, string>();

  // 活跃屏幕共享跟踪: roomName -> { userId, userName }
  private activeSharers = new Map<string, { userId: number; userName: string }>();

  // 活跃语音通话跟踪: roomName -> Set<{ userId, userName }>
  private activeVoiceRooms = new Map<string, Set<{ userId: number; userName: string }>>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token
        || client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      (client as any).userId = payload.sub;
      (client as any).username = payload.username;
      (client as any).role = payload.role;
      if (payload.role === 'external') {
        (client as any).allowedTicketId = payload.ticketId;
      } else {
        const user = await this.userRepository.findOne({ where: { id: payload.sub } });
        if (user) {
          (client as any).realName = user.realName;
          (client as any).displayName = user.displayName;
        }
      }

      // 强制加入以用户ID命名的个人房间，用于多端红点同步
      client.join(`user_${payload.sub}`);

      this.onlineUsers.set(payload.sub, client.id);

      this.logger.log(`用户 ${payload.username} (${payload.sub}) 已连接`);
    } catch (err) {
      this.logger.error('Socket connection error:', err);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      this.onlineUsers.delete(userId);
      this.logger.log(`用户 ${(client as any).username} 已断开`);
      // 广播更新各房间在线列表
      this.broadcastRoomUsersForClient(client);

      // 清理该用户的活跃屏幕共享
      for (const [roomName, sharer] of this.activeSharers.entries()) {
        if (sharer.userId === userId) {
          this.activeSharers.delete(roomName);
          this.logger.log(`[屏幕共享] 分享方 ${userId} 断开连接，清理房间 ${roomName} 的共享状态`);
          this.server.to(roomName).emit('screenShare:stopped', {
            ticketId: parseInt(roomName.replace('ticket_', '')),
            from: userId,
          });
        }
      }

      // 清理该用户的语音通话状态
      for (const [roomName, participants] of this.activeVoiceRooms.entries()) {
        const found = [...participants].find(p => p.userId === userId);
        if (found) {
          participants.delete(found);
          this.logger.log(`[语音通话] 用户 ${userId} 断开连接，从房间 ${roomName} 的语音通话中移除`);
          this.server.to(roomName).emit('voice:peerLeft', {
            ticketId: parseInt(roomName.replace('ticket_', '')),
            userId,
          });
          if (participants.size === 0) {
            this.activeVoiceRooms.delete(roomName);
          }
        }
      }
    }
  }

  // 获取一个房间内所有在线用户信息
  private async getRoomUsers(roomName: string) {
    const sockets = await this.server.in(roomName).fetchSockets();
    const users: { id: string | number; name: string; role: string }[] = [];
    const seenKeys = new Set<string>();

    for (const s of sockets) {
      const key = `${(s as any).userId}-${(s as any).username}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      users.push({
        id: (s as any).userId,
        name: (s as any).realName || (s as any).displayName || (s as any).username,
        role: (s as any).role || 'user',
      });
    }
    return users;
  }

  // 广播房间在线用户
  private async broadcastRoomUsers(roomName: string) {
    const users = await this.getRoomUsers(roomName);
    this.server.to(roomName).emit('roomUsers', { room: roomName, users });
  }

  // 在用户断线时，遍历其所在房间广播
  private broadcastRoomUsersForClient(client: Socket) {
    const rooms = client.rooms;
    rooms.forEach((room) => {
      if (room.startsWith('ticket_')) {
        this.broadcastRoomUsers(room);
      }
    });
  }

  // 给特定用户的所有终端发送事件
  public emitToUser(userId: number, event: string, data: any) {
    this.server.to(`user_${userId}`).emit(event, data);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    if ((client as any).role === 'external' && (client as any).allowedTicketId !== data.ticketId) {
      client.emit('error', '无权访问此工单聊天室');
      return;
    }

    // 房间锁定鉴权
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
      relations: ['participants'],
    });
    if (ticket && ticket.isRoomLocked) {
      const authorized = this.isAuthorizedForRoom(client, ticket);
      if (!authorized) {
        client.emit('roomLocked', { ticketId: data.ticketId, message: '该房间已锁定，仅受邀人员可参与' });
        return;
      }
    }

    const roomName = `ticket_${data.ticketId}`;
    await client.join(roomName);
    this.logger.log(`用户 ${(client as any).username} 加入房间 ${roomName}`);

    // 获取历史消息
    const messages = await this.chatService.getMessagesByTicket(data.ticketId);
    client.emit('messageHistory', messages);

    // 发送当前锁定状态
    if (ticket) {
      client.emit('roomLockChanged', {
        ticketId: data.ticketId,
        locked: ticket.isRoomLocked,
        externalDisabled: ticket.isExternalLinkDisabled,
      });
    }

    // 广播最新在线用户
    await this.broadcastRoomUsers(roomName);

    // 如果房间内有活跃屏幕共享，通知新加入的用户
    const activeSharer = this.activeSharers.get(roomName);
    if (activeSharer) {
      client.emit('screenShare:active', {
        ticketId: data.ticketId,
        from: activeSharer.userId,
        fromName: activeSharer.userName,
      });
    }

    // 如果房间内有活跃语音通话，通知新加入的用户
    const voiceParticipants = this.activeVoiceRooms.get(roomName);
    if (voiceParticipants && voiceParticipants.size > 0) {
      client.emit('voice:active', {
        ticketId: data.ticketId,
        participants: [...voiceParticipants],
      });
    }
  }

  @SubscribeMessage('fetchMoreHistory')
  async handleFetchMoreHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; page: number },
  ) {
    if ((client as any).role === 'external' && (client as any).allowedTicketId !== data.ticketId) {
      client.emit('error', '无权访问此工单聊天室');
      return;
    }
    const messages = await this.chatService.getMessagesByTicket(data.ticketId, data.page);
    client.emit('moreHistoryLoaded', messages);
  }

  // 判断 socket 用户是否有权进入已锁定的房间
  private isAuthorizedForRoom(client: Socket, ticket: Ticket): boolean {
    const role = (client as any).role;
    const userId = (client as any).userId;

    // admin 免锁定
    if (role === 'admin') return true;

    // 外部用户：看 isExternalLinkDisabled
    if (role === 'external') {
      return !ticket.isExternalLinkDisabled;
    }

    // creator / assignee
    if (ticket.creatorId === Number(userId) || ticket.assigneeId === Number(userId)) return true;

    // participants
    if (ticket.participants && ticket.participants.some(p => p.id === Number(userId))) return true;

    return false;
  }

  @SubscribeMessage('lockRoom')
  async handleLockRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; disableExternal?: boolean },
  ) {
    const userId = (client as any).userId;
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
      relations: ['participants'],
    });
    if (!ticket) { client.emit('error', '工单不存在'); return; }

    // 仅 creator / assignee 可锁定
    if (ticket.creatorId !== Number(userId) && ticket.assigneeId !== Number(userId)) {
      client.emit('error', '仅工单创建人或接单人可锁定房间');
      return;
    }

    ticket.isRoomLocked = true;
    ticket.isExternalLinkDisabled = !!data.disableExternal;
    await this.ticketRepository.save(ticket);

    const roomName = `ticket_${data.ticketId}`;

    // 立即踢出未授权的内部用户（外部用户如果在锁定前已在房间内，则依据规则不踢出）
    const sockets = await this.server.in(roomName).fetchSockets();
    for (const s of sockets) {
      const socketData = s as any;
      if (socketData.role === 'external') {
        continue;
      }
      const authorized = this.isAuthorizedForRoom(socketData, ticket);
      if (!authorized) {
        socketData.emit('roomLocked', { ticketId: data.ticketId, message: '房间已被锁定，您已被移出' });
        socketData.leave(roomName);
      }
    }

    // 广播锁定状态给剩余用户
    this.server.to(roomName).emit('roomLockChanged', {
      ticketId: data.ticketId,
      locked: true,
      externalDisabled: ticket.isExternalLinkDisabled,
    });

    // 广播更新在线用户列表
    await this.broadcastRoomUsers(roomName);

    // 发送全局事件，触发工单列表刷新状态
    this.server.emit('ticketEvent', { action: 'update', data: { id: ticket.id } });
  }

  kickUserFromRoom(ticketId: number, targetUserId: number, message: string) {
    const roomName = `ticket_${ticketId}`;
    this.server.to(`user_${targetUserId}`).emit('roomKicked', { ticketId, message });
    
    // Server-side force leave
    this.server.in(roomName).fetchSockets().then(sockets => {
      for (const s of sockets) {
        if ((s as any).userId === targetUserId) {
          s.leave(roomName);
        }
      }
      setTimeout(() => this.broadcastRoomUsers(roomName), 200);
    }).catch(err => this.logger.error('发送消息失败:', err));
  }

  @SubscribeMessage('kickUser')
  async handleKickUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; targetUserId: number },
  ) {
    const operatorId = (client as any).userId;
    const ticket = await this.ticketRepository.findOne({ where: { id: data.ticketId }});
    if (!ticket) { client.emit('error', '工单不存在'); return; }

    const operatorRole = (client as any).role;
    if (operatorRole !== 'admin' && ticket.creatorId !== Number(operatorId) && ticket.assigneeId !== Number(operatorId)) {
      client.emit('error', '只有创建人、接单人或管理员可以驱逐用户');
      return;
    }

    this.kickUserFromRoom(data.ticketId, data.targetUserId, '您已被移出该工单聊天室');
  }

  @SubscribeMessage('unlockRoom')
  async handleUnlockRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const userId = (client as any).userId;
    const ticket = await this.ticketRepository.findOne({ where: { id: data.ticketId } });
    if (!ticket) { client.emit('error', '工单不存在'); return; }

    // 仅 creator / assignee 可解锁
    if (ticket.creatorId !== Number(userId) && ticket.assigneeId !== Number(userId)) {
      client.emit('error', '仅工单创建人或接单人可解锁房间');
      return;
    }

    ticket.isRoomLocked = false;
    ticket.isExternalLinkDisabled = false;
    await this.ticketRepository.save(ticket);

    const roomName = `ticket_${data.ticketId}`;
    this.server.to(roomName).emit('roomLockChanged', {
      ticketId: data.ticketId,
      locked: false,
      externalDisabled: false,
    });

    // 触发全局更新
    this.server.emit('ticketEvent', { action: 'update', data: { id: ticket.id } });
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    await client.leave(roomName);
    // 广播最新在线用户
    await this.broadcastRoomUsers(roomName);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      ticketId: number;
      content: string;
      type?: string;
      fileUrl?: string;
      fileName?: string;
      fileSize?: number;
    },
  ) {
    if ((client as any).role === 'external' && (client as any).allowedTicketId !== data.ticketId) {
      client.emit('error', '无权发送消息至此工单');
      return;
    }

    const userId = (client as any).userId;
    const username = (client as any).username;
    const isExternal = (client as any).role === 'external';
    const parsedUserId = isExternal ? null : Number(userId);

    const message = await this.chatService.createMessage({
      ticketId: data.ticketId,
      senderId: parsedUserId,
      senderName: username, // 始终保存发送者名称（对外部用户尤为关键）
      content: data.content,
      type: (data.type as any) || 'text',
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileSize: data.fileSize,
    });

    const roomName = `ticket_${data.ticketId}`;
    this.server.to(roomName).emit('newMessage', message);

    // 取消全局广播新消息通知（避免信息泄露和不相关的红点累加），仅定向投放到参与该工单的用户
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
      relations: ['participants'],
    });

    if (ticket) {
      const targetUserIds = new Set<number>();
      if (ticket.creatorId) targetUserIds.add(ticket.creatorId);
      if (ticket.assigneeId) targetUserIds.add(ticket.assigneeId);
      if (Array.isArray(ticket.participants)) {
        ticket.participants.forEach(p => targetUserIds.add(p.id));
      }

      targetUserIds.forEach(targetId => {
        this.server.to(`user_${targetId}`).emit('ticketNewMessage', {
          ticketId: data.ticketId,
          messageId: message.id,
          senderId: userId,
        });
      });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    client.to(roomName).emit('userTyping', {
      userId: (client as any).userId,
      username: (client as any).username,
    });
  }

  @SubscribeMessage('recallMessage')
  async handleRecallMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; ticketId: number },
  ) {
    const userId = (client as any).userId;
    const username = (client as any).username;
    if (!userId) {
      client.emit('error', '未授权');
      return;
    }

    try {
      const message = await this.chatService.recallMessage(data.messageId, userId, username);
      const roomName = `ticket_${data.ticketId}`;
      // 广播给房间内所有人（包括发送者自己）
      this.server.to(roomName).emit('messageRecalled', {
        messageId: data.messageId,
        ticketId: data.ticketId,
      });
    } catch (err: any) {
      client.emit('recallError', { message: err.message || '撤回失败' });
    }
  }

  // ==================== 屏幕共享信令 ====================

  @SubscribeMessage('screenShare:start')
  handleScreenShareStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as any).userId;
    const userName = (client as any).realName || (client as any).displayName || (client as any).username;

    this.logger.log(`[屏幕共享] 用户 ${userName} (${userId}) 在工单 ${data.ticketId} 发起屏幕共享`);

    // 记录活跃分享状态
    this.activeSharers.set(roomName, { userId, userName });

    // 通知房间内所有其他人：有人开始共享屏幕
    client.to(roomName).emit('screenShare:started', {
      ticketId: data.ticketId,
      from: userId,
      fromName: userName,
    });
  }

  @SubscribeMessage('screenShare:stop')
  handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as any).userId;

    this.logger.log(`[屏幕共享] 用户 ${userId} 在工单 ${data.ticketId} 停止屏幕共享`);

    // 清除活跃分享状态
    this.activeSharers.delete(roomName);

    client.to(roomName).emit('screenShare:stopped', {
      ticketId: data.ticketId,
      from: userId,
    });
  }

  @SubscribeMessage('screenShare:offer')
  handleScreenShareOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; sdp: any; to: number },
  ) {
    const fromId = (client as any).userId;
    this.logger.debug(`[屏幕共享] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`);
    // 将 SDP Offer 转发给指定观看者
    this.server.to(`user_${data.to}`).emit('screenShare:offer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: fromId,
    });
  }

  @SubscribeMessage('screenShare:answer')
  handleScreenShareAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; sdp: any; to: number },
  ) {
    // 将 SDP Answer 转发回分享方
    this.server.to(`user_${data.to}`).emit('screenShare:answer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: (client as any).userId,
    });
  }

  @SubscribeMessage('screenShare:ice')
  handleScreenShareIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; candidate: any; to: number },
  ) {
    // 转发 ICE Candidate
    this.server.to(`user_${data.to}`).emit('screenShare:ice', {
      ticketId: data.ticketId,
      candidate: data.candidate,
      from: (client as any).userId,
    });
  }

  @SubscribeMessage('screenShare:requestView')
  handleScreenShareRequestView(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; to: number },
  ) {
    const fromId = (client as any).userId;
    this.logger.debug(`[屏幕共享] 观看请求: 用户 ${fromId} -> 分享方 user_${data.to}`);
    // 观看者请求建立连接，转发给分享方
    this.server.to(`user_${data.to}`).emit('screenShare:requestView', {
      ticketId: data.ticketId,
      from: fromId,
    });
  }

  // ==================== 语音通话信令 ====================

  @SubscribeMessage('voice:join')
  async handleVoiceJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as any).userId;
    const userName = (client as any).realName || (client as any).displayName || (client as any).username;

    // 检查人数上限
    const maxStr = await this.settingsService.get('voice_maxParticipants');
    const maxParticipants = maxStr ? parseInt(maxStr, 10) : 6;
    const participants = this.activeVoiceRooms.get(roomName) || new Set();

    if (participants.size >= maxParticipants) {
      client.emit('voice:rejected', {
        ticketId: data.ticketId,
        reason: `语音通话人数已达上限 (${maxParticipants}人)`,
      });
      return;
    }

    this.logger.log(`[语音通话] 用户 ${userName} (${userId}) 加入工单 ${data.ticketId} 的语音通话`);

    // 将当前参与者列表发送给新加入的用户（用于建立 PeerConnection）
    const existingParticipants = [...participants];
    client.emit('voice:currentParticipants', {
      ticketId: data.ticketId,
      participants: existingParticipants,
    });

    // 加入通话列表
    participants.add({ userId, userName });
    this.activeVoiceRooms.set(roomName, participants);

    // 广播给房间内所有人（包括非语音参与者，用于显示状态）
    client.to(roomName).emit('voice:peerJoined', {
      ticketId: data.ticketId,
      userId,
      userName,
    });
  }

  @SubscribeMessage('voice:leave')
  handleVoiceLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as any).userId;

    this.logger.log(`[语音通话] 用户 ${userId} 离开工单 ${data.ticketId} 的语音通话`);

    const participants = this.activeVoiceRooms.get(roomName);
    if (participants) {
      const found = [...participants].find(p => p.userId === userId);
      if (found) participants.delete(found);
      if (participants.size === 0) {
        this.activeVoiceRooms.delete(roomName);
      }
    }

    client.to(roomName).emit('voice:peerLeft', {
      ticketId: data.ticketId,
      userId,
    });
  }

  @SubscribeMessage('voice:offer')
  handleVoiceOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; sdp: any; to: number },
  ) {
    const fromId = (client as any).userId;
    this.logger.debug(`[语音通话] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`);
    this.server.to(`user_${data.to}`).emit('voice:offer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: fromId,
    });
  }

  @SubscribeMessage('voice:answer')
  handleVoiceAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; sdp: any; to: number },
  ) {
    this.server.to(`user_${data.to}`).emit('voice:answer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: (client as any).userId,
    });
  }

  @SubscribeMessage('voice:ice')
  handleVoiceIce(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; candidate: any; to: number },
  ) {
    this.server.to(`user_${data.to}`).emit('voice:ice', {
      ticketId: data.ticketId,
      candidate: data.candidate,
      from: (client as any).userId,
    });
  }
}
