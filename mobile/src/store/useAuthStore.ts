import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';

interface User {
  id: number;
  username: string;
  realName?: string;
  role?: { id: number; name: string; permissions?: string[] } | any;
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
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '网络请求失败';
      throw new Error(errorMsg);
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      console.warn('Backend logout failed, proceeding with local clear');
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
      console.error('Failed to restore auth state', error);
    } finally {
      set({ isLoading: false });
    }
  },
}));
