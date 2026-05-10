import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTask, AiTaskFile, ApiResponse } from '../../../types/api';
import { apiOk, makeAiTask } from '../../../test-utils/fixtures';
import TaskLogPanel from './TaskLogPanel';

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn<() => void>();
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emitMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

interface PersistedTask extends AiTask {
  executionLog?: Array<{
    line: string;
    type?: 'thought' | 'action' | 'output' | 'info' | 'error';
    timestamp: number;
  }>;
}

const aiApiMock = vi.hoisted(() => ({
  getTask: vi.fn<(id: string) => Promise<ApiResponse<PersistedTask> | { success: true; data: PersistedTask }>>(),
  getTaskFiles: vi.fn<(id: string) => Promise<ApiResponse<AiTaskFile[]>>>(),
}));

vi.mock('../../../services/api', () => ({
  aiAPI: aiApiMock,
}));

describe('TaskLogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    aiApiMock.getTask.mockResolvedValue(apiOk({
      ...makeAiTask({ id: 'task-log', status: 'completed' }),
      executionLog: [
        { line: '任务完成', type: 'info', timestamp: 1770000000000 },
      ],
    }));
    aiApiMock.getTaskFiles.mockResolvedValue(apiOk([
      {
        name: 'deck.pptx',
        size: 2048,
        url: 'https://cos/deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        category: 'core',
      },
    ]));
  });

  it('loads persisted logs and generated files for completed tasks', async () => {
    render(<TaskLogPanel taskId="task-log" taskStatus="completed" />);

    expect(await screen.findByText('deck.pptx')).toBeInTheDocument();
    expect(aiApiMock.getTask).toHaveBeenCalledWith('task-log');
    expect(aiApiMock.getTaskFiles).toHaveBeenCalledWith('task-log');

    fireEventClick(screen.getByRole('tab', { name: /原始日志/ }));
    expect(await screen.findByText('任务完成')).toBeInTheDocument();
  });

  it('loads persisted logs from worker success/data responses', async () => {
    aiApiMock.getTask.mockResolvedValue({
      success: true,
      data: {
        ...makeAiTask({ id: 'task-log', status: 'completed' }),
        executionLog: [
          { line: '历史原始日志', type: 'info', timestamp: 1770000000000 },
        ],
      },
    });

    render(<TaskLogPanel taskId="task-log" taskStatus="completed" />);

    fireEventClick(await screen.findByRole('tab', { name: /原始日志/ }));
    expect(await screen.findByText('历史原始日志')).toBeInTheDocument();
  });

  it('accepts runtime file_ready events from the log stream', async () => {
    render(<TaskLogPanel taskId="task-live" taskStatus="running" />);

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    act(() => {
      MockEventSource.instances[0].emitMessage({
        taskId: 'task-live',
        eventType: 'file_ready',
        name: 'live/slide.png',
        category: 'process',
        size: 1024,
        url: 'https://cos/slide.png',
        mimeType: 'image/png',
        timestamp: 1770000000000,
      });
    });

    expect(await screen.findByAltText('live/slide.png')).toBeInTheDocument();
  });
});

const fireEventClick = (element: HTMLElement) => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
