import axios from 'axios';
import type {
  AxiosError,
  AxiosProgressEvent,
  InternalAxiosRequestConfig,
} from 'axios';
import { message } from 'antd';
import COS from 'cos-js-sdk-v5';
import type {
  AiChatMessagePayload,
  AiChatSession,
  AiCreateTaskPayload,
  AiHealth,
  AiListParams,
  AiTask,
  AiTaskFile,
  AiTaskListData,
  AiTemplate,
  AiUploadUrl,
  ApiResponse,
  AuthTokenPayload,
  BbsNotification,
  CategoryNode,
  FileUploadResult,
  GlobalSearchData,
  KnowledgeDocument,
  PaginatedData,
  ReportCategoryLevel,
  ReportCategoryStats,
  ReportCrossMatrix,
  ReportCustomerDrillParams,
  ReportCustomerStats,
  ReportDimension,
  ReportFilterParams,
  ReportPersonDrillParams,
  ReportPersonStats,
  ReportStatItem,
  ReportSummary,
  ReportTimeSeriesItem,
  TicketAggregates,
  TicketBatchSummary,
  UploadCredentials,
  WorkerApiResponse,
} from '../types/api';
import type { User, UpdateUserInfoParam } from '../types/user';
import type { User as AuthUser } from '../stores/authStore';
import type { Ticket, CreateTicketDto, UpdateTicketDto, TicketQueryParams, TicketBadgeSummary } from '../types/ticket';

interface ApiRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _silent?: boolean;
}

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
  async (error: AxiosError<ApiResponse<unknown>>) => {
    const originalRequest = error.config as ApiRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const res = await axios.post<ApiResponse<AuthTokenPayload>>(
          '/api/auth/refresh',
          {},
          { withCredentials: true },
        );
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
  login: (data: { username: string; password: string }): Promise<ApiResponse<AuthTokenPayload & { user?: AuthUser }>> =>
    api.post('/auth/login', data),
  register: (data: { username: string; password: string; realName: string; email?: string; displayName?: string }): Promise<ApiResponse<AuthTokenPayload & { user?: AuthUser }>> =>
    api.post('/auth/register', data),
  logout: (): Promise<ApiResponse<void>> => api.post('/auth/logout'),
  getMe: (): Promise<ApiResponse<AuthUser>> => api.get('/auth/me'),
  refresh: (): Promise<ApiResponse<AuthTokenPayload>> => api.post('/auth/refresh'),
  externalLogin: (ticketToken: string, nickname: string): Promise<ApiResponse<AuthTokenPayload & { user?: AuthUser }>> => api.post('/auth/external/login', { ticketToken, nickname }),
  bbsExternalLogin: (token: string): Promise<ApiResponse<AuthTokenPayload & { user?: AuthUser }>> => api.post('/auth/external/bbs-login', { token }),
};

