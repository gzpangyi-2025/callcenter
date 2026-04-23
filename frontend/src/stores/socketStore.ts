import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from './authStore';
import { authAPI, ticketsAPI, bbsAPI } from '../services/api';

// ─── 工具函数：每次 unreadMap / newTicketIds / myTicketIds 变化时同步计算 ───
const calcBadge = (
  unreadMap: Record<number, number>,
  newTicketIds: number[],
  myTicketIds: number[],
  bbsUnreadMap: Record<number, number>,
): number => {
  const unreadTotal = myTicketIds.reduce((sum, id) => sum + (unreadMap[id] || 0), 0);
  const bbsTotal = Object.values(bbsUnreadMap).reduce((sum, count) => sum + count, 0);
  return unreadTotal + newTicketIds.length + bbsTotal;
};

// ─── 通知音效：使用 Web Audio API 合成短促 "叮" 声 ───
let audioCtx: AudioContext | null = null;
let lastPlayTime = 0;

const playDing = () => {
  try {
    const now = Date.now();
    // 防抖：200ms 内不重复播放
    if (now - lastPlayTime < 200) return;
    lastPlayTime = now;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // 如果 AudioContext 被浏览器挂起（用户尚未交互），静默跳过
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
      return;
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    // 清脆的叮声：高频正弦波 + 快速衰减
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);        // A5
    oscillator.frequency.setValueAtTime(1320, audioCtx.currentTime + 0.05); // E6 上扬

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch {
    // 浏览器不支持 Web Audio 或用户未交互，静默忽略
  }
};

// ─── 新工单提示音：双响低音 "嘟嘟"，区别于消息叮声 ───
const playAlert = () => {
  try {
    const now = Date.now();
    if (now - lastPlayTime < 200) return;
    lastPlayTime = now;

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
      return;
    }

    // 第一声
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523, audioCtx.currentTime);      // C5
    osc1.frequency.setValueAtTime(784, audioCtx.currentTime + 0.06); // G5
    gain1.gain.setValueAtTime(0.35, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.2);

    // 第二声（间隔 0.25s）
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523, audioCtx.currentTime + 0.25);
    osc2.frequency.setValueAtTime(1047, audioCtx.currentTime + 0.31); // C6 上扬
    gain2.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain2.gain.setValueAtTime(0.35, audioCtx.currentTime + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc2.start(audioCtx.currentTime + 0.25);
    osc2.stop(audioCtx.currentTime + 0.5);
  } catch {
    // 静默忽略
  }
};

// ─── 标签页标题闪烁 ───
// 过滤掉脏标题数据（应对 Vite 热更新残留在 document.title 上的情况）
const ORIGINAL_TITLE = (document.title || 'CallCenter').replace(/🔴\s*\(\d+条新消息\)\s*/g, '').trim() || 'CallCenter';
let flashInterval: ReturnType<typeof setInterval> | null = null;
let currentFlashBadge = 0;

export const startTitleFlash = (badge: number) => {
  if (badge <= 0) {
    stopTitleFlash();
    return;
  }
  
  // 防止相同数量重复触发导致定时器频闪
  if (flashInterval && currentFlashBadge === badge) return;
  
  currentFlashBadge = badge;
  let showAlert = true;

  if (flashInterval) clearInterval(flashInterval);
  flashInterval = setInterval(() => {
    if (showAlert) {
      document.title = `🔴 (${badge}条新消息) ${ORIGINAL_TITLE}`;
    } else {
      document.title = ORIGINAL_TITLE;
    }
    showAlert = !showAlert;
  }, 1000);
};

export const stopTitleFlash = () => {
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  currentFlashBadge = 0;
  if (document.title !== ORIGINAL_TITLE) {
    document.title = ORIGINAL_TITLE;
  }
};

// 用户回到页面时，如果没有未读就停止闪烁
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const state = useSocketStore.getState();
      if (state.profileBadge <= 0) {
        stopTitleFlash();
      }
    }
  });
}

