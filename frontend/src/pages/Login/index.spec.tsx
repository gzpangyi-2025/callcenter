import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, AuthTokenPayload } from '../../types/api';
import type { User } from '../../stores/authStore';
import { useAuthStore } from '../../stores/authStore';
import { makeUser } from '../../test-utils/fixtures';
import LoginPage from '.';

interface LoginRequest {
  username: string;
  password: string;
}

interface RegisterRequest extends LoginRequest {
  realName: string;
  email?: string;
}

type AuthResponse = ApiResponse<AuthTokenPayload & { user?: User }>;

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn<(path: string) => void>(),
  location: { search: '' },
}));

const messageMock = vi.hoisted(() => ({
  success: vi.fn<(content: string) => void>(),
}));

const authApiMock = vi.hoisted(() => ({
  login: vi.fn<(values: LoginRequest) => Promise<AuthResponse>>(),
  register: vi.fn<(values: RegisterRequest) => Promise<AuthResponse>>(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => routerMock.navigate,
    useLocation: () => routerMock.location,
  };
});

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: {
      ...actual.message,
      success: messageMock.success,
    },
  };
});

vi.mock('../../services/api', () => ({
  authAPI: authApiMock,
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    routerMock.location.search = '';
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('stores auth and follows redirect after a successful login', async () => {
    const user = makeUser({ username: 'agent' });
    routerMock.location.search = '?redirect=%2Ftickets';
    authApiMock.login.mockResolvedValue({
      code: 0,
      data: { accessToken: 'login-token', user },
    });

    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('用户名'), 'agent');
    await userEvent.type(screen.getByPlaceholderText('密码'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    await waitFor(() => {
      expect(authApiMock.login).toHaveBeenCalledWith({
        username: 'agent',
        password: 'secret123',
      });
    });
    expect(useAuthStore.getState()).toMatchObject({
      user,
      accessToken: 'login-token',
      isAuthenticated: true,
    });
    expect(messageMock.success).toHaveBeenCalledWith('登录成功');
    expect(routerMock.navigate).toHaveBeenCalledWith('/tickets');
  });

  it('registers without leaking the confirm field into the API payload', async () => {
    const user = makeUser({ id: 2, username: 'new-agent', realName: '新同事' });
    authApiMock.register.mockResolvedValue({
      code: 0,
      data: { accessToken: 'register-token', user },
    });

    render(<LoginPage />);

    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    await userEvent.type(screen.getByPlaceholderText('用户名（登录账号）'), 'new-agent');
    await userEvent.type(screen.getByPlaceholderText('中文姓名（真实姓名）'), '新同事');
    await userEvent.type(screen.getByPlaceholderText('邮箱 (选填)'), 'agent@example.com');
    await userEvent.type(screen.getAllByPlaceholderText('密码')[1], 'secret123');
    await userEvent.type(screen.getByPlaceholderText('确认密码'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: /注\s*册/ }));

    await waitFor(() => {
      expect(authApiMock.register).toHaveBeenCalledWith({
        username: 'new-agent',
        realName: '新同事',
        email: 'agent@example.com',
        password: 'secret123',
      });
    });
    expect(useAuthStore.getState().accessToken).toBe('register-token');
    expect(messageMock.success).toHaveBeenCalledWith('注册成功');
    expect(routerMock.navigate).toHaveBeenCalledWith('/');
  });

  it('blocks registration when the password confirmation differs', async () => {
    render(<LoginPage />);

    await userEvent.click(screen.getByRole('tab', { name: '注册' }));
    await userEvent.type(screen.getByPlaceholderText('用户名（登录账号）'), 'new-agent');
    await userEvent.type(screen.getByPlaceholderText('中文姓名（真实姓名）'), '新同事');
    await userEvent.type(screen.getAllByPlaceholderText('密码')[1], 'secret123');
    await userEvent.type(screen.getByPlaceholderText('确认密码'), 'other123');
    await userEvent.click(screen.getByRole('button', { name: /注\s*册/ }));

    expect(await screen.findByText('两次密码不一致')).toBeInTheDocument();
    expect(authApiMock.register).not.toHaveBeenCalled();
  });
});
