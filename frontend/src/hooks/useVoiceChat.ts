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

  const socketRef = useRef(socket);
  const ticketIdRef = useRef(ticketId);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { ticketIdRef.current = ticketId; }, [ticketId]);
  useEffect(() => { currentUserIdRef.current = currentUserId; }, [currentUserId]);

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
      if (pc.iceConnectionState === 'connected') {
        const audioEl = audioElementsRef.current.get(peerId);
        if (audioEl && audioEl.paused && audioEl.srcObject) {
          console.log('[语音通话] ICE connected, 重新尝试播放音频');
          safePlayAudio(audioEl, peerId);
        }
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
  }, []);

  const cleanupAll = useCallback(() => {
    voicePeersRef.current.forEach(pc => pc.close());
    voicePeersRef.current.clear();

    audioElementsRef.current.forEach(el => {
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    setState({
      isInVoice: false,
      isMuted: false,
      voiceParticipants: [],
      hasActiveVoice: false,
    });
  }, []);

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

      setState(prev => ({
        ...prev,
        isInVoice: true,
        isMuted: false,
      }));

      s.emit('voice:join', { ticketId: tid });
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
  }, []);

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

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

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
      // 不要让“先到者”发送 Offer，因为新人（后到者）在 handleCurrentParticipants 中已经向所有人发送了 Offer。
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
      if (data.ticketId !== ticketIdRef.current || !localStreamRef.current) return;

      console.log('[语音通话] 收到 Offer, from:', data.from);

      const pc = await createVoicePeerConnection(data.from);

      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

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
      }
    };

    const handleIce = async (data: { ticketId: number; candidate: RTCIceCandidateInit; from: number }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      const pc = voicePeersRef.current.get(data.from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('[语音通话] ICE candidate 添加失败:', err);
        }
      }
    };

    const handleRejected = (data: { ticketId: number; reason: string }) => {
      if (data.ticketId !== ticketIdRef.current) return;
      message.warning(data.reason);
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
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
