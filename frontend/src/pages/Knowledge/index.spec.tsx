import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ApiResponse, KnowledgeDocument, PaginatedData } from '../../types/api';
import { apiOk } from '../../test-utils/fixtures';
import KnowledgePage from '.';

const knowledgeApiMock = vi.hoisted(() => ({
  search: vi.fn<(q: string, page?: number, docType?: string) => Promise<ApiResponse<PaginatedData<KnowledgeDocument>>>>(),
  getOne: vi.fn<(id: number) => Promise<ApiResponse<KnowledgeDocument>>>(),
  deleteOne: vi.fn<(id: number) => Promise<ApiResponse<void>>>(),
}));

vi.mock('../../services/api', () => ({
  knowledgeAPI: knowledgeApiMock,
}));

vi.mock('../../components/MarkdownViewer', () => ({
  MarkdownViewer: ({ content }: { content: string }) => <article>{content}</article>,
}));

vi.mock('../../components/RequirePermission', () => ({
  RequirePermission: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const makeKnowledgeDoc = (overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id: 1,
  title: 'Oracle RAC 故障复盘',
  content: '复盘正文',
  type: 'chat_history',
  tags: 'Oracle,RAC',
  severity: '高',
  category: '数据库',
  ticketId: 100,
  ticketNo: 'T-100',
  generatedBy: 'agent',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderKnowledge = (initialPath = '/knowledge') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <KnowledgePage />
    </MemoryRouter>,
  );

describe('KnowledgePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    knowledgeApiMock.search.mockResolvedValue(apiOk({
      items: [makeKnowledgeDoc()],
      total: 1,
    }));
    knowledgeApiMock.getOne.mockResolvedValue(apiOk(makeKnowledgeDoc({ id: 2, title: '直达文档', content: '直达正文' })));
    knowledgeApiMock.deleteOne.mockResolvedValue(apiOk(undefined));
  });

  it('loads knowledge documents and opens the markdown preview', async () => {
    renderKnowledge();

    expect(await screen.findByText('技术支持知识库')).toBeInTheDocument();
    expect(await screen.findByText('Oracle RAC 故障复盘')).toBeInTheDocument();
    expect(screen.getByText('高')).toBeInTheDocument();
    expect(screen.getByText('数据库')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Oracle RAC 故障复盘'));

    expect(await screen.findByText('复盘正文')).toBeInTheDocument();
    expect(knowledgeApiMock.search).toHaveBeenCalledWith('', 1, 'chat_history');
  });

  it('reloads documents when changing tab and typing a debounced keyword', async () => {
    renderKnowledge();

    fireEvent.click(await screen.findByText('📖 知识文档'));
    await waitFor(() => {
      expect(knowledgeApiMock.search).toHaveBeenLastCalledWith('', 1, 'ai_doc');
    });

    fireEvent.change(screen.getByPlaceholderText('搜索知识文档标题或对应关联工单号...'), {
      target: { value: '交换机' },
    });

    await new Promise((resolve) => setTimeout(resolve, 350));

    await waitFor(() => {
      expect(knowledgeApiMock.search).toHaveBeenLastCalledWith('交换机', 1, 'ai_doc');
    });
  });

  it('opens a document from the global search viewId query', async () => {
    renderKnowledge('/knowledge?viewId=2');

    expect(await screen.findByText('直达正文')).toBeInTheDocument();
    expect(knowledgeApiMock.getOne).toHaveBeenCalledWith(2);
  });
});
