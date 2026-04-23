import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button, Tooltip, Tag } from 'antd';
import {
  FullscreenOutlined, FullscreenExitOutlined,
  CloseOutlined, CompressOutlined, ExpandOutlined,
  DesktopOutlined, LoadingOutlined, DisconnectOutlined,
  CustomerServiceOutlined, ReloadOutlined,
} from '@ant-design/icons';

interface ScreenSharePanelProps {
  /** 远程视频流 (观看方) */
  remoteStream: MediaStream | null;
  /** 本地屏幕流 (分享方预览) */
  localStream: MediaStream | null;
  /** 是否正在分享 */
  isSharing: boolean;
  /** 是否正在观看 */
  isViewing: boolean;
  /** 分享者名称 */
  sharerName: string;
  /** 连接状态 */
  connectionState: 'idle' | 'connecting' | 'connected' | 'failed';
  /** 重试连接回调 */
  onRetry?: () => void;
  /** 停止分享回调 */
  onStopSharing: () => void;
  /** 停止观看回调 */
  onStopViewing: () => void;
  /** 是否移动端 */
  isMobile: boolean;
  /** 是否处于支援模式 */
  supportMode: boolean;
  /** 切换支援模式 */
  onToggleSupportMode: () => void;
  /** 自定义样式（支援模式拖拽调整宽度） */
  style?: React.CSSProperties;
}

