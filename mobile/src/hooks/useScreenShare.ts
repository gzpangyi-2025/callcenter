import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, MediaStream } from 'react-native-webrtc';

import { settingsAPI } from '../services/api';

// STUN/TURN 动态配置缓存
let cachedIceServers: any[] | null = null;
let lastFetchTime = 0;

const getIceServers = async (): Promise<any[]> => {
  const now = Date.now();
  if (cachedIceServers && now - lastFetchTime < 1000 * 60 * 5) {
    return cachedIceServers;
  }
  try {
    const res: any = await settingsAPI.getWebRtcConfig();
    if (res.code === 0 && res.data?.length > 0) {
      cachedIceServers = res.data;
      lastFetchTime = now;
      return cachedIceServers as any[];
    }
  } catch (err) {
    console.error('[WebRTC] 获取穿透配置失败，使用默认保底:', err);
  }
  return [{ urls: 'stun:stun.qq.com:3478' }];
};

export interface ScreenShareState {
  isViewing: boolean;
  remoteStream: MediaStream | null;
  sharerUserId: number | null;
  sharerName: string;
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  hasActiveShare: boolean;
  reconnectAttempts: number;
}

const MAX_RECONNECT_ATTEMPTS = 5;

export function useScreenShare(
  socket: Socket | null,
  ticketId: number | null,
  currentUserId: number | null,
) {
  const [state, setState] = useState<ScreenShareState>({
    isViewing: false,
    remoteStream: null,
    sharerUserId: null,
    sharerName: '',
    connectionState: 'idle',
    hasActiveShare: false,
    reconnectAttempts: 0,
  });

  const peerConnectionsRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<Map<number, any[]>>(new Map());
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const socketRef = useRef(socket);
  const ticketIdRef = useRef(ticketId);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { ticketIdRef.current = ticketId; }, [ticketId]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  const clearDisconnectTimer = () => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  };

  const flushPendingCandidates = async (peerId: number, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending && pending.length > 0) {
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

  const triggerReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setState(prev => ({ ...prev, connectionState: 'failed' }));
      return;
    }

    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;

    setState(prev => ({
      ...prev,
      connectionState: 'reconnecting',
      reconnectAttempts: attempt,
    }));

    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    remoteStreamRef.current = null;

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

  const createPeerConnection = async (peerId: number): Promise<RTCPeerConnection> => {
    const existing = peerConnectionsRef.current.get(peerId);
    if (existing) {
      existing.close();
      peerConnectionsRef.current.delete(peerId);
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event: any) => {
      if (event.candidate && socketRef.current && ticketIdRef.current) {
        socketRef.current.emit('screenShare:ice', {
          ticketId: ticketIdRef.current,
          candidate: event.candidate,
          to: peerId,
        });
      }
    };

    pc.ontrack = (event: any) => {
      let stream: MediaStream;
      if (event.streams && event.streams.length > 0) {
        stream = event.streams[0];
      } else {
        stream = remoteStreamRef.current || new MediaStream();
        stream.addTrack(event.track);
      }

      remoteStreamRef.current = stream;
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
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        clearDisconnectTimer();
        setState(prev => ({ ...prev, connectionState: 'connected' }));
      } else if (pc.iceConnectionState === 'disconnected') {
        clearDisconnectTimer();
        setState(prev => ({ ...prev, connectionState: 'reconnecting' }));
        disconnectTimerRef.current = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            triggerReconnect();
          }
        }, 8000);
      } else if (pc.iceConnectionState === 'failed') {
        clearDisconnectTimer();
        triggerReconnect();
      }
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  };

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
    }));
  }, []);

  const cleanupAllConnections = useCallback(() => {
    clearDisconnectTimer();
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    remoteStreamRef.current = null;
    reconnectAttemptsRef.current = 0;

    setState({
      isViewing: false,
      remoteStream: null,
      sharerUserId: null,
      sharerName: '',
      connectionState: 'idle',
      hasActiveShare: false,
      reconnectAttempts: 0,
    });
  }, []);

  const stopViewing = useCallback(() => {
    cleanupViewerConnections();
  }, [cleanupViewerConnections]);

  const joinViewing = useCallback(() => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (!s || !tid) return;

    reconnectAttemptsRef.current = 0;

    setState(prev => {
      if (!prev.sharerUserId || prev.sharerUserId === currentUserIdRef.current) return prev;
      s.emit('screenShare:requestView', { ticketId: tid, to: prev.sharerUserId });
      return {
        ...prev,
        connectionState: 'connecting',
        reconnectAttempts: 0,
      };
    });
  }, []);

  useEffect(() => {
    if (!socket || !ticketId) return;

    const handleStarted = async (data: { ticketId: number; from: number; fromName: string }) => {
      if (data.ticketId !== ticketIdRef.current || data.from === currentUserIdRef.current) return;
      setState(prev => ({
        ...prev,
        sharerUserId: data.from,
        sharerName: data.fromName,
        connectionState: 'connecting',
        hasActiveShare: true,
      }));
      socket.emit('screenShare:requestView', { ticketId, to: data.from });
    };

    const handleActive = (data: { ticketId: number; from: number; fromName: string }) => {
      if (data.ticketId !== ticketIdRef.current || data.from === currentUserIdRef.current) return;
      setState(prev => ({
        ...prev,
        sharerUserId: data.from,
        sharerName: data.fromName,
        hasActiveShare: true,
      }));
    };

    const handleOffer = async (data: { ticketId: number; sdp: any; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      const pc = await createPeerConnection(data.from);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushPendingCandidates(data.from, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('screenShare:answer', { ticketId, sdp: answer, to: data.from });
    };

    const handleIce = async (data: { ticketId: number; candidate: any; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.error('[屏幕共享] ICE candidate 添加失败:', err);
          }
        } else {
          const pending = pendingCandidatesRef.current.get(data.from) || [];
          pending.push(data.candidate);
          pendingCandidatesRef.current.set(data.from, pending);
        }
      } else {
        const pending = pendingCandidatesRef.current.get(data.from) || [];
        pending.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, pending);
      }
    };

    const handleStopped = (data: { ticketId: number; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      cleanupAllConnections();
    };

    socket.on('screenShare:started', handleStarted);
    socket.on('screenShare:active', handleActive);
    socket.on('screenShare:offer', handleOffer);
    socket.on('screenShare:ice', handleIce);
    socket.on('screenShare:stopped', handleStopped);

    return () => {
      socket.off('screenShare:started', handleStarted);
      socket.off('screenShare:active', handleActive);
      socket.off('screenShare:offer', handleOffer);
      socket.off('screenShare:ice', handleIce);
      socket.off('screenShare:stopped', handleStopped);
    };
  }, [socket, ticketId]);

  useEffect(() => {
    return () => {
      clearDisconnectTimer();
      cleanupAllConnections();
    };
  }, [ticketId, cleanupAllConnections]);

  return {
    ...state,
    stopViewing,
    joinViewing,
  };
}
