import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AiHealth,
  AiTaskFile,
  AiTaskListData,
  AiTemplate,
  AiUploadUrl,
  ApiResponse,
} from '../../types/api';
import { useAuthStore } from '../../stores/authStore';
import { apiOk, makeAdminUser, makeAiTask } from '../../test-utils/fixtures';
import AiPage, {
  buildCreateTaskPayload,
  normalizeTaskFiles,
  normalizeTaskList,
  normalizeTemplates,
  normalizeUploadUrl,
} from '.';

type SocketHandler = (payload?: unknown) => void;

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, Set<SocketHandler>>();
  return {
    handlers,
    emit: vi.fn<(event: string, payload: unknown) => void>(),
    on: vi.fn((event: string, handler: SocketHandler) => {
      const bucket = handlers.get(event) ?? new Set<SocketHandler>();
      bucket.add(handler);
      handlers.set(event, bucket);
    }),
    off: vi.fn((event: string, handler: SocketHandler) => {
      handlers.get(event)?.delete(handler);
    }),
    fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    reset: () => {
      handlers.clear();
    },
  };
});

const aiApiMock = vi.hoisted(() => ({
  health: vi.fn<() => Promise<ApiResponse<AiHealth>>>(),
  getTemplates: vi.fn<() => Promise<ApiResponse<AiTemplate[]>>>(),
  listTasks: vi.fn<(params?: Record<string, unknown>) => Promise<ApiResponse<AiTaskListData> | AiTaskListData>>(),
  getTaskFiles: vi.fn<(id: string) => Promise<ApiResponse<AiTaskFile[]>>>(),
  createTask: vi.fn(),
  cancelTask: vi.fn(),
  deleteTask: vi.fn(),
  resumeTask: vi.fn(),
  getUploadUrl: vi.fn<() => Promise<ApiResponse<AiUploadUrl>>>(),
}));

vi.mock('../../services/api', () => ({
  aiAPI: aiApiMock,
}));

vi.mock('../../stores/socketStore', () => ({
  useSocketStore: () => ({
    socket: socketMock,
    connected: true,
  }),
}));

vi.mock('./components/AiChatPanel', () => ({
  default: () => <div>mock chat panel</div>,
}));

vi.mock('./components/TaskLogPanel', () => ({
  default: ({ taskId }: { taskId: string }) => <div>mock task log {taskId}</div>,
}));

const waitForSocketHandler = (event: string) =>
  waitFor(() => {
    expect(socketMock.handlers.get(event)?.size ?? 0).toBeGreaterThan(0);
  });

describe('AI page API boundary helpers', () => {
  it('normalizes task list response shapes', () => {
    const task = makeAiTask({ id: 'task-a' });

    expect(normalizeTaskList(apiOk<AiTaskListData>([task]))).toEqual({ list: [task], total: 1 });
    expect(normalizeTaskList(apiOk<AiTaskListData>({ items: [task], total: 9 }))).toEqual({ list: [task], total: 9 });
    expect(normalizeTaskList(apiOk<AiTaskListData>({ data: [task], total: 3 }))).toEqual({ list: [task], total: 3 });
  });

  it('builds template params, review mode, and attachments into create payload', () => {
    const template: AiTemplate = {
      name: 'ppt',
      variables: [
        { name: 'topic', required: true },
        { name: 'audience' },
      ],
    };

    expect(buildCreateTaskPayload(
      {
        type: 'ppt',
        reviewMode: 'review',
        param_topic: '容灾汇报',
        param_audience: '外部客户',
      },
      [template],
      [{ name: 'source.docx', url: 'https://cos/source.docx', size: 1024 }],
      'draft-1',
      false,
    )).toEqual({
      id: 'draft-1',
      type: 'ppt',
      params: {
        topic: '容灾汇报',
        audience: '外部客户',
      },
      attachments: [{ name: 'source.docx', url: 'https://cos/source.docx', size: 1024 }],
      reviewMode: 'review',
    });
  });

  it('normalizes upload urls, templates, and task files defensively', () => {
    const uploadUrl: AiUploadUrl = { url: 'https://cos/upload?sign=1', key: 'k' };
    const template: AiTemplate = { name: 'doc', title: '文档' };
    const file: AiTaskFile = { name: 'response.md', size: 10, url: 'https://cos/response.md' };

    expect(normalizeUploadUrl(apiOk(uploadUrl))).toEqual(uploadUrl);
    expect(normalizeUploadUrl({ key: 'missing-url' } as AiUploadUrl)).toBeNull();
    expect(normalizeTemplates(apiOk([template]))).toEqual([template]);
    expect(normalizeTaskFiles(apiOk([file]))).toEqual([file]);
  });
});

describe('AiPage websocket task updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMock.reset();
    useAuthStore.setState({
      user: makeAdminUser(),
      accessToken: 'token',
      isAuthenticated: true,
    });
    aiApiMock.health.mockResolvedValue(apiOk({ ok: true }));
    aiApiMock.getTemplates.mockResolvedValue(apiOk([]));
    aiApiMock.getTaskFiles.mockResolvedValue(apiOk([]));
    aiApiMock.listTasks.mockResolvedValue(apiOk<AiTaskListData>({
      data: [makeAiTask({ id: 'task-1', type: 'ppt', status: 'running', progress: 10, currentStep: '启动中' })],
      total: 1,
    }));
  });

  it('applies progress and completed task snapshots from the socket', async () => {
    render(<AiPage />);

    fireEvent.click(await screen.findByRole('tab', { name: /任务中心/ }));
    expect(await screen.findByText('ppt')).toBeInTheDocument();
    expect(screen.getByText('启动中')).toBeInTheDocument();
    await waitForSocketHandler('ai:taskProgress');

    act(() => {
      socketMock.fire('ai:taskProgress', {
        taskId: 'task-1',
        progress: 42,
        currentStep: '生成页面',
      });
    });

    expect(await screen.findByText('生成页面')).toBeInTheDocument();
    await waitForSocketHandler('ai:taskUpdated');

    act(() => {
      socketMock.fire('ai:taskUpdated', {
        task: makeAiTask({
          id: 'task-1',
          type: 'ppt',
          status: 'completed',
          progress: 100,
          currentStep: '完成',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('adds a fileReady payload to the selected completed task detail', async () => {
    aiApiMock.listTasks.mockResolvedValue(apiOk<AiTaskListData>({
      data: [makeAiTask({ id: 'task-2', type: 'doc', status: 'completed', progress: 100 })],
      total: 1,
    }));

    render(<AiPage />);

    fireEvent.click(await screen.findByRole('tab', { name: /任务中心/ }));
    fireEvent.click(await screen.findByRole('button', { name: /详情/ }));

    await waitFor(() => {
      expect(screen.getByText('mock task log task-2')).toBeInTheDocument();
    });
    await waitForSocketHandler('ai:fileReady');

    act(() => {
      socketMock.fire('ai:fileReady', {
        taskId: 'task-2',
        name: 'output/report.docx',
        size: 2048,
        url: 'https://cos/report.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        category: 'core',
      });
    });

    expect(await screen.findByText(/report\.docx/)).toBeInTheDocument();
  });
});