interface SocketState {
  socket: Socket | null;
  connected: boolean;
  unreadMap: Record<number, number>; // ticketId -> unread count
  newTicketIds: number[];            // ticketIds that are "new" for assigned/participated tabs
  myTicketIds: number[];             // all ticket IDs relevant to current user (set by Profile)
  bbsUnreadMap: Record<number, number>; // postId -> unreadCount
  profileBadge: number;              // computed in-store, read by sidebar
  currentTicketId: number | null;
  currentBbsId: number | null;
  connect: (token: string) => void;
  disconnect: () => void;
  setCurrentTicket: (ticketId: number | null) => void;
  setCurrentBbs: (postId: number | null) => void;
  setMyTicketIds: (ids: number[]) => void;  // called by Profile after data load
  clearUnread: (ticketId: number) => void;
  clearBbsUnread: (postId: number) => void;
  fetchBbsUnread: () => void;
  clearNewTicket: (ticketId: number) => void;
  clearAllNewTickets: () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  connected: false,
  unreadMap: {},
  newTicketIds: [],
  myTicketIds: [],
  bbsUnreadMap: {},
  profileBadge: 0,
  currentTicketId: null,
  currentBbsId: null,

  connect: (token: string) => {
    const existing = get().socket;
    if (existing?.connected) return;
    if (existing) existing.disconnect();

    const socket = io('/chat', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      console.log('[GlobalSocket] 已连接:', socket.id);
      set({ connected: true });
      // 连接/重连成功后，主动拉取一次全量的工单状态和BBS状态
      get().fetchBbsUnread();
      
      ticketsAPI.getMyBadges().then((res: any) => {
        if (res.code === 0 && res.data) {
          const state = get();
          const newBadge = calcBadge(res.data.unreadMap, res.data.newTicketIds, state.myTicketIds, state.bbsUnreadMap);
          set({
            unreadMap: res.data.unreadMap,
            newTicketIds: res.data.newTicketIds,
            profileBadge: newBadge,
          });
          startTitleFlash(newBadge);
        }
      }).catch(console.error);
    });

    socket.on('disconnect', async (reason) => {
      console.log('[GlobalSocket] 已断开:', reason);
      set({ connected: false });
      
      // 当服务端因 token 过期等原因断开连接时，尝试刷新 token 并重连
      if (reason === 'io server disconnect') {
        try {
          const res: any = await authAPI.refresh();
          if (res.code === 0 && res.data?.accessToken) {
            localStorage.setItem('accessToken', res.data.accessToken);
            // 使用新 token 注入并建立全新的连接
            get().connect(res.data.accessToken);
          }
        } catch (e) {
          console.error('[GlobalSocket] 自动重连令牌续期失败', e);
        }
      }
    });

    socket.on('reconnect', (attempt: number) => {
      console.log('[GlobalSocket] 重连成功, 第', attempt, '次尝试');
      set({ connected: true });
    });

    // ── 新消息：追踪未读数，在 store 内同步更新 profileBadge ──────────────
    socket.on('ticketNewMessage', (data: { ticketId: number; senderId: number | null; messageId: number }) => {
      const state = get();
      const currentUserId = useAuthStore.getState().user?.id;

      // 自己发的消息 / 正在查看的工单 → 不累加
      if (data.senderId === currentUserId) return;
      // 额外保险校验：如果这不是属于我监控范围的工单，屏蔽
      if (!state.myTicketIds.includes(data.ticketId)) return;

      // 判断如果当前正在查看这个工单页面，立刻给后端发回执，强制已读，消灭别的端红点
      if (data.ticketId === state.currentTicketId) {
        ticketsAPI.readTicket(data.ticketId).catch(() => {});
        return;
      }

      const newMap = {
        ...state.unreadMap,
        [data.ticketId]: (state.unreadMap[data.ticketId] || 0) + 1,
      };
      const newBadge = calcBadge(newMap, state.newTicketIds, state.myTicketIds, state.bbsUnreadMap);
      set({
        unreadMap: newMap,
        profileBadge: newBadge,
      });

      // 🔔 播放提示音 + 标题闪烁
      playDing();
      startTitleFlash(newBadge);
    });

