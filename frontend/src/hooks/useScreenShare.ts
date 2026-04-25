import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';

import { settingsAPI } from '../services/api';

// STUN/TURN 动态配置缓存
let cachedIceServers: RTCIceServer[] | null = null;
let lastFetchTime = 0;

const getIceServers = async (): Promise<RTCIceServer[]> => {
  const now = Date.now();
  if (cachedIceServers && now - lastFetchTime < 1000 * 60 * 5) { // 5分钟缓存
    return cachedIceServers;
  }
  try {
    const res: any = await settingsAPI.getWebRtcConfig();
    if (res.code === 0 && res.data?.length > 0) {
      cachedIceServers = res.data;
      lastFetchTime = now;
      return cachedIceServers as RTCIceServer[];
    }
  } catch (err) {
    console.error('[WebRTC] 获取穿透配置失败，使用默认保底:', err);
  }
  // 保底免费服务器
  return [{ urls: 'stun:stun.qq.com:3478' }];
};

export interface ScreenShareState {
  /** 当前用户是否正在分享屏幕 */
  isSharing: boolean;
  /** 当前用户是否正在观看远程屏幕 */
  isViewing: boolean;
  /** 远程端的视频流 (观看方使用) */
  remoteStream: MediaStream | null;
  /** 本地屏幕流 (分享方使用，可做预览) */
  localStream: MediaStream | null;
  /** 正在分享屏幕的用户 ID */
  sharerUserId: number | null;
  /** 正在分享屏幕的用户名称 */
  sharerName: string;
  /** 连接状态 */
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  /** 房间内是否有活跃的屏幕共享（即使自己没在看） */
  hasActiveShare: boolean;
  /** 自动重连次数 */
  reconnectAttempts: number;
}

const MAX_RECONNECT_ATTEMPTS = 3;

