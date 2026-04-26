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
      const authorized = this.roomService.isAuthorizedForRoom(
        { userId: authClient.userId, role: authClient.role },
        ticket,
      );
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

    // 立即踢出未授权的内部用户
    const sockets = await this.server.in(roomName).fetchSockets();
    for (const s of sockets) {
      const rs = s as unknown as AuthenticatedRemoteSocket;
      if (rs.role === 'external') {
        continue;
      }
      const authorized = this.roomService.isAuthorizedForRoom(
        { userId: rs.userId, role: rs.role },
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
      type:
        (data.type as import('../../entities/message.entity').MessageType) ||
        'text',
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
      await this.chatService.recallMessage(data.messageId, userId, username);
      const roomName = `ticket_${data.ticketId}`;
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
  handleScreenShareStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
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
  handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as AuthenticatedSocket).userId;

    this.screenShareService.stopShare(roomName);

    client.to(roomName).emit('screenShare:stopped', {
      ticketId: data.ticketId,
      from: userId,
    });
    this.server.emit('ticketEvent', { action: 'screenShareChanged' });
  }

  @SubscribeMessage('screenShare:offer')
  handleScreenShareOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    const fromId = (client as AuthenticatedSocket).userId;
    this.logger.debug(
      `[屏幕共享] 转发 Offer: 从 ${fromId} -> 到 user_${data.to}`,
    );
    this.server.to(`user_${data.to}`).emit('screenShare:offer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: fromId,
    });
  }

  @SubscribeMessage('screenShare:answer')
  handleScreenShareAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
  ) {
    this.server.to(`user_${data.to}`).emit('screenShare:answer', {
      ticketId: data.ticketId,
      sdp: data.sdp,
      from: (client as AuthenticatedSocket).userId,
    });
  }

  @SubscribeMessage('screenShare:ice')
  handleScreenShareIce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; candidate: RTCIceCandidateInit; to: number },
  ) {
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
  handleVoiceLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { ticketId: number },
  ) {
    const roomName = `ticket_${data.ticketId}`;
    const userId = (client as AuthenticatedSocket).userId;

    this.voiceService.leaveVoice(roomName, userId);

    client.to(roomName).emit('voice:peerLeft', {
      ticketId: data.ticketId,
      userId,
    });
  }

  @SubscribeMessage('voice:offer')
  handleVoiceOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
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
    @MessageBody()
    data: { ticketId: number; sdp: RTCSessionDescriptionInit; to: number },
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
    @MessageBody()
    data: { ticketId: number; candidate: RTCIceCandidateInit; to: number },
  ) {
    this.server.to(`user_${data.to}`).emit('voice:ice', {
      ticketId: data.ticketId,
      candidate: data.candidate,
      from: (client as AuthenticatedSocket).userId,
    });
  }
}