    // ── 多端同步：只要任何一端上报了已读，其他端立刻静默消除未读 ──
    socket.on('ticketReadCleared', (data: { ticketId: number }) => {
      const state = get();
      const newMap = { ...state.unreadMap };
      delete newMap[data.ticketId];
      const newIds = state.newTicketIds.filter(id => id !== data.ticketId);

      const newBadge = calcBadge(newMap, newIds, state.myTicketIds, state.bbsUnreadMap);
      set({
        unreadMap: newMap,
        newTicketIds: newIds,
        profileBadge: newBadge,
      });

      startTitleFlash(newBadge);
    });

    // ── 工单事件：追踪新分配/邀请的工单，同步更新 profileBadge ─────────────
    socket.on('ticketEvent', (event: { action: string; operatorId: number | null; data: any }) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) return;
      const t = event.data;
      if (!t) return;

      const state = get();

      // 删除事件 → 清理本地残留状态
      if (event.action === 'deleted') {
        const newMyIds = state.myTicketIds.filter(id => id !== t.id);
        const newIds = state.newTicketIds.filter(id => id !== t.id);
        const newMap = { ...state.unreadMap };
        delete newMap[t.id];
        const newBadge = calcBadge(newMap, newIds, newMyIds, state.bbsUnreadMap);
        set({
          myTicketIds: newMyIds,
          newTicketIds: newIds,
          unreadMap: newMap,
          profileBadge: newBadge,
        });
        startTitleFlash(newBadge);
        return;
      }

      // 自己触发的操作，不标记 NEW（但仍需更新 myTicketIds）
      const isSelfAction = event.operatorId === currentUserId;

      const isMyCreation = t.creatorId === currentUserId;
      const isAssignedToMe = t.assigneeId === currentUserId;
      const isParticipant = Array.isArray(t.participants) && t.participants.some((p: any) => p.id === currentUserId);

      // 更新 myTicketIds：确保自己相关工单都被追踪
      let newMyIds = state.myTicketIds;
      if ((isMyCreation || isAssignedToMe || isParticipant) && !newMyIds.includes(t.id)) {
        newMyIds = [...newMyIds, t.id];
      }

      // 仅对这些 action 标记"新到达"，且排除自己触发的操作和自己创建的工单
      const newTaskActions = ['created', 'assigned', 'participantAdded'];
      let newTicketIds = state.newTicketIds;
      if (!isSelfAction && !isMyCreation && newTaskActions.includes(event.action)
          && (isAssignedToMe || isParticipant) && !newTicketIds.includes(t.id)) {
        newTicketIds = [...newTicketIds, t.id];
      }

      const newBadge = calcBadge(state.unreadMap, newTicketIds, newMyIds, state.bbsUnreadMap);
      set({
        myTicketIds: newMyIds,
        newTicketIds,
        profileBadge: newBadge,
      });

