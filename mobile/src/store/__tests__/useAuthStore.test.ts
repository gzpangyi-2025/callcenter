/**
 * Tests for useAuthStore — Zustand auth state management.
 *
 * Strategy: mock api (axios) and expo-secure-store to test
 * login, logout, and checkAuth flows in isolation.
 */

// ---------- Mocks ----------

const mockSecureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => {
    return Promise.resolve(mockSecureStore[key] ?? null);
  }),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
}));

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock('../../constants/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api',
}));

// ---------- Imports ----------

import { useAuthStore } from '../useAuthStore';
import api from '../../services/api';

// ---------- Helpers ----------

function resetStore() {
  useAuthStore.setState({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });
  // Clear the mock secure store
  Object.keys(mockSecureStore).forEach(key => delete mockSecureStore[key]);
}

// ---------- Tests ----------

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
});

describe('useAuthStore', () => {
  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(true);
    });
  });

  describe('login', () => {
    it('should set user and token on successful login', async () => {
      const mockUser = { id: 1, username: 'admin', realName: '管理员' };
      (api.post as jest.Mock).mockResolvedValueOnce({
        data: {
          code: 0,
          data: { accessToken: 'jwt-token-123', user: mockUser },
        },
      });

      await useAuthStore.getState().login('admin', 'password');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe('jwt-token-123');
      expect(state.isAuthenticated).toBe(true);
      expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'password' });
    });

    it('should persist token and user to SecureStore', async () => {
      const mockUser = { id: 1, username: 'admin' };
      (api.post as jest.Mock).mockResolvedValueOnce({
        data: { code: 0, data: { accessToken: 'tok', user: mockUser } },
      });

      await useAuthStore.getState().login('admin', 'pass');

      expect(mockSecureStore['user_token']).toBe('tok');
      expect(JSON.parse(mockSecureStore['user_data'])).toEqual(mockUser);
    });

    it('should throw on non-zero code response', async () => {
      (api.post as jest.Mock).mockResolvedValueOnce({
        data: { code: 1, message: '密码错误' },
      });

      await expect(useAuthStore.getState().login('admin', 'wrong')).rejects.toThrow('密码错误');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('should throw on network error with message', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

      await expect(useAuthStore.getState().login('admin', 'pass')).rejects.toThrow('Network Error');
    });

    it('should extract message from axios error response', async () => {
      const axiosError = {
        response: { data: { message: '服务器异常' } },
      };
      (api.post as jest.Mock).mockRejectedValueOnce(axiosError);

      await expect(useAuthStore.getState().login('admin', 'pass')).rejects.toThrow('服务器异常');
    });
  });

  describe('logout', () => {
    it('should clear state and SecureStore', async () => {
      // First login
      useAuthStore.setState({ user: { id: 1, username: 'a' }, token: 't', isAuthenticated: true });
      mockSecureStore['user_token'] = 't';
      mockSecureStore['user_data'] = '{}';

      (api.post as jest.Mock).mockResolvedValueOnce({});

      await useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(mockSecureStore['user_token']).toBeUndefined();
      expect(mockSecureStore['user_data']).toBeUndefined();
    });

    it('should still clear local state even if backend logout fails', async () => {
      useAuthStore.setState({ user: { id: 1, username: 'a' }, token: 't', isAuthenticated: true });
      (api.post as jest.Mock).mockRejectedValueOnce(new Error('server down'));

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('checkAuth', () => {
    it('should restore state from SecureStore', async () => {
      const mockUser = { id: 1, username: 'admin' };
      mockSecureStore['user_token'] = 'saved-token';
      mockSecureStore['user_data'] = JSON.stringify(mockUser);

      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.token).toBe('saved-token');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading to false when no stored data', async () => {
      await useAuthStore.getState().checkAuth();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('should handle corrupted SecureStore data gracefully', async () => {
      mockSecureStore['user_token'] = 'tok';
      mockSecureStore['user_data'] = 'not-json';

      // Should not throw, just set isLoading false
      await useAuthStore.getState().checkAuth();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });
});
