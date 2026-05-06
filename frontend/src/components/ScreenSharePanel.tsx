import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button, Tooltip, Tag, message } from 'antd';
import {
  FullscreenOutlined, FullscreenExitOutlined,
  CloseOutlined, CompressOutlined, ExpandOutlined,
  DesktopOutlined, LoadingOutlined, DisconnectOutlined,
  CustomerServiceOutlined, ReloadOutlined, ScissorOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useScreenshotStore } from '../stores/screenshotStore';

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
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
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
  isMobile,
  supportMode,
  onToggleSupportMode,
  style,
}) => {
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [videoFrameStreamId, setVideoFrameStreamId] = useState<string | null>(null);
  const { addScreenshot } = useScreenshotStore();
  const hasVideoFrames = !!remoteStream && videoFrameStreamId === remoteStream.id;

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
    if (!remoteStream) return;
    const el = remoteVideoRef.current;
    if (!el) return;

    const streamId = remoteStream.id;
    let timerId: ReturnType<typeof setTimeout>;
    let checkCount = 0;

    const checkFrames = () => {
      checkCount++;
      // videoWidth > 0 表示解码器已收到并解析出真实画面
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        console.log('[屏幕共享] 视频帧已到达, 尺寸:', el.videoWidth, 'x', el.videoHeight);
        setVideoFrameStreamId(streamId);
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

  // 弱网下 WebRTC ICE 穿透和获取首帧可能较慢（有时甚至长达1分钟）
  // 为了避免打断正在建立的弱网连接，将自动重连放宽到 45 秒，同时在 15 秒时给出提示
  const isWaitingFrames = connectionState === 'connected' && isViewing && !hasVideoFrames;

  useEffect(() => {
    if (isWaitingFrames && onRetry) {
      // 15秒提示
      const timer1 = setTimeout(() => {
        console.log('[屏幕共享] 15秒未收到首帧画面，可能网络拥堵...');
        message.warning('画面传输较慢，正在努力缓冲中...如果长时间无画面可点击手动重试', 5);
      }, 15000);

      // 20秒彻底超时才自动重试
      const timer2 = setTimeout(() => {
        console.log('[屏幕共享] 20秒超时仍无画面，触发自动重连...');
        message.error('获取画面超时，系统自动重新连接...');
        onRetry();
      }, 20000);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
      };
    }
  }, [isWaitingFrames, onRetry]);

  // 绑定本地预览流到 video 元素
  const bindLocalVideo = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localStream) {
      console.log('[屏幕共享] callback ref: 绑定本地预览流');
      el.srcObject = localStream;
      safePlay(el);
    }
  }, [localStream, safePlay]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el || !localStream) return;
    if (el.srcObject !== localStream) {
      console.log('[屏幕共享] useEffect: 更新本地预览流');
      el.srcObject = localStream;
      safePlay(el);
    }
  }, [localStream, safePlay]);

  // 全屏切换
  const toggleFullscreen = useCallback(() => {
    if (!panelRef.current) return;

    if (isMobile) {
      // 手机端使用 CSS transform 旋转模拟横屏
      setIsFullscreen(prev => !prev);
    } else {
      // PC端使用原生 Fullscreen API
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
    }
  }, [isMobile]);

  // 监听 ESC 退出全屏
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // 截图逻辑
  const handleScreenshot = useCallback(() => {
    const videoElement = remoteVideoRef.current;
    if (!videoElement || !hasVideoFrames) {
      message.warning('无可用视频画面');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    // 短暂闪屏特效
    const flash = document.createElement('div');
    flash.style.position = 'absolute';
    flash.style.inset = '0';
    flash.style.backgroundColor = 'white';
    flash.style.opacity = '0.5';
    flash.style.transition = 'opacity 0.2s';
    flash.style.zIndex = '9999';
    flash.style.pointerEvents = 'none';
    if (panelRef.current) panelRef.current.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.remove(), 200); }, 50);

    canvas.toBlob((blob) => {
      if (!blob) return;
      
      // 添加到暂存箱
      addScreenshot(blob);
      
      // 写入系统剪贴板 (仅保存最新一张)
      try {
        navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]).then(() => {
          message.success('已截图并保存到剪贴板！');
        }).catch((err) => {
          console.error('剪贴板写入失败:', err);
          message.success('已截图并放入暂存箱，但未获剪贴板权限');
        });
      } catch (err) {
        console.error('浏览器不支持 clipboard.write:', err);
        message.success('已截图并放入暂存箱');
      }

    }, 'image/png');
  }, [hasVideoFrames, addScreenshot]);

  // 区分"已连接但等待画面"和"已连接且有画面"两种状态
  // isWaitingFrames 已在上方定义
  // 没有活跃的共享时不渲染。必须放在全部 Hook 之后，避免开始共享时 Hook 顺序变化。
  if (!isSharing && !isViewing) return null;

  const statusIcon = connectionState === 'connecting'
    ? <LoadingOutlined spin style={{ color: '#f59e0b' }} />
    : connectionState === 'reconnecting'
    ? <LoadingOutlined spin style={{ color: '#f97316' }} />
    : isWaitingFrames
    ? <LoadingOutlined spin style={{ color: '#60a5fa' }} />
    : connectionState === 'connected'
    ? <DesktopOutlined style={{ color: '#10b981' }} />
    : connectionState === 'failed'
    ? <DisconnectOutlined style={{ color: '#ef4444' }} />
    : null;

  const statusText = connectionState === 'connecting'
    ? '正在建立连接...'
    : connectionState === 'reconnecting'
    ? '网络波动，自动重连中...'
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
      className={`screen-share-panel ${isFullscreen ? (isMobile ? 'mobile-landscape' : 'fullscreen') : ''} ${isExpanded ? 'expanded' : 'collapsed'} ${supportMode ? 'support-mode-video' : ''}`}
      style={style}
    >
      {/* 手机横屏全屏模式：显示浮动返回按钮，隐藏普通工具栏 */}
      {isFullscreen && isMobile && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 30,
        }}>
          <Button
            type="primary"
            icon={<ArrowLeftOutlined />}
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(0,0,0,0.6)',
              border: 'none',
              borderRadius: 24,
              padding: '6px 18px',
              height: 36,
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >返回</Button>
        </div>
      )}
      {/* 工具栏（手机全屏时隐藏） */}
      {!(isFullscreen && isMobile) && (
      <div className="screen-share-toolbar">
        <div className="screen-share-toolbar-left">
          {statusIcon}
          <span className="screen-share-status-text">
            {isSharing ? (
              <>🖥️ 您正在分享屏幕</>
            ) : (
              <>🖥️ {sharerName} 正在共享屏幕 <Tag color={connectionState === 'reconnecting' ? 'orange' : isWaitingFrames ? 'blue' : connectionState === 'connected' ? 'green' : connectionState === 'failed' ? 'red' : 'orange'} style={{ marginLeft: 4, fontSize: 11, lineHeight: '18px', padding: '0 6px' }}>{statusText}</Tag></>
            )}
          </span>
        </div>
        <div className="screen-share-toolbar-right">
          {/* 手动重试按钮 */}
          {isViewing && (connectionState === 'failed' || connectionState === 'reconnecting' || isWaitingFrames) && onRetry && (
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
          {/* 截图按钮 */}
          {isViewing && connectionState === 'connected' && hasVideoFrames && (
            <Tooltip title="一键截图并复制 (临时保存 10 张)">
              <Button
                type="text"
                size="small"
                icon={<ScissorOutlined />}
                onClick={handleScreenshot}
                className="screen-share-toolbar-btn"
                style={{ color: '#10b981' }}
              />
            </Tooltip>
          )}
          {/* 支援模式按钮（手机端隐藏） */}
          {isViewing && !isMobile && (
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
          {!supportMode && !isMobile && (isViewing || isFullscreen) && (
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
      )}

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

        {isViewing && connectionState === 'reconnecting' && (
          <div className="screen-share-connecting">
            <LoadingOutlined spin style={{ fontSize: 36, color: '#f97316' }} />
            <div style={{ marginTop: 12, color: 'var(--text-secondary)' }}>网络波动，正在自动重连...</div>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>系统将自动尝试恢复连接，请稍候</div>
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
              ref={bindLocalVideo}
              autoPlay
              playsInline
              muted
              className="screen-share-video-mini"
            />
            <div className="screen-share-preview-label">本地预览</div>
          </div>
        )}
      </div>

      {/* PC全屏模式下的提示 */}
      {isFullscreen && !isMobile && (
        <div className="screen-share-fullscreen-hint">
          按 Esc 退出全屏 · 聊天区域在底部保留
        </div>
      )}
    </div>
  );
};

export default ScreenSharePanel;
