import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge, Drawer, Spin, message, Modal } from 'antd';
import { LockOutlined, DownOutlined } from '@ant-design/icons';
import ScreenSharePanel from '../../components/ScreenSharePanel';
import VoiceBar from '../../components/VoiceBar';
import ScreenshotContainer from '../../components/ScreenshotContainer';
import ChatMessageList from './ChatMessageList';
import ChatInputBar from './ChatInputBar';
import ChatHeader from './ChatHeader';
import { TicketProvider } from './TicketContext';
import TicketSidebar from './TicketSidebar';
import TicketModals from './TicketModals';
import api, { filesAPI, ticketsAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { useScreenShare } from '../../hooks/useScreenShare';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import type { Ticket } from '../../types/ticket';



const statusDotColor: Record<string, string> = {
  pending: '#f59e0b',
  in_progress: '#3b82f6',
  closing: '#f97316',
  closed: '#10b981',
};

const TicketDetail: React.FC<{ externalTicketId?: string }> = ({ externalTicketId }) => {
  const params = useParams();
  const id = externalTicketId || params.id;
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [roomUsers, setRoomUsers] = useState<any[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);

  // 房间锁定状态
  const [isRoomLocked, setIsRoomLocked] = useState(false);
  const [isExternalDisabled, setIsExternalDisabled] = useState(false);
  const [exportingChat, setExportingChat] = useState(false);
  const [serviceDuration, setServiceDuration] = useState('');
  const [isExternalKicked, setIsExternalKicked] = useState(false);
  
  // 回车按键习惯设置：true = 回车换行 (Ctrl+Enter 发送), false = 回车发送 (Shift/Ctrl+Enter 换行)
  const [enterToNewline, setEnterToNewline] = useState<boolean>(() => localStorage.getItem('enterToNewline') === 'true');

  // Modal 控制状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [knowledgeModalOpen, setKnowledgeModalOpen] = useState(false);
  const [lockDisableExternal, setLockDisableExternal] = useState(false);
  
  // AI 草稿状态
  const [draftKnowledge, setDraftKnowledge] = useState<any>(null);
  const [draftContent, setDraftContent] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const { user } = useAuthStore();
  const { socket, unreadMap, setCurrentTicket, clearUnread } = useSocketStore();
  const canInvite = ticket && user && (ticket.creatorId === user.id || ticket.assigneeId === user.id || user.role?.name === 'admin');

  // 屏幕共享
  const screenShare = useScreenShare(socket, id ? Number(id) : null, user?.id ?? null);
  // 语音通话
  const voiceChat = useVoiceChat(socket, id ? Number(id) : null, user?.id ?? null);
  const [supportMode, setSupportMode] = useState(false);
  const [videoPanelWidth, setVideoPanelWidth] = useState(70); // 支援模式下视频占比 %
  const isDraggingDivider = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 支援模式拖拽分割线
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingDivider.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setVideoPanelWidth(Math.min(85, Math.max(40, pct)));
    };

    const handleMouseUp = () => {
      isDraggingDivider.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // 屏幕共享结束时自动退出支援模式
  useEffect(() => {
    if (!screenShare.isSharing && !screenShare.isViewing && supportMode) {
      setSupportMode(false);
    }
  }, [screenShare.isSharing, screenShare.isViewing, supportMode]);

  // 历史消息上下拉翻页状态
  const [, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [initialChatLoading, setInitialChatLoading] = useState(true);
  const isLoadingHistoryRef = useRef(false);
  const previousScrollHeight = useRef(0);

  // 智能追踪：用户是否在底部 & 未读新消息计数
  const isUserAtBottomRef = useRef(true);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // 底部判断（50px 容差）
  const checkIsNearBottom = (el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  // 聊天容器滚动事件
  const handleChatScroll = useCallback(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    const atBottom = checkIsNearBottom(el);
    isUserAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    // 用户手动滚到底部时，清除未读计数
    if (atBottom && newMsgCount > 0) {
      setNewMsgCount(0);
    }
  }, [newMsgCount]);

  // 一键回到底部
  const scrollToBottom = useCallback(() => {
    const el = chatMessagesRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    isUserAtBottomRef.current = true;
    setIsAtBottom(true);
    setNewMsgCount(0);
  }, []);


  // 负责加载工单详情（包括 participants）
  const loadTicket = useCallback(async () => {
    try {
      const res: any = await ticketsAPI.getById(Number(id));
      if (res.code === 0) setTicket(res.data);
    } catch {
      message.error('加载工单失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // 负责加载侧边栏个人活跃工单Tab
  const loadMyTickets = useCallback(async () => {
    if (!user) return;
    try {
      const [createdRes, assignedRes, participatedRes] = await Promise.all([
        ticketsAPI.myCreated(),
        ticketsAPI.myAssigned(),
        ticketsAPI.myParticipated(),
      ]);
      let items: any[] = [];
      if ((createdRes as any).code === 0) items = items.concat((createdRes as any).data || []);
      if ((assignedRes as any).code === 0) items = items.concat((assignedRes as any).data || []);
      if ((participatedRes as any).code === 0) items = items.concat((participatedRes as any).data || []);
      
      const uniqueItems = Array.from(new Map(items.map(item => [item.id, item])).values());
      const activeItems = uniqueItems.filter((t: any) => t.status !== 'closed');
      setMyTickets(activeItems);
    } catch { /* ignore */ }
  }, [user]);

  // 应同式检测
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 标记当前正在查看的工单 + 清除未读
  useEffect(() => {
    const ticketId = Number(id);
    setCurrentTicket(ticketId);
    clearUnread(ticketId);
    // 切换工单时重置状态
    setLoading(true);
    setMessages([]);
    setHistoryPage(1);
    setHasMoreHistory(true);
    setInitialChatLoading(true);
    isLoadingHistoryRef.current = false;
    return () => setCurrentTicket(null);
  }, [id]);

  // 加载工单详情
  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  // 加载"我的活跃工单"用于标签页
  useEffect(() => {
    loadMyTickets();
  }, [loadMyTickets]);

  // 消息状态或房间锁定状态变化时的滚动逻辑
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        const el = chatMessagesRef.current;
        if (!el) return;

        if (isLoadingHistoryRef.current) {
          // 是拉取历史记录导致的 messages 变化：高度补偿，维持视觉位置不变
          const newScrollHeight = el.scrollHeight;
          const diff = newScrollHeight - previousScrollHeight.current;
          el.scrollTo({ top: el.scrollTop + diff, behavior: 'instant' });
          isLoadingHistoryRef.current = false;
        } else if (isUserAtBottomRef.current) {
          // 用户正在底部 → 自动追踪新消息
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
          // 用户在上方阅读历史 → 不打断，仅累加计数
          setNewMsgCount(prev => prev + 1);
        }
      }, 50);
    }
  }, [messages.length, isRoomLocked]);

  // 全局 Socket 事件监听
  useEffect(() => {
    if (!socket || !id) return;
    const ticketId = Number(id);

    socket.emit('joinRoom', { ticketId });

    const handleHistory = (data: any) => {
      setMessages(data.items || []);
      setHasMoreHistory((data.items || []).length === 200); // 假设后端 pageSize=200
      setInitialChatLoading(false);
    };
    const handleMoreHistoryLoaded = (data: any) => {
      setLoadingHistory(false);
      const items = data.items || [];
      if (items.length > 0) {
        setMessages((prev) => [...items, ...prev]);
        setHasMoreHistory(items.length === 200);
      } else {
        setHasMoreHistory(false);
        isLoadingHistoryRef.current = false;
      }
    };
    const handleNewMessage = (msg: any) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    const handleRoomUsers = (data: any) => {
      if (data.room === `ticket_${ticketId}`) {
        setRoomUsers(data.users || []);
      }
    };
    const handleTicketEvent = (event: any) => {
      if (event.data?.id === ticketId) {
        // 收到当前工单的更新事件后，重新从服务器加载完整数据（包含 participants）
        loadTicket();
      }
      loadMyTickets();
    };

    // 如果 Socket 发生断线重连，服务器会视其为全新连接，丢失原本的 Room 状态。
    // 因此前端必须在每次重新连上底层的 connect 事件中，自动重新发送 joinRoom 请求。
    const handleReconnectJoin = () => {
      socket.emit('joinRoom', { ticketId });
    };

    // 消息撤回事件
    const handleMessageRecalled = (data: { messageId: number }) => {
      setMessages((prev) => prev.map((m) =>
        m.id === data.messageId
          ? { ...m, isRecalled: true, content: '该消息已被撤回', type: 'text', fileUrl: null, fileName: null, fileSize: null }
          : m
      ));
    };
    const handleRecallError = (data: { message: string }) => {
      message.error(data.message || '撤回失败');
    };

    socket.on('connect', handleReconnectJoin);
    socket.on('messageHistory', handleHistory);
    socket.on('moreHistoryLoaded', handleMoreHistoryLoaded);
    socket.on('newMessage', handleNewMessage);
    socket.on('ticketEvent', handleTicketEvent);
    socket.on('roomUsers', handleRoomUsers);
    socket.on('messageRecalled', handleMessageRecalled);
    socket.on('recallError', handleRecallError);

    // 房间锁定事件
    const handleRoomLockChanged = (data: any) => {
      if (data.ticketId === ticketId) {
        setIsRoomLocked(data.locked);
        setIsExternalDisabled(data.externalDisabled);
      }
    };
    const handleRoomLockedKick = (data: any) => {
      if (data.ticketId === ticketId) {
        if (externalTicketId) {
          setIsExternalKicked(true);
        } else {
          message.warning(data.message || '房间已被锁定，您已被移出');
          navigate('/tickets');
        }
      }
    };
    const handleRoomKicked = (data: any) => {
      if (data.ticketId === ticketId) {
        if (externalTicketId) {
          setIsExternalKicked(true);
        } else {
          Modal.error({ title: '系统通知', content: data.message || '您已被移出工单聊天室' });
          navigate('/tickets');
        }
      }
    };

    socket.on('roomLockChanged', handleRoomLockChanged);
    socket.on('roomLocked', handleRoomLockedKick);
    socket.on('roomKicked', handleRoomKicked);

    return () => {
      socket.emit('leaveRoom', { ticketId });
      socket.off('connect', handleReconnectJoin);
      socket.off('messageHistory', handleHistory);
      socket.off('moreHistoryLoaded', handleMoreHistoryLoaded);
      socket.off('newMessage', handleNewMessage);
      socket.off('ticketEvent', handleTicketEvent);
      socket.off('roomUsers', handleRoomUsers);
      socket.off('messageRecalled', handleMessageRecalled);
      socket.off('recallError', handleRecallError);
      socket.off('roomLockChanged', handleRoomLockChanged);
      socket.off('roomLocked', handleRoomLockedKick);
      socket.off('roomKicked', handleRoomKicked);
    };
  }, [socket, id, loadTicket, loadMyTickets]);


  // 实时服务时长计时器
  useEffect(() => {
    if (!ticket?.assignedAt || ticket?.closedAt) {
      setServiceDuration('');
      return;
    }
    const calcDuration = () => {
      const start = new Date(ticket.assignedAt as string).getTime();
      const now = Date.now();
      const diff = Math.max(0, now - start);
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      if (days > 0) {
        setServiceDuration(`${days}天 ${hours}小时 ${mins}分`);
      } else if (hours > 0) {
        setServiceDuration(`${hours}小时 ${mins}分 ${secs}秒`);
      } else {
        setServiceDuration(`${mins}分 ${secs}秒`);
      }
    };
    calcDuration();
    const timer = setInterval(calcDuration, 1000);
    return () => clearInterval(timer);
  }, [ticket?.assignedAt, ticket?.closedAt]);




  // ==================== 消息撤回 ====================
  const handleRecall = (msgId: number) => {
    if (!socket) return;
    socket.emit('recallMessage', { messageId: msgId, ticketId: Number(id) });
  };

  // ==================== 消息操作 ====================
  const sendMessage = async () => {
    if ((!inputValue.trim() && pendingFiles.length === 0) || !socket) return;

    // 先上传并发送待发文件
    if (pendingFiles.length > 0) {
      for (const file of pendingFiles) {
        await handleFileUpload(file);
      }
      setPendingFiles([]);
    }

    // 再发送文字消息
    if (inputValue.trim()) {
      socket.emit('sendMessage', {
        ticketId: Number(id),
        content: inputValue.trim(),
        type: 'text',
      });
      setInputValue('');
    }
    // 自己发消息后无条件回到底部
    isUserAtBottomRef.current = true;
    setIsAtBottom(true);
    setNewMsgCount(0);
    if (isMobile && textareaRef.current) textareaRef.current.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 输入法正在组字时（如拼音选字），不触发发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (enterToNewline) {
      // 回车换行模式：
      // 只有组合键 Ctrl+Enter 或 Meta+Enter 才触发发送
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendMessage();
      }
      // 此模式下，单按 Enter 会走浏览器原生默认行为，也就是换行
    } else {
      // 回车发送模式（系统原来的默认模式）：
      if (e.key === 'Enter') {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // 有组合键时，仅作为换行，不发送
          return;
        }
        // 单纯的 Enter，阻止换行默认行为，直接发送
        e.preventDefault();
        sendMessage();
      }
    }
  };

  // 粘贴图片/文件 → 加入待发队列，等待用户确认发送
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const ext = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const namedFile = new File([file], `截图_${timestamp}.${ext}`, { type: file.type });
          setPendingFiles(prev => [...prev, namedFile]);
        }
        return;
      }
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setPendingFiles(prev => [...prev, file]);
        return;
      }
    }

  };




  const handleFileUpload = async (file: File) => {
    setUploading(true);
    const hide = message.loading(`正在上传 ${file.name}...`, 0);
    try {
      const res: any = await filesAPI.upload(file);
      hide();
      if (res.code === 0 && socket) {
        const isImage = file.type.startsWith('image/');
        socket.emit('sendMessage', {
          ticketId: Number(id),
          content: isImage ? `![${file.name}](${res.data.url})` : file.name,
          type: isImage ? 'image' : 'file',
          fileUrl: res.data.url,
          fileName: file.name,
          fileSize: file.size,
        });
        message.success(`${file.name} 上传成功`);
      }
    } catch {
      hide();
      message.error('文件上传失败，请检查文件大小（限50MB）');
    } finally {
      setUploading(false);
    }
  };



  if (isExternalKicked) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, background: 'var(--bg-primary)' }}>
        <LockOutlined style={{ fontSize: 64, color: '#ef4444', marginBottom: 24 }} />
        <h2 style={{ color: 'var(--text-primary)' }}>外链访问已暂停</h2>
        <p style={{ color: 'var(--text-secondary)' }}>该工单的专属外链目前已被关闭。如需继续服务，请联系技术人员重新分享链接。</p>
      </div>
    );
  }

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!ticket) return <div>工单不存在</div>;

  const currentTicketId = Number(id);

  // ==================== 标签栏 ====================
  const tabsBar = !externalTicketId && myTickets.length > 0 && (
    <div className="ticket-tabs-bar">
      {myTickets.map((t: any) => {
        const isActive = t.id === currentTicketId;
        const unread = unreadMap[t.id] || 0;
        
        let relationType = 'participated';
        if (t.creator?.id === user?.id || t.creatorId === user?.id) {
          relationType = 'created';
        } else if (t.assignee?.id === user?.id || t.assigneeId === user?.id) {
          relationType = 'assigned';
        }

        return (
          <div
            key={t.id}
            className={`ticket-tab ${isActive ? 'active' : ''} tab-type-${relationType}`}
            onClick={() => !isActive && navigate(`/tickets/${t.id}`)}
          >
            <span
              className="tab-status-dot"
              style={{ background: statusDotColor[t.status] || '#64748b' }}
            />
            <span className="tab-title">{t.title}</span>
            {unread > 0 && (
              <Badge count={unread} size="small" style={{ boxShadow: 'none' }} />
            )}
          </div>
        );
      })}
    </div>
  );

  

  // ==================== 聊天区域 ====================

  const handleCopyMessage = (msgId: number, text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleLoadMoreHistory = () => {
    if (!socket || loadingHistory) return;
    setLoadingHistory(true);
    isLoadingHistoryRef.current = true;
    if (chatMessagesRef.current) {
      previousScrollHeight.current = chatMessagesRef.current.scrollHeight;
    }
    setHistoryPage((prev) => {
      const nextPage = prev + 1;
      socket.emit('fetchMoreHistory', { ticketId: Number(id), page: nextPage });
      return nextPage;
    });
  };

  const handleExportChat = async () => {
    if (!ticket) return;
    setExportingChat(true);
    try {
      const res = await api.get(`/tickets/${ticket.id}/export-chat-zip`, { responseType: 'blob' });
      const blob = new Blob([res as any], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ticket.ticketNo}_聊天记录.zip`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('聊天记录导出成功');
    } catch (err: any) {
    } finally {
      setExportingChat(false);
    }
  };

  const handleToggleLock = () => {
    if (isRoomLocked) {
      socket?.emit('unlockRoom', { ticketId: ticket?.id });
      setIsRoomLocked(false);
      setIsExternalDisabled(false);
      message.success('房间已解锁');
    } else {
      setLockDisableExternal(false);
      setLockModalOpen(true);
    }
  };

  const chatArea = (
    <div ref={containerRef} className={`chat-container ${supportMode ? 'support-mode' : ''}`}>
      {(screenShare.isSharing || screenShare.isViewing) && (
        <ScreenSharePanel
          remoteStream={screenShare.remoteStream}
          localStream={screenShare.localStream}
          isSharing={screenShare.isSharing}
          isViewing={screenShare.isViewing}
          sharerName={screenShare.sharerName}
          connectionState={screenShare.connectionState}
          onRetry={() => { screenShare.stopViewing(); setTimeout(() => screenShare.joinViewing(), 500); }}
          onStopSharing={() => { screenShare.stopSharing(); setSupportMode(false); }}
          onStopViewing={() => { screenShare.stopViewing(); setSupportMode(false); }}
          isMobile={isMobile}
          supportMode={supportMode}
          onToggleSupportMode={() => setSupportMode(prev => !prev)}
          style={supportMode ? { flex: 'none', width: `${videoPanelWidth}%` } : undefined}
        />
      )}
      {supportMode && (
        <div className="support-mode-divider" onMouseDown={handleDividerMouseDown} />
      )}
      <div className={`chat-content-wrapper ${supportMode ? 'support-mode-chat' : ''}`}
        style={supportMode ? { flex: 'none', width: `${100 - videoPanelWidth}%` } : undefined}>

      <ChatHeader
        ticket={ticket}
        isMobile={isMobile}
        externalTicketId={externalTicketId}
        user={user}
        socket={socket}
        id={id}
        roomUsers={roomUsers}
        canInvite={!!canInvite}
        isRoomLocked={isRoomLocked}
        isExternalDisabled={isExternalDisabled}
        exportingChat={exportingChat}
        screenShare={screenShare}
        voiceChat={voiceChat}
        onNavigateBack={() => navigate('/tickets')}
        onOpenInfoDrawer={() => setInfoDrawerOpen(true)}
        onExportChat={handleExportChat}
        onToggleLock={handleToggleLock}
        onStopSharingAndExitSupport={() => { screenShare.stopSharing(); setSupportMode(false); }}
      />

      <VoiceBar
        isInVoice={voiceChat.isInVoice}
        isMuted={voiceChat.isMuted}
        voiceParticipants={voiceChat.voiceParticipants}
        onToggleMute={voiceChat.toggleMute}
        onLeaveVoice={voiceChat.leaveVoice}
      />

      <ChatMessageList
        messages={messages}
        user={user}
        isMobile={isMobile}
        initialChatLoading={initialChatLoading}
        hasMoreHistory={hasMoreHistory}
        loadingHistory={loadingHistory}
        copiedMessageId={copiedMessageId}
        chatMessagesRef={chatMessagesRef as React.RefObject<HTMLDivElement>}
        onChatScroll={handleChatScroll}
        onLoadMoreHistory={handleLoadMoreHistory}
        onRecall={handleRecall}
        onCopyMessage={handleCopyMessage}
      />

      {!isAtBottom && (
        <div className="new-msg-fab" onClick={scrollToBottom}>
          <DownOutlined style={{ marginRight: 6 }} />
          {newMsgCount > 0 ? `${newMsgCount} 条新消息` : '回到最新'}
        </div>
      )}

      {['pending', 'in_progress', 'closing'].includes(ticket.status) && (
        <ChatInputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          pendingFiles={pendingFiles}
          setPendingFiles={setPendingFiles}
          uploading={uploading}
          isMobile={isMobile}
          enterToNewline={enterToNewline}
          setEnterToNewline={setEnterToNewline}
          textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>}
          onSendMessage={sendMessage}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
      )}
      </div>{/* end chat-content-wrapper */}
    </div>
  );

  // ==================== 渲染 ====================
  return (
    <TicketProvider value={{
    ticket, user, socket, id, externalTicketId, loadTicket, canInvite: !!canInvite, serviceDuration,
    editModalOpen, setEditModalOpen,
    inviteModalOpen, setInviteModalOpen,
    lockModalOpen, setLockModalOpen,
    knowledgeModalOpen, setKnowledgeModalOpen,
    lockDisableExternal, setLockDisableExternal,
    draftKnowledge, setDraftKnowledge,
    draftContent, setDraftContent
}}>
    <div className={`ticket-workspace ${isMobile ? 'mobile' : ''} fade-in`}>
      {tabsBar}
      <div className="ticket-main-content">
        {!isMobile && (
          <div className="ticket-sidebar"><TicketSidebar /></div>
        )}
        <div className="ticket-chat-area">{chatArea}</div>
      </div>
      {isMobile && (
        <Drawer
          title="工单详情"
          placement="right"
          open={infoDrawerOpen}
          onClose={() => setInfoDrawerOpen(false)}
          width="85vw"
          styles={{
            body: { padding: 16, background: 'var(--bg-primary)' },
            header: { background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' },
          }}
        >
          <TicketSidebar />
        </Drawer>
      )}

      <ScreenshotContainer onSendToChat={(file) => setPendingFiles(prev => [...prev, file])} isMobile={isMobile} />
      <TicketModals />
    </div>
    </TicketProvider>
  );
};

export default TicketDetail;
