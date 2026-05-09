import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiChatSession, AiTask, AiTaskFile, ApiResponse } from '../../../types/api';
import { apiOk, makeAiTask } from '../../../test-utils/fixtures';
import AiChatPanel from './AiChatPanel';

interface MockChatInputBarProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  onSendMessage: () => void;
}

const aiApiMock = vi.hoisted(() => ({
  chatSessions: vi.fn<() => Promise<ApiResponse<AiChatSession[]>>>(),
  chatSessionDetail: vi.fn<(id: string) => Promise<ApiResponse<AiChatSession & { messages?: unknown[] }>>>(),
  chatStream: vi.fn<() => Promise<Response>>(),
  getTaskFiles: vi.fn<(id: string) => Promise<ApiResponse<AiTaskFile[]>>>(),
  injectChatMessage: vi.fn<(id: string, payload: { role: 'assistant' | 'system'; content: string; metadata?: Record<string, unknown> }) => Promise<ApiResponse<unknown>>>(),
  deleteChatSession: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  aiAPI: aiApiMock,
}));

vi.mock('../../Tickets/ChatInputBar', () => ({
  default: ({ inputValue, setInputValue, onSendMessage }: MockChatInputBarProps) => (
    <div>
      <textarea
        aria-label="chat input"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
      />
      <button type="button" onClick={onSendMessage}>send chat</button>
    </div>
  ),
}));

const streamResponse = (events: string[]) => {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.close();
    },
  }), { status: 200 });
};

describe('AiChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn<() => void>();
    aiApiMock.chatSessions.mockResolvedValue(apiOk([
      { id: 's1', title: '方案讨论', userId: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]));
    aiApiMock.chatSessionDetail.mockResolvedValue(apiOk({
      id: 's1',
      title: '方案讨论',
      userId: 1,
      messages: [
        { role: 'user', content: '帮我生成 PPT' },
        { role: 'assistant', content: '可以' },
      ],
    }));
    aiApiMock.getTaskFiles.mockResolvedValue(apiOk([]));
    aiApiMock.injectChatMessage.mockResolvedValue(apiOk({
      role: 'assistant',
      content: '反馈已注入',
      metadata: { responseForTask: 'task-1' },
    }));
  });

  it('loads sessions and opens a session with its messages', async () => {
    render(<AiChatPanel />);

    fireEvent.click(await screen.findByText('方案讨论'));

    expect(await screen.findByText('帮我生成 PPT')).toBeInTheDocument();
    expect(screen.getByText('可以')).toBeInTheDocument();
    expect(aiApiMock.chatSessionDetail).toHaveBeenCalledWith('s1');
  });

  it('sends a streaming chat message and reports created tasks', async () => {
    const onTaskCreated = vi.fn<(taskId: string) => void>();
    aiApiMock.chatStream.mockResolvedValue(streamResponse([
      JSON.stringify({ sessionId: 's2', type: 'text', content: '收到，' }),
      JSON.stringify({ type: 'task_created', taskId: 'task-200' }),
      JSON.stringify({ type: 'text', content: '已创建任务。' }),
    ]));

    render(<AiChatPanel onTaskCreated={onTaskCreated} />);

    await userEvent.type(screen.getByLabelText('chat input'), '生成周报');
    fireEvent.click(screen.getByRole('button', { name: 'send chat' }));

    expect(await screen.findByText('生成周报')).toBeInTheDocument();
    expect(await screen.findByText('收到，已创建任务。')).toBeInTheDocument();
    expect(onTaskCreated).toHaveBeenCalledWith('task-200');
  });

  it('injects task feedback when a linked task completes', async () => {
    const completedTask: AiTask = makeAiTask({ id: 'task-feedback', status: 'completed' });
    aiApiMock.chatSessionDetail.mockResolvedValue(apiOk({
      id: 's1',
      title: '方案讨论',
      userId: 1,
      messages: [
        {
          role: 'assistant',
          content: '任务已创建',
          metadata: { intent: 'create_task', taskId: 'task-feedback' },
        },
      ],
    }));
    aiApiMock.getTaskFiles.mockResolvedValue(apiOk([
      {
        name: 'response.md',
        size: 100,
        url: 'https://cos/response.md',
      },
    ]));
    vi.stubGlobal('fetch', vi.fn<() => Promise<Response>>(() =>
      Promise.resolve(new Response('执行结果正文', { status: 200 })),
    ));
    aiApiMock.injectChatMessage.mockResolvedValue(apiOk({
      role: 'assistant',
      content: '【Codex 执行反馈】\n\n执行结果正文',
      metadata: { responseForTask: 'task-feedback' },
    }));

    render(<AiChatPanel tasks={[completedTask]} />);

    fireEvent.click(await screen.findByText('方案讨论'));

    await waitFor(() => {
      expect(aiApiMock.injectChatMessage).toHaveBeenCalledWith('s1', {
        role: 'assistant',
        content: '【Codex 执行反馈】\n\n执行结果正文',
        metadata: { responseForTask: 'task-feedback' },
      });
    });
    expect(await screen.findByText(/Codex 执行反馈/)).toBeInTheDocument();
  });
});
