# Phase 1 安全加固 — 变更总结

**执行日期**: 2026-04-26  
**修改文件数**: 13  
**ESLint 违规消除**: floating-promises 16处 + misused-promises 7处 = **23 → 0**

---

## 🔒 安全修复

### SEC-01: JWT Secret 硬编码兜底值已移除

```diff:jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          return request?.query?.token as string;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'fallback_secret',
    });
  }

  async validate(payload: any) {
    if (payload.role === 'external') {
      return {
        id: payload.sub,
        username: payload.username,
        displayName: payload.username,
        role: { id: -1, name: 'external', permissions: [] },
        ticketId: payload.ticketId,
      };
    }

    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      realName: user.realName,
      role: user.role,
    };
  }
}
===
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error(
        '❌ 环境变量 JWT_SECRET 未配置！请在 .env 文件中设置 JWT_SECRET 后重新启动。',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          return request?.query?.token as string;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: any) {
    if (payload.role === 'external') {
      return {
        id: payload.sub,
        username: payload.username,
        displayName: payload.username,
        role: { id: -1, name: 'external', permissions: [] },
        ticketId: payload.ticketId,
        bbsId: payload.bbsId,
      };
    }

    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      realName: user.realName,
      role: user.role,
    };
  }
}
```

**影响**: 如果 `.env` 中未配置 `JWT_SECRET`，应用将拒绝启动并抛出明确的错误消息，防止使用可预测的默认密钥被伪造 Token。

---

### SEC-02: WebSocket CORS 改为环境变量驱动

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
import { Repository, In } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedSocket } from '../../common/types/auth.types';

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
      const key = `${(s as any).userId}-${(s as any).username}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      users.push({
        id: (s as any).userId,
        name:
          (s as any).realName || (s as any).displayName || (s as any).username,
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
    if (
      (client as any).role === 'external' &&
      (client as any).allowedTicketId !== data.ticketId
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
    if (
      (client as any).role === 'external' &&
      (client as any).allowedTicketId !== data.ticketId
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
    const userId = (client as any).userId;
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
      const socketData = s as any;
      if (socketData.role === 'external') {
        continue;
      }
      const authorized = this.isAuthorizedForRoom(socketData, ticket);
      if (!authorized) {
        socketData.emit('roomLocked', {
          ticketId: data.ticketId,
          message: '房间已被锁定，您已被移出',
        });
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
          if ((s as any).userId === targetUserId) {
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
    const operatorId = (client as any).userId;
    const ticket = await this.ticketRepository.findOne({
      where: { id: data.ticketId },
    });
    if (!ticket) {
      client.emit('error', '工单不存在');
      return;
    }

    const operatorRole = (client as any).role;
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
    const userId = (client as any).userId;
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
    const userId = (client as any).userId;

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
    if (
      (client as any).role === 'external' &&
      (client as any).allowedTicketId !== data.ticketId
    ) {
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
      const message = await this.chatService.recallMessage(
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
    const userId = (client as any).userId;
    const userName =
      (client as any).realName ||
      (client as any).displayName ||
      (client as any).username;

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
    const userId = (client as any).userId;

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
    const fromId = (client as any).userId;
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
    const userId = (client as any).userId;
    const userName =
      (client as any).realName ||
      (client as any).displayName ||
      (client as any).username;

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
    const userId = (client as any).userId;

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
    const fromId = (client as any).userId;
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
```

**影响**: 生产环境通过 `CORS_ORIGIN` 环境变量（逗号分隔）控制允许的前端来源，与 `main.ts` 的 HTTP CORS 配置保持一致。开发环境仍默认 localhost。

---

### SEC-04: Search Controller 补充权限守卫

