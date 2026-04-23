import axios from 'axios';
import { message } from 'antd';
import type { ApiResponse, PaginatedData } from '../types/api';
import type { User, UpdateUserInfoParam } from '../types/user';
import type { Ticket, CreateTicketDto, UpdateTicketDto, TicketQueryParams, TicketBadgeSummary } from '../types/ticket';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
  withCredentials: true,
});

// 请求拦截器 - 自动带上token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器 - 处理token过期自动刷新及全局错误
api.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const res = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        const { accessToken } = res.data.data;
        localStorage.setItem('accessToken', accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        
        // 通知 socketStore 更新 token 连接
        import('../stores/socketStore').then(module => {
          module.useSocketStore.getState().connect(accessToken);
        });

        return api(originalRequest);
      } catch {
        localStorage.removeItem('accessToken');
        // 特区豁免策略：外链特区遇到 401 失效时由其自身接管，不执行全局强制驱逐到 /login
        if (!(window.location.pathname.startsWith('/external/ticket/') || window.location.pathname.startsWith('/external/bbs/'))) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }

    // 全局错误提示 (可通过 config._silent 屏蔽某次特定请求的全局报错)
    if (!originalRequest?._silent) {
      const errMsg = error.response?.data?.message || error.message || '请求失败';
      message.error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    }

    return Promise.reject(error);
  },
);

// Auth API
export const authAPI = {
  login: (data: { username: string; password: string }) =>
    api.post('/auth/login', data),
  register: (data: { username: string; password: string; realName: string; email?: string; displayName?: string }) =>
    api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
  externalLogin: (ticketToken: string, nickname: string) => api.post('/auth/external/login', { ticketToken, nickname }),
  bbsExternalLogin: (token: string) => api.post('/auth/external/bbs-login', { token }),
};

// Tickets API
export const ticketsAPI = {
  create: (data: CreateTicketDto): Promise<ApiResponse<Ticket>> => api.post('/tickets', data),
  getAll: (params?: TicketQueryParams): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/tickets', { params }),
  getById: (id: number): Promise<ApiResponse<Ticket>> => api.get(`/tickets/${id}`),
  getMyBadges: (): Promise<ApiResponse<TicketBadgeSummary>> => api.get('/tickets/my/badges'),
  getBatchSummary: (ids: number[]): Promise<ApiResponse<any[]>> => api.post('/tickets/batch/summary', { ids }),
  readTicket: (id: number): Promise<ApiResponse<void>> => api.post(`/tickets/${id}/read`),
  getByNo: (ticketNo: string): Promise<ApiResponse<Ticket>> => api.get(`/tickets/no/${ticketNo}`),
  update: (id: number, data: UpdateTicketDto): Promise<ApiResponse<Ticket>> => api.put(`/tickets/${id}`, data),
  assign: (id: number): Promise<ApiResponse<Ticket>> => api.post(`/tickets/${id}/assign`),
  requestClose: (id: number): Promise<ApiResponse<Ticket>> => api.post(`/tickets/${id}/request-close`),
  confirmClose: (id: number): Promise<ApiResponse<Ticket>> => api.post(`/tickets/${id}/confirm-close`),
  delete: (id: number): Promise<ApiResponse<void>> => api.delete(`/tickets/${id}`),
  batchDelete: (ids: number[]): Promise<ApiResponse<void>> => api.delete('/tickets/batch', { data: { ids } }),
  myCreated: (): Promise<ApiResponse<Ticket[]>> => api.get('/tickets/my/created'),
  myAssigned: (): Promise<ApiResponse<Ticket[]>> => api.get('/tickets/my/assigned'),
  myParticipated: (): Promise<ApiResponse<Ticket[]>> => api.get('/tickets/my/participated'),
  inviteParticipant: (id: number, userId: number): Promise<ApiResponse<Ticket>> => api.post(`/tickets/${id}/invite`, { userId }),
  removeParticipant: (id: number, userId: number): Promise<ApiResponse<Ticket>> => api.delete(`/tickets/${id}/participants/${userId}`),
};

