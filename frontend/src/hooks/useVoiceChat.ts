import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { message } from 'antd';

import { settingsAPI } from '../services/api';

// STUN/TURN 动态配置缓存（与 useScreenShare 共用逻辑）
let cachedIceServers: RTCIceServer[] | null = null;
let lastFetchTime = 0;

const getIceServers = async (): Promise<RTCIceServer[]> => {
  const now = Date.now();
  if (cachedIceServers && now - lastFetchTime < 1000 * 60 * 5) {
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
    console.error('[语音通话] 获取穿透配置失败，使用默认保底:', err);
  }
  return [{ urls: 'stun:stun.qq.com:3478' }];
};

export interface VoiceParticipant {
  userId: number;
  userName: string;
}

export interface VoiceChatState {
  isInVoice: boolean;
  isMuted: boolean;
  voiceParticipants: VoiceParticipant[];
  hasActiveVoice: boolean;
}

/**
 * 在用户手势期间解锁浏览器的音频播放权限。
 * iOS Safari 和部分 Android 浏览器要求必须在用户交互（如点击）的同步调用链中
 * 调用 AudioContext.resume() 或 audio.play()，才能解除自动播放限制。
 */
const unlockAudioPlayback = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      console.log('[语音通话] AudioContext 已解锁, state:', ctx.state);
    }

    const silentAudio = document.createElement('audio');
    silentAudio.setAttribute('playsinline', 'true');
    silentAudio.setAttribute('webkit-playsinline', 'true');
    silentAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoAAAAAAAAAAAAAAAAAAAA';
    silentAudio.volume = 0.01;
    silentAudio.play().then(() => {
      console.log('[语音通话] 静音 Audio 播放成功，浏览器音频已解锁');
      setTimeout(() => silentAudio.remove(), 1000);
    }).catch(() => {
      silentAudio.remove();
    });
  } catch (e) {
    console.warn('[语音通话] 音频解锁尝试失败（不影响桌面端）:', e);
  }
};

