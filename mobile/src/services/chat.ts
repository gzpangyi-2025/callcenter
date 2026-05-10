import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../constants/config';
import { useAuthStore } from '../store/useAuthStore';

// Extract base URL from API_BASE_URL (remove /api)
const SOCKET_URL = API_BASE_URL.replace(/\/api$/, '');

export interface ChatMessage {
  id: number;
  content: string;
  type: 'text' | 'image' | 'file';
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  isRecalled?: boolean;
  createdAt: string;
  sender: {
    id: number;
    username: string;
    realName?: string;
    displayName?: string;
  };
}

class ChatService {
  private socket: Socket | null = null;
  private currentTicketId: number | null = null;

  private messageHistoryCallback: ((messages: ChatMessage[]) => void) | null = null;
  private newMessageCallback: ((message: ChatMessage) => void) | null = null;
  private messageRecalledCallback: ((data: { messageId: number; ticketId: number }) => void) | null = null;
  private recallErrorCallback: ((data: { message: string }) => void) | null = null;

  connect(ticketId: number) {
    if (this.socket) {
      this.disconnect();
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      console.error('ChatService: No auth token found');
      return;
    }

    this.currentTicketId = ticketId;

    this.socket = io(`${SOCKET_URL}/chat`, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.socket?.emit('joinRoom', { ticketId });
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    this.socket.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    this.socket.on('messageHistory', (payload: any) => {
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

    this.socket.on('messageRecalled', (data: { messageId: number; ticketId: number }) => {
      if (this.messageRecalledCallback) {
        this.messageRecalledCallback(data);
      }
    });

    this.socket.on('recallError', (data: { message: string }) => {
      if (this.recallErrorCallback) {
        this.recallErrorCallback(data);
      }
    });
  }

  disconnect() {
    if (this.socket) {
      if (this.currentTicketId) {
        this.socket.emit('leaveRoom', { ticketId: this.currentTicketId });
      }
      this.socket.disconnect();
      this.socket = null;
      this.currentTicketId = null;
    }
  }

  sendMessage(
    content: string, 
    type: 'text' | 'image' | 'file' = 'text',
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

  onMessageRecalled(callback: (data: { messageId: number; ticketId: number }) => void) {
    this.messageRecalledCallback = callback;
  }

  onRecallError(callback: (data: { message: string }) => void) {
    this.recallErrorCallback = callback;
  }
}

export const chatService = new ChatService();
