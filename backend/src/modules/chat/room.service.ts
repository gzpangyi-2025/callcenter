import { Injectable, Logger } from '@nestjs/common';
import { Ticket, TicketStatus } from '../../entities/ticket.entity';

/** 用于房间权限判断的用户信息 */
export interface RoomUserInfo {
  userId: number;
  role: string;
  allowedTicketId?: number;
}

/**
 * 房间管理和在线用户 Service
 *
 * 管理在线用户映射和房间权限判断逻辑，从 ChatGateway 中提取以遵循单一职责原则。
 */
@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);

  /** 在线用户映射: userId -> socketId */
  private onlineUsers = new Map<string | number, string>();

  /** 记录用户上线 */
  addOnlineUser(userId: string | number, socketId: string): void {
    this.onlineUsers.set(userId, socketId);
  }

  /** 记录用户下线 */
  removeOnlineUser(userId: string | number): void {
    this.onlineUsers.delete(userId);
  }

  /** 获取用户的 socketId */
  getSocketId(userId: string | number): string | undefined {
    return this.onlineUsers.get(userId);
  }

  /**
   * 判断用户是否有权进入已锁定的房间
   */
  isAuthorizedForRoom(userInfo: RoomUserInfo, ticket: Ticket): boolean {
    const { role, userId } = userInfo;

    // admin 免锁定
    if (role === 'admin') return true;

    // 外部用户：看 isExternalLinkDisabled
    if (role === 'external') {
      return (
        userInfo.allowedTicketId === ticket.id && !ticket.isExternalLinkDisabled
      );
    }

    if (this.isTicketMember(userId, ticket)) return true;

    return false;
  }

  /**
   * 判断用户是否可以访问工单聊天室。
   *
   * 未锁定房间保留原有广场/服务中工单协作能力；但定向待接单工单只允许创建人、
   * 接单人、参与者或管理员进入，避免通过 ticketId 绕过列表可见性。
   */
  canAccessTicketRoom(userInfo: RoomUserInfo, ticket: Ticket): boolean {
    const { role, userId } = userInfo;

    if (role === 'external') {
      return (
        userInfo.allowedTicketId === ticket.id && !ticket.isExternalLinkDisabled
      );
    }

    if (role === 'admin') return true;
    if (this.isTicketMember(userId, ticket)) return true;
    if (ticket.isRoomLocked) return false;

    const isDirectedPending =
      ticket.status === TicketStatus.PENDING && !!ticket.assigneeId;
    return !isDirectedPending;
  }

  private isTicketMember(userId: number, ticket: Ticket): boolean {
    const normalizedUserId = Number(userId);

    if (
      ticket.creatorId === normalizedUserId ||
      ticket.assigneeId === normalizedUserId
    ) {
      return true;
    }

    return (
      Array.isArray(ticket.participants) &&
      ticket.participants.some((p) => p.id === normalizedUserId)
    );
  }
}
