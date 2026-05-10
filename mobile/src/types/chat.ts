/** Message types used throughout the chat system. */

export type ChatMessageType = 'text' | 'image' | 'file';

export interface ChatSender {
  id: number;
  username: string;
  realName?: string;
  displayName?: string;
}

export interface ChatMessage {
  id: number;
  content: string;
  type: ChatMessageType;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  isRecalled?: boolean;
  createdAt: string;
  sender: ChatSender;
}

export interface MessageRecalledPayload {
  messageId: number;
  ticketId: number;
}

export interface RecallErrorPayload {
  message: string;
}

/** Union type for the messageHistory socket event payload. */
export type MessageHistoryPayload = ChatMessage[] | { items: ChatMessage[] };
