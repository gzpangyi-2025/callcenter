import { create } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../constants/config';
import { logger } from '../utils/logger';

const api = create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Request interceptor to attach JWT token
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('user_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      logger.error('Error fetching token from SecureStore', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for generic error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access (e.g., trigger logout)
      logger.warn('Unauthorized access, please login again.');
    }
    return Promise.reject(error);
  }
);

export default api;