export function useScreenShare(
  socket: Socket | null,
  ticketId: number | null,
  currentUserId: number | null,
) {
  const [state, setState] = useState<ScreenShareState>({
    isSharing: false,
    isViewing: false,
    remoteStream: null,
    localStream: null,
    sharerUserId: null,
    sharerName: '',
    connectionState: 'idle',
    hasActiveShare: false,
    reconnectAttempts: 0,
  });

  // 引用：PeerConnection 集合（分享方可能有多个观看者）
  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // ICE Candidate 缓冲队列：在 setRemoteDescription 之前到达的 candidate 先缓存
  const pendingCandidatesRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());

  // disconnected 恢复计时器
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 重连计数器
  const reconnectAttemptsRef = useRef(0);

  // 用 ref 持有最新的 socket/ticketId/currentUserId
  const socketRef = useRef(socket);
  const ticketIdRef = useRef(ticketId);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { ticketIdRef.current = ticketId; }, [ticketId]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  // 清理 disconnected 计时器
  const clearDisconnectTimer = () => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  };

  // 消化缓冲的 ICE Candidate
  const flushPendingCandidates = async (peerId: number, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending && pending.length > 0) {
      console.log(`[屏幕共享] 消化 ${pending.length} 个缓冲的 ICE Candidate, peerId:`, peerId);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[屏幕共享] 缓冲 ICE candidate 添加失败:', err);
        }
      }
      pendingCandidatesRef.current.delete(peerId);
    }
  };

  // 触发观看方自动重连
  const triggerReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[屏幕共享] 已达最大重连次数，停止自动重连');
      setState(prev => ({ ...prev, connectionState: 'failed' }));
      return;
    }

    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;
    console.log(`[屏幕共享] 自动重连第 ${attempt} 次`);

    setState(prev => ({
      ...prev,
      connectionState: 'reconnecting',
      reconnectAttempts: attempt,
    }));

    // 清理旧连接
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    remoteStreamRef.current = null;

    // 延迟 1 秒后重新发起观看请求
    setTimeout(() => {
      const s = socketRef.current;
      const tid = ticketIdRef.current;
      if (!s || !tid) return;

      setState(prev => {
        if (!prev.sharerUserId || prev.sharerUserId === currentUserIdRef.current) return prev;
        s.emit('screenShare:requestView', { ticketId: tid, to: prev.sharerUserId });
        return { ...prev, connectionState: 'connecting' };
      });
    }, 1000);
  }, []);

  // 创建 PeerConnection
  const createPeerConnection = async (peerId: number): Promise<RTCPeerConnection> => {
    // 清理已有的旧连接
    const existing = peerConnectionsRef.current.get(peerId);
    if (existing) {
      console.log('[屏幕共享] 清理已有PeerConnection for:', peerId);
      existing.close();
      peerConnectionsRef.current.delete(peerId);
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && ticketIdRef.current) {
        socketRef.current.emit('screenShare:ice', {
          ticketId: ticketIdRef.current,
          candidate: event.candidate,
          to: peerId,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[屏幕共享] ontrack 触发, track.kind:', event.track.kind, 'streams:', event.streams.length, 'peerId:', peerId);

      let stream: MediaStream;
      if (event.streams && event.streams.length > 0) {
        stream = event.streams[0];
      } else {
        if (!remoteStreamRef.current) {
          stream = new MediaStream();
        } else {
          stream = remoteStreamRef.current;
        }
        stream.addTrack(event.track);
      }

      console.log('[屏幕共享] 远程流已获取, tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}`));

      remoteStreamRef.current = stream;
      // 成功收到 track，重置重连计数
      reconnectAttemptsRef.current = 0;
      setState(prev => ({
        ...prev,
        remoteStream: stream,
        isViewing: true,
        connectionState: 'connected',
        hasActiveShare: true,
        reconnectAttempts: 0,
      }));
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[屏幕共享] ICE 状态变更:', pc.iceConnectionState, 'peerId:', peerId);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        clearDisconnectTimer();
        setState(prev => ({ ...prev, connectionState: 'connected' }));
      } else if (pc.iceConnectionState === 'disconnected') {
        // disconnected 是临时状态，给 8 秒恢复窗口
        clearDisconnectTimer();
        setState(prev => ({ ...prev, connectionState: 'reconnecting' }));
        disconnectTimerRef.current = setTimeout(() => {
          // 超时仍未恢复，触发自动重连
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            console.log('[屏幕共享] disconnected 超时 8 秒未恢复，触发自动重连');
            triggerReconnect();
          }
        }, 8000);
      } else if (pc.iceConnectionState === 'failed') {
        clearDisconnectTimer();
        console.log('[屏幕共享] ICE 连接失败，触发自动重连');
        triggerReconnect();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[屏幕共享] 连接状态:', pc.connectionState, 'peerId:', peerId);
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  };

  // 清理观看方的 PeerConnection（不清除 activeSharer 信息）
  const cleanupViewerConnections = useCallback(() => {
    clearDisconnectTimer();
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    remoteStreamRef.current = null;
    reconnectAttemptsRef.current = 0;

    setState(prev => ({
      ...prev,
      isViewing: false,
      remoteStream: null,
      connectionState: prev.hasActiveShare ? 'idle' : 'idle',
      reconnectAttempts: 0,
      // 保留 hasActiveShare、sharerUserId、sharerName
    }));
  }, []);

  // 完全清理所有连接（分享方停止或共享结束时使用）
  const cleanupAllConnections = useCallback(() => {
    clearDisconnectTimer();
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    remoteStreamRef.current = null;
    reconnectAttemptsRef.current = 0;

    setState({
      isSharing: false,
      isViewing: false,
      remoteStream: null,
      localStream: null,
      sharerUserId: null,
      sharerName: '',
      connectionState: 'idle',
      hasActiveShare: false,
      reconnectAttempts: 0,
    });
  }, []);

  // ==================== 分享方 API ====================

  /** 发起屏幕共享 */
  const startSharing = useCallback(async () => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (!s || !tid) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      });

      localStreamRef.current = stream;

      setState(prev => ({
        ...prev,
        isSharing: true,
        localStream: stream,
        sharerUserId: currentUserIdRef.current,
        connectionState: 'connecting',
        hasActiveShare: true,
      }));

      // 通知房间内所有人
      s.emit('screenShare:start', { ticketId: tid });

      // 监听浏览器原生"停止共享"按钮
      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };
    } catch (err: any) {
      console.error('[屏幕共享] 获取屏幕流失败:', err);
    }
  }, []);

  /** 停止屏幕共享 */
  const stopSharing = useCallback(() => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (s && tid) {
      s.emit('screenShare:stop', { ticketId: tid });
    }
    cleanupAllConnections();
  }, [cleanupAllConnections]);

  // ==================== 观看方 API ====================

  /** 观看方停止观看（但不清除活跃分享信息，可以重新加入） */
  const stopViewing = useCallback(() => {
    cleanupViewerConnections();
  }, [cleanupViewerConnections]);

  /** 观看方主动加入/重新加入屏幕共享 */
  const joinViewing = useCallback(() => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (!s || !tid) return;

    // 重置重连计数
    reconnectAttemptsRef.current = 0;

    setState(prev => {
      if (!prev.sharerUserId || prev.sharerUserId === currentUserIdRef.current) return prev;

      console.log('[屏幕共享] 主动加入观看, sharer:', prev.sharerUserId);

      // 发送观看请求
      s.emit('screenShare:requestView', { ticketId: tid, to: prev.sharerUserId });

      return {
        ...prev,
        connectionState: 'connecting',
        reconnectAttempts: 0,
      };
    });
  }, []);

  // ==================== Socket 事件监听 ====================

  useEffect(() => {
    if (!socket || !ticketId) return;

    // 有人开始了屏幕共享（实时通知）
    const handleStarted = async (data: { ticketId: number; from: number; fromName: string }) => {
      if (data.ticketId !== ticketIdRef.current || data.from === currentUserIdRef.current) return;

      console.log('[屏幕共享] 收到共享开始通知, from:', data.fromName, '(', data.from, ')');

      setState(prev => ({
        ...prev,
        sharerUserId: data.from,
        sharerName: data.fromName,
        connectionState: 'connecting',
        hasActiveShare: true,
      }));

      // 自动请求建立连接
      socket.emit('screenShare:requestView', { ticketId, to: data.from });
    };

    // 加入房间时收到活跃共享通知（不自动连接，只显示状态）
    const handleActive = (data: { ticketId: number; from: number; fromName: string }) => {
      if (data.ticketId !== ticketIdRef.current || data.from === currentUserIdRef.current) return;

      console.log('[屏幕共享] 房间内有活跃共享, from:', data.fromName, '(', data.from, ')');

      setState(prev => ({
        ...prev,
        sharerUserId: data.from,
        sharerName: data.fromName,
        hasActiveShare: true,
        // 不自动连接，用户可以点击按钮加入
      }));
    };

    // 分享方：收到观看请求，为该观看者创建 offer
    const handleRequestView = async (data: { ticketId: number; from: number }) => {
      if (data.ticketId !== ticketIdRef.current || !localStreamRef.current) {
        console.log('[屏幕共享] handleRequestView 跳过: ticketId匹配:', data.ticketId === ticketIdRef.current, 'localStream存在:', !!localStreamRef.current);
        return;
      }

      console.log('[屏幕共享] 收到观看请求, from:', data.from, '当前PC数:', peerConnectionsRef.current.size);

      const pc = await createPeerConnection(data.from);

      const tracks = localStreamRef.current.getTracks();
      console.log('[屏幕共享] 添加轨道到PC:', tracks.map(t => `${t.kind}:${t.readyState}`));
      tracks.forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log('[屏幕共享] 发送 Offer 给:', data.from);
      socket.emit('screenShare:offer', {
        ticketId,
        sdp: offer,
        to: data.from,
      });
    };

    // 观看方：收到 SDP Offer
    const handleOffer = async (data: { ticketId: number; sdp: RTCSessionDescriptionInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;

      console.log('[屏幕共享] 收到 Offer, from:', data.from);

      const pc = await createPeerConnection(data.from);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      // 消化缓冲的 ICE Candidate
      await flushPendingCandidates(data.from, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[屏幕共享] 发送 Answer 给:', data.from);
      socket.emit('screenShare:answer', {
        ticketId,
        sdp: answer,
        to: data.from,
      });
    };

    // 分享方：收到 SDP Answer
    const handleAnswer = async (data: { ticketId: number; sdp: RTCSessionDescriptionInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      console.log('[屏幕共享] 收到 Answer, from:', data.from);
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // 消化缓冲的 ICE Candidate
        await flushPendingCandidates(data.from, pc);
      }
    };

    // ICE Candidate 交换
    const handleIce = async (data: { ticketId: number; candidate: RTCIceCandidateInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc) {
        // 检查是否已有 remoteDescription，没有则缓冲
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.error('[屏幕共享] ICE candidate 添加失败:', err);
          }
        } else {
          console.log('[屏幕共享] remoteDescription 未就绪，缓冲 ICE candidate, from:', data.from);
          const pending = pendingCandidatesRef.current.get(data.from) || [];
          pending.push(data.candidate);
          pendingCandidatesRef.current.set(data.from, pending);
        }
      } else {
        // PC 尚未创建，缓冲候选者
        console.log('[屏幕共享] PeerConnection 尚未创建，缓冲 ICE candidate, from:', data.from);
        const pending = pendingCandidatesRef.current.get(data.from) || [];
        pending.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, pending);
      }
    };

    // 有人停止了屏幕共享
    const handleStopped = (data: { ticketId: number; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      console.log('[屏幕共享] 收到共享停止通知, from:', data.from);
      // 完全清理
      clearDisconnectTimer();
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      pendingCandidatesRef.current.clear();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      remoteStreamRef.current = null;
      reconnectAttemptsRef.current = 0;
      setState({
        isSharing: false,
        isViewing: false,
        remoteStream: null,
        localStream: null,
        sharerUserId: null,
        sharerName: '',
        connectionState: 'idle',
        hasActiveShare: false,
        reconnectAttempts: 0,
      });
    };

    socket.on('screenShare:started', handleStarted);
    socket.on('screenShare:active', handleActive);
    socket.on('screenShare:requestView', handleRequestView);
    socket.on('screenShare:offer', handleOffer);
    socket.on('screenShare:answer', handleAnswer);
    socket.on('screenShare:ice', handleIce);
    socket.on('screenShare:stopped', handleStopped);

    return () => {
      socket.off('screenShare:started', handleStarted);
      socket.off('screenShare:active', handleActive);
      socket.off('screenShare:requestView', handleRequestView);
      socket.off('screenShare:offer', handleOffer);
      socket.off('screenShare:answer', handleAnswer);
      socket.off('screenShare:ice', handleIce);
      socket.off('screenShare:stopped', handleStopped);
    };
  }, [socket, ticketId]);

  // 组件卸载或 ticketId 切换时清理
  useEffect(() => {
    return () => {
      clearDisconnectTimer();
      cleanupAllConnections();
    };
  }, [ticketId, cleanupAllConnections]);

  return {
    ...state,
    startSharing,
    stopSharing,
    stopViewing,
    joinViewing,
  };
}
