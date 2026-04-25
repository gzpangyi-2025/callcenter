import React, { useState, useEffect } from 'react';
import { Button, Avatar, Tooltip } from 'antd';
import {
  AudioOutlined, AudioMutedOutlined, PhoneOutlined,
} from '@ant-design/icons';
import type { VoiceParticipant } from '../hooks/useVoiceChat';

interface VoiceBarProps {
  isInVoice: boolean;
  isMuted: boolean;
  voiceParticipants: VoiceParticipant[];
  onToggleMute: () => void;
  onLeaveVoice: () => void;
}

const VoiceBar: React.FC<VoiceBarProps> = ({
  isInVoice,
  isMuted,
  voiceParticipants,
  onToggleMute,
  onLeaveVoice,
}) => {
  const [elapsed, setElapsed] = useState(0);

  // 通话计时
  useEffect(() => {
    if (!isInVoice) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [isInVoice]);

  if (!isInVoice) return null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '6px 14px',
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.08))',
      borderBottom: '1px solid var(--border)',
      fontSize: 13,
      minHeight: 40,
    }}>
      {/* 通话状态 & 时长 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#10b981',
          display: 'inline-block',
          animation: 'pulse-glow 2s ease-in-out infinite',
        }} />
        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
          语音通话中
        </span>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>
          {formatTime(elapsed)}
        </span>
      </div>

      {/* 参与者头像 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
        <Avatar.Group size={22} max={{ count: 5, style: { background: '#10b981', fontSize: 10 } }}>
          {voiceParticipants.map(p => (
            <Tooltip key={p.userId} title={p.userName}>
              <Avatar
                size={22}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  fontSize: 11,
                }}
              >
                {p.userName?.[0] || '?'}
              </Avatar>
            </Tooltip>
          ))}
        </Avatar.Group>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4 }}>
          {voiceParticipants.length} 人
        </span>
      </div>

      {/* 控制按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Tooltip title={isMuted ? '开麦' : '闭麦'}>
          <Button
            type="text"
            size="small"
            icon={isMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
            onClick={onToggleMute}
            style={{
              color: isMuted ? '#ef4444' : '#10b981',
              fontSize: 15,
            }}
          />
        </Tooltip>
        <Tooltip title="挂断">
          <Button
            type="text"
            size="small"
            danger
            icon={<PhoneOutlined style={{ transform: 'rotate(135deg)' }} />}
            onClick={onLeaveVoice}
            style={{ fontSize: 15 }}
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default VoiceBar;
