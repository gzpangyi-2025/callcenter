import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from './types/api';
import type { User } from './stores/authStore';
import { useAuthStore } from './stores/authStore';
import { makeUser } from './test-utils/fixtures';
import App from './App';

const socketMock = vi.hoisted(() => ({
  connect: vi.fn<(token: string) => void>(),
  disconnect: vi.fn<() => void>(),
}));

const authApiMock = vi.hoisted(() => ({
  getMe: vi.fn<() => Promise<ApiResponse<User>>>(),
}));

vi.mock('./stores/socketStore', () => ({
  useSocketStore: () => socketMock,
}));

vi.mock('./services/api', () => ({
  authAPI: authApiMock,
}));

vi.mock('./pages/Login', () => ({
  default: () => <div>login page</div>,
}));

vi.mock('./components/MainLayout', () => ({
  default: () => <div>layout shell</div>,
}));

vi.mock('./pages/Dashboard', () => ({
  default: () => <div>dashboard page</div>,
}));

vi.mock('./pages/Tickets', () => ({
  default: () => <div>ticket list</div>,
}));

vi.mock('./pages/Tickets/TicketDetail', () => ({
  default: () => <div>ticket detail</div>,
}));

vi.mock('./pages/Tickets/TicketShared', () => ({
  default: () => <div>ticket shared</div>,
}));

vi.mock('./pages/BBS/BbsShared', () => ({
  default: () => <div>bbs shared</div>,
}));

describe('App routing and session bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('redirects anonymous internal routes to login', async () => {
    render(<App />);

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(socketMock.disconnect).toHaveBeenCalled();
    expect(authApiMock.getMe).not.toHaveBeenCalled();
  });

  it('refreshes the current user and connects the socket for authenticated sessions', async () => {
    const user = makeUser({ username: 'agent' });
    localStorage.setItem('accessToken', 'stored-token');
    useAuthStore.setState({
      user,
      accessToken: 'stored-token',
      isAuthenticated: true,
    });
    authApiMock.getMe.mockResolvedValue({ code: 0, data: user });

    render(<App />);

    expect(await screen.findByText('layout shell')).toBeInTheDocument();
    await waitFor(() => {
      expect(authApiMock.getMe).toHaveBeenCalled();
    });
    expect(socketMock.connect).toHaveBeenCalledWith('stored-token');
    expect(useAuthStore.getState().user).toEqual(user);
  });

  it('clears external users before they enter the internal workspace', async () => {
    const externalUser = makeUser({
      username: 'guest',
      role: { id: 9, name: 'external', permissions: [] },
    });
    localStorage.setItem('accessToken', 'guest-token');
    useAuthStore.setState({
      user: externalUser,
      accessToken: 'guest-token',
      isAuthenticated: true,
    });

    render(<App />);

    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });
});