export function useVoiceChat(
  socket: Socket | null,
  ticketId: number | null,
  currentUserId: number | null,
) {
  const [state, setState] = useState<VoiceChatState>({
    isInVoice: false,
    isMuted: false,
    voiceParticipants: [],
    hasActiveVoice: false,
  });

  const voicePeersRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementsRef = useRef<Map<number, HTMLAudioElement>>(new Map());

  // ICE Candidate 缓冲队列
  const pendingCandidatesRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());

  // disconnected 恢复计时器 (per peer)
  const disconnectTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // ICE Restart 重试计数器（每个 peer 最多 3 次）
  const iceRestartCountRef = useRef<Map<number, number>>(new Map());

  // 健康心跳定时器
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 标记是否正在语音通话中（ref 版本，给 cleanup 和 heartbeat 用）
  const isInVoiceRef = useRef(false);

  const socketRef = useRef(socket);
  const ticketIdRef = useRef(ticketId);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { ticketIdRef.current = ticketId; }, [ticketId]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

  // 消化缓冲的 ICE Candidate
  const flushPendingCandidates = async (peerId: number, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending && pending.length > 0) {
      console.log(`[语音通话] 消化 ${pending.length} 个缓冲的 ICE Candidate, peerId:`, peerId);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[语音通话] 缓冲 ICE candidate 添加失败:', err);
        }
      }
      pendingCandidatesRef.current.delete(peerId);
    }
  };

  /** 创建一个可靠播放远程音频的 audio 元素 */
  const createAudioElement = (peerId: number): HTMLAudioElement => {
    const existing = audioElementsRef.current.get(peerId);
    if (existing) {
      existing.srcObject = null;
      existing.remove();
    }

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    audioEl.setAttribute('playsinline', 'true');
    audioEl.setAttribute('webkit-playsinline', 'true');
    audioEl.volume = 1.0;
    audioEl.muted = false;
    audioEl.setAttribute('data-voice-peer', String(peerId));
    document.body.appendChild(audioEl);
    audioElementsRef.current.set(peerId, audioEl);

    return audioEl;
  };

  /** 尝试播放音频元素，带重试机制 */
  const safePlayAudio = (audioEl: HTMLAudioElement, peerId: number) => {
    const tryPlay = () => {
      audioEl.play().then(() => {
        console.log('[语音通话] 音频播放成功, peerId:', peerId,
          'paused:', audioEl.paused, 'volume:', audioEl.volume, 'muted:', audioEl.muted);
      }).catch(err => {
        console.warn('[语音通话] 音频播放失败, peerId:', peerId, err.name, err.message);
        if (err.name === 'NotAllowedError') {
          const retryOnClick = () => {
            audioEl.play().catch(() => {});
            document.removeEventListener('click', retryOnClick);
            document.removeEventListener('touchstart', retryOnClick);
          };
          document.addEventListener('click', retryOnClick, { once: true });
          document.addEventListener('touchstart', retryOnClick, { once: true });
        }
      });
    };
    setTimeout(tryPlay, 100);
  };

  // 对单个 peer 发起 ICE Restart 重连（最多 3 次）
  const restartIceForPeer = useCallback(async (peerId: number) => {
    const count = (iceRestartCountRef.current.get(peerId) || 0) + 1;
    if (count > 5) {
      console.warn('[语音通话] peerId', peerId, '已达 ICE Restart 上限(5次)，放弃重连');
      return;
    }
    iceRestartCountRef.current.set(peerId, count);

    const pc = voicePeersRef.current.get(peerId);
    if (!pc || !localStreamRef.current) return;

    console.log(`[语音通话] 触发 ICE Restart (第${count}次), peerId:`, peerId);
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      const s = socketRef.current;
      const tid = ticketIdRef.current;
      if (s && tid) {
        s.emit('voice:offer', {
          ticketId: tid,
          sdp: offer,
          to: peerId,
        });
      }
    } catch (err) {
      console.error('[语音通话] ICE Restart 失败, peerId:', peerId, err);
    }
  }, []);

  // 创建语音 PeerConnection
  const createVoicePeerConnection = async (peerId: number): Promise<RTCPeerConnection> => {
    const existing = voicePeersRef.current.get(peerId);
    if (existing) {
      existing.close();
      voicePeersRef.current.delete(peerId);
    }

    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && ticketIdRef.current) {
        socketRef.current.emit('voice:ice', {
          ticketId: ticketIdRef.current,
          candidate: event.candidate,
          to: peerId,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[语音通话] ontrack 触发, peerId:', peerId,
        'track.kind:', event.track.kind, 'track.readyState:', event.track.readyState,
        'streams:', event.streams.length);

      if (event.track.kind !== 'audio') return;

      let stream: MediaStream;
      if (event.streams && event.streams.length > 0) {
        stream = event.streams[0];
      } else {
        stream = new MediaStream();
        stream.addTrack(event.track);
      }

      const audioEl = createAudioElement(peerId);
      audioEl.srcObject = stream;
      safePlayAudio(audioEl, peerId);

      event.track.onmute = () => {
        console.log('[语音通话] 远程音频轨道 muted, peerId:', peerId);
      };
      event.track.onunmute = () => {
        console.log('[语音通话] 远程音频轨道 unmuted, peerId:', peerId);
        safePlayAudio(audioEl, peerId);
      };
      event.track.onended = () => {
        console.log('[语音通话] 远程音频轨道 ended, peerId:', peerId);
      };
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[语音通话] ICE 状态变更:', pc.iceConnectionState, 'peerId:', peerId);

      // 清理之前的 disconnected 计时器
      const existingTimer = disconnectTimersRef.current.get(peerId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        disconnectTimersRef.current.delete(peerId);
      }

      if (pc.iceConnectionState === 'connected') {
        // 连接成功，重置该 peer 的 ICE Restart 计数器
        iceRestartCountRef.current.delete(peerId);
        const audioEl = audioElementsRef.current.get(peerId);
        if (audioEl && audioEl.paused && audioEl.srcObject) {
          console.log('[语音通话] ICE connected, 重新尝试播放音频');
          safePlayAudio(audioEl, peerId);
        }
      } else if (pc.iceConnectionState === 'disconnected') {
        // disconnected 是临时状态，给 5 秒恢复窗口
        const timer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            console.log('[语音通话] disconnected 超时 5 秒未恢复，触发 ICE Restart, peerId:', peerId);
            restartIceForPeer(peerId);
          }
        }, 5000);
        disconnectTimersRef.current.set(peerId, timer);
      } else if (pc.iceConnectionState === 'failed') {
        console.log('[语音通话] ICE 连接失败，触发 ICE Restart, peerId:', peerId);
        restartIceForPeer(peerId);
      }
    };

    voicePeersRef.current.set(peerId, pc);
    return pc;
  };

  const cleanupPeer = useCallback((peerId: number) => {
    const pc = voicePeersRef.current.get(peerId);
    if (pc) {
      pc.close();
      voicePeersRef.current.delete(peerId);
    }
    const audioEl = audioElementsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElementsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    iceRestartCountRef.current.delete(peerId);
    const timer = disconnectTimersRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      disconnectTimersRef.current.delete(peerId);
    }
  }, []);

  const cleanupAll = useCallback(() => {
    // 关键修复：向服务端发送 voice:leave，确保后端清除该用户的语音状态
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (s && tid && isInVoiceRef.current) {
      s.emit('voice:leave', { ticketId: tid });
    }

    voicePeersRef.current.forEach(pc => pc.close());
    voicePeersRef.current.clear();

    audioElementsRef.current.forEach(el => {
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();

    pendingCandidatesRef.current.clear();
    iceRestartCountRef.current.clear();

    // 清理所有 disconnected 计时器
    disconnectTimersRef.current.forEach(timer => clearTimeout(timer));
    disconnectTimersRef.current.clear();

    // 清理心跳定时器
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    isInVoiceRef.current = false;

    setState({
      isInVoice: false,
      isMuted: false,
      voiceParticipants: [],
      hasActiveVoice: false,
    });
  }, []);

  // ==================== 健康心跳检测 ====================
  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);

    heartbeatTimerRef.current = setInterval(() => {
      if (!isInVoiceRef.current) return;

      voicePeersRef.current.forEach((pc, peerId) => {
        const iceState = pc.iceConnectionState;
        if (iceState === 'failed') {
          console.log('[语音通话] 心跳检测: peerId', peerId, '处于 failed 状态，触发 ICE Restart');
          restartIceForPeer(peerId);
        } else if (iceState === 'disconnected') {
          // disconnected 已经有单独的计时器处理，这里不重复
        } else if (iceState === 'closed') {
          console.log('[语音通话] 心跳检测: peerId', peerId, '连接已关闭，清理');
          cleanupPeer(peerId);
        }
      });
    }, 10000); // 每 10 秒检查一次
  }, [restartIceForPeer, cleanupPeer]);

  // ==================== 公开 API ====================

  const joinVoice = useCallback(async () => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (!s || !tid) return;

    // 【关键】在用户点击的同步链中解锁浏览器音频播放权限
    unlockAudioPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;
      isInVoiceRef.current = true;

      setState(prev => ({
        ...prev,
        isInVoice: true,
        isMuted: false,
      }));

      s.emit('voice:join', { ticketId: tid });

      // 启动健康心跳
      startHeartbeat();
    } catch (err: any) {
      console.error('[语音通话] 获取麦克风失败:', err);
      if (err.name === 'NotAllowedError') {
        message.error('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
      } else if (err.name === 'NotFoundError') {
        message.error('未检测到麦克风设备');
      } else {
        message.error('无法访问麦克风: ' + err.message);
      }
    }
  }, [startHeartbeat]);

  const leaveVoice = useCallback(() => {
    const s = socketRef.current;
    const tid = ticketIdRef.current;
    if (s && tid) {
      s.emit('voice:leave', { ticketId: tid });
    }

    voicePeersRef.current.forEach(pc => pc.close());
    voicePeersRef.current.clear();

    audioElementsRef.current.forEach(el => {
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();

    pendingCandidatesRef.current.clear();

    disconnectTimersRef.current.forEach(timer => clearTimeout(timer));
    disconnectTimersRef.current.clear();

    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    isInVoiceRef.current = false;

    setState(prev => ({
      ...prev,
      isInVoice: false,
      isMuted: false,
    }));
  }, []);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setState(prev => ({ ...prev, isMuted: !audioTrack.enabled }));
      }
    }
  }, []);

  // ==================== Socket 事件监听 ====================

  useEffect(() => {
    if (!socket || !ticketId) return;

    const handleActive = (data: { ticketId: number; participants: VoiceParticipant[] }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      console.log('[语音通话] 房间内有活跃语音通话:', data.participants);
      setState(prev => ({
        ...prev,
        voiceParticipants: data.participants,
        hasActiveVoice: data.participants.length > 0,
      }));
    };

    const handleCurrentParticipants = async (data: { ticketId: number; participants: VoiceParticipant[] }) => {
      if (data.ticketId !== ticketIdRef.current || !localStreamRef.current) return;
      console.log('[语音通话] 收到现有参与者列表:', data.participants);

      for (const participant of data.participants) {
        if (participant.userId === currentUserIdRef.current) continue;

        const pc = await createVoicePeerConnection(participant.userId);

        localStreamRef.current!.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log('[语音通话] 发送 Offer 给已有参与者:', participant.userId);
        socket.emit('voice:offer', {
          ticketId,
          sdp: offer,
          to: participant.userId,
        });
      }
    };

    const handlePeerJoined = async (data: { ticketId: number; userId: number; userName: string }) => {
      if (data.ticketId !== ticketIdRef.current) return;

      console.log('[语音通话] 新用户加入:', data.userName, '(', data.userId, ')');

      setState(prev => {
        const exists = prev.voiceParticipants.some(p => p.userId === data.userId);
        const newParticipants = exists
          ? prev.voiceParticipants
          : [...prev.voiceParticipants, { userId: data.userId, userName: data.userName }];
        return {
          ...prev,
          voiceParticipants: newParticipants,
          hasActiveVoice: true,
        };
      });

      // 修复 WebRTC Glare（冲突）问题：
      // 不要让"先到者"发送 Offer，因为新人（后到者）在 handleCurrentParticipants 中已经向所有人发送了 Offer。
      // 只需等待对方发送 Offer 触发 handleOffer 即可建立连接。
    };

    const handlePeerLeft = (data: { ticketId: number; userId: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      console.log('[语音通话] 用户离开:', data.userId);

      cleanupPeer(data.userId);

      setState(prev => {
        const newParticipants = prev.voiceParticipants.filter(p => p.userId !== data.userId);
        return {
          ...prev,
          voiceParticipants: newParticipants,
          hasActiveVoice: newParticipants.length > 0,
        };
      });
    };

    const handleOffer = async (data: { ticketId: number; sdp: RTCSessionDescriptionInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;

      // 增加重试保护：如果 localStream 尚未就绪，等待后重试
      const waitForStream = async (retries = 3): Promise<boolean> => {
        for (let i = 0; i < retries; i++) {
          if (localStreamRef.current) return true;
          console.log(`[语音通话] 收到 Offer 但 localStream 未就绪，等待重试 (${i + 1}/${retries}), from:`, data.from);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return false;
      };

      if (!localStreamRef.current) {
        const ready = await waitForStream();
        if (!ready) {
          console.warn('[语音通话] 放弃处理 Offer: localStream 始终未就绪, from:', data.from);
          return;
        }
      }

      console.log('[语音通话] 收到 Offer, from:', data.from);

      const pc = await createVoicePeerConnection(data.from);

      localStreamRef.current!.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

      // 消化缓冲的 ICE Candidate
      await flushPendingCandidates(data.from, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[语音通话] 发送 Answer 给:', data.from);
      socket.emit('voice:answer', {
        ticketId,
        sdp: answer,
        to: data.from,
      });
    };

    const handleAnswer = async (data: { ticketId: number; sdp: RTCSessionDescriptionInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      console.log('[语音通话] 收到 Answer, from:', data.from);
      const pc = voicePeersRef.current.get(data.from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // 消化缓冲的 ICE Candidate
        await flushPendingCandidates(data.from, pc);
      }
    };

    const handleIce = async (data: { ticketId: number; candidate: RTCIceCandidateInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      const pc = voicePeersRef.current.get(data.from);
      if (pc) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.error('[语音通话] ICE candidate 添加失败:', err);
          }
        } else {
          console.log('[语音通话] remoteDescription 未就绪，缓冲 ICE candidate, from:', data.from);
          const pending = pendingCandidatesRef.current.get(data.from) || [];
          pending.push(data.candidate);
          pendingCandidatesRef.current.set(data.from, pending);
        }
      } else {
        // PC 尚未创建，缓冲候选者
        const pending = pendingCandidatesRef.current.get(data.from) || [];
        pending.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, pending);
      }
    };

    const handleRejected = (data: { ticketId: number; reason: string }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      message.warning(data.reason);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      isInVoiceRef.current = false;
      setState(prev => ({ ...prev, isInVoice: false, isMuted: false }));
    };

    socket.on('voice:active', handleActive);
    socket.on('voice:currentParticipants', handleCurrentParticipants);
    socket.on('voice:peerJoined', handlePeerJoined);
    socket.on('voice:peerLeft', handlePeerLeft);
    socket.on('voice:offer', handleOffer);
    socket.on('voice:answer', handleAnswer);
    socket.on('voice:ice', handleIce);
    socket.on('voice:rejected', handleRejected);

    return () => {
      socket.off('voice:active', handleActive);
      socket.off('voice:currentParticipants', handleCurrentParticipants);
      socket.off('voice:peerJoined', handlePeerJoined);
      socket.off('voice:peerLeft', handlePeerLeft);
      socket.off('voice:offer', handleOffer);
      socket.off('voice:answer', handleAnswer);
      socket.off('voice:ice', handleIce);
      socket.off('voice:rejected', handleRejected);
    };
  }, [socket, ticketId, cleanupPeer]);

  useEffect(() => {
    return () => {
      cleanupAll();
    };
  }, [ticketId, cleanupAll]);

  return {
    ...state,
    joinVoice,
    leaveVoice,
    toggleMute,
  };
}
