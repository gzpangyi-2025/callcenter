import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, BbsNotification, TicketBatchSummary } from '../types/api';
import type { Ticket } from '../types/ticket';
import { useAuthStore } from '../stores/authStore';
import { makePermission, makeTicket, makeUser } from '../test-utils/fixtures';
import MainLayout from './MainLayout';

const socketStoreMock = vi.hoisted(() => ({
  profileBadge: 0,
  socket: null,
  setMyTicketIds: vi.fn<(ids: number[]) => void>(),
  unreadMap: {} as Record<number, number>,
  newTicketIds: [] as number[],
  bbsUnreadMap: {} as Record<number, number>,
  clearNewTicket: vi.fn<(ticketId: number) => void>(),
  clearUnread: vi.fn<(ticketId: number) => void>(),
}));

const ticketsApiMock = vi.hoisted(() => ({
  getBatchSummary: vi.fn<(ids: number[]) => Promise<ApiResponse<TicketBatchSummary[]>>>(),
  myCreated: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
  myAssigned: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
  myParticipated: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
}));

const bbsApiMock = vi.hoisted(() => ({
  getNotifications: vi.fn<() => Promise<ApiResponse<BbsNotification[]>>>(),
}));

const authApiMock = vi.hoisted(() => ({
  logout: vi.fn<() => Promise<ApiResponse<void>>>(),
  getMe: vi.fn(),
}));

const usersApiMock = vi.hoisted(() => ({
  updateMe: vi.fn(),
  changeMyPassword: vi.fn(),
}));

vi.mock('../stores/socketStore', () => ({
  useSocketStore: () => socketStoreMock,
}));

vi.mock('../services/api', () => ({
  authAPI: authApiMock,
  ticketsAPI: ticketsApiMock,
  usersAPI: usersApiMock,
  bbsAPI: bbsApiMock,
}));

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketStoreMock.profileBadge = 0;
    socketStoreMock.socket = null;
    socketStoreMock.unreadMap = {};
    socketStoreMock.newTicketIds = [];
    socketStoreMock.bbsUnreadMap = {};
    ticketsApiMock.getBatchSummary.mockResolvedValue({ code: 0, data: [] });
    ticketsApiMock.myCreated.mockResolvedValue({ code: 0, data: [] });
    ticketsApiMock.myAssigned.mockResolvedValue({ code: 0, data: [] });
    ticketsApiMock.myParticipated.mockResolvedValue({ code: 0, data: [] });
    bbsApiMock.getNotifications.mockResolvedValue({ code: 0, data: [] });
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('renders permission-gated menu entries from role permissions', () => {
    useAuthStore.setState({
      user: makeUser({
        role: {
          id: 2,
          name: 'user',
          permissions: [
            makePermission('ai:access'),
            makePermission('report:read'),
          ],
        },
      }),
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderLayout();

    expect(screen.getByText('仪表盘')).toBeInTheDocument();
    expect(screen.getByText('工单广场')).toBeInTheDocument();
    expect(screen.getByText('AI 协作')).toBeInTheDocument();
    expect(screen.getByText('数据报表')).toBeInTheDocument();
    expect(screen.queryByText('后台管理')).not.toBeInTheDocument();
    expect(screen.queryByText('知识库')).not.toBeInTheDocument();
    expect(screen.queryByText('交流论坛')).not.toBeInTheDocument();
  });

  it('preloads all ticket ids relevant to the current user without duplicates', async () => {
    useAuthStore.setState({
      user: makeUser(),
      accessToken: 'token',
      isAuthenticated: true,
    });
    ticketsApiMock.myCreated.mockResolvedValue({ code: 0, data: [makeTicket({ id: 10 })] });
    ticketsApiMock.myAssigned.mockResolvedValue({ code: 0, data: [makeTicket({ id: 11 })] });
    ticketsApiMock.myParticipated.mockResolvedValue({ code: 0, data: [makeTicket({ id: 10 })] });

    renderLayout();

    await waitFor(() => {
      expect(socketStoreMock.setMyTicketIds).toHaveBeenCalledWith([10, 11]);
    });
  });
});