```diff:search.controller.ts
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('search')
@UseGuards(AuthGuard('jwt'))
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    if (!query) return { total: 0, items: [] };
    return this.searchService.search(
      query,
      type || 'all',
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );
  }

  @Post('sync')
  async syncAll() {
    return this.searchService.syncAll();
  }
}
===
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';

@Controller('search')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Permissions('tickets:read')
  async search(
    @Query('q') query: string,
    @Query('type') type?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    if (!query) return { total: 0, items: [] };
    return this.searchService.search(
      query,
      type || 'all',
      parseInt(page, 10),
      parseInt(pageSize, 10),
    );
  }

  @Post('sync')
  @Permissions('admin:access')
  async syncAll() {
    return this.searchService.syncAll();
  }
}
```

**影响**: 搜索接口需要 `tickets:read` 权限，`POST /search/sync` 需要 `admin:access` 权限，防止低权限用户触发全量索引重建。

---

### SEC-05: PermissionsGuard 移除 username 绕过

```diff:permissions.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果未设置 @Permissions 验证，默认允许（或你可以选择默认拦截，当前配合系统保持放行）
    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // 如果没有 user 或其不包含 role，拒绝访问 (例外：external 临时通行证有自己的鉴别)
    if (!user || !user.role) {
      return false;
    }

    // 针对外部用户的特殊处理
    if (user.role === 'external' || user.role.name === 'external') {
      // 外部用户仅允许查看工单（controller 内部会进一步校验 ticketId）或 BBS帖子
      return (
        requiredPermissions.includes('tickets:read') ||
        requiredPermissions.includes('bbs:read')
      );
    }

    // ⭐ 超级管理员通行权
    // 特权控制流：如果你的底层身份名就是 admin，那么你具备全部权限通过，无视 checkbox 是否不小心被勾去
    if (user.role.name === 'admin' || user.username === 'admin') {
      return true;
    }

    const permissions = user.role.permissions || [];
    // 检查用户所拥有的所有权限记录里，是否有包含 Controller 定义在此方法上的 ANY 或 ALL 需求
    // 这里我们使用: 用户具有需要的任一权限即放行
    const hasPermission = requiredPermissions.some((requiredCode) =>
      permissions.some((p: any) => {
        const pCode = p.code || `${p.resource}:${p.action}`;
        return pCode === requiredCode;
      }),
    );

    return hasPermission;
  }
}
===
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果未设置 @Permissions 验证，默认允许（或你可以选择默认拦截，当前配合系统保持放行）
    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // 如果没有 user 或其不包含 role，拒绝访问 (例外：external 临时通行证有自己的鉴别)
    if (!user || !user.role) {
      return false;
    }

    // 针对外部用户的特殊处理
    if (user.role === 'external' || user.role.name === 'external') {
      // 外部用户仅允许查看工单（controller 内部会进一步校验 ticketId）或 BBS帖子
      return (
        requiredPermissions.includes('tickets:read') ||
        requiredPermissions.includes('bbs:read')
      );
    }

    // ⭐ 超级管理员通行权
    // 仅基于角色判断，不依赖 username，避免被注册同名账户绕过
    if (user.role.name === 'admin') {
      return true;
    }

    const permissions = user.role.permissions || [];
    // 检查用户所拥有的所有权限记录里，是否有包含 Controller 定义在此方法上的 ANY 或 ALL 需求
    // 这里我们使用: 用户具有需要的任一权限即放行
    const hasPermission = requiredPermissions.some((requiredCode) =>
      permissions.some((p: any) => {
        const pCode = p.code || `${p.resource}:${p.action}`;
        return pCode === requiredCode;
      }),
    );

    return hasPermission;
  }
}
```

**影响**: 超管通行权仅基于 `role.name === 'admin'` 判断，消除了通过注册同名 username 绕过权限的理论风险。

---

### MISC-03: test-reload 调试接口保护