const ScreenSharePanel: React.FC<ScreenSharePanelProps> = ({
  remoteStream,
  localStream,
  isSharing,
  isViewing,
  sharerName,
  connectionState,
  onRetry,
  onStopSharing,
  onStopViewing,
  isMobile: _isMobile,
  supportMode,
  onToggleSupportMode,
  style,
}) => {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [hasVideoFrames, setHasVideoFrames] = useState(false);

  // 播放辅助函数（带防护）
  const safePlay = useCallback((el: HTMLVideoElement) => {
    // 延迟确保 srcObject 完全生效
    setTimeout(() => {
      if (el.srcObject) {
        el.play().catch(err => {
          if (err.name !== 'AbortError') {
            console.warn('[屏幕共享] 播放失败:', err);
          }
        });
      }
    }, 100);
  }, []);

  // callback ref: video 元素首次挂载时绑定流
  const bindRemoteVideo = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (el && remoteStream) {
      console.log('[屏幕共享] callback ref: 绑定远程流');
      el.srcObject = remoteStream;
      safePlay(el);
    }
  }, [remoteStream, safePlay]);

  // useEffect: remoteStream 变化后更新已存在的 video 元素
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el || !remoteStream) return;
    if (el.srcObject !== remoteStream) {
      console.log('[屏幕共享] useEffect: 更新远程流');
      el.srcObject = remoteStream;
      safePlay(el);
    }
  }, [remoteStream, safePlay]);

  // 检测视频是否真正有画面帧（解决"已连接但黑屏"问题）
  useEffect(() => {
    if (!remoteStream) { setHasVideoFrames(false); return; }
    const el = remoteVideoRef.current;
    if (!el) return;

    setHasVideoFrames(false); // 新流先重置
    let timerId: ReturnType<typeof setTimeout>;
    let checkCount = 0;

    const checkFrames = () => {
      checkCount++;
      // videoWidth > 0 表示解码器已收到并解析出真实画面
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        console.log('[屏幕共享] 视频帧已到达, 尺寸:', el.videoWidth, 'x', el.videoHeight);
        setHasVideoFrames(true);
        return; // 停止轮询
      }
      // 最多检查 30 秒（每 200ms 一次 = 150 次）
      if (checkCount < 150) {
        timerId = setTimeout(checkFrames, 200);
      }
    };
    timerId = setTimeout(checkFrames, 200);

    return () => { clearTimeout(timerId); };
  }, [remoteStream]);

  // 取消了激进的自动重试，因为在弱网下 WebRTC 获取首帧可能需要超过 10 秒。
  // 频繁自动重连会导致永远看不到画面。

  // 绑定本地预览流到 video 元素
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    if (!panelRef.current) return;

    if (!document.fullscreenElement) {
      panelRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error('[屏幕共享] 全屏请求失败:', err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  // 监听 ESC 退出全屏
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 没有活跃的共享时不渲染
  if (!isSharing && !isViewing) return null;

  // 区分"已连接但等待画面"和"已连接且有画面"两种状态
  const isWaitingFrames = connectionState === 'connected' && isViewing && !hasVideoFrames;

  const statusIcon = connectionState === 'connecting'
    ? <LoadingOutlined spin style={{ color: '#f59e0b' }} />
    : isWaitingFrames
    ? <LoadingOutlined spin style={{ color: '#60a5fa' }} />
    : connectionState === 'connected'
    ? <DesktopOutlined style={{ color: '#10b981' }} />
    : connectionState === 'failed'
    ? <DisconnectOutlined style={{ color: '#ef4444' }} />
    : null;

  const statusText = connectionState === 'connecting'
    ? '正在建立连接...'
    : isWaitingFrames
    ? '等待画面传输...'
    : connectionState === 'connected'
    ? '已连接'
    : connectionState === 'failed'
    ? '连接失败'
    : '';

  return (
    <div
      ref={panelRef}
      className={`screen-share-panel ${isFullscreen ? 'fullscreen' : ''} ${isExpanded ? 'expanded' : 'collapsed'} ${supportMode ? 'support-mode-video' : ''}`}
      style={style}
    >
      {/* 工具栏 */}
      <div className="screen-share-toolbar">
        <div className="screen-share-toolbar-left">
          {statusIcon}
          <span className="screen-share-status-text">
            {isSharing ? (
              <>🖥️ 您正在分享屏幕</>
            ) : (
              <>🖥️ {sharerName} 正在共享屏幕 <Tag color={isWaitingFrames ? 'blue' : connectionState === 'connected' ? 'green' : connectionState === 'failed' ? 'red' : 'orange'} style={{ marginLeft: 4, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>{statusText}</Tag></>
            )}
          </span>
        </div>
        <div className="screen-share-toolbar-right">
          {/* 手动重试按钮 */}
          {isViewing && (connectionState === 'failed' || isWaitingFrames) && onRetry && (
            <Tooltip title="重新连接">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={onRetry}
                className="screen-share-toolbar-btn"
                style={{ color: '#60a5fa' }}
              />
            </Tooltip>
          )}
          {/* 支援模式按钮 */}
          {isViewing && (
            <Tooltip title={supportMode ? '退出支援模式' : '支援模式 (大画面 + 聊天)'}>
              <Button
                type="text"
                size="small"
                icon={<CustomerServiceOutlined />}
                onClick={onToggleSupportMode}
                className="screen-share-toolbar-btn"
                style={supportMode ? { color: '#10b981' } : undefined}
              />
            </Tooltip>
          )}
          {isViewing && !supportMode && (
            <Tooltip title={isExpanded ? '缩小画面' : '放大画面'}>
              <Button
                type="text"
                size="small"
                icon={isExpanded ? <CompressOutlined /> : <ExpandOutlined />}
                onClick={() => setIsExpanded(!isExpanded)}
                className="screen-share-toolbar-btn"
              />
            </Tooltip>
          )}
          {!supportMode && (isViewing || isFullscreen) && (
            <Tooltip title={isFullscreen ? '退出全屏 (Esc)' : '全屏观看'}>
              <Button
                type="text"
                size="small"
                icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={toggleFullscreen}
                className="screen-share-toolbar-btn"
              />
            </Tooltip>
          )}
          <Tooltip title={isSharing ? '停止分享' : '停止观看'}>
            <Button
              type="text"
              size="small"
              danger
              icon={<CloseOutlined />}
              onClick={isSharing ? onStopSharing : onStopViewing}
              className="screen-share-toolbar-btn"
            />
          </Tooltip>
        </div>
      </div>

      {/* 视频画面区域 */}
      <div className="screen-share-video-container">
        {isViewing && (
          <video
            ref={bindRemoteVideo}
            autoPlay
            playsInline
            muted
            className="screen-share-video"
            onDoubleClick={supportMode ? undefined : toggleFullscreen}
            style={{ display: remoteStream ? 'block' : 'none' }}
          />
        )}

        {isViewing && connectionState === 'connecting' && (
          <div className="screen-share-connecting">
            <LoadingOutlined spin style={{ fontSize: 36, color: '#818cf8' }} />
            <div style={{ marginTop: 12, color: 'var(--text-secondary)' }}>正在建立远程连接...</div>
          </div>
        )}

        {isViewing && isWaitingFrames && (
          <div className="screen-share-connecting">
            <LoadingOutlined spin style={{ fontSize: 36, color: '#60a5fa' }} />
            <div style={{ marginTop: 12, color: 'var(--text-secondary)' }}>通道已建立，等待画面传输...</div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>网络可能较慢，请耐心等待首帧到达</div>
            {onRetry && (
              <Button
                type="link"
                icon={<ReloadOutlined />}
                onClick={onRetry}
                style={{ marginTop: 8 }}
              >手动重试连接</Button>
            )}
          </div>
        )}

        {isViewing && connectionState === 'failed' && (
          <div className="screen-share-connecting">
            <DisconnectOutlined style={{ fontSize: 36, color: '#ef4444' }} />
            <div style={{ marginTop: 12, color: '#ef4444' }}>连接失败</div>
            {onRetry && (
              <Button
                type="link"
                icon={<ReloadOutlined />}
                onClick={onRetry}
                style={{ marginTop: 8 }}
              >点击重试</Button>
            )}
          </div>
        )}

        {/* 分享方的本地预览小窗 */}
        {isSharing && localStream && (
          <div className="screen-share-local-preview">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="screen-share-video-mini"
            />
            <div className="screen-share-preview-label">本地预览</div>
          </div>
        )}
      </div>

      {/* 全屏模式下的悬浮聊天提示 */}
      {isFullscreen && (
        <div className="screen-share-fullscreen-hint">
          按 Esc 退出全屏 · 聊天区域在底部保留
        </div>
      )}
    </div>
  );
};

export default ScreenSharePanel;