// Files API
export const filesAPI = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Users API
export const usersAPI = {
  getAll: (): Promise<ApiResponse<User[]>> => api.get('/users'),
  search: (q: string): Promise<ApiResponse<User[]>> => api.get('/users/search', { params: { q } }),
  updateRole: (id: number, roleId: number): Promise<ApiResponse<User>> => api.put(`/users/${id}/role`, { roleId }),
  updateInfo: (id: number, data: UpdateUserInfoParam): Promise<ApiResponse<User>> =>
    api.put(`/users/${id}/info`, data),
  updateMe: (data: UpdateUserInfoParam): Promise<ApiResponse<User>> =>
    api.put('/users/me', data),
  changeMyPassword: (data: { oldPassword?: string; newPassword?: string }): Promise<ApiResponse<void>> =>
    api.put('/users/me/password', data),
  resetPassword: (id: number, password?: string): Promise<ApiResponse<void>> =>
    api.put(`/users/${id}/reset-password`, { password }),
  delete: (id: number): Promise<ApiResponse<void>> => api.delete(`/users/${id}`),
};

// Roles API
export const rolesAPI = {
  getAll: () => api.get('/roles'),
  getPermissions: () => api.get('/roles/permissions'),
  updatePermissions: (id: number, permissionIds: number[]) => api.post(`/roles/${id}/permissions`, { permissionIds }),
};

// Settings API
export const settingsAPI = {
  getAll: () => api.get('/settings'),
  saveAi: (data: {
    visionModel?: string; visionApiKey?: string;
    systemPrompt?: string; imageModel?: string; imageApiKey?: string;
  }) => api.post('/settings/ai', data),
  saveBiz: (data: {
    companyName?: string; websiteUrl?: string;
    companyEmail?: string; companyPhone?: string; sla?: string;
  }) => api.post('/settings/biz', data),
  saveSecurity: (data: { shareExpiration?: string }) => api.post('/settings/security', data),
  uploadLogo: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/settings/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getWebRtcConfig: () => api.get('/settings/webrtc-config'),
  saveWebRtc: (data: {
    mode?: string; customStun?: string;
    customTurn?: string; turnUsername?: string; turnPassword?: string;
    screenShareMaxViewers?: number; voiceMaxParticipants?: number;
  }) => api.post('/settings/webrtc', data),
};

// Knowledge API
export const knowledgeAPI = {
  generateDraft: (ticketId: number) => api.post(`/knowledge/tickets/${ticketId}/generate`, {}, { timeout: 120000 }),
  saveKnowledge: (data: { ticketId: number; title: string; content: string; tags?: string; category?: string; severity?: string; analysisImgUrl?: string; flowImgUrl?: string; }) => api.post('/knowledge', data, { timeout: 60000 }),
  exportChatHistory: (ticketId: number) => api.post(`/knowledge/tickets/${ticketId}/export-chat`),
  updateKnowledge: (id: number, data: { title?: string; content: string; tags?: string }) => api.put(`/knowledge/${id}`, data),
  search: (q: string, page: number = 1, docType?: string) => api.get('/knowledge', { params: { q, page, docType } }),
  getOne: (id: number) => api.get(`/knowledge/${id}`),
  getByTicket: (ticketId: number) => api.get(`/knowledge/ticket/${ticketId}`),
  deleteOne: (id: number) => api.delete(`/knowledge/${id}`),
};

// Report API
export const reportAPI = {
  getSummary: (params?: any) => api.get('/report/summary', { params }),
  getCategoryStats: (params?: any) => api.get('/report/by-category', { params }),
  getCategory2Stats: (category1: string, params?: any) => api.get('/report/by-category2', { params: { ...params, category1 } }),
  getCategory3Stats: (category2: string, params?: any) => api.get('/report/by-category3', { params: { ...params, category2 } }),
  getByPerson: (limit?: number, params?: any) => api.get('/report/by-person', { params: { ...params, limit } }),
  getByCustomer: (params?: any) => api.get('/report/by-customer', { params }),
  getTimeSeries: (dimension?: string, params?: any) => api.get('/report/time-series', { params: { ...params, dimension } }),
  getCrossMatrix: (categoryName: string, level: string, limit: number = 8, params?: any) => api.get('/report/cross-matrix', { params: { ...params, categoryName, level, limit } }),
  drillTypePerson: (params: any) => api.get('/report/drill/type-person', { params }),
  drillPersonTickets: (params: any) => api.get('/report/drill/person-tickets', { params }),
  drillCustomerTickets: (params: any) => api.get('/report/drill/customer-tickets', { params }),
  exportXlsx: (params?: any) => api.get('/report/export-xlsx', { params, responseType: 'blob' }),
};

