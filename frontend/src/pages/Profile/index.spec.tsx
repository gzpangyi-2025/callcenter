import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, CategoryNode } from '../../types/api';
import type { CreateTicketDto, Ticket } from '../../types/ticket';
import type { User as ApiUser } from '../../types/user';
import { useAuthStore } from '../../stores/authStore';
import { apiOk, makeApiUser, makeTicket, makeUser } from '../../test-utils/fixtures';
import ProfilePage from '.';

interface MockSocket {
  on: ReturnType<typeof vi.fn<(event: string, handler: () => void) => void>>;
  off: ReturnType<typeof vi.fn<(event: string, handler: () => void) => void>>;
}

const ticketsApiMock = vi.hoisted(() => ({
  myCreated: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
  myAssigned: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
  myParticipated: vi.fn<() => Promise<ApiResponse<Ticket[]>>>(),
  assign: vi.fn<(id: number) => Promise<ApiResponse<Ticket>>>(),
  create: vi.fn<(data: CreateTicketDto) => Promise<ApiResponse<Ticket>>>(),
}));

const usersApiMock = vi.hoisted(() => ({
  search: vi.fn<(q: string) => Promise<ApiResponse<ApiUser[]>>>(),
}));

const categoryApiMock = vi.hoisted(() => ({
  getTree: vi.fn<() => Promise<ApiResponse<CategoryNode[]>>>(),
}));

const socketStoreMock = vi.hoisted(() => ({
  socket: null as MockSocket | null,
  unreadMap: {} as Record<number, number>,
  newTicketIds: [] as number[],
  clearNewTicket: vi.fn<(ticketId: number) => void>(),
  clearUnread: vi.fn<(ticketId: number) => void>(),
  setMyTicketIds: vi.fn<(ids: number[]) => void>(),
}));

vi.mock('../../services/api', () => ({
  ticketsAPI: ticketsApiMock,
  usersAPI: usersApiMock,
  categoryAPI: categoryApiMock,
}));

vi.mock('../../stores/socketStore', () => ({
  useSocketStore: () => socketStoreMock,
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderProfile = () =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<><ProfilePage /><LocationProbe /></>} />
        <Route path="/tickets/:id" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProfilePage', () => {
  const createdTicket = makeTicket({
    id: 10,
    ticketNo: 'T-CREATED',
    title: '我申请的数据库问题',
    status: 'in_progress',
  });
  const assignedTicket = makeTicket({
    id: 20,
    ticketNo: 'T-ASSIGNED',
    title: '我接手的网络问题',
    status: 'pending',
  });
  const participatedTicket = makeTicket({
    id: 30,
    ticketNo: 'T-PART',
    title: '我参与的硬件问题',
    status: 'closed',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    socketStoreMock.socket = {
      on: vi.fn<(event: string, handler: () => void) => void>(),
      off: vi.fn<(event: string, handler: () => void) => void>(),
    };
    socketStoreMock.unreadMap = { 20: 2 };
    socketStoreMock.newTicketIds = [20];
    useAuthStore.setState({
      user: makeUser({
        username: 'profile-user',
        realName: '个人主页用户',
        employeeId: 'E-001',
        department: '技术部',
        position: '工程师',
      }),
      accessToken: 'token',
      isAuthenticated: true,
    });
    ticketsApiMock.myCreated.mockResolvedValue(apiOk([createdTicket]));
    ticketsApiMock.myAssigned.mockResolvedValue(apiOk([assignedTicket]));
    ticketsApiMock.myParticipated.mockResolvedValue(apiOk([participatedTicket]));
    ticketsApiMock.assign.mockResolvedValue(apiOk({ ...assignedTicket, status: 'in_progress' }));
    ticketsApiMock.create.mockResolvedValue(apiOk(makeTicket({ id: 99, title: '新建工单' })));
    usersApiMock.search.mockResolvedValue(apiOk([makeApiUser()]));
    categoryApiMock.getTree.mockResolvedValue(apiOk([]));
  });

  it('loads personal ticket groups and registers ticket ids for badges', async () => {
    renderProfile();

    expect(await screen.findByText(/个人主页 · 个人主页用户/)).toBeInTheDocument();
    expect(screen.getByText('工号: E-001')).toBeInTheDocument();
    expect(await screen.findByText('我申请的数据库问题')).toBeInTheDocument();
    expect(socketStoreMock.setMyTicketIds).toHaveBeenCalledWith([10, 20, 30]);
    expect(socketStoreMock.socket?.on.mock.calls[0]?.[0]).toBe('ticketEvent');
  });

  it('switches to assigned tickets and assigns a pending ticket', async () => {
    renderProfile();

    fireEvent.click(await screen.findByText(/我接手的/));
    expect(await screen.findByText('我接手的网络问题')).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /接单/ }));

    await waitFor(() => {
      expect(ticketsApiMock.assign).toHaveBeenCalledWith(20);
    });
  });

  it('opens the create ticket modal and submits the fallback type payload', async () => {
    renderProfile();

    fireEvent.click(await screen.findByRole('button', { name: /新建工单/ }));
    fireEvent.change(screen.getByPlaceholderText('请简要描述问题'), {
      target: { value: '新建工单标题' },
    });
    fireEvent.change(screen.getByPlaceholderText('请详细描述遇到的问题...'), {
      target: { value: '这里是问题描述' },
    });
    fireEvent.change(screen.getByPlaceholderText('请输入客户名称'), {
      target: { value: '测试客户' },
    });
    fireEvent.change(screen.getByPlaceholderText('关联的服务单号 (选填)'), {
      target: { value: 'SR-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));

    await waitFor(() => {
      expect(ticketsApiMock.create).toHaveBeenCalledWith({
        title: '新建工单标题',
        description: '这里是问题描述',
        type: 'other',
        customerName: '测试客户',
        serviceNo: 'SR-1',
      });
    });
  });
});