```diff:tickets.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { TicketsService } from './tickets.service';
import { TicketsExportService } from './tickets-export.service';
import { CreateTicketDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketStatus } from '../../entities/ticket.entity';
import type { AuthenticatedUser } from '../../common/types/auth.types';

/** 从 Express Request 中提取经过 JWT 认证的用户信息 */
const getUser = (req: { user?: unknown }): AuthenticatedUser =>
  req.user as AuthenticatedUser;

@Controller('tickets')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly ticketsExportService: TicketsExportService,
  ) {}

  @Post()
  @Permissions('tickets:create')
  async create(@Body() createDto: CreateTicketDto, @Req() req: any) {
    const ticket = await this.ticketsService.create(createDto, getUser(req).id);
    return { code: 0, message: '工单创建成功', data: ticket };
  }

  @Get()
  @Permissions('tickets:read')
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.findAll({
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 10,
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('test-reload')
  async testReload() {
    return { code: 0, message: 'PM2 Reload Successful!' };
  }

  @Get('aggregates')
  @Permissions('tickets:read')
  async getAggregates(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.getAggregates({
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('my/badges')
  @Permissions('tickets:read')
  async getMyBadges(@Req() req: any) {
    const data = await this.ticketsService.getMyBadges(getUser(req).id);
    return { code: 0, data };
  }

  @Post('batch/summary')
  @Permissions('tickets:read')
  async getBatchSummary(@Body('ids') ids: number[]) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { code: 0, data: [] };
    }
    const data = await this.ticketsService.getBatchSummary(ids);
    return { code: 0, data };
  }

  @Get('my/created')
  @Permissions('tickets:read')
  async myCreated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'creator',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/assigned')
  @Permissions('tickets:read')
  async myAssigned(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'assignee',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/participated')
  @Permissions('tickets:read')
  async myParticipated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'participant',
    );
    return { code: 0, data: tickets };
  }

  @Get(':id')
  @Permissions('tickets:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (getUser(req).role?.name === 'external' && req.user.ticketId !== id) {
      throw new ForbiddenException('外部用户无权访问此工单');
    }
    const ticket = await this.ticketsService.findOne(id);
    return { code: 0, data: ticket };
  }

  @Get('no/:ticketNo')
  @Permissions('tickets:read')
  async findByNo(@Param('ticketNo') ticketNo: string) {
    const ticket = await this.ticketsService.findByTicketNo(ticketNo);
    return { code: 0, data: ticket };
  }

  @Put(':id')
  @Permissions('tickets:read') // 基础权限检查；底层 service 会根据创建人或 tickets:edit 权限决定是否放行
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateTicketDto,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.update(
      id,
      updateDto,
      getUser(req),
    );
    return { code: 0, message: '工单更新成功', data: ticket };
  }

  @Post(':id/read')
  @Permissions('tickets:read')
  async readTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (typeof getUser(req).id === 'string') {
      return { code: 0, message: 'external user skipped' };
    }
    await this.ticketsService.readTicket(id, getUser(req).id);
    return { code: 0, message: 'success' };
  }

  @Post(':id/assign')
  @Permissions('tickets:assign')
  async assign(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.assign(id, getUser(req).id);
    return { code: 0, message: '接单成功', data: ticket };
  }

  @Post(':id/request-close')
  @Permissions('tickets:assign')
  async requestClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.requestClose(id, getUser(req).id);
    return { code: 0, message: '已申请关单，等待创建者确认', data: ticket };
  }

  @Post(':id/confirm-close')
  @Permissions('tickets:read')
  async confirmClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.confirmClose(id, getUser(req).id);
    return { code: 0, message: '工单已关闭', data: ticket };
  }

  @Delete('batch')
  @Permissions('tickets:delete')
  async deleteBatch(@Body('ids') ids: number[], @Req() req: any) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { code: -1, message: '请求参数错误，未提供有效的 IDs' };
    }
    await this.ticketsService.batchDelete(ids, getUser(req));
    return { code: 0, message: `成功删除了 ${ids.length} 条工单` };
  }

  @Delete(':id')
  @Permissions('tickets:delete')
  async deleteTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.ticketsService.deleteTicket(id, getUser(req));
    return { code: 0, message: '工单已删除' };
  }

  @Post(':id/share')
  @Permissions('tickets:share')
  async generateShareLink(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    const token = await this.ticketsService.generateShareToken(id);
    return { code: 0, message: '分享外链生成成功', data: { token } };
  }

  @Post(':id/invite')
  @Permissions('tickets:read')
  async inviteParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Body('userId') targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.inviteParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '邀请成功', data: ticket };
  }

  @Delete(':id/participants/:userId')
  @Permissions('tickets:read')
  async removeParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.removeParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '专家已移除', data: ticket };
  }

  @Post(':id/room-lock')
  @Permissions('tickets:read')
  async toggleRoomLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { locked: boolean; disableExternal?: boolean },
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.toggleRoomLock(
      id,
      getUser(req).id,
      body.locked,
      !!body.disableExternal,
    );
    return {
      code: 0,
      message: body.locked ? '房间已锁定' : '房间已解锁',
      data: ticket,
    };
  }

  @Get(':id/export-chat-zip')
  @Permissions('tickets:read')
  async exportChatZip(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出聊天记录');
    }
    await this.ticketsExportService.exportChatZip(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }

  @Get(':id/export-report')
  @Permissions('tickets:read')
  async exportReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出报告');
    }
    await this.ticketsExportService.exportReport(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }
}
===
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { TicketsService } from './tickets.service';
import { TicketsExportService } from './tickets-export.service';
import { CreateTicketDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketStatus } from '../../entities/ticket.entity';
import type { AuthenticatedUser } from '../../common/types/auth.types';

/** 从 Express Request 中提取经过 JWT 认证的用户信息 */
const getUser = (req: { user?: unknown }): AuthenticatedUser =>
  req.user as AuthenticatedUser;

@Controller('tickets')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly ticketsExportService: TicketsExportService,
  ) {}

  @Post()
  @Permissions('tickets:create')
  async create(@Body() createDto: CreateTicketDto, @Req() req: any) {
    const ticket = await this.ticketsService.create(createDto, getUser(req).id);
    return { code: 0, message: '工单创建成功', data: ticket };
  }

  @Get()
  @Permissions('tickets:read')
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.findAll({
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 10,
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('test-reload')
  @Permissions('admin:access')
  async testReload() {
    return { code: 0, message: 'PM2 Reload Successful!' };
  }

  @Get('aggregates')
  @Permissions('tickets:read')
  async getAggregates(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.getAggregates({
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('my/badges')
  @Permissions('tickets:read')
  async getMyBadges(@Req() req: any) {
    const data = await this.ticketsService.getMyBadges(getUser(req).id);
    return { code: 0, data };
  }

  @Post('batch/summary')
  @Permissions('tickets:read')
  async getBatchSummary(@Body('ids') ids: number[]) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { code: 0, data: [] };
    }
    const data = await this.ticketsService.getBatchSummary(ids);
    return { code: 0, data };
  }

  @Get('my/created')
  @Permissions('tickets:read')
  async myCreated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'creator',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/assigned')
  @Permissions('tickets:read')
  async myAssigned(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'assignee',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/participated')
  @Permissions('tickets:read')
  async myParticipated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'participant',
    );
    return { code: 0, data: tickets };
  }

  @Get(':id')
  @Permissions('tickets:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (getUser(req).role?.name === 'external' && req.user.ticketId !== id) {
      throw new ForbiddenException('外部用户无权访问此工单');
    }
    const ticket = await this.ticketsService.findOne(id);
    return { code: 0, data: ticket };
  }

  @Get('no/:ticketNo')
  @Permissions('tickets:read')
  async findByNo(@Param('ticketNo') ticketNo: string) {
    const ticket = await this.ticketsService.findByTicketNo(ticketNo);
    return { code: 0, data: ticket };
  }

  @Put(':id')
  @Permissions('tickets:read') // 基础权限检查；底层 service 会根据创建人或 tickets:edit 权限决定是否放行
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateTicketDto,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.update(
      id,
      updateDto,
      getUser(req),
    );
    return { code: 0, message: '工单更新成功', data: ticket };
  }

  @Post(':id/read')
  @Permissions('tickets:read')
  async readTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (typeof getUser(req).id === 'string') {
      return { code: 0, message: 'external user skipped' };
    }
    await this.ticketsService.readTicket(id, getUser(req).id);
    return { code: 0, message: 'success' };
  }

  @Post(':id/assign')
  @Permissions('tickets:assign')
  async assign(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.assign(id, getUser(req).id);
    return { code: 0, message: '接单成功', data: ticket };
  }

  @Post(':id/request-close')
  @Permissions('tickets:assign')
  async requestClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.requestClose(id, getUser(req).id);
    return { code: 0, message: '已申请关单，等待创建者确认', data: ticket };
  }

  @Post(':id/confirm-close')
  @Permissions('tickets:read')
  async confirmClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.confirmClose(id, getUser(req).id);
    return { code: 0, message: '工单已关闭', data: ticket };
  }

  @Delete('batch')
  @Permissions('tickets:delete')
  async deleteBatch(@Body('ids') ids: number[], @Req() req: any) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { code: -1, message: '请求参数错误，未提供有效的 IDs' };
    }
    await this.ticketsService.batchDelete(ids, getUser(req));
    return { code: 0, message: `成功删除了 ${ids.length} 条工单` };
  }

  @Delete(':id')
  @Permissions('tickets:delete')
  async deleteTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.ticketsService.deleteTicket(id, getUser(req));
    return { code: 0, message: '工单已删除' };
  }

  @Post(':id/share')
  @Permissions('tickets:share')
  async generateShareLink(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    const token = await this.ticketsService.generateShareToken(id);
    return { code: 0, message: '分享外链生成成功', data: { token } };
  }

  @Post(':id/invite')
  @Permissions('tickets:read')
  async inviteParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Body('userId') targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.inviteParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '邀请成功', data: ticket };
  }

  @Delete(':id/participants/:userId')
  @Permissions('tickets:read')
  async removeParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.removeParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '专家已移除', data: ticket };
  }

  @Post(':id/room-lock')
  @Permissions('tickets:read')
  async toggleRoomLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { locked: boolean; disableExternal?: boolean },
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.toggleRoomLock(
      id,
      getUser(req).id,
      body.locked,
      !!body.disableExternal,
    );
    return {
      code: 0,
      message: body.locked ? '房间已锁定' : '房间已解锁',
      data: ticket,
    };
  }

  @Get(':id/export-chat-zip')
  @Permissions('tickets:read')
  async exportChatZip(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出聊天记录');
    }
    await this.ticketsExportService.exportChatZip(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }

  @Get(':id/export-report')
  @Permissions('tickets:read')
  async exportReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出报告');
    }
    await this.ticketsExportService.exportReport(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }
}
```