// Category API
export const categoryAPI = {
  importExcel: (formData: FormData) => api.post('/category/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getTree: () => api.get('/category/tree'),
  getAll: () => api.get('/category/all'),
};

// Audit API
export const auditAPI = {
  getLogs: (params?: any) => api.get('/audit/logs', { params }),
  deleteLogs: (data: { type?: string; startDate?: string; endDate?: string }) =>
    api.delete('/audit/logs', { data }),
  getSettings: () => api.get('/audit/settings'),
  updateSettings: (data: Record<string, boolean>) => api.put('/audit/settings', data),
};

// BBS API
export const bbsAPI = {
  // 板块
  getSections: () => api.get('/bbs/sections'),
  createSection: (data: any) => api.post('/bbs/sections', data),
  updateSection: (id: number, data: any) => api.put(`/bbs/sections/${id}`, data),
  deleteSection: (id: number) => api.delete(`/bbs/sections/${id}`),
  // 预设标签
  getTags: () => api.get('/bbs/tags'),
  createTag: (data: any) => api.post('/bbs/tags', data),
  deleteTag: (id: number) => api.delete(`/bbs/tags/${id}`),

  // Subscription/Notification
  getNotifications: () => api.get('/bbs/notifications'),
  subscribe: (id: number) => api.post(`/bbs/posts/${id}/subscribe`),
  unsubscribe: (id: number) => api.delete(`/bbs/posts/${id}/subscribe`),
  getSubscriptionStatus: (id: number) => api.get(`/bbs/posts/${id}/subscribe`),
  clearUnread: (id: number) => api.post(`/bbs/posts/${id}/clearUnread`),

  // 帖子迁移
  migratePosts: (ids: number[], targetSectionId: number) =>
    api.put('/bbs/posts/migrate', { ids, targetSectionId }),
  generateShareToken: (id: number) => api.post(`/bbs/posts/${id}/share`),
};

export const searchAPI = {
  search: (params: { q: string; type?: string; page?: number; pageSize?: number }) => api.get('/search', { params }),
  syncAll: () => api.post('/search/sync'),
};

// Backup API
export const backupAPI = {
  getStats: () => api.get('/backup/stats'),
  create: (options: { includeImages?: boolean; includeFiles?: boolean; includeAuditLogs?: boolean }) =>
    api.post('/backup/create', options, { timeout: 300000 }), // 5 min timeout for large backups
  list: () => api.get('/backup/list'),
  download: (filename: string) => {
    const token = localStorage.getItem('accessToken');
    // Use window.open for direct file download
    window.open(`/api/backup/download/${encodeURIComponent(filename)}?token=${token}`, '_blank');
  },
  restore: (file: File, onProgress?: (percent: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/backup/restore', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000, // 10 min timeout for large restores
      onUploadProgress: (e: any) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
  },
  delete: (filename: string) => api.delete(`/backup/${encodeURIComponent(filename)}`),
};

// Infra API
export const infraAPI = {
  getEnv: () => api.get('/infra/env'),
  saveEnv: (data: Record<string, string>) => api.post('/infra/env', data),
  restart: () => api.post('/infra/restart'),
  testEs: (data: any) => api.post('/infra/test-es', data),
  testRedis: (data: any) => api.post('/infra/test-redis', data),
  testMysql: (data: any) => api.post('/infra/test-mysql', data),
  rebuildIndex: () => api.post('/infra/rebuild-index', {}, { timeout: 300000 }),
};

export default api;
