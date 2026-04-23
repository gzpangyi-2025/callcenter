import React from 'react';
import { Button, Avatar, Tooltip, Popover } from 'antd';
import {
  ArrowLeftOutlined, TeamOutlined, LockOutlined, UnlockOutlined,
  DesktopOutlined, DownloadOutlined, InfoCircleOutlined,
  AudioOutlined,
} from '@ant-design/icons';
import type { Ticket } from '../../types/ticket';

interface ChatHeaderProps {
  ticket: Ticket;
  isMobile: boolean;
  externalTicketId?: string;
  user: any;
  socket: any;
  id: string | undefined;
  roomUsers: any[];
  canInvite: boolean;
  isRoomLocked: boolean;
  isExternalDisabled: boolean;
  exportingChat: boolean;
  screenShare: {
    isSharing: boolean;
    isViewing: boolean;
    hasActiveShare: boolean;
    sharerName: string;
    stopSharing: () => void;
    joinViewing: () => void;
    startSharing: () => void;
  };
  voiceChat: {
    isInVoice: boolean;
    isMuted: boolean;
    hasActiveVoice: boolean;
    voiceParticipants: Array<{ userId: number; userName: string }>;
    joinVoice: () => void;
    leaveVoice: () => void;
  };
  onNavigateBack: () => void;
  onOpenInfoDrawer: () => void;
  onExportChat: () => void;
  onToggleLock: () => void;
  onStopSharingAndExitSupport: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  ticket,
  isMobile,
  externalTicketId,
  user,
  socket,
  id,
  roomUsers,
  canInvite,
  isRoomLocked,
  isExternalDisabled,
  exportingChat,
  screenShare,
  voiceChat,
  onNavigateBack,
  onOpenInfoDrawer,
  onExportChat,
  onToggleLock,
  onStopSharingAndExitSupport,
}) => {
  return (
    <div className="chat-header">
      {!externalTicketId && isMobile && (
        <Button type="text" icon={<ArrowLeftOutlined />}
          onClick={onNavigateBack}
          style={{ color: 'var(--text-primary)', marginRight: 8 }} />
      )}
      <span style={{ flex: 1, fontWeight: 500 }}>
        💬 {isMobile ? ticket.title : '实时沟通'}
      </span>

      {/* 在线用户头像组 */}
      {roomUsers.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 8 }}>
          <TeamOutlined style={{ color: 'var(--text-muted)', fontSize: 14, marginRight: 4 }} />
          <Avatar.Group size={isMobile ? 22 : 26} max={{ count: isMobile ? 3 : 6, style: { background: 'linear-gradient(135deg, #4f46e5, #818cf8)', fontSize: 11 } }}>
            {roomUsers.map((u: any) => (
              <Popover 
                key={u.id} 
                title={`${u.name}${u.role === 'external' ? ' (外部)' : ''}`}
                content={
                  (!externalTicketId && canInvite && user?.id !== u.id) ? (
                    <Button size="small" danger type="text" onClick={() => {
                      socket?.emit('kickUser', { ticketId: Number(id), targetUserId: u.id });
                    }}>
                      踢出房间
                    </Button>
                  ) : null
                }
                trigger="hover"
              >
                <Avatar style={{ 
                  background: u.role === 'external' ? '#f59e0b' : 'linear-gradient(135deg, #4f46e5, #818cf8)', 
                  fontSize: 12,
                  cursor: (!externalTicketId && canInvite && user?.id !== u.id) ? 'pointer' : 'default'
                }}>
                  {u.name?.[0]?.toUpperCase() || '?'}
                </Avatar>
              </Popover>
            ))}
          </Avatar.Group>
        </div>
      )}

      {/* 锁定状态标识 */}
      {isRoomLocked && (
        <Tooltip title={`房间已锁定${isExternalDisabled ? '（外链已暂停）' : ''}`}>
          <LockOutlined style={{ color: '#ef4444', fontSize: 14, marginRight: 4 }} />
        </Tooltip>
      )}

      {/* 屏幕共享按钮 */}
      {['pending', 'in_progress', 'closing'].includes(ticket.status) && (
        <Tooltip title={
          screenShare.isSharing ? '点击停止分享屏幕'
          : screenShare.isViewing ? `正在观看 ${screenShare.sharerName} 的屏幕`
          : screenShare.hasActiveShare ? `${screenShare.sharerName} 正在共享屏幕 — 点击观看`
          : '分享屏幕'
        }>
          <Button
            type="text"
            size="small"
            icon={<DesktopOutlined />}
            style={{
              color: screenShare.isSharing || screenShare.isViewing
                ? '#10b981'
                : screenShare.hasActiveShare
                ? '#10b981'
                : 'var(--text-secondary)',
              fontSize: 14,
              animation: screenShare.hasActiveShare && !screenShare.isViewing && !screenShare.isSharing
                ? 'pulse-glow 2s ease-in-out infinite'
                : undefined,
            }}
            onClick={() => {
              if (screenShare.isSharing) {
                onStopSharingAndExitSupport();
              } else if (screenShare.hasActiveShare && !screenShare.isViewing) {
                screenShare.joinViewing();
              } else if (!screenShare.isViewing && !screenShare.hasActiveShare) {
                screenShare.startSharing();
              }
            }}
          />
        </Tooltip>
      )}

      {/* 语音通话按钮 */}
      {['pending', 'in_progress', 'closing'].includes(ticket.status) && (
        <Tooltip title={
          voiceChat.isInVoice ? '点击退出语音通话'
          : voiceChat.hasActiveVoice ? `${voiceChat.voiceParticipants.map(p => p.userName).join('、')} 正在语音通话 — 点击加入`
          : '加入语音通话'
        }>
          <Button
            type="text"
            size="small"
            icon={<AudioOutlined />}
            style={{
              color: voiceChat.isInVoice
                ? '#10b981'
                : voiceChat.hasActiveVoice
                ? '#10b981'
                : 'var(--text-secondary)',
              fontSize: 14,
              animation: voiceChat.hasActiveVoice && !voiceChat.isInVoice
                ? 'pulse-glow 2s ease-in-out infinite'
                : undefined,
            }}
            onClick={() => {
              if (voiceChat.isInVoice) {
                voiceChat.leaveVoice();
              } else {
                voiceChat.joinVoice();
              }
            }}
          />
        </Tooltip>
      )}

      {/* 导出按钮 — 仅内部受邀用户 */}
      {!externalTicketId && ticket && user?.role?.name !== 'external' && (
        <Tooltip title="导出聊天记录">
          <Button type="text" size="small" loading={exportingChat}
            icon={<DownloadOutlined />}
            style={{ color: 'var(--text-secondary)', fontSize: 14 }}
            onClick={onExportChat}
          />
        </Tooltip>
      )}

      {/* 锁定/解锁按钮 — 仅 creator / assignee */}
      {!externalTicketId && ticket && (Number(user?.id) === Number(ticket.creatorId) || Number(user?.id) === Number(ticket.assigneeId)) && (
        <Tooltip title={isRoomLocked ? '解锁房间' : '锁定房间'}>
          <Button type="text" size="small"
            icon={isRoomLocked ? <LockOutlined style={{ color: '#ef4444' }} /> : <UnlockOutlined />}
            style={{ color: isRoomLocked ? '#ef4444' : 'var(--text-secondary)', fontSize: 14 }}
            onClick={onToggleLock}
          />
        </Tooltip>
      )}

      {isMobile && (
        <Button type="text" icon={<InfoCircleOutlined />}
          onClick={onOpenInfoDrawer}
          style={{ color: 'var(--text-secondary)' }} />
      )}
    </div>
  );
};

export default ChatHeader;
