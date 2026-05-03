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
import { ScreenShareService } from './screen-share.service';
import { VoiceService } from './voice.service';
import { RoomService } from './room.service';

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

/** JWT payload decoded from token */
interface JwtTokenPayload {
  sub: number;
  username: string;
  role: string;
  ticketId?: number;
  bbsId?: number;
}

/** WebRTC SDP description (offer/answer) */
interface RTCSessionDescriptionInit {
  type: 'offer' | 'answer';
  sdp: string;
}

/** WebRTC ICE candidate */
interface RTCIceCandidateInit {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
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

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly settingsService: SettingsService,
    private readonly screenShareService: ScreenShareService,
    private readonly voiceService: VoiceService,
    private readonly roomService: RoomService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
  ) {}

  public hasActiveScreenShare(ticketId: number): boolean {
    return this.screenShareService.hasActiveShare(ticketId);
  }

  public hasActiveVoice(ticketId: number): boolean {
    return this.voiceService.hasActiveVoice(ticketId);
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

      const payload = this.jwtService.verify<JwtTokenPayload>(token, {
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

      this.roomService.addOnlineUser(payload.sub, client.id);

      this.logger.log(`用户 ${payload.username} (${payload.sub}) 已连接`);
    } catch (err) {
      this.logger.error('Socket connection error:', err);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    if (!userId) return;

    this.roomService.removeOnlineUser(userId);
    this.logger.log(`用户 ${authClient.username} 已断开`);
    // 广播更新各房间在线列表
    this.broadcastRoomUsersForClient(client);

    // 清理该用户的活跃屏幕共享
    const cleanedShareRooms = this.screenShareService.cleanupUser(userId);
    for (const roomName of cleanedShareRooms) {
      this.server.to(roomName).emit('screenShare:stopped', {
        ticketId: parseInt(roomName.replace('ticket_', '')),
        from: userId,
      });
      this.server.emit('ticketEvent', { action: 'screenShareChanged' });
    }

    // 清理该用户的语音通话状态
    const affectedVoiceRooms = this.voiceService.cleanupUser(userId);
    for (const roomName of affectedVoiceRooms) {
      this.server.to(roomName).emit('voice:peerLeft', {
        ticketId: parseInt(roomName.replace('ticket_', '')),
        userId,
      });
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

  private getTicketRoomName(ticketId: number): string {
    return `ticket_${ticketId}`;
  }

  private async loadRoomTicket(ticketId: number): Promise<Ticket | null> {
    if (!Number.isInteger(Number(ticketId)) || Number(ticketId) <= 0) {
      return null;
    }

    return this.ticketRepository.findOne({
      where: { id: Number(ticketId) },
      relations: ['participants'],
    });
  }

  private async authorizeTicketRoom(
    client: Socket,
    ticketId: number,
    action: string,
  ): Promise<Ticket | null> {
    const authClient = client as AuthenticatedSocket;
    const ticket = await this.loadRoomTicket(ticketId);

    if (!ticket) {
      client.emit('error', '工单不存在');
      return null;
    }

    const authorized = this.roomService.canAccessTicketRoom(
      {
        userId: authClient.userId,
        role: authClient.role,
        allowedTicketId: authClient.allowedTicketId,
      },
      ticket,
    );

    if (!authorized) {
      if (ticket.isRoomLocked) {
        client.emit('roomLocked', {
          ticketId,
          message: '该房间已锁定，仅受邀人员可参与',
        });
      } else {
        client.emit('error', `无权${action}此工单聊天室`);
      }
      return null;
    }

    return ticket;
  }

  private async getAuthorizedSignalTargets(
    client: Socket,
    ticketId: number,
    targetUserId: number,
    action: string,
  ): Promise<AuthenticatedRemoteSocket[] | null> {
    const ticket = await this.authorizeTicketRoom(client, ticketId, action);
    if (!ticket) return null;

    const roomName = this.getTicketRoomName(ticket.id);
    const sockets = await this.server.in(roomName).fetchSockets();
    const targetSockets = sockets
      .map((s) => s as unknown as AuthenticatedRemoteSocket)
      .filter((s) => s.userId === Number(targetUserId));

    if (targetSockets.length === 0) {
      client.emit('error', '目标用户不在该工单房间内');
      return null;
    }

    return targetSockets;
  }

  private emitToSignalTargets(
    targets: AuthenticatedRemoteSocket[],
    event: string,
    data: Record<string, unknown>,
  ): void {
    targets.forEach((target) => target.emit(event, data));
  }

  private async forwardSignalToRoomUser(
    client: Socket,
    ticketId: number,
    targetUserId: number,
    action: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    const targets = await this.getAuthorizedSignalTargets(
      client,
      ticketId,
      targetUserId,
      action,
    );

    if (!targets) return false;

    this.emitToSignalTargets(targets, event, data);
    return true;
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
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '访问',
    );
    if (!ticket) return;

    const roomName = this.getTicketRoomName(data.ticketId);
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
    const activeSharer = this.screenShareService.getActiveSharer(roomName);
    if (activeSharer) {
      client.emit('screenShare:active', {
        ticketId: data.ticketId,
        from: activeSharer.userId,
        fromName: activeSharer.userName,
      });
    }

    // 如果房间内有活跃语音通话，通知新加入的用户
    const voiceParticipants = this.voiceService.getParticipants(roomName);
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
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '访问',
    );
    if (!ticket) return;

    const messages = await this.chatService.getMessagesByTicket(
      data.ticketId,
      data.page,
    );
    client.emit('moreHistoryLoaded', messages);
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

    // 立即踢出未授权用户
    const sockets = await this.server.in(roomName).fetchSockets();
    for (const s of sockets) {
      const rs = s as unknown as AuthenticatedRemoteSocket;
      const authorized = this.roomService.canAccessTicketRoom(
        {
          userId: rs.userId,
          role: rs.role,
          allowedTicketId: rs.allowedTicketId,
        },
        ticket,
      );
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

    await this.broadcastRoomUsers(roomName);

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

    this.server
      .in(roomName)
      .fetchSockets()
      .then((sockets) => {
        for (const s of sockets) {
          if (
            (s as unknown as AuthenticatedRemoteSocket).userId === targetUserId
          ) {
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

    // 如果该用户在此房间的语音通话中，自动移除
    const voiceParticipants = this.voiceService.getParticipants(roomName);
    if (voiceParticipants?.has(userId)) {
      this.voiceService.leaveVoice(roomName, userId);
      client.to(roomName).emit('voice:peerLeft', {
        ticketId: data.ticketId,
        userId,
      });
    }

    // 如果该用户是此房间的屏幕共享方，自动停止共享
    const sharer = this.screenShareService.getActiveSharer(roomName);
    if (sharer?.userId === userId) {
      this.screenShareService.stopShare(roomName);
      client.to(roomName).emit('screenShare:stopped', {
        ticketId: data.ticketId,
        from: userId,
      });
      this.server.emit('ticketEvent', { action: 'screenShareChanged' });
    }

    await client.leave(roomName);
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
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '发送消息至',
    );
    if (!ticket) {
      return;
    }

    if (ticket.isRoomLocked) {
      const roomName = this.getTicketRoomName(data.ticketId);
      const roomSockets = await this.server.in(roomName).fetchSockets();
      const isInRoom = roomSockets.some(
        (s) =>
          (s as unknown as AuthenticatedRemoteSocket).id === client.id,
      );
      if (!isInRoom) {
        client.emit('roomLocked', {
          ticketId: data.ticketId,
          message: '请先加入该工单聊天室再发送消息',
        });
        return;
      }
    }

    if (
      !data.content &&
      !data.fileUrl
    ) {
      client.emit('error', '消息内容不能为空');
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
      type:
        (data.type as import('../../entities/message.entity').MessageType) ||
        'text',
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileSize: data.fileSize,
    });

    const roomName = this.getTicketRoomName(data.ticketId);
    this.server.to(roomName).emit('newMessage', message);

    // 取消全局广播新消息通知（避免信息泄露和不相关的红点累加），仅定向投放到参与该工单的用户
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
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '访问',
    );
    if (!ticket) return;

    const authClient = client as AuthenticatedSocket;
    const roomName = this.getTicketRoomName(data.ticketId);
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
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '撤回消息',
    );
    if (!ticket) return;

    try {
      await this.chatService.recallMessage(data.messageId, userId, username);
      const roomName = this.getTicketRoomName(data.ticketId);
      this.server.to(roomName).emit('messageRecalled', {
        messageId: data.messageId,
        ticketId: data.ticketId,
      });
    } catch (err: unknown) {
      client.emit('recallError', {
        message: err instanceof Error ? err.message : '撤回失败',
      });
    }
  }

  // ==================== 屏幕共享信令 ====================

  @SubscribeMessage('screenShare:start')
  async handleScreenShareStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '发起屏幕共享',
    );
    if (!ticket) return;

    const roomName = this.getTicketRoomName(ticket.id);
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const userName =
      authClient.realName || authClient.displayName || authClient.username;

    this.screenShareService.startShare(roomName, userId, userName);

    client.to(roomName).emit('screenShare:started', {
      ticketId: data.ticketId,
      from: userId,
      fromName: userName,
    });
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
  }

  @SubscribeMessage('screenShare:stop')
  async handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '停止屏幕共享',
    );
    if (!ticket) return;

    const roomName = this.getTicketRoomName(ticket.id);
    const userId = (client as AuthenticatedSocket).userId;

    this.screenShareService.stopShare(roomName);

    client.to(roomName).emit('screenShare:stopped', {
      ticketId: data.ticketId,
      from: userId,
    });
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
  }

  @SubscribeMessage('screenShare:offer')
  async handleScreenShareOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[屏幕共享] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`,
    );
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送屏幕共享信令至',
      'screenShare:offer',
      {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: fromId,
      },
    );
  }

  @SubscribeMessage('screenShare:answer')
  async handleScreenShareAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送屏幕共享信令至',
      'screenShare:answer',
      {
        ticketId: data.ticketId,
        sdp: data.sdp,
        from: (client as AuthenticatedSocket).userId,
      },
    );
  }

  @SubscribeMessage('screenShare:ice')
  async handleScreenShareIce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; candidate: RTCIceCandidateInit; to: number },
  ) {
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送屏幕共享信令至',
      'screenShare:ice',
      {
        ticketId: data.ticketId,
        candidate: data.candidate,
        from: (client as AuthenticatedSocket).userId,
      },
    );
  }

  @SubscribeMessage('screenShare:requestView')
  async handleScreenShareRequestView(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[屏幕共享] 观看请求: 用户 ${fromId} -> 分享方 user_${data.to}`,
    );
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '请求观看屏幕共享',
      'screenShare:requestView',
      {
        ticketId: data.ticketId,
        from: fromId,
      },
    );
  }

  // ==================== 语音通话信令 ====================

  @SubscribeMessage('voice:join')
  async handleVoiceJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '加入语音通话',
    );
    if (!ticket) return;

    const roomName = this.getTicketRoomName(ticket.id);
    const authClient = client as AuthenticatedSocket;
    const userId = authClient.userId;
    const userName =
      authClient.realName || authClient.displayName || authClient.username;

    // 检查人数上限
    const maxStr = await this.settingsService.get('voice_maxParticipants');
    const maxParticipants = maxStr ? parseInt(maxStr, 10) : 6;

    const result = this.voiceService.joinVoice(
      roomName,
      userId,
      userName,
      maxParticipants,
    );

    if (result.status === 'full') {
      client.emit('voice:rejected', {
        ticketId: data.ticketId,
        reason: `语音通话人数已达上限 (${maxParticipants}人)`,
      });
      return;
    }

    // 将当前参与者列表发送给新加入的用户（用于建立 PeerConnection）
    client.emit('voice:currentParticipants', {
      ticketId: data.ticketId,
      participants: result.existingParticipants,
    });

    // 广播给房间内所有人（包括非语音参与者，用于显示状态）
    client.to(roomName).emit('voice:peerJoined', {
      ticketId: data.ticketId,
      userId,
      userName,
    });
  }

  @SubscribeMessage('voice:leave')
  async handleVoiceLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const ticket = await this.authorizeTicketRoom(
      client,
      data.ticketId,
      '离开语音通话',
    );
    if (!ticket) return;

    const roomName = this.getTicketRoomName(ticket.id);
    const userId = (client as AuthenticatedSocket).userId;

    this.voiceService.leaveVoice(roomName, userId);

    client.to(roomName).emit('voice:peerLeft', {
      ticketId: data.ticketId,
      userId,
    });
  }

  @SubscribeMessage('voice:offer')
  async handleVoiceOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[语音通话] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`,
    );
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送语音信令至',
      'voice:offer',
      {
        ticketId: data.ticketId,
        sdp: data.sdp,
        from: fromId,
      },
    );
  }

  @SubscribeMessage('voice:answer')
  async handleVoiceAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送语音信令至',
      'voice:answer',
      {
        ticketId: data.ticketId,
        sdp: data.sdp,
        from: (client as AuthenticatedSocket).userId,
      },
    );
  }

  @SubscribeMessage('voice:ice')
  async handleVoiceIce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; candidate: RTCIceCandidateInit; to: number },
  ) {
    await this.forwardSignalToRoomUser(
      client,
      data.ticketId,
      data.to,
      '发送语音信令至',
      'voice:ice',
      {
        ticketId: data.ticketId,
        candidate: data.candidate,
        from: (client as AuthenticatedSocket).userId,
      },
    );
  }
}
