import { Injectable, Logger } from '@nestjs/common';

/**
 * 语音通话状态管理 Service
 *
 * 管理所有活跃的语音通话会话状态，从 ChatGateway 中提取以遵循单一职责原则。
 * 使用 Map<number, string> 天然去重，避免 Set 对象引用比较问题。
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  /** 活跃语音通话跟踪: roomName -> Map<userId, userName> */
  private activeVoiceRooms = new Map<string, Map<number, string>>();

  /**
   * 用户加入语音通话
   * @returns 'ok' | 'duplicate' | 'full'
   */
  joinVoice(
    roomName: string,
    userId: number,
    userName: string,
    maxParticipants: number,
  ): {
    status: 'ok' | 'duplicate' | 'full';
    existingParticipants: { userId: number; userName: string }[];
  } {
    let participants = this.activeVoiceRooms.get(roomName);
    if (!participants) {
      participants = new Map();
      this.activeVoiceRooms.set(roomName, participants);
    }

    // 去重：如果同一用户重复加入，先移除旧记录
    if (participants.has(userId)) {
      this.logger.warn(`[语音通话] 用户 ${userId} 重复加入，先移除旧记录`);
      participants.delete(userId);
    }

    // 返回现有参与者列表（在加入之前，用于建立 PeerConnection）
    const existingParticipants = [...participants.entries()].map(
      ([id, name]) => ({ userId: id, userName: name }),
    );

    if (participants.size >= maxParticipants) {
      return { status: 'full', existingParticipants };
    }

    // 加入通话列表
    participants.set(userId, userName);
    this.logger.log(
      `[语音通话] 用户 ${userName} (${userId}) 加入 ${roomName} 的语音通话`,
    );

    return { status: 'ok', existingParticipants };
  }

  /** 用户离开语音通话 */
  leaveVoice(roomName: string, userId: number): void {
    const participants = this.activeVoiceRooms.get(roomName);
    if (participants) {
      participants.delete(userId);
      this.logger.log(`[语音通话] 用户 ${userId} 离开 ${roomName} 的语音通话`);
      if (participants.size === 0) {
        this.activeVoiceRooms.delete(roomName);
      }
    }
  }

  /** 获取房间的语音通话参与者 */
  getParticipants(roomName: string): Map<number, string> | undefined {
    return this.activeVoiceRooms.get(roomName);
  }

  /** 查询指定工单是否有活跃语音通话 */
  hasActiveVoice(ticketId: number): boolean {
    const participants = this.activeVoiceRooms.get(`ticket_${ticketId}`);
    return !!participants && participants.size > 0;
  }

  /**
   * 用户断线时清理该用户的所有语音通话状态
   * @returns 被影响的房间列表（需要由 Gateway 发送通知）
   */
  cleanupUser(userId: number): string[] {
    const affectedRooms: string[] = [];
    for (const [roomName, participants] of this.activeVoiceRooms.entries()) {
      if (participants.has(userId)) {
        participants.delete(userId);
        affectedRooms.push(roomName);
        this.logger.log(
          `[语音通话] 用户 ${userId} 断开连接，从房间 ${roomName} 的语音通话中移除`,
        );
        if (participants.size === 0) {
          this.activeVoiceRooms.delete(roomName);
        }
      }
    }
    return affectedRooms;
  }
}