// Tickets API
export const ticketsAPI = {
  create: (data: CreateTicketDto): Promise<ApiResponse<Ticket>> => api.post('/tickets', data),
  getAll: (params?: TicketQueryParams): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/tickets', { params }),
  getAggregates: (params?: TicketQueryParams): Promise<ApiResponse<TicketAggregates>> => api.get('/tickets/aggregates', { params }),
  getById: (id: number): Promise<ApiResponse<Ticket>> => api.get(`/tickets/${id}`),
  getMyBadges: (): Promise<ApiResponse<TicketBadgeSummary>> => api.get('/tickets/my/badges'),
  getBatchSummary: (ids: number[]): Promise<ApiResponse<TicketBatchSummary[]>> => api.post('/tickets/batch/summary', { ids }),
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
  upload: async (file: File, moduleName?: string): Promise<ApiResponse<FileUploadResult>> => {
    try {
      const credentialResponse = await api.get('/files/upload-credentials', { 
        params: { filename: file.name, ...(moduleName ? { module: moduleName } : {}) } 
      }) as unknown as ApiResponse<UploadCredentials>;
      const credResult = credentialResponse.data;
      const { provider } = credResult;

      if (provider === 'local') {
        const formData = new FormData();
        formData.append('file', file);
        if (moduleName) formData.append('module', moduleName);
        return api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      if (provider === 's3') {
        await axios.put(credResult.presignedUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
        
        return await api.post('/files/confirm', {
          key: credResult.key,
          originalName: file.name,
          size: file.size,
          mimetype: file.type || 'application/octet-stream',
        });
      }

      const cos = new COS({
        getAuthorization: (_options, callback) => {
          callback({
            TmpSecretId: credResult.credentials.tmpSecretId,
            TmpSecretKey: credResult.credentials.tmpSecretKey,
            SecurityToken: credResult.credentials.sessionToken,
            StartTime: credResult.startTime,
            ExpiredTime: credResult.expiredTime,
          });
        }
      });

      await new Promise((resolve, reject) => {
        cos.sliceUploadFile({
          Bucket: credResult.bucket,
          Region: credResult.region,
          Key: credResult.key,
          Body: file,
          ContentType: file.type || 'application/octet-stream',
        }, function(err, data) {
           if (err) reject(err);
           else resolve(data);
        });
      });

      return await api.post('/files/confirm', {
          key: credResult.key,
        originalName: file.name,
        size: file.size,
        mimetype: file.type || 'application/octet-stream',
      });
    } catch (e) {
      console.warn('COS direct upload failed, falling back to standard upload...', e);
      const formData = new FormData();
      formData.append('file', file);
      if (moduleName) formData.append('module', moduleName);
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
  getAll: (): Promise<ApiResponse<unknown[]>> => api.get('/roles'),
  getPermissions: (): Promise<ApiResponse<unknown[]>> => api.get('/roles/permissions'),
  updatePermissions: (id: number, permissionIds: number[]): Promise<ApiResponse<void>> => api.post(`/roles/${id}/permissions`, { permissionIds }),
  create: (data: { name: string; description?: string; permissionIds?: number[] }): Promise<ApiResponse<unknown>> => api.post('/roles', data),
  deleteRole: (id: number): Promise<ApiResponse<void>> => api.delete(`/roles/${id}`),
};

// Settings API
export const settingsAPI = {
  getAll: (): Promise<ApiResponse<Record<string, string>>> => api.get('/settings'),
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
  getMigrationStats: (): Promise<ApiResponse<unknown>> => api.get('/files/migration-stats'),
  migrateStorage: (): Promise<ApiResponse<void>> => api.post('/files/migrate'),

  uploadLogo: (file: File): Promise<ApiResponse<FileUploadResult>> => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/settings/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  getWebRtcConfig: (): Promise<ApiResponse<Record<string, unknown>>> => api.get('/settings/webrtc-config'),
  saveWebRtc: (data: {
    mode?: string; customStun?: string;
    customTurn?: string; turnUsername?: string; turnPassword?: string;
    screenShareMaxViewers?: number; voiceMaxParticipants?: number;
  }): Promise<ApiResponse<void>> => api.post('/settings/webrtc', data),
  saveCodexConfig: (data: { concurrency?: number; maxResumeAttempts?: number }): Promise<ApiResponse<Record<string, unknown>>> =>
    api.post('/settings/codex', data),
  getCodexConfig: (): Promise<ApiResponse<Record<string, unknown>>> => api.get('/settings/codex'),
};

// Knowledge API
export const knowledgeAPI = {
  generateDraft: (ticketId: number): Promise<ApiResponse<Record<string, unknown>>> => api.post(`/knowledge/tickets/${ticketId}/generate`, {}, { timeout: 120000 }),
  saveKnowledge: (data: { ticketId: number; title: string; content: string; tags?: string; category?: string; severity?: string; analysisImgUrl?: string; flowImgUrl?: string; }): Promise<ApiResponse<Record<string, unknown>>> => api.post('/knowledge', data, { timeout: 60000 }),
  exportChatHistory: (ticketId: number): Promise<ApiResponse<Record<string, unknown>>> => api.post(`/knowledge/tickets/${ticketId}/export-chat`),
  updateKnowledge: (id: number, data: { title?: string; content: string; tags?: string }): Promise<ApiResponse<Record<string, unknown>>> => api.put(`/knowledge/${id}`, data),
  search: (q: string, page: number = 1, docType?: string): Promise<ApiResponse<PaginatedData<KnowledgeDocument>>> => api.get('/knowledge', { params: { q, page, docType } }),
  getOne: (id: number): Promise<ApiResponse<KnowledgeDocument>> => api.get(`/knowledge/${id}`),
  getByTicket: (ticketId: number): Promise<ApiResponse<KnowledgeDocument[]>> => api.get(`/knowledge/ticket/${ticketId}`),
  deleteOne: (id: number): Promise<ApiResponse<void>> => api.delete(`/knowledge/${id}`),
};

// Report API
export const reportAPI = {
  getSummary: (params?: ReportFilterParams): Promise<ApiResponse<ReportSummary>> => api.get('/report/summary', { params }),
  getCategoryStats: (params?: ReportFilterParams): Promise<ApiResponse<ReportCategoryStats>> => api.get('/report/by-category', { params }),
  getCategory2Stats: (category1: string, params?: ReportFilterParams): Promise<ApiResponse<ReportStatItem[]>> => api.get('/report/by-category2', { params: { ...params, category1 } }),
  getCategory3Stats: (category2: string, params?: ReportFilterParams): Promise<ApiResponse<ReportStatItem[]>> => api.get('/report/by-category3', { params: { ...params, category2 } }),
  getByPerson: (limit?: number, params?: ReportFilterParams): Promise<ApiResponse<ReportPersonStats>> => api.get('/report/by-person', { params: { ...params, limit } }),
  getByCustomer: (params?: ReportFilterParams): Promise<ApiResponse<ReportCustomerStats[]>> => api.get('/report/by-customer', { params }),
  getTimeSeries: (dimension?: ReportDimension, params?: ReportFilterParams): Promise<ApiResponse<ReportTimeSeriesItem[]>> => api.get('/report/time-series', { params: { ...params, dimension } }),
  getCrossMatrix: (categoryName: string, level: ReportCategoryLevel, limit: number = 8, params?: ReportFilterParams): Promise<ApiResponse<ReportCrossMatrix>> => api.get('/report/cross-matrix', { params: { ...params, categoryName, level, limit } }),
  drillTypePerson: (params: ReportPersonDrillParams): Promise<ApiResponse<PaginatedData<Ticket>>> => api.get('/report/drill/type-person', { params }),
  drillPersonTickets: (params: ReportPersonDrillParams): Promise<ApiResponse<PaginatedData<Ticket> | Ticket[]>> => api.get('/report/drill/person-tickets', { params }),
  drillCustomerTickets: (params: ReportCustomerDrillParams): Promise<ApiResponse<PaginatedData<Ticket> | Ticket[]>> => api.get('/report/drill/customer-tickets', { params }),
  exportXlsx: (params?: ReportFilterParams): Promise<Blob> => api.get('/report/export-xlsx', { params, responseType: 'blob' }),
};

// Category API
export const categoryAPI = {
  importExcel: (formData: FormData): Promise<ApiResponse<unknown>> => api.post('/category/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  getTree: (): Promise<ApiResponse<CategoryNode[]>> => api.get('/category/tree'),
  getAll: (): Promise<ApiResponse<CategoryNode[]>> => api.get('/category/all'),
};

// Audit API
export const auditAPI = {
  getLogs: (params?: Record<string, unknown>): Promise<ApiResponse<PaginatedData<Record<string, unknown>>>> => api.get('/audit/logs', { params }),
  deleteLogs: (data: { type?: string; startDate?: string; endDate?: string }): Promise<ApiResponse<void>> =>
    api.delete('/audit/logs', { data }),
  getSettings: (): Promise<ApiResponse<Record<string, boolean>>> => api.get('/audit/settings'),
  updateSettings: (data: Record<string, boolean>): Promise<ApiResponse<void>> => api.put('/audit/settings', data),
};

// BBS API
export const bbsAPI = {
  // 板块
  getSections: (): Promise<ApiResponse<Array<Record<string, unknown>>>> => api.get('/bbs/sections'),
  createSection: (data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> => api.post('/bbs/sections', data),
  updateSection: (id: number, data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> => api.put(`/bbs/sections/${id}`, data),
  deleteSection: (id: number): Promise<ApiResponse<void>> => api.delete(`/bbs/sections/${id}`),
  // 预设标签
  getTags: (): Promise<ApiResponse<Array<Record<string, unknown>>>> => api.get('/bbs/tags'),
  createTag: (data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> => api.post('/bbs/tags', data),
  deleteTag: (id: number): Promise<ApiResponse<void>> => api.delete(`/bbs/tags/${id}`),

  // Subscription/Notification
  getNotifications: (): Promise<ApiResponse<BbsNotification[]>> => api.get('/bbs/notifications'),
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
  search: (params: { q: string; type?: string; page?: number; pageSize?: number }): Promise<GlobalSearchData> => api.get('/search', { params }),
  syncAll: (): Promise<ApiResponse<void>> => api.post('/search/sync'),
};

// Backup API
export interface BackupStats {
  totalBackups?: number;
  totalSize?: number;
  latestBackup?: string;
  [key: string]: unknown;
}

export interface BackupFile {
  filename: string;
  size?: number;
  createdAt?: string;
  [key: string]: unknown;
}

export const backupAPI = {
  getStats: (): Promise<ApiResponse<BackupStats>> => api.get('/backup/stats'),
  create: (options: { includeImages?: boolean; includeFiles?: boolean; includeAuditLogs?: boolean }): Promise<ApiResponse<BackupFile>> =>
    api.post('/backup/create', options, { timeout: 300000 }), // 5 min timeout for large backups
  list: (): Promise<ApiResponse<BackupFile[]>> => api.get('/backup/list'),
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
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
  },
  delete: (filename: string): Promise<ApiResponse<void>> => api.delete(`/backup/${encodeURIComponent(filename)}`),
  cleanOrphans: (): Promise<ApiResponse<unknown>> => api.post('/backup/clean-orphans', {}, { timeout: 120000 }),
  getCosOrphans: (): Promise<ApiResponse<unknown>> => api.get('/backup/cos-orphans', { timeout: 120000 }),
  cleanCosOrphans: (): Promise<ApiResponse<void>> => api.post('/backup/clean-cos-orphans', {}, { timeout: 120000 }),
};

// Infra API
export const infraAPI = {
  getEnv: (): Promise<ApiResponse<Record<string, string>>> => api.get('/infra/env'),
  saveEnv: (data: Record<string, string>): Promise<ApiResponse<void>> => api.post('/infra/env', data),
  restart: (): Promise<ApiResponse<void>> => api.post('/infra/restart'),
  testEs: (data: Record<string, unknown>): Promise<ApiResponse<unknown>> => api.post('/infra/test-es', data),
  testRedis: (data: Record<string, unknown>): Promise<ApiResponse<unknown>> => api.post('/infra/test-redis', data),
  testMysql: (data: Record<string, unknown>): Promise<ApiResponse<unknown>> => api.post('/infra/test-mysql', data),
  rebuildIndex: (): Promise<ApiResponse<void>> => api.post('/infra/rebuild-index', {}, { timeout: 300000 }),
};

// AI / Codex Worker API (proxied through CallCenter backend)
export const aiAPI = {
  /** 获取 Codex Worker 健康状态 */
  health: (): Promise<ApiResponse<AiHealth> | AiHealth> => api.get('/ai/health'),

  /** 获取可用任务模板列表 */
  getTemplates: (): Promise<ApiResponse<AiTemplate[]> | WorkerApiResponse<AiTemplate[]> | AiTemplate[]> => api.get('/ai/templates'),

  /** 获取直接上传附件到 Worker COS 的预签名 URL */
  getUploadUrl: (taskId: string, filename: string): Promise<ApiResponse<AiUploadUrl> | AiUploadUrl> => 
    api.get('/ai/upload-url', { params: { taskId, filename } }),

  /** 提交新 AI 任务 */
  createTask: (data: AiCreateTaskPayload): Promise<ApiResponse<AiTask> | AiTask> => api.post('/ai/tasks', data),

  /** 任务列表（带分页/状态过滤） */
  listTasks: (params?: AiListParams): Promise<ApiResponse<AiTaskListData> | AiTaskListData> => api.get('/ai/tasks', {
    params: { ...params, _t: Date.now() },
    headers: { 'Cache-Control': 'no-cache' },
  }),

  /** 获取任务详情 */
  getTask: (id: string): Promise<ApiResponse<AiTask> | AiTask> => api.get(`/ai/tasks/${id}`),

  /** 取消任务 */
  cancelTask: (id: string): Promise<ApiResponse<AiTask> | AiTask> => api.post(`/ai/tasks/${id}/cancel`),

  /** 删除任务（含COS文件清理） */
  deleteTask: (id: string): Promise<ApiResponse<void> | void> => api.delete(`/ai/tasks/${id}`),

  /** 恢复暂停的任务（提交审阅确认） */
  resumeTask: (id: string, input: string): Promise<ApiResponse<AiTask> | AiTask> => api.post(`/ai/tasks/${id}/resume`, { input }),

  /** 获取任务产物下载链接 */
  getTaskFiles: (id: string): Promise<ApiResponse<AiTaskFile[]> | AiTaskFile[] | { data: AiTaskFile[] }> => api.get(`/ai/tasks/${id}/files`),

  /** 获取已完成任务的预览文件（slides、图片等） */
  getTaskPreviews: (id: string): Promise<ApiResponse<AiTaskFile[]> | AiTaskFile[]> => api.get(`/ai/tasks/${id}/previews`),

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
  chatSessions: (): Promise<ApiResponse<AiChatSession[]>> => api.get('/ai/chat/sessions'),

  /** 会话详情（含消息） */
  chatSessionDetail: (id: string): Promise<ApiResponse<AiChatSession & { messages?: unknown[] }>> => api.get(`/ai/chat/sessions/${id}`),

  /** 注入消息到会话（如任务反馈） */
  injectChatMessage: (id: string, data: AiChatMessagePayload): Promise<ApiResponse<unknown>> =>
    api.post(`/ai/chat/sessions/${id}/messages`, data),

  /** 删除会话 */
  deleteChatSession: (id: string): Promise<ApiResponse<void>> => api.delete(`/ai/chat/sessions/${id}`),
};

export default api;
