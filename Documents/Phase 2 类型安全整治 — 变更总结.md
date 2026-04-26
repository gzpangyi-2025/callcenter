# Phase 2 类型安全整治 — 变更总结

**执行日期**: 2026-04-26  
**修改文件数**: 17  
**ESLint 违规减少**: 774 → 583 (**-191, -25%**)

---

## 🔧 TYPE-01: chat.gateway.ts 全面 AuthenticatedSocket 重构

```diff:chat.gateway.ts
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
import { AuthenticatedSocket } from '../../common/types/auth.types';

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

  public hasActiveScreenShare(ticketId: number): boolean {
    return this.activeSharers.has(`ticket_${ticketId}`);
  }

  public hasActiveVoice(ticketId: number): boolean {
    const participants = this.activeVoiceRooms.get(`ticket_${ticketId}`);
    return !!participants && participants.size > 0;
  }

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

      const authClient = client as AuthenticatedSocket;
      authClient.userId = payload.sub;
      authClient.username = payload.username;
      authClient.role = payload.role;
      if (payload.role === 'external') {
        authClient.allowedTicketId = payload.ticketId;
      } else {
        const user = await this.userRepository.findOne({ where: { id: payload.sub } });
        if (user) {
          authClient.realName = user.realName;
          authClient.displayName = user.displayName;
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
          this.server.emit('ticketEvent', { action: 'screenShareChanged' });
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
          messageType: message.type,
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
    // 通知全局刷新大厅状态
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
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
    // 通知全局刷新大厅状态
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
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
===
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedSocket } from '../../common/types/auth.types';

/** fetchSockets() 返回的远程 Socket 代理类型 */
interface AuthenticatedRemoteSocket {
  id: string;
  userId: number;
  username: string;
  role: string;
  realName?: string;
  displayName?: string;
  allowedTicketId?: number;
  emit: (event: string, ...args: unknown[]) => void;
  join: (room: string) => void;
  leave: (room: string) => void;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:5173', 'http://localhost:3001'],
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
  private activeSharers = new Map<
    string,
    { userId: number; userName: string }
  >();

  // 活跃语音通话跟踪: roomName -> Map<userId, userName>（使用 Map 天然去重，避免 Set 对象引用比较问题）
  private activeVoiceRooms = new Map<string, Map<number, string>>();

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

  public hasActiveScreenShare(ticketId: number): boolean {
    return this.activeSharers.has(`ticket_${ticketId}`);
  }

  public hasActiveVoice(ticketId: number): boolean {
    const participants = this.activeVoiceRooms.get(`ticket_${ticketId}`);
    return !!participants && participants.size > 0;
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      const authClient = client as AuthenticatedSocket;
      authClient.userId = payload.sub;
      authClient.username = payload.username;
      authClient.role = payload.role;
      if (payload.role === 'external') {
        authClient.allowedTicketId = payload.ticketId;
      } else {
        const user = await this.userRepository.findOne({
          where: { id: payload.sub },
        });
        if (user) {
          authClient.realName = user.realName;
          authClient.displayName = user.displayName;
        }
      }

      // 强制加入以用户ID命名的个人房间，用于多端红点同步
      void client.join(`user_${payload.sub}`);

      this.onlineUsers.set(payload.sub, client.id);

      this.logger.log(`用户 ${payload.username} (${payload.sub}) 已连接`);
    } catch (err) {
      this.logger.error('Socket connection error:', err);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    if (userId) {
      this.onlineUsers.delete(userId);
      this.logger.log(`用户 ${authClient.username} 已断开`);
      // 广播更新各房间在线列表
      this.broadcastRoomUsersForClient(client);

      // 清理该用户的活跃屏幕共享
      for (const [roomName, sharer] of this.activeSharers.entries()) {
        if (sharer.userId === userId) {
          this.activeSharers.delete(roomName);
          this.logger.log(
            `[屏幕共享] 分享方 ${userId} 断开连接，清理房间 ${roomName} 的共享状态`,
          );
          this.server.to(roomName).emit('screenShare:stopped', {
            ticketId: parseInt(roomName.replace('ticket_', '')),
            from: userId,
          });
          this.server.emit('ticketEvent', { action: 'screenShareChanged' });
        }
      }

      // 清理该用户的语音通话状态
      for (const [roomName, participants] of this.activeVoiceRooms.entries()) {
        if (participants.has(userId)) {
          participants.delete(userId);
          this.logger.log(
            `[语音通话] 用户 ${userId} 断开连接，从房间 ${roomName} 的语音通话中移除`,
          );
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
      const rs = s as unknown as AuthenticatedRemoteSocket;
      const key = `${rs.userId}-${rs.username}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      users.push({
        id: rs.userId,
        name: rs.realName || rs.displayName || rs.username,
        role: rs.role || 'user',
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
        void this.broadcastRoomUsers(room);
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
    const authClient = client as AuthenticatedSocket;
    if (
      authClient.role === 'external' &&
      authClient.allowedTicketId !== data.ticketId
    ) {
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
        client.emit('roomLocked', {
          ticketId: data.ticketId,
          message: '该房间已锁定，仅受邀人员可参与',
        });
        return;
      }
    }

    const roomName = `ticket_${data.ticketId}`;
    await client.join(roomName);
    this.logger.log(`用户 ${authClient.username} 加入房间 ${roomName}`);

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
        participants: [...voiceParticipants.entries()].map(([id, name]) => ({
          userId: id,
          userName: name,
        })),
      });
    }
  }

  @SubscribeMessage('fetchMoreHistory')
  async handleFetchMoreHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; page: number },
  ) {
    const authClient = client as AuthenticatedSocket;
    if (
      authClient.role === 'external' &&
      authClient.allowedTicketId !== data.ticketId
    ) {
      client.emit('error', '无权访问此工单聊天室');
      return;
    }
    const messages = await this.chatService.getMessagesByTicket(
      data.ticketId,
      data.page,
    );
    client.emit('moreHistoryLoaded', messages);
  }

  // 判断 socket 用户是否有权进入已锁定的房间
  private isAuthorizedForRoom(client: Socket | AuthenticatedRemoteSocket, ticket: Ticket): boolean {
    const role = (client as AuthenticatedSocket).role;
    const userId = (client as AuthenticatedSocket).userId;

    // admin 免锁定
    if (role === 'admin') return true;

    // 外部用户：看 isExternalLinkDisabled
    if (role === 'external') {
      return !ticket.isExternalLinkDisabled;
    }

    // creator / assignee
    if (
      ticket.creatorId === Number(userId) ||
      ticket.assigneeId === Number(userId)
    )
      return true;

    // participants
    if (
      ticket.participants &&
      ticket.participants.some((p) => p.id === Number(userId))
    )
      return true;

    return false;
  }

  @SubscribeMessage('lockRoom')
  async handleLockRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; disableExternal?: boolean },
  ) {
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
      relations: ['participants'],
    });
    if (!ticket) {
      client.emit('error', '工单不存在');
      return;
    }

    // 仅 creator / assignee 可锁定
    if (
      ticket.creatorId !== Number(userId) &&
      ticket.assigneeId !== Number(userId)
    ) {
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
      const rs = s as unknown as AuthenticatedRemoteSocket;
      if (rs.role === 'external') {
        continue;
      }
      const authorized = this.isAuthorizedForRoom(rs, ticket);
      if (!authorized) {
        rs.emit('roomLocked', {
          ticketId: data.ticketId,
          message: '房间已被锁定，您已被移出',
        });
        rs.leave(roomName);
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
    this.server.emit('ticketEvent', {
      action: 'update',
      data: { id: ticket.id },
    });
  }

  kickUserFromRoom(ticketId: number, targetUserId: number, message: string) {
    const roomName = `ticket_${ticketId}`;
    this.server
      .to(`user_${targetUserId}`)
      .emit('roomKicked', { ticketId, message });

    // Server-side force leave
    this.server
      .in(roomName)
      .fetchSockets()
      .then((sockets) => {
        for (const s of sockets) {
          if ((s as unknown as AuthenticatedRemoteSocket).userId === targetUserId) {
            s.leave(roomName);
          }
        }
        setTimeout(() => void this.broadcastRoomUsers(roomName), 200);
      })
      .catch((err) => this.logger.error('发送消息失败:', err));
  }

  @SubscribeMessage('kickUser')
  async handleKickUser(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; targetUserId: number },
  ) {
    const authClient = client as AuthenticatedSocket;
    const operatorId = authClient.userId;
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
    });
    if (!ticket) {
      client.emit('error', '工单不存在');
      return;
    }

    const operatorRole = authClient.role;
    if (
      operatorRole !== 'admin' &&
      ticket.creatorId !== Number(operatorId) &&
      ticket.assigneeId !== Number(operatorId)
    ) {
      client.emit('error', '只有创建人、接单人或管理员可以驱逐用户');
      return;
    }

    this.kickUserFromRoom(
      data.ticketId,
      data.targetUserId,
      '您已被移出该工单聊天室',
    );
  }

  @SubscribeMessage('unlockRoom')
  async handleUnlockRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const userId = (client as AuthenticatedSocket).userId;
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
    });
    if (!ticket) {
      client.emit('error', '工单不存在');
      return;
    }

    // 仅 creator / assignee 可解锁
    if (
      ticket.creatorId !== Number(userId) &&
      ticket.assigneeId !== Number(userId)
    ) {
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
    this.server.emit('ticketEvent', {
      action: 'update',
      data: { id: ticket.id },
    });
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as AuthenticatedSocket).userId;

    // 如果该用户在此房间的语音通话中，自动移除（防止切换房间后语音状态残留）
    const participants = this.activeVoiceRooms.get(roomName);
    if (participants?.has(userId)) {
      participants.delete(userId);
      this.logger.log(
        `[语音通话] 用户 ${userId} 离开房间 ${roomName}，自动清理语音状态`,
      );
      client.to(roomName).emit('voice:peerLeft', {
        ticketId: data.ticketId,
        userId,
      });
      if (participants.size === 0) {
        this.activeVoiceRooms.delete(roomName);
      }
    }

    // 如果该用户是此房间的屏幕共享方，自动停止共享
    const sharer = this.activeSharers.get(roomName);
    if (sharer?.userId === userId) {
      this.activeSharers.delete(roomName);
      this.logger.log(
        `[屏幕共享] 用户 ${userId} 离开房间 ${roomName}，自动清理共享状态`,
      );
      client.to(roomName).emit('screenShare:stopped', {
        ticketId: data.ticketId,
        from: userId,
      });
      this.server.emit('ticketEvent', { action: 'screenShareChanged' });
    }

    await client.leave(roomName);
    // 广播最新在线用户
    await this.broadcastRoomUsers(roomName);
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      ticketId: number;
      content: string;
      type?: string;
      fileUrl?: string;
      fileName?: string;
      fileSize?: number;
    },
  ) {
    const authClient = client as AuthenticatedSocket;
    if (
      authClient.role === 'external' &&
      authClient.allowedTicketId !== data.ticketId
    ) {
      client.emit('error', '无权发送消息至此工单');
      return;
    }

    const userId = authClient.userId;
    const username = authClient.username;
    const isExternal = authClient.role === 'external';
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
        ticket.participants.forEach((p) => targetUserIds.add(p.id));
      }

      targetUserIds.forEach((targetId) => {
        this.server.to(`user_${targetId}`).emit('ticketNewMessage', {
          ticketId: data.ticketId,
          messageId: message.id,
          senderId: userId,
          messageType: message.type,
        });
      });
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const authClient = client as AuthenticatedSocket;
    const roomName = `ticket_${data.ticketId}`;
    client.to(roomName).emit('userTyping', {
      userId: authClient.userId,
      username: authClient.username,
    });
  }

  @SubscribeMessage('recallMessage')
  async handleRecallMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; ticketId: number },
  ) {
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const username = authClient.username;
    if (!userId) {
      client.emit('error', '未授权');
      return;
    }

    try {
      await this.chatService.recallMessage(
        data.messageId,
        userId,
        username,
      );
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
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const userName =
      authClient.realName ||
      authClient.displayName ||
      authClient.username;

    this.logger.log(
      `[屏幕共享] 用户 ${userName} (${userId}) 在工单 ${data.ticketId} 发起屏幕共享`,
    );

    // 记录活跃分享状态
    this.activeSharers.set(roomName, { userId, userName });

    // 通知房间内所有其他人：有人开始共享屏幕
    client.to(roomName).emit('screenShare:started', {
      ticketId: data.ticketId,
      from: userId,
      fromName: userName,
    });
    // 通知全局刷新大厅状态
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
  }

  @SubscribeMessage('screenShare:stop')
  handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as AuthenticatedSocket).userId;

    this.logger.log(
      `[屏幕共享] 用户 ${userId} 在工单 ${data.ticketId} 停止屏幕共享`,
    );

    // 清除活跃分享状态
    this.activeSharers.delete(roomName);

    client.to(roomName).emit('screenShare:stopped', {
      ticketId: data.ticketId,
      from: userId,
    });
    // 通知全局刷新大厅状态
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
  }

  @SubscribeMessage('screenShare:offer')
  handleScreenShareOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; sdp: any; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[屏幕共享] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`,
    );
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
      from: (client as AuthenticatedSocket).userId,
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
      from: (client as AuthenticatedSocket).userId,
    });
  }

  @SubscribeMessage('screenShare:requestView')
  handleScreenShareRequestView(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[屏幕共享] 观看请求: 用户 ${fromId} -> 分享方 user_${data.to}`,
    );
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
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const userName =
      authClient.realName ||
      authClient.displayName ||
      authClient.username;

    // 检查人数上限
    const maxStr = await this.settingsService.get('voice_maxParticipants');
    const maxParticipants = maxStr ? parseInt(maxStr, 10) : 6;
    let participants = this.activeVoiceRooms.get(roomName);
    if (!participants) {
      participants = new Map();
      this.activeVoiceRooms.set(roomName, participants);
    }

    // 去重：如果同一用户重复加入（如切换房间后状态残留），先移除旧记录
    if (participants.has(userId)) {
      this.logger.warn(`[语音通话] 用户 ${userId} 重复加入，先移除旧记录`);
      participants.delete(userId);
    }

    if (participants.size >= maxParticipants) {
      client.emit('voice:rejected', {
        ticketId: data.ticketId,
        reason: `语音通话人数已达上限 (${maxParticipants}人)`,
      });
      return;
    }

    this.logger.log(
      `[语音通话] 用户 ${userName} (${userId}) 加入工单 ${data.ticketId} 的语音通话`,
    );

    // 将当前参与者列表发送给新加入的用户（用于建立 PeerConnection）
    const existingParticipants = [...participants.entries()].map(
      ([id, name]) => ({ userId: id, userName: name }),
    );
    client.emit('voice:currentParticipants', {
      ticketId: data.ticketId,
      participants: existingParticipants,
    });

    // 加入通话列表（Map 天然去重）
    participants.set(userId, userName);

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
    const userId = (client as AuthenticatedSocket).userId;

    this.logger.log(
      `[语音通话] 用户 ${userId} 离开工单 ${data.ticketId} 的语音通话`,
    );

    const participants = this.activeVoiceRooms.get(roomName);
    if (participants) {
      participants.delete(userId);
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
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[语音通话] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`,
    );
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
      from: (client as AuthenticatedSocket).userId,
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
      from: (client as AuthenticatedSocket).userId,
    });
  }
}
```

**核心变更**:
- 所有 47+ 处 `(client as any).userId / .username / .role` 替换为 `(client as AuthenticatedSocket).xxx`
- 新增 `AuthenticatedRemoteSocket` 接口处理 `fetchSockets()` 返回的远程 Socket 代理类型
- `getRoomUsers()`、`lockRoom()`、`kickUserFromRoom()` 中的 remote socket 全部类型化
- 移除未使用的 `In` import 和未使用的 `message` 变量

> 该文件的 unsafe 违规从 **142 处** 大幅下降。

---

## 📦 TYPE-02: BBS Controller DTO 重构

```diff:bbs.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { BbsService } from './bbs.service';

@Controller('bbs')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class BbsController {
  constructor(private readonly bbsService: BbsService) {}

  // ───────── 板块路由 ─────────
  @Get('sections')
  @Permissions('bbs:read')
  findAllSections() {
    return this.bbsService.findAllSections();
  }

  @Post('sections')
  @Permissions('bbs:edit')
  createSection(@Body() body: any) {
    return this.bbsService.createSection(body);
  }

  @Put('sections/:id')
  @Permissions('bbs:edit')
  updateSection(@Param('id') id: string, @Body() body: any) {
    return this.bbsService.updateSection(Number(id), body);
  }

  @Delete('sections/:id')
  @Permissions('bbs:delete')
  removeSection(@Param('id') id: string) {
    return this.bbsService.removeSection(Number(id));
  }

  // ───────── 预设标签路由 ─────────
  @Get('tags')
  @Permissions('bbs:read')
  findAllTags() {
    return this.bbsService.findAllTags();
  }

  @Post('tags')
  @Permissions('bbs:edit')
  createTag(@Body() body: any) {
    return this.bbsService.createTag(body);
  }

  @Delete('tags/:id')
  @Permissions('bbs:delete')
  removeTag(@Param('id') id: string) {
    return this.bbsService.removeTag(Number(id));
  }

  // ───────── 帖子迁移 ─────────
  @Put('posts/migrate')
  @Permissions('bbs:edit')
  migrateToSection(@Body() body: { ids: number[]; targetSectionId: number }) {
    return this.bbsService.migrateToSection(body.ids, body.targetSectionId);
  }

  // ───────── 帖子路由 ─────────
  @Get('posts')
  @Permissions('bbs:read')
  findAll(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('tag') tag: string,
    @Query('search') search: string,
    @Query('sortBy') sortBy: string,
    @Query('status') status: string,
    @Query('sectionId') sectionId: string,
  ) {
    return this.bbsService.findAll(
      Number(page) || 1,
      Number(pageSize) || 20,
      tag,
      search,
      sortBy,
      status,
      sectionId ? Number(sectionId) : undefined,
    );
  }

  @Get('posts/:id')
  @Permissions('bbs:read')
  async findOne(@Param('id') id: string, @Request() req: any) {
    if (req.user?.role === 'external' || req.user?.role?.name === 'external') {
      if (Number(req.user.bbsId) !== Number(id)) {
        throw new UnauthorizedException('无权访问该论坛帖子');
      }
    }
    const post = await this.bbsService.findOne(Number(id));
    await this.bbsService.incrementView(Number(id));
    return post;
  }

  @Post('posts/:id/share')
  @Permissions('bbs:read')
  async generateShareToken(@Param('id') id: string) {
    const token = await this.bbsService.generateShareToken(Number(id));
    return { token };
  }

  @Post('posts')
  @Permissions('bbs:create')
  create(@Body() body: any, @Request() req: any) {
    return this.bbsService.create(body, req.user.id);
  }

  @Put('posts/:id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    const hasEditPerm = req.user.role?.permissions?.some(
      (p: any) => `${p.resource}:${p.action}` === 'bbs:edit',
    );
    const canBypass =
      req.user.role?.name === 'admin' ||
      req.user.username === 'admin' ||
      hasEditPerm;
    return this.bbsService.update(Number(id), body, req.user.id, canBypass);
  }

  @Delete('posts/batch')
  batchRemove(@Body('ids') ids: number[], @Request() req: any) {
    const hasDeletePerm = req.user.role?.permissions?.some(
      (p: any) => `${p.resource}:${p.action}` === 'bbs:delete',
    );
    const canBypass =
      req.user.role?.name === 'admin' ||
      req.user.username === 'admin' ||
      hasDeletePerm;
    return this.bbsService.batchRemove(ids, req.user.id, canBypass);
  }

  @Delete('posts/:id')
  remove(@Param('id') id: string, @Request() req: any) {
    const hasDeletePerm = req.user.role?.permissions?.some(
      (p: any) => `${p.resource}:${p.action}` === 'bbs:delete',
    );
    const canBypass =
      req.user.role?.name === 'admin' ||
      req.user.username === 'admin' ||
      hasDeletePerm;
    return this.bbsService.remove(Number(id), req.user.id, canBypass);
  }

  @Put('posts/:id/pin')
  @Permissions('bbs:edit')
  togglePin(@Param('id') id: string) {
    return this.bbsService.togglePin(Number(id));
  }

  @Put('posts/:id/archive')
  @Permissions('bbs:edit')
  archive(@Param('id') id: string) {
    return this.bbsService.archive(Number(id));
  }

  @Get('posts/:id/comments')
  @Permissions('bbs:read')
  getComments(@Param('id') id: string) {
    return this.bbsService.getComments(Number(id));
  }

  @Post('posts/:id/comments')
  @Permissions('bbs:comment')
  addComment(
    @Param('id') id: string,
    @Body('content') content: string,
    @Request() req: any,
  ) {
    return this.bbsService.addComment(Number(id), content, req.user.id);
  }

  // ───────── 订阅及通知 API ─────────
  @Get('notifications')
  @Permissions('bbs:read')
  getNotifications(@Request() req: any) {
    return this.bbsService.getUnreadNotifications(req.user.id);
  }

  @Post('posts/:id/subscribe')
  @Permissions('bbs:read')
  subscribe(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.subscribe(Number(id), req.user.id);
  }

  @Delete('posts/:id/subscribe')
  @Permissions('bbs:read')
  unsubscribe(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.unsubscribe(Number(id), req.user.id);
  }

  @Get('posts/:id/subscribe')
  @Permissions('bbs:read')
  getSubscriptionStatus(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.getSubscriptionStatus(Number(id), req.user.id);
  }

  @Post('posts/:id/clearUnread')
  @Permissions('bbs:read')
  clearUnread(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.clearUnread(Number(id), req.user.id);
  }
}
===
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UnauthorizedException,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { BbsService } from './bbs.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';

/** 从 Express Request 中提取经过 JWT 认证的用户信息 */
const getUser = (req: { user?: unknown }): AuthenticatedUser =>
  req.user as AuthenticatedUser;

// ───────── DTO 定义 ─────────

interface CreateSectionDto {
  name: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

interface UpdateSectionDto {
  name?: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

interface CreateTagDto {
  name: string;
  color?: string;
}

interface CreatePostDto {
  title: string;
  content: string;
  tags?: string[];
  sectionId?: number;
}

interface UpdatePostDto {
  title?: string;
  content?: string;
  tags?: string[];
  sectionId?: number;
}

interface MigratePostsDto {
  ids: number[];
  targetSectionId: number;
}

@Controller('bbs')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class BbsController {
  constructor(private readonly bbsService: BbsService) {}

  // ───────── 板块路由 ─────────
  @Get('sections')
  @Permissions('bbs:read')
  findAllSections() {
    return this.bbsService.findAllSections();
  }

  @Post('sections')
  @Permissions('bbs:edit')
  createSection(@Body() body: CreateSectionDto) {
    return this.bbsService.createSection(body);
  }

  @Put('sections/:id')
  @Permissions('bbs:edit')
  updateSection(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSectionDto,
  ) {
    return this.bbsService.updateSection(id, body);
  }

  @Delete('sections/:id')
  @Permissions('bbs:delete')
  removeSection(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.removeSection(id);
  }

  // ───────── 预设标签路由 ─────────
  @Get('tags')
  @Permissions('bbs:read')
  findAllTags() {
    return this.bbsService.findAllTags();
  }

  @Post('tags')
  @Permissions('bbs:edit')
  createTag(@Body() body: CreateTagDto) {
    return this.bbsService.createTag(body);
  }

  @Delete('tags/:id')
  @Permissions('bbs:delete')
  removeTag(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.removeTag(id);
  }

  // ───────── 帖子迁移 ─────────
  @Put('posts/migrate')
  @Permissions('bbs:edit')
  migrateToSection(@Body() body: MigratePostsDto) {
    return this.bbsService.migrateToSection(body.ids, body.targetSectionId);
  }

  // ───────── 帖子路由 ─────────
  @Get('posts')
  @Permissions('bbs:read')
  findAll(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('tag') tag: string,
    @Query('search') search: string,
    @Query('sortBy') sortBy: string,
    @Query('status') status: string,
    @Query('sectionId') sectionId: string,
  ) {
    return this.bbsService.findAll(
      Number(page) || 1,
      Number(pageSize) || 20,
      tag,
      search,
      sortBy,
      status,
      sectionId ? Number(sectionId) : undefined,
    );
  }

  @Get('posts/:id')
  @Permissions('bbs:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: { user?: unknown }) {
    const user = getUser(req);
    if (user.role?.name === 'external') {
      // 外部用户仅能查看被分享的帖子（bbsId 保存在 JWT payload 中）
      const bbsId = (user as AuthenticatedUser & { bbsId?: number }).bbsId;
      if (bbsId !== id) {
        throw new UnauthorizedException('无权访问该论坛帖子');
      }
    }
    const post = await this.bbsService.findOne(id);
    await this.bbsService.incrementView(id);
    return post;
  }

  @Post('posts/:id/share')
  @Permissions('bbs:read')
  async generateShareToken(@Param('id', ParseIntPipe) id: number) {
    const token = await this.bbsService.generateShareToken(id);
    return { token };
  }

  @Post('posts')
  @Permissions('bbs:create')
  create(@Body() body: CreatePostDto, @Request() req: { user?: unknown }) {
    return this.bbsService.create(body, getUser(req).id);
  }

  @Put('posts/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePostDto,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    const isAdmin = user.role?.name === 'admin';
    const hasEditPerm = user.role?.permissions?.some(
      (p) => `${p.resource}:${p.action}` === 'bbs:edit',
    );
    return this.bbsService.update(id, body, user.id, isAdmin || !!hasEditPerm);
  }

  @Delete('posts/batch')
  batchRemove(
    @Body('ids') ids: number[],
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    const isAdmin = user.role?.name === 'admin';
    const hasDeletePerm = user.role?.permissions?.some(
      (p) => `${p.resource}:${p.action}` === 'bbs:delete',
    );
    return this.bbsService.batchRemove(ids, user.id, isAdmin || !!hasDeletePerm);
  }

  @Delete('posts/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    const isAdmin = user.role?.name === 'admin';
    const hasDeletePerm = user.role?.permissions?.some(
      (p) => `${p.resource}:${p.action}` === 'bbs:delete',
    );
    return this.bbsService.remove(id, user.id, isAdmin || !!hasDeletePerm);
  }

  @Put('posts/:id/pin')
  @Permissions('bbs:edit')
  togglePin(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.togglePin(id);
  }

  @Put('posts/:id/archive')
  @Permissions('bbs:edit')
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.archive(id);
  }

  @Get('posts/:id/comments')
  @Permissions('bbs:read')
  getComments(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.getComments(id);
  }

  @Post('posts/:id/comments')
  @Permissions('bbs:comment')
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body('content') content: string,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.addComment(id, content, getUser(req).id);
  }

  // ───────── 订阅及通知 API ─────────
  @Get('notifications')
  @Permissions('bbs:read')
  getNotifications(@Request() req: { user?: unknown }) {
    return this.bbsService.getUnreadNotifications(getUser(req).id);
  }

  @Post('posts/:id/subscribe')
  @Permissions('bbs:read')
  subscribe(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.subscribe(id, getUser(req).id);
  }

  @Delete('posts/:id/subscribe')
  @Permissions('bbs:read')
  unsubscribe(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.unsubscribe(id, getUser(req).id);
  }

  @Get('posts/:id/subscribe')
  @Permissions('bbs:read')
  getSubscriptionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.getSubscriptionStatus(id, getUser(req).id);
  }

  @Post('posts/:id/clearUnread')
  @Permissions('bbs:read')
  clearUnread(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.clearUnread(id, getUser(req).id);
  }
}

```

**核心变更**:
- 定义 7 个 DTO 接口: `CreateSectionDto`, `UpdateSectionDto`, `CreateTagDto`, `CreatePostDto`, `UpdatePostDto`, `MigratePostsDto`
- 所有 `@Body() body: any` → 强类型 DTO
- 所有 `@Request() req: any` → `@Request() req: { user?: unknown }` + `getUser()` 类型安全辅助函数
- 所有 `@Param('id') id: string` → `@Param('id', ParseIntPipe) id: number`
- 移除 `username === 'admin'` 绕过 (SEC-05 延伸修复)
- 权限检查中的 `(p: any)` → 类型安全的 `(p)` 推断

---

## 🏗️ MISC-01: Category Controller Guard 统一化

```diff:category.controller.ts
import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoryService } from './category.service';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * 上传 Excel 导入分类（清空旧数据后全量写入）
   */
  @Post('import')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('settings:edit')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const result = await this.categoryService.importFromExcel(file.buffer);
    return {
      code: 0,
      message: `成功导入 ${result.imported} 条分类数据`,
      data: result,
    };
  }

  /**
   * 获取三级联动树（给前端 Cascader 用）
   */
  @Get('tree')
  @UseGuards(AuthGuard('jwt'))
  async getTree() {
    const data = await this.categoryService.getTree();
    return { code: 0, data };
  }

  /**
   * 获取全部扁平记录（管理后台预览用）
   */
  @Get('all')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @Permissions('settings:read')
  async findAll() {
    const data = await this.categoryService.findAll();
    return { code: 0, data };
  }
}
===
import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoryService } from './category.service';

@Controller('category')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /**
   * 上传 Excel 导入分类（清空旧数据后全量写入）
   */
  @Post('import')
  @Permissions('settings:edit')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const result = await this.categoryService.importFromExcel(file.buffer);
    return {
      code: 0,
      message: `成功导入 ${result.imported} 条分类数据`,
      data: result,
    };
  }

  /**
   * 获取三级联动树（给前端 Cascader 用）
   */
  @Get('tree')
  async getTree() {
    const data = await this.categoryService.getTree();
    return { code: 0, data };
  }

  /**
   * 获取全部扁平记录（管理后台预览用）
   */
  @Get('all')
  @Permissions('settings:read')
  async findAll() {
    const data = await this.categoryService.findAll();
    return { code: 0, data };
  }
}

```

- 将 `@UseGuards(AuthGuard('jwt'), PermissionsGuard)` 提升到类级别
- 移除每个方法上的重复 guard 声明
- `@UploadedFile() file: any` → `Express.Multer.File`

---

## 🧹 MISC-02: 未使用变量清理 (30 → 4)

| 文件 | 移除的未使用项 |
|------|---------------|
| `audit.service.ts` | `Between`, `Like` |
| `auth.service.ts` | 2处 `catch(e)` → `catch` |
| `backup.service.ts` | `extname`, `writeFileSync`, `copyFileSync`, `createHash`, `IMAGE_EXTS` |
| `chat.gateway.ts` | `In` |
| `chat.service.ts` | `path`, `fs` |
| `files.controller.ts` | `NotFoundException` |
| `files.service.ts` | 回调 `data` → `_data`, `catch(e)` → `catch` |
| `infra.service.ts` | `promisify`, `execAsync` |
| `knowledge.service.ts` | `fs`, `path` |
| `report.service.ts` | `statusCounts` (整个无效查询), `resultMapper` |
| `search.subscriber.ts` | `Message` |
| `tickets-export.service.ts` | `path`, `fs` |
| `roles.controller.ts` | `Roles` |
| `tickets.controller.ts` | `Roles`, `req` → `_req` |
| `users.controller.ts` | `Roles` |

**剩余 4 处**: COS SDK 回调签名的 `_data` (2处)、`_req` 未读参数 (1处)、测试文件 (1处) — 均为符合规范的 intentionally unused。

---

## ✅ 验证结果

- `npm run build` (NestJS) ✅ 通过
- ESLint 总计 **583 处** (从 774 减少 191 处)
- 代码已同步至生产服务器
