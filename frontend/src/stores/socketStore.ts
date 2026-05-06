import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useAuthStore, type User } from './authStore';
import { authAPI, ticketsAPI, bbsAPI } from '../services/api';
import { calcBadge } from '../utils/badgeUtils';
import { playDing, playAlert } from '../utils/soundUtils';
import { startTitleFlash, stopTitleFlash, initVisibilityListener } from '../utils/titleFlash';

// 重新导出供外部按需使用（保持 API 兼容）
export { startTitleFlash, stopTitleFlash };

type TicketBadgePayload = {
  unreadMap?: Record<string | number, number>;
  newTicketIds?: Array<string | number>;
  ticketIds?: Array<string | number>;
};

type TicketEventPayload = {
  id: number;
  creatorId?: number | null;
  assigneeId?: number | null;
  participants?: Array<{ id: number | string }>;
};

const apiData = <T,>(res: T | { data?: T }): T => {
  if (res && typeof res === 'object' && 'data' in res) {
    return (res as { data?: T }).data as T;
  }
  return res as T;
};

const toNumberArray = (value?: Array<string | number>): number[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(Number.isFinite))];
};

const normalizeCountMap = (value?: Record<string | number, number>): Record<number, number> => {
  if (!value) return {};
  return Object.entries(value).reduce<Record<number, number>>((acc, [key, count]) => {
    const ticketId = Number(key);
    const normalizedCount = Number(count);
    if (Number.isFinite(ticketId) && normalizedCount > 0) {
      acc[ticketId] = normalizedCount;
    }
    return acc;
  }, {});
};

const socketToken = (socket: Socket | null): string | undefined => {
  const auth = socket?.auth;
  if (auth && typeof auth === 'object' && 'token' in auth) {
    return (auth as { token?: string }).token;
  }
  return undefined;
};

interface SocketState {
  socket: Socket | null;
  connected: boolean;
  unreadMap: Record<number, number>; // ticketId -> unread count
  newTicketIds: number[];            // ticketIds that are "new" for assigned/participated tabs
  myTicketIds: number[];             // all ticket IDs relevant to current user
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
    if (existing?.connected && socketToken(existing) === token) return;
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
      
      ticketsAPI.getMyBadges().then((res) => {
        const payload = apiData<TicketBadgePayload>(res);
        if (payload) {
          const state = get();
          const unreadMap = normalizeCountMap(payload.unreadMap);
          const newTicketIds = toNumberArray(payload.newTicketIds);
          const serverTicketIds = toNumberArray(payload.ticketIds);
          const myTicketIds = serverTicketIds.length > 0
            ? serverTicketIds
            : [...new Set([...state.myTicketIds, ...Object.keys(unreadMap).map(Number), ...newTicketIds])];
          const newBadge = calcBadge(unreadMap, newTicketIds, myTicketIds, state.bbsUnreadMap);
          set({
            unreadMap,
            newTicketIds,
            myTicketIds,
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
          const res = await authAPI.refresh();
          const data = apiData<{ accessToken?: string }>(res);
          if (data?.accessToken) {
            localStorage.setItem('accessToken', data.accessToken);
            // 使用新 token 注入并建立全新的连接
            get().connect(data.accessToken);
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
      const myTicketIds = state.myTicketIds.includes(data.ticketId)
        ? state.myTicketIds
        : [...state.myTicketIds, data.ticketId];

      // 判断如果当前正在查看这个工单页面，立刻给后端发回执，强制已读，消灭别的端红点
      if (data.ticketId === state.currentTicketId) {
        if (myTicketIds !== state.myTicketIds) set({ myTicketIds });
        ticketsAPI.readTicket(data.ticketId).catch(() => {});
        return;
      }

      const newMap = {
        ...state.unreadMap,
        [data.ticketId]: (state.unreadMap[data.ticketId] || 0) + 1,
      };
      const newBadge = calcBadge(newMap, state.newTicketIds, myTicketIds, state.bbsUnreadMap);
      set({
        unreadMap: newMap,
        myTicketIds,
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
    socket.on('ticketEvent', (event: { action: string; operatorId: number | null; data?: TicketEventPayload }) => {
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
      const isParticipant = Array.isArray(t.participants) && t.participants.some((p) => Number(p.id) === currentUserId);

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
        .then((res) => {
          const user = apiData<User>(res as unknown as User | { data?: User });
          if (user) {
            const token = localStorage.getItem('accessToken');
            if (token) {
              useAuthStore.getState().setAuth(user, token);
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
    }
    set({
      socket: null,
      connected: false,
      unreadMap: {},
      newTicketIds: [],
      myTicketIds: [],
      bbsUnreadMap: {},
      profileBadge: 0,
    });
    stopTitleFlash();
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
      bbsAPI.getNotifications().then((res) => {
        const notifications = apiData<Array<{ postId: number | string; unreadCount: number | string }>>(res);
        if (Array.isArray(notifications)) {
          const newMap: Record<number, number> = {};
          notifications.forEach(item => {
            newMap[Number(item.postId)] = Number(item.unreadCount) || 0;
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

// 初始化标签页可见性监听，用户回到页面时如果没有未读就停止闪烁
initVisibilityListener(() => useSocketStore.getState().profileBadge);
