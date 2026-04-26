import { Injectable, Logger } from '@nestjs/common';

/**
 * 屏幕共享状态管理 Service
 *
 * 管理所有活跃的屏幕共享会话状态，从 ChatGateway 中提取以遵循单一职责原则。
 * 状态仍保存在进程内存中（适用于单实例部署）。
 */
@Injectable()
export class ScreenShareService {
  private readonly logger = new Logger(ScreenShareService.name);

  /** 活跃屏幕共享跟踪: roomName -> { userId, userName } */
  private activeSharers = new Map<
    string,
    { userId: number; userName: string }
  >();

  /** 开始屏幕共享 */
  startShare(roomName: string, userId: number, userName: string): void {
    this.activeSharers.set(roomName, { userId, userName });
    this.logger.log(
      `[屏幕共享] 用户 ${userName} (${userId}) 在 ${roomName} 发起屏幕共享`,
    );
  }

  /** 停止屏幕共享 */
  stopShare(roomName: string): void {
    this.activeSharers.delete(roomName);
  }

  /** 获取房间的活跃屏幕共享者 */
  getActiveSharer(
    roomName: string,
  ): { userId: number; userName: string } | undefined {
    return this.activeSharers.get(roomName);
  }

  /** 查询指定工单是否有活跃屏幕共享 */
  hasActiveShare(ticketId: number): boolean {
    return this.activeSharers.has(`ticket_${ticketId}`);
  }

  /**
   * 用户断线时清理该用户的所有活跃共享
   * @returns 被清理的房间名列表（需要由 Gateway 发送通知）
   */
  cleanupUser(userId: number): string[] {
    const cleanedRooms: string[] = [];
    for (const [roomName, sharer] of this.activeSharers.entries()) {
      if (sharer.userId === userId) {
        this.activeSharers.delete(roomName);
        cleanedRooms.push(roomName);
        this.logger.log(
          `[屏幕共享] 分享方 ${userId} 断开连接，清理房间 ${roomName} 的共享状态`,
        );
      }
    }
    return cleanedRooms;
  }
}