      // 🔔 新工单到达时播放双响提示音 + 标题闪烁
      if (newTicketIds.length > state.newTicketIds.length) {
        playAlert();
        startTitleFlash(newBadge);
      }
    });

    // ── BBS通知：追踪论坛订阅未读数 ──────────────
    socket.on('bbsNewNotification', (data: { postId: number; unreadCount: number }) => {
      const state = get();
      
      // 如果当前正在查看这个帖子详情页，立刻进行后台清除操作
      if (data.postId === state.currentBbsId) {
        bbsAPI.clearUnread(data.postId).catch(() => {});
        return;
      }

      const newMap = {
        ...state.bbsUnreadMap,
        [data.postId]: data.unreadCount,
      };
      
      const newBadge = calcBadge(state.unreadMap, state.newTicketIds, state.myTicketIds, newMap);
      set({
        bbsUnreadMap: newMap,
        profileBadge: newBadge,
      });

      playDing();
      startTitleFlash(newBadge);
    });

    socket.on('bbsBadeRead', (data: { postId: number }) => {
      const state = get();
      const newMap = { ...state.bbsUnreadMap };
      delete newMap[data.postId];

      const newBadge = calcBadge(state.unreadMap, state.newTicketIds, state.myTicketIds, newMap);
      set({
        bbsUnreadMap: newMap,
        profileBadge: newBadge,
      });

      startTitleFlash(newBadge);
    });

    // ── 权限变更通知 ──────────────────────────────────────────────────────
    socket.on('permissionsUpdated', () => {
      console.log('[GlobalSocket] 收到权限变更通知，正在刷新用户权限...');
      authAPI.getMe()
        .then((res: any) => {
          if (res.code === 0) {
            const token = localStorage.getItem('accessToken');
            if (token) {
              useAuthStore.getState().setAuth(res.data, token);
              console.log('[GlobalSocket] 权限已实时更新');
            }
          }
        })
        .catch(() => {});
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, connected: false, unreadMap: {}, newTicketIds: [], myTicketIds: [], profileBadge: 0 });
      stopTitleFlash();
    }
  },

  setCurrentTicket: (ticketId: number | null) => {
    set({ currentTicketId: ticketId });
  },

  // Profile 页面加载数据后调用，告知 store 哪些 ticketId 属于"我的"
  setMyTicketIds: (ids: number[]) => {
    const state = get();
    const newBadge = calcBadge(state.unreadMap, state.newTicketIds, ids, state.bbsUnreadMap);
    set({
      myTicketIds: ids,
      profileBadge: newBadge,
    });
    startTitleFlash(newBadge);
  },

  // 进入工单详情时调用：清除该工单未读数，同步 profileBadge & 上报服务器
  clearUnread: (ticketId: number) => {
    // 异步清除远端未读指针
    ticketsAPI.readTicket(ticketId).catch(() => {});
    
    // (由于我们在本地已经发起了请求，其实也可以等 WebSocket 推送 ticketReadCleared 事件回来再清。
    //  但为了 UI 的即时响应，这里可以先做 optimistic update 乐观更新本地状态)
    const state = get();
    const newMap = { ...state.unreadMap };
    delete newMap[ticketId];
    
    // 一并把 NEW 角标清空
    const newIds = state.newTicketIds.filter((id) => id !== ticketId);

    const newBadge = calcBadge(newMap, newIds, state.myTicketIds, state.bbsUnreadMap);
    set({
      unreadMap: newMap,
      newTicketIds: newIds,
      profileBadge: newBadge,
    });
    startTitleFlash(newBadge);
  },

  // 切换 tab / 进入工单时调用：清除该工单"NEW"标记，同步 profileBadge
  clearNewTicket: (ticketId: number) => {
    const state = get();
    if (!state.newTicketIds.includes(ticketId)) return;
    const newIds = state.newTicketIds.filter((id) => id !== ticketId);
    const newBadge = calcBadge(state.unreadMap, newIds, state.myTicketIds, state.bbsUnreadMap);
    set({
      newTicketIds: newIds,
      profileBadge: newBadge,
    });
    startTitleFlash(newBadge);
  },

  clearAllNewTickets: () => {
    const state = get();
    const newBadge = calcBadge(state.unreadMap, [], state.myTicketIds, state.bbsUnreadMap);
    set({
      newTicketIds: [],
      profileBadge: newBadge,
    });
    startTitleFlash(newBadge);
  },

  setCurrentBbs: (postId: number | null) => {
    set({ currentBbsId: postId });
    if (postId !== null) {
      get().clearBbsUnread(postId);
    }
  },

  clearBbsUnread: (postId: number) => {
    const state = get();
    if (state.bbsUnreadMap[postId]) {
      const newMap = { ...state.bbsUnreadMap };
      delete newMap[postId];
      bbsAPI.clearUnread(postId).catch(() => {});
      const newBadge = calcBadge(state.unreadMap, state.newTicketIds, state.myTicketIds, newMap);
      set({
        bbsUnreadMap: newMap,
        profileBadge: newBadge,
      });
      startTitleFlash(newBadge);
    }
  },

  fetchBbsUnread: () => {
    import('../services/api').then(({ bbsAPI }) => {
      bbsAPI.getNotifications().then((res: any) => {
        if (Array.isArray(res)) {
          const newMap: Record<number, number> = {};
          res.forEach(item => {
            newMap[item.postId] = item.unreadCount;
          });
          const state = get();
          const newBadge = calcBadge(state.unreadMap, state.newTicketIds, state.myTicketIds, newMap);
          set({
            bbsUnreadMap: newMap,
            profileBadge: newBadge,
          });
          startTitleFlash(newBadge);
        }
      }).catch(() => {});
    });
  },
}));
