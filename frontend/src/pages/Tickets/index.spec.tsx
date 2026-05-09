import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, CategoryNode, PaginatedData, TicketAggregates } from '../../types/api';
import type { Ticket } from '../../types/ticket';
import { useAuthStore } from '../../stores/authStore';
import { makePermission, makeTicket, makeUser } from '../../test-utils/fixtures';
import TicketList from '.';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  disconnect = vi.fn<() => void>();
  observe = vi.fn<(target: Element) => void>();
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => []);
  unobserve = vi.fn<(target: Element) => void>();
}

const ticketsApiMock = vi.hoisted(() => ({
  getAll: vi.fn<(params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedData<Ticket>>>>(),
  getAggregates: vi.fn<(params?: Record<string, unknown>) => Promise<ApiResponse<TicketAggregates>>>(),
  create: vi.fn(),
  assign: vi.fn(),
  batchDelete: vi.fn(),
}));

const usersApiMock = vi.hoisted(() => ({
  search: vi.fn(),
}));

const categoryApiMock = vi.hoisted(() => ({
  getTree: vi.fn<() => Promise<ApiResponse<CategoryNode[]>>>(),
}));

const socketStoreMock = vi.hoisted(() => ({
  socket: null,
}));

vi.mock('../../stores/socketStore', () => ({
  useSocketStore: () => socketStoreMock,
}));

vi.mock('../../services/api', () => ({
  ticketsAPI: ticketsApiMock,
  usersAPI: usersApiMock,
  categoryAPI: categoryApiMock,
}));

const aggregates: TicketAggregates = {
  categories: [],
  customers: [],
  creators: [],
  assignees: [],
};

const renderTicketList = () =>
  render(
    <MemoryRouter>
      <TicketList />
    </MemoryRouter>,
  );

describe('TicketList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    socketStoreMock.socket = null;
    useAuthStore.setState({
      user: makeUser({
        role: {
          id: 2,
          name: 'user',
          permissions: [makePermission('tickets:create')],
        },
      }),
      accessToken: 'token',
      isAuthenticated: true,
    });
    ticketsApiMock.getAll.mockResolvedValue({
      code: 0,
      data: {
        items: [makeTicket({ id: 100, ticketNo: 'T-100', title: '交换机故障' })],
        total: 1,
      },
    });
    ticketsApiMock.getAggregates.mockResolvedValue({ code: 0, data: aggregates });
    categoryApiMock.getTree.mockResolvedValue({ code: 0, data: [] });
  });

  it('loads tickets with aggregate filters on mount', async () => {
    renderTicketList();

    expect(await screen.findByText('工单广场')).toBeInTheDocument();
    expect(await screen.findByText('T-100')).toBeInTheDocument();
    expect(screen.getByText('交换机故障')).toBeInTheDocument();
    expect(ticketsApiMock.getAll).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: undefined,
      keyword: undefined,
      category1: undefined,
      category2: undefined,
      category3: undefined,
      customerName: undefined,
      creatorId: undefined,
      assigneeId: undefined,
    });
    expect(ticketsApiMock.getAggregates).toHaveBeenCalled();
    expect(categoryApiMock.getTree).toHaveBeenCalled();
  });

  it('shows the create ticket entry only when the user has create permission', async () => {
    const { unmount } = renderTicketList();

    expect(await screen.findByRole('button', { name: /创建工单/ })).toBeInTheDocument();

    unmount();
    useAuthStore.setState({
      user: makeUser({ role: { id: 3, name: 'user', permissions: [] } }),
      accessToken: 'token',
      isAuthenticated: true,
    });
    renderTicketList();

    await waitFor(() => {
      expect(screen.getAllByText('工单广场').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /创建工单/ })).not.toBeInTheDocument();
  });
});
