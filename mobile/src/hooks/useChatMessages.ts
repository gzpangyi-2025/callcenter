import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList } from 'react-native';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

import { chatService, ChatMessage } from '../services/chat';
import { ticketsService, TicketItem } from '../services/tickets';
import { useAuthStore } from '../store/useAuthStore';
import { logger } from '../utils/logger';

export interface UseChatMessagesReturn {
  ticket: TicketItem | null;
  loading: boolean;
  messages: ChatMessage[];
  showScrollButton: boolean;
  flatListRef: React.RefObject<FlatList | null>;
  scrollToBottom: () => void;
  handleScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  sendTextMessage: (text: string) => void;
  recallMessage: (item: ChatMessage) => void;
}

export function useChatMessages(ticketId: number): UseChatMessagesReturn {
  const [ticket, setTicket] = useState<TicketItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (flatListRef.current) {
        flatListRef.current.scrollToEnd({ animated: true });
      }
    }, 100);
  }, []);

  const loadTicket = useCallback(async () => {
    try {
      const data = await ticketsService.getTicketById(ticketId);
      setTicket(data);
    } catch (error) {
      logger.error('Failed to load ticket details:', error);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();

    chatService.onMessageHistory((history) => {
      setMessages(history);
      scrollToBottom();
    });

    chatService.onNewMessage((msg) => {
      setMessages((prev) => [...prev, msg]);
      if (isAtBottomRef.current || msg.sender.id === useAuthStore.getState().user?.id) {
        scrollToBottom();
      }
    });

    chatService.onMessageRecalled((data) => {
      setMessages((prev) => prev.map(m => m.id === data.messageId ? { ...m, isRecalled: true } : m));
    });

    chatService.onRecallError((data) => {
      Alert.alert('撤回失败', data.message);
    });

    chatService.connect(ticketId);

    return () => {
      chatService.disconnect();
    };
  }, [ticketId, loadTicket, scrollToBottom]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    isAtBottomRef.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    chatService.sendMessage(trimmed, 'text');
  }, []);

  const recallMessage = useCallback((item: ChatMessage) => {
    Alert.alert('撤回消息', '确定要撤回这条消息吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: () => chatService.recallMessage(item.id),
      },
    ]);
  }, []);

  return {
    ticket,
    loading,
    messages,
    showScrollButton,
    flatListRef,
    scrollToBottom,
    handleScroll,
    sendTextMessage,
    recallMessage,
  };
}
