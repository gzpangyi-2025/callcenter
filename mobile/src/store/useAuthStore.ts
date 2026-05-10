import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';
import { logger } from '../utils/logger';

interface User {
  id: number;
  username: string;
  realName?: string;
  role?: { id: number; name: string; permissions?: string[] };
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username, password) => {
    try {
      const response = await api.post('/auth/login', { username, password });
      if (response.data.code === 0) {
        const { accessToken, user } = response.data.data;
        
        // Save to secure store
        await SecureStore.setItemAsync('user_token', accessToken);
        await SecureStore.setItemAsync('user_data', JSON.stringify(user));

        set({
          user,
          token: accessToken,
          isAuthenticated: true,
        });
      } else {
        throw new Error(response.data.message || '登录失败');
      }
    } catch (error: unknown) {
      let errorMsg = '网络请求失败';
      if (error instanceof Error) {
        errorMsg = error.message;
      }
      if (typeof error === 'object' && error !== null && 'response' in error) {
        const axiosErr = error as { response?: { data?: { message?: string } } };
        errorMsg = axiosErr.response?.data?.message || errorMsg;
      }
      throw new Error(errorMsg);
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      logger.warn('Backend logout failed, proceeding with local clear');
    } finally {
      await SecureStore.deleteItemAsync('user_token');
      await SecureStore.deleteItemAsync('user_data');
      set({ user: null, token: null, isAuthenticated: false });
    }
  },

  checkAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync('user_token');
      const userData = await SecureStore.getItemAsync('user_data');
      
      if (token && userData) {
        set({
          token,
          user: JSON.parse(userData),
          isAuthenticated: true,
        });
      }
    } catch (error) {
      logger.error('Failed to restore auth state', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
