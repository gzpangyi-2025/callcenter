import { Injectable, Logger } from '@nestjs/common';
import { Ticket } from '../../entities/ticket.entity';

/** 用于房间权限判断的用户信息 */
export interface RoomUserInfo {
  userId: number;
  role: string;
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
}