**影响**: `GET /tickets/test-reload` 现在需要管理员权限。

---

## ⚡ 运行时稳定性 (ERR-03: 消除所有 Floating Promises)

| 文件 | 问题类型 | 修复方式 |
|------|---------|---------|
| `main.ts` | floating bootstrap() | `.catch()` + `process.exit(1)` |
| `auth.controller.ts` (×4) | floating audit log | `void` 显式标记 |
| `search.subscriber.ts` (×3) | floating sync/remove | `void` 显式标记 |
| `tickets.service.ts` (×6) | floating audit log | `void` 显式标记 |
| `chat.gateway.ts` (×3) | floating join/broadcast | `void` 显式标记 |
| `backup.service.ts` | `new Promise(async)` 反模式 | 重构为 Promise + 外部 await |
| `files.controller.ts` | `setImmediate(async)` | `void IIFE` 包裹 |
| `files.service.ts` (×2) | `new Promise(async)` 反模式 | await 前置 + 纯 Promise |
| `bbs.service.ts` (×2) | `forEach(async)` | `for...of` + `void` |

---

## ✅ 验证结果

- `npm run build` (NestJS) ✅ 通过
- `tsc --noEmit` ✅ 仅有 1 个预存的测试文件类型警告（非本次修改引起）
- ESLint `no-floating-promises` + `no-misused-promises` ✅ **0 处违规**
- 代码已同步至生产服务器
