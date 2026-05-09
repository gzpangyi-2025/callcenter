import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, PaginatedData, ReportSummary } from '../../types/api';
import type { Ticket } from '../../types/ticket';
import { makeApiUser, makeTicket } from '../../test-utils/fixtures';
import Dashboard from '.';

const navigateMock = vi.hoisted(() => ({
  navigate: vi.fn<(path: string) => void>(),
}));

const ticketsApiMock = vi.hoisted(() => ({
  getAll: vi.fn<(params?: Record<string, unknown>) => Promise<ApiResponse<PaginatedData<Ticket>>>>(),
}));

const reportApiMock = vi.hoisted(() => ({
  getSummary: vi.fn<() => Promise<ApiResponse<ReportSummary>>>(),
}));

const socketStoreMock = vi.hoisted(() => ({
  socket: null,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock.navigate,
  };
});

vi.mock('../../stores/socketStore', () => ({
  useSocketStore: () => socketStoreMock,
}));

vi.mock('../../services/api', () => ({
  ticketsAPI: ticketsApiMock,
  reportAPI: reportApiMock,
}));

const ticketListResponse = (items: Ticket[]): ApiResponse<PaginatedData<Ticket>> => ({
  code: 0,
  data: {
    items,
    total: items.length,
  },
});

const summaryResponse: ApiResponse<ReportSummary> = {
  code: 0,
  data: {
    total: 4,
    pending: 2,
    in_progress: 1,
    closing: 1,
    closed: 1,
    avgHours: 2.5,
  },
};

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketStoreMock.socket = null;
    const assignee = makeApiUser({ id: 2, username: 'supporter', realName: '接单同事' });
    ticketsApiMock.getAll.mockResolvedValue(ticketListResponse([
      makeTicket({ id: 1, ticketNo: 'T-1', title: '最早待接单', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeTicket({ id: 2, ticketNo: 'T-2', title: '服务中工单', status: 'in_progress', assignee, assigneeId: assignee.id, assignedAt: '2026-01-01T01:00:00.000Z' }),
      makeTicket({ id: 3, ticketNo: 'T-3', title: '待确认工单', status: 'closing', assignee, assigneeId: assignee.id, assignedAt: '2026-01-01T02:00:00.000Z' }),
    ]));
    reportApiMock.getSummary.mockResolvedValue(summaryResponse);
  });

  it('loads dashboard summary and top ticket sections', async () => {
    render(<Dashboard />);

    expect(await screen.findByText('仪表盘')).toBeInTheDocument();
    expect(await screen.findByText('最早待接单')).toBeInTheDocument();
    expect(screen.getByText('服务中工单')).toBeInTheDocument();
    expect(screen.getByText('待确认工单')).toBeInTheDocument();
    expect(screen.getByText('总工单数')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(reportApiMock.getSummary).toHaveBeenCalled();
    expect(ticketsApiMock.getAll).toHaveBeenCalledWith({ pageSize: 100, isDashboard: true });
  });

  it('opens a filtered ticket list when a stat card is clicked', async () => {
    ticketsApiMock.getAll
      .mockResolvedValueOnce(ticketListResponse([]))
      .mockResolvedValueOnce(ticketListResponse([
        makeTicket({ id: 10, title: '待处理筛选结果', status: 'pending' }),
      ]));

    render(<Dashboard />);

    fireEvent.click(await screen.findByText('待接单'));

    await waitFor(() => {
      expect(ticketsApiMock.getAll).toHaveBeenLastCalledWith({
        pageSize: 200,
        status: 'pending',
      });
    });
    expect(await screen.findByText('筛选结果 · 待接单 (2)')).toBeInTheDocument();
    expect(await screen.findByText('待处理筛选结果')).toBeInTheDocument();
  });

  it('navigates to the ticket detail page from a ticket row', async () => {
    render(<Dashboard />);

    fireEvent.click(await screen.findByText('服务中工单'));

    expect(navigateMock.navigate).toHaveBeenCalledWith('/tickets/2');
  });
});
