/**
 * Tests for ChatService — socket.io WebSocket service.
 *
 * Strategy: mock `socket.io-client` so no real connections are made.
 * We capture event handlers registered via `socket.on(...)` and invoke
 * them manually to verify callbacks propagate correctly.
 */

// ---------- Mocks ----------

const mockEmit = jest.fn();
const mockDisconnect = jest.fn();
const mockOn = jest.fn();
const mockRemoveAllListeners = jest.fn();

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: mockOn,
    emit: mockEmit,
    disconnect: mockDisconnect,
    removeAllListeners: mockRemoveAllListeners,
  })),
}));

jest.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: jest.fn(() => ({ token: 'test-token-123' })),
  },
}));

jest.mock('../../constants/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api',
}));

// ---------- Imports (after mocks) ----------

import { io } from 'socket.io-client';
import { chatService } from '../chat';
import type { ChatMessage } from '../../types/chat';
import { useAuthStore } from '../../store/useAuthStore';

// ---------- Helpers ----------

/** Resolve a registered handler by event name from mockOn calls. */
function getHandler(eventName: string): ((...args: unknown[]) => void) | undefined {
  const call = mockOn.mock.calls.find(
    (c: unknown[]) => c[0] === eventName,
  );
  return call ? (call[1] as (...args: unknown[]) => void) : undefined;
}

const makeChatMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 1,
  content: 'hello',
  type: 'text',
  createdAt: '2026-01-01T00:00:00Z',
  sender: { id: 10, username: 'alice' },
  ...overrides,
});

// ---------- Tests ----------

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the service's internal state by disconnecting
  chatService.disconnect();
});

describe('ChatService', () => {
  describe('connect', () => {
    it('should create a socket connection with correct URL and auth', () => {
      chatService.connect(42);

      expect(io).toHaveBeenCalledWith('http://localhost:3000/chat', {
        auth: { token: 'test-token-123' },
        transports: ['websocket'],
        reconnection: false,
      });
    });

    it('should not connect when no token is available', () => {
      (useAuthStore.getState as jest.Mock).mockReturnValueOnce({ token: null });

      chatService.connect(42);

      expect(io).not.toHaveBeenCalled();
    });

    it('should disconnect existing socket before reconnecting', () => {
      chatService.connect(1);
      const firstDisconnect = mockDisconnect;

      chatService.connect(2);

      // The first socket should have been disconnected
      expect(firstDisconnect).toHaveBeenCalled();
    });

    it('should emit joinRoom on connect event', () => {
      chatService.connect(42);

      const connectHandler = getHandler('connect');
      expect(connectHandler).toBeDefined();
      connectHandler!();

      expect(mockEmit).toHaveBeenCalledWith('joinRoom', { ticketId: 42 });
    });
  });

  describe('event callbacks', () => {
    it('should invoke messageHistory callback with array payload', () => {
      const callback = jest.fn();
      chatService.onMessageHistory(callback);
      chatService.connect(1);

      const handler = getHandler('messageHistory');
      const messages = [makeChatMessage()];
      handler!(messages);

      expect(callback).toHaveBeenCalledWith(messages);
    });

    it('should invoke messageHistory callback with { items } payload', () => {
      const callback = jest.fn();
      chatService.onMessageHistory(callback);
      chatService.connect(1);

      const handler = getHandler('messageHistory');
      const messages = [makeChatMessage({ id: 2 })];
      handler!({ items: messages });

      expect(callback).toHaveBeenCalledWith(messages);
    });

    it('should invoke newMessage callback', () => {
      const callback = jest.fn();
      chatService.onNewMessage(callback);
      chatService.connect(1);

      const handler = getHandler('newMessage');
      const msg = makeChatMessage();
      handler!(msg);

      expect(callback).toHaveBeenCalledWith(msg);
    });

    it('should invoke messageRecalled callback', () => {
      const callback = jest.fn();
      chatService.onMessageRecalled(callback);
      chatService.connect(1);

      const handler = getHandler('messageRecalled');
      handler!({ messageId: 5, ticketId: 1 });

      expect(callback).toHaveBeenCalledWith({ messageId: 5, ticketId: 1 });
    });

    it('should invoke recallError callback', () => {
      const callback = jest.fn();
      chatService.onRecallError(callback);
      chatService.connect(1);

      const handler = getHandler('recallError');
      handler!({ message: '超时' });

      expect(callback).toHaveBeenCalledWith({ message: '超时' });
    });

    it('should not throw when callback is not set', () => {
      chatService.connect(1);

      const handler = getHandler('newMessage');
      expect(() => handler!(makeChatMessage())).not.toThrow();
    });
  });

  describe('sendMessage', () => {
    it('should emit sendMessage with correct payload', () => {
      chatService.connect(42);

      chatService.sendMessage('hello', 'text');

      expect(mockEmit).toHaveBeenCalledWith('sendMessage', {
        ticketId: 42,
        content: 'hello',
        type: 'text',
        fileUrl: undefined,
        fileName: undefined,
        fileSize: undefined,
      });
    });

    it('should emit sendMessage with file info', () => {
      chatService.connect(42);

      chatService.sendMessage('doc.pdf', 'file', '/files/doc.pdf', 'doc.pdf', 1024);

      expect(mockEmit).toHaveBeenCalledWith('sendMessage', {
        ticketId: 42,
        content: 'doc.pdf',
        type: 'file',
        fileUrl: '/files/doc.pdf',
        fileName: 'doc.pdf',
        fileSize: 1024,
      });
    });

    it('should not emit when not connected', () => {
      // Ensure fully disconnected (disconnect in beforeEach may leave leaveRoom calls)
      mockEmit.mockClear();

      chatService.sendMessage('hello', 'text');

      expect(mockEmit).not.toHaveBeenCalledWith('sendMessage', expect.anything());
    });
  });

  describe('recallMessage', () => {
    it('should emit recallMessage with correct payload', () => {
      chatService.connect(42);

      chatService.recallMessage(99);

      expect(mockEmit).toHaveBeenCalledWith('recallMessage', {
        ticketId: 42,
        messageId: 99,
      });
    });

    it('should not emit when not connected', () => {
      mockEmit.mockClear();

      chatService.recallMessage(99);

      expect(mockEmit).not.toHaveBeenCalledWith('recallMessage', expect.anything());
    });
  });

  describe('disconnect', () => {
    it('should emit leaveRoom and disconnect socket', () => {
      chatService.connect(42);

      chatService.disconnect();

      expect(mockEmit).toHaveBeenCalledWith('leaveRoom', { ticketId: 42 });
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should be safe to call when already disconnected', () => {
      expect(() => chatService.disconnect()).not.toThrow();
    });
  });
});
