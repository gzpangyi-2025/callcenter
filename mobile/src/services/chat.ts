import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../constants/config';
import { useAuthStore } from '../store/useAuthStore';
import { logger } from '../utils/logger';
import type {
  ChatMessage,
  ChatMessageType,
  MessageHistoryPayload,
  MessageRecalledPayload,
  RecallErrorPayload,
} from '../types/chat';

export type { ChatMessage, ChatMessageType };

// Extract base URL from API_BASE_URL (remove /api)
const SOCKET_URL = API_BASE_URL.replace(/\/api$/, '');

/** Maximum reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;
/** Initial delay between reconnection attempts (ms). Doubles on each retry. */
const BASE_RECONNECT_DELAY_MS = 1000;

class ChatService {
  private socket: Socket | null = null;
  private currentTicketId: number | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;

  private messageHistoryCallback: ((messages: ChatMessage[]) => void) | null = null;
  private newMessageCallback: ((message: ChatMessage) => void) | null = null;
  private messageRecalledCallback: ((data: MessageRecalledPayload) => void) | null = null;
  private recallErrorCallback: ((data: RecallErrorPayload) => void) | null = null;
  private socketChangeCallback: ((socket: Socket | null) => void) | null = null;

  getSocket(): Socket | null {
    return this.socket;
  }

  onSocketChange(callback: (socket: Socket | null) => void) {
    this.socketChangeCallback = callback;
  }

  connect(ticketId: number) {
    if (this.socket) {
      this.disconnect();
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      logger.error('ChatService: No auth token found');
      return;
    }

    this.currentTicketId = ticketId;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    this.createSocket(ticketId, token);
  }

  private createSocket(ticketId: number, token: string) {
    this.socket = io(`${SOCKET_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    if (this.socketChangeCallback) {
      this.socketChangeCallback(this.socket);
    }

    this.socket.on('connect', () => {
      logger.info('WebSocket connected');
      this.reconnectAttempts = 0;
      this.socket?.emit('joinRoom', { ticketId });
    });

    this.socket.on('disconnect', (reason: string) => {
      logger.info('WebSocket disconnected, reason:', reason);

      if (!this.intentionalDisconnect && this.currentTicketId !== null) {
        this.scheduleReconnect();
      }
    });

    this.socket.on('connect_error', (err: Error) => {
      logger.error('WebSocket connect_error:', err.message);

      if (!this.intentionalDisconnect && this.currentTicketId !== null) {
        this.scheduleReconnect();
      }
    });

    this.socket.on('error', (err: unknown) => {
      logger.error('WebSocket error:', err);
    });

    this.socket.on('messageHistory', (payload: MessageHistoryPayload) => {
      const messages = Array.isArray(payload) ? payload : (payload.items || []);
      if (this.messageHistoryCallback) {
        this.messageHistoryCallback(messages);
      }
    });

    this.socket.on('newMessage', (message: ChatMessage) => {
      if (this.newMessageCallback) {
        this.newMessageCallback(message);
      }
    });

    this.socket.on('messageRecalled', (data: MessageRecalledPayload) => {
      if (this.messageRecalledCallback) {
        this.messageRecalledCallback(data);
      }
    });

    this.socket.on('recallError', (data: RecallErrorPayload) => {
      if (this.recallErrorCallback) {
        this.recallErrorCallback(data);
      }
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Delay: 1s, 2s, 4s, 8s, 16s — then gives up.
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn(`ChatService: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up.`);
      return;
    }

    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.info(`ChatService: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (this.intentionalDisconnect || this.currentTicketId === null) {
        return;
      }

      // Clean up old socket without triggering disconnect logic
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        if (this.socketChangeCallback) {
          this.socketChangeCallback(null);
        }
      }

      const token = useAuthStore.getState().token;
      if (!token) {
        logger.error('ChatService: No auth token for reconnect');
        return;
      }

      this.createSocket(this.currentTicketId!, token);
    }, delay);
  }

  disconnect() {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      if (this.currentTicketId) {
        this.socket.emit('leaveRoom', { ticketId: this.currentTicketId });
      }
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      if (this.socketChangeCallback) {
        this.socketChangeCallback(null);
      }
      this.currentTicketId = null;
    }

    this.reconnectAttempts = 0;
  }

  sendMessage(
    content: string, 
    type: ChatMessageType = 'text',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number
  ) {
    if (!this.socket || !this.currentTicketId) return;
    
    this.socket.emit('sendMessage', {
      ticketId: this.currentTicketId,
      content,
      type,
      fileUrl,
      fileName,
      fileSize
    });
  }

  recallMessage(messageId: number) {
    if (!this.socket || !this.currentTicketId) return;
    this.socket.emit('recallMessage', {
      ticketId: this.currentTicketId,
      messageId,
    });
  }

  onMessageHistory(callback: (messages: ChatMessage[]) => void) {
    this.messageHistoryCallback = callback;
  }

  onNewMessage(callback: (message: ChatMessage) => void) {
    this.newMessageCallback = callback;
  }

  onMessageRecalled(callback: (data: MessageRecalledPayload) => void) {
    this.messageRecalledCallback = callback;
  }

  onRecallError(callback: (data: RecallErrorPayload) => void) {
    this.recallErrorCallback = callback;
  }
}

export const chatService = new ChatService();
