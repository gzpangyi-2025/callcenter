import axios from 'axios';
import { message } from 'antd';
import COS from 'cos-js-sdk-v5';
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
  login: (data: { username: string; password: string }): Promise<ApiResponse<any>> =>
    api.post('/auth/login', data),
  register: (data: { username: string; password: string; realName: string; email?: string; displayName?: string }): Promise<ApiResponse<any>> =>
    api.post('/auth/register', data),
  logout: (): Promise<ApiResponse<void>> => api.post('/auth/logout'),
  getMe: (): Promise<ApiResponse<User>> => api.get('/auth/me'),
  refresh: (): Promise<ApiResponse<any>> => api.post('/auth/refresh'),
  externalLogin: (ticketToken: string, nickname: string): Promise<ApiResponse<any>> => api.post('/auth/external/login', { ticketToken, nickname }),
  bbsExternalLogin: (token: string): Promise<ApiResponse<any>> => api.post('/auth/external/bbs-login', { token }),
};

// Tickets API
export const ticketsAPI = {
  create: (data: CreateTicketDto): Promise<ApiResponse<Ticket>> => api.post('/tickets', data),
  getAll: (params?: TicketQueryParams): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/tickets', { params }),
  getAggregates: (params?: TicketQueryParams): Promise<ApiResponse<any>> => api.get('/tickets/aggregates', { params }),
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
  upload: async (file: File): Promise<ApiResponse<any>> => {
    try {
      const { data: credResult } = await api.get('/files/upload-credentials', { params: { filename: file.name } });
      const { provider, credentials, startTime, expiredTime, bucket, region, key } = credResult;

      if (provider === 'local') {
        const formData = new FormData();
        formData.append('file', file);
        return api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      const cos = new COS({
        getAuthorization: (_options, callback) => {
          callback({
            TmpSecretId: credentials.tmpSecretId,
            TmpSecretKey: credentials.tmpSecretKey,
            SecurityToken: credentials.sessionToken,
            StartTime: startTime,
            ExpiredTime: expiredTime,
          });
        }
      });

      await new Promise((resolve, reject) => {
        cos.sliceUploadFile({
          Bucket: bucket,
          Region: region,
          Key: key,
          Body: file,
          ContentType: file.type || 'application/octet-stream',
        }, function(err, data) {
           if (err) reject(err);
           else resolve(data);
        });
      });

      return await api.post('/files/confirm', {
        key,
        originalName: file.name,
        size: file.size,
        mimetype: file.type || 'application/octet-stream',
      });
    } catch (e) {
      console.warn('COS direct upload failed, falling back to standard upload...', e);
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }
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
  getAll: (): Promise<ApiResponse<any[]>> => api.get('/roles'),
  getPermissions: (): Promise<ApiResponse<any[]>> => api.get('/roles/permissions'),
  updatePermissions: (id: number, permissionIds: number[]): Promise<ApiResponse<void>> => api.post(`/roles/${id}/permissions`, { permissionIds }),
  create: (data: { name: string; description?: string; permissionIds?: number[] }): Promise<ApiResponse<any>> => api.post('/roles', data),
  deleteRole: (id: number): Promise<ApiResponse<void>> => api.delete(`/roles/${id}`),
};

// Settings API
export const settingsAPI = {
  getAll: (): Promise<ApiResponse<any>> => api.get('/settings'),
  saveAi: (data: {
    visionModel?: string; visionApiKey?: string;
    systemPrompt?: string; imageModel?: string; imageApiKey?: string;
    chatModel?: string; chatApiKey?: string;
  }): Promise<ApiResponse<void>> => api.post('/settings/ai', data),
  saveBiz: (data: {
    companyName?: string; websiteUrl?: string;
    companyEmail?: string; companyPhone?: string; sla?: string;
  }): Promise<ApiResponse<void>> => api.post('/settings/biz', data),
  saveSecurity: (data: { shareExpiration?: string }): Promise<ApiResponse<void>> => api.post('/settings/security', data),
  saveStorage: (data: {
    provider?: string; cosSecretId?: string; cosSecretKey?: string;
    cosBucket?: string; cosRegion?: string;
  }): Promise<ApiResponse<void>> => api.post('/settings/storage', data),
  getMigrationStats: (): Promise<ApiResponse<any>> => api.get('/files/migration-stats'),
  migrateStorage: (): Promise<ApiResponse<void>> => api.post('/files/migrate'),

  uploadLogo: (file: File): Promise<ApiResponse<any>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/settings/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getWebRtcConfig: (): Promise<ApiResponse<any>> => api.get('/settings/webrtc-config'),
  saveWebRtc: (data: {
    mode?: string; customStun?: string;
    customTurn?: string; turnUsername?: string; turnPassword?: string;
    screenShareMaxViewers?: number; voiceMaxParticipants?: number;
  }): Promise<ApiResponse<void>> => api.post('/settings/webrtc', data),
  saveCodexConfig: (data: { maxRetries?: number; concurrency?: number }): Promise<ApiResponse<any>> =>
    api.post('/settings/codex', data),
  getCodexConfig: (): Promise<ApiResponse<any>> => api.get('/settings/codex'),
};

// Knowledge API
export const knowledgeAPI = {
  generateDraft: (ticketId: number): Promise<ApiResponse<any>> => api.post(`/knowledge/tickets/${ticketId}/generate`, {}, { timeout: 120000 }),
  saveKnowledge: (data: { ticketId: number; title: string; content: string; tags?: string; category?: string; severity?: string; analysisImgUrl?: string; flowImgUrl?: string; }): Promise<ApiResponse<any>> => api.post('/knowledge', data, { timeout: 60000 }),
  exportChatHistory: (ticketId: number): Promise<ApiResponse<any>> => api.post(`/knowledge/tickets/${ticketId}/export-chat`),
  updateKnowledge: (id: number, data: { title?: string; content: string; tags?: string }): Promise<ApiResponse<any>> => api.put(`/knowledge/${id}`, data),
  search: (q: string, page: number = 1, docType?: string): Promise<ApiResponse<PaginatedData<any>>> => api.get('/knowledge', { params: { q, page, docType } }),
  getOne: (id: number): Promise<ApiResponse<any>> => api.get(`/knowledge/${id}`),
  getByTicket: (ticketId: number): Promise<ApiResponse<any[]>> => api.get(`/knowledge/ticket/${ticketId}`),
  deleteOne: (id: number): Promise<ApiResponse<void>> => api.delete(`/knowledge/${id}`),
};

// Report API
export const reportAPI = {
  getSummary: (params?: any): Promise<ApiResponse<any>> => api.get('/report/summary', { params }),
  getCategoryStats: (params?: any): Promise<ApiResponse<any[]>> => api.get('/report/by-category', { params }),
  getCategory2Stats: (category1: string, params?: any): Promise<ApiResponse<any[]>> => api.get('/report/by-category2', { params: { ...params, category1 } }),
  getCategory3Stats: (category2: string, params?: any): Promise<ApiResponse<any[]>> => api.get('/report/by-category3', { params: { ...params, category2 } }),
  getByPerson: (limit?: number, params?: any): Promise<ApiResponse<any[]>> => api.get('/report/by-person', { params: { ...params, limit } }),
  getByCustomer: (params?: any): Promise<ApiResponse<any[]>> => api.get('/report/by-customer', { params }),
  getTimeSeries: (dimension?: string, params?: any): Promise<ApiResponse<any[]>> => api.get('/report/time-series', { params: { ...params, dimension } }),
  getCrossMatrix: (categoryName: string, level: string, limit: number = 8, params?: any): Promise<ApiResponse<any>> => api.get('/report/cross-matrix', { params: { ...params, categoryName, level, limit } }),
  drillTypePerson: (params: any): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/report/drill/type-person', { params }),
  drillPersonTickets: (params: any): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/report/drill/person-tickets', { params }),
  drillCustomerTickets: (params: any): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/report/drill/customer-tickets', { params }),
  exportXlsx: (params?: any): Promise<Blob> => api.get('/report/export-xlsx', { params, responseType: 'blob' }),
};

// Category API
export const categoryAPI = {
  importExcel: (formData: FormData): Promise<ApiResponse<any>> => api.post('/category/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getTree: (): Promise<ApiResponse<any[]>> => api.get('/category/tree'),
  getAll: (): Promise<ApiResponse<any[]>> => api.get('/category/all'),
};

// Audit API
export const auditAPI = {
  getLogs: (params?: any): Promise<ApiResponse<PaginatedData<any>>> => api.get('/audit/logs', { params }),
  deleteLogs: (data: { type?: string; startDate?: string; endDate?: string }): Promise<ApiResponse<void>> =>
    api.delete('/audit/logs', { data }),
  getSettings: (): Promise<ApiResponse<Record<string, boolean>>> => api.get('/audit/settings'),
  updateSettings: (data: Record<string, boolean>): Promise<ApiResponse<void>> => api.put('/audit/settings', data),
};

// BBS API
export const bbsAPI = {
  // 板块
  getSections: (): Promise<ApiResponse<any[]>> => api.get('/bbs/sections'),
  createSection: (data: any): Promise<ApiResponse<any>> => api.post('/bbs/sections', data),
  updateSection: (id: number, data: any): Promise<ApiResponse<any>> => api.put(`/bbs/sections/${id}`, data),
  deleteSection: (id: number): Promise<ApiResponse<void>> => api.delete(`/bbs/sections/${id}`),
  // 预设标签
  getTags: (): Promise<ApiResponse<any[]>> => api.get('/bbs/tags'),
  createTag: (data: any): Promise<ApiResponse<any>> => api.post('/bbs/tags', data),
  deleteTag: (id: number): Promise<ApiResponse<void>> => api.delete(`/bbs/tags/${id}`),

  // Subscription/Notification
  getNotifications: (): Promise<ApiResponse<any[]>> => api.get('/bbs/notifications'),
  subscribe: (id: number): Promise<ApiResponse<void>> => api.post(`/bbs/posts/${id}/subscribe`),
  unsubscribe: (id: number): Promise<ApiResponse<void>> => api.delete(`/bbs/posts/${id}/subscribe`),
  getSubscriptionStatus: (id: number): Promise<ApiResponse<{ subscribed: boolean }>> => api.get(`/bbs/posts/${id}/subscribe`),
  clearUnread: (id: number): Promise<ApiResponse<void>> => api.post(`/bbs/posts/${id}/clearUnread`),

  // 帖子迁移
  migratePosts: (ids: number[], targetSectionId: number): Promise<ApiResponse<void>> =>
    api.put('/bbs/posts/migrate', { ids, targetSectionId }),
  generateShareToken: (id: number): Promise<ApiResponse<string>> => api.post(`/bbs/posts/${id}/share`),
};

export const searchAPI = {
  search: (params: { q: string; type?: string; page?: number; pageSize?: number }): Promise<ApiResponse<PaginatedData<any>>> => api.get('/search', { params }),
  syncAll: (): Promise<ApiResponse<void>> => api.post('/search/sync'),
};

// Backup API
export const backupAPI = {
  getStats: (): Promise<ApiResponse<any>> => api.get('/backup/stats'),
  create: (options: { includeImages?: boolean; includeFiles?: boolean; includeAuditLogs?: boolean }): Promise<ApiResponse<any>> =>
    api.post('/backup/create', options, { timeout: 300000 }), // 5 min timeout for large backups
  list: (): Promise<ApiResponse<any[]>> => api.get('/backup/list'),
  download: (filename: string): void => {
    const token = localStorage.getItem('accessToken');
    // Use window.open for direct file download
    window.open(`/api/backup/download/${encodeURIComponent(filename)}?token=${token}`, '_blank');
  },
  restore: (file: File, onProgress?: (percent: number) => void): Promise<ApiResponse<void>> => {
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
  delete: (filename: string): Promise<ApiResponse<void>> => api.delete(`/backup/${encodeURIComponent(filename)}`),
  cleanOrphans: (): Promise<ApiResponse<any>> => api.post('/backup/clean-orphans', {}, { timeout: 120000 }),
  getCosOrphans: (): Promise<ApiResponse<any>> => api.get('/backup/cos-orphans', { timeout: 120000 }),
  cleanCosOrphans: (): Promise<ApiResponse<void>> => api.post('/backup/clean-cos-orphans', {}, { timeout: 120000 }),
};

// Infra API
export const infraAPI = {
  getEnv: (): Promise<ApiResponse<Record<string, string>>> => api.get('/infra/env'),
  saveEnv: (data: Record<string, string>): Promise<ApiResponse<void>> => api.post('/infra/env', data),
  restart: (): Promise<ApiResponse<void>> => api.post('/infra/restart'),
  testEs: (data: any): Promise<ApiResponse<any>> => api.post('/infra/test-es', data),
  testRedis: (data: any): Promise<ApiResponse<any>> => api.post('/infra/test-redis', data),
  testMysql: (data: any): Promise<ApiResponse<any>> => api.post('/infra/test-mysql', data),
  rebuildIndex: (): Promise<ApiResponse<void>> => api.post('/infra/rebuild-index', {}, { timeout: 300000 }),
};

// AI / Codex Worker API (proxied through CallCenter backend)
export const aiAPI = {
  /** 获取 Codex Worker 健康状态 */
  health: (): Promise<any> => api.get('/ai/health'),

  /** 获取可用任务模板列表 */
  getTemplates: (): Promise<any> => api.get('/ai/templates'),

  /** 获取直接上传附件到 Worker COS 的预签名 URL */
  getUploadUrl: (taskId: string, filename: string): Promise<any> => 
    api.get('/ai/upload-url', { params: { taskId, filename } }),

  /** 提交新 AI 任务 */
  createTask: (data: {
    id?: string;
    type: string;
    params: Record<string, unknown>;
    prompt?: string;
    parentTaskId?: string;
    attachments?: Array<{ name: string; url: string; size: number }>;
  }): Promise<any> => api.post('/ai/tasks', data),

  /** 任务列表（带分页/状态过滤） */
  listTasks: (params?: {
    page?: number;
    limit?: number;
    status?: string;
    all?: string;
  }): Promise<any> => api.get('/ai/tasks', {
    params: { ...params, _t: Date.now() },
    headers: { 'Cache-Control': 'no-cache' },
  }),

  /** 获取任务详情 */
  getTask: (id: string): Promise<any> => api.get(`/ai/tasks/${id}`),

  /** 取消任务 */
  cancelTask: (id: string): Promise<any> => api.post(`/ai/tasks/${id}/cancel`),

  /** 删除任务（含COS文件清理） */
  deleteTask: (id: string): Promise<any> => api.delete(`/ai/tasks/${id}`),

  /** 恢复暂停的任务（提交审阅确认） */
  resumeTask: (id: string, input: string): Promise<any> => api.post(`/ai/tasks/${id}/resume`, { input }),

  /** 获取任务产物下载链接 */
  getTaskFiles: (id: string): Promise<any> => api.get(`/ai/tasks/${id}/files`),

  // ── Chat (Gemini Flash) ──────────────────────────────────────────────────

  /** 发送消息 (SSE 流式) — 返回的是 Response 对象而非 JSON */
  chatStream: (data: { sessionId?: string; message: string; images?: string[] }) => {
    const token = localStorage.getItem('accessToken') ?? '';
    return fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
  },

  /** 会话列表 */
  chatSessions: (): Promise<any> => api.get('/ai/chat/sessions'),

  /** 会话详情（含消息） */
  chatSessionDetail: (id: string): Promise<any> => api.get(`/ai/chat/sessions/${id}`),

  /** 注入消息到会话（如任务反馈） */
  injectChatMessage: (id: string, data: { role: 'assistant' | 'system'; content: string; metadata?: any }): Promise<any> =>
    api.post(`/ai/chat/sessions/${id}/messages`, data),

  /** 删除会话 */
  deleteChatSession: (id: string): Promise<any> => api.delete(`/ai/chat/sessions/${id}`),
};

export default api;
