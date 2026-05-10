import type { Ticket } from './ticket';

export interface ApiResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

export interface WorkerApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface AuthTokenPayload {
  accessToken: string;
}

export interface FileUploadResult {
  url: string;
  originalName?: string;
  filename?: string;
  size: number;
  mimetype: string;
}

export interface CosTemporaryCredentials {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
}

export type UploadCredentials =
  | { provider: 'local' }
  | {
      provider: 's3';
      presignedUrl: string;
      key: string;
    }
  | {
      provider: 'cos';
      credentials: CosTemporaryCredentials;
      startTime: number;
      expiredTime: number;
      bucket: string;
      region: string;
      key: string;
    };

export interface FilterAggregateItem {
  label: string;
  value: string | number;
  count: number;
}

export interface TicketAggregates {
  categories: FilterAggregateItem[];
  customers: FilterAggregateItem[];
  creators: FilterAggregateItem[];
  assignees: FilterAggregateItem[];
}

export interface TicketBatchSummary {
  id: number;
  title?: string;
  ticketNo?: string;
  unreadCount?: number;
  latestMessageAt?: string;
  hasActiveScreenShare?: boolean;
}

export interface CategoryNode {
  value: string;
  label: string;
  children?: CategoryNode[];
}

export interface KnowledgeDocument {
  id: number;
  title: string;
  content?: string;
  type?: 'chat_history' | 'ai_doc' | string;
  tags?: string | null;
  severity?: string | null;
  category?: string | null;
  ticketId?: number;
  ticketNo?: string | null;
  generatedBy?: string | null;
  createdAt: string;
}

export type SearchResultType = 'post' | 'ticket' | 'knowledge' | 'message' | string;

export type SearchHighlight = Partial<Record<'title' | 'content' | 'aiSummary', string[]>>;

export interface SearchResultItem {
  id: string | number;
  type: SearchResultType;
  title?: string;
  content?: string;
  highlight?: SearchHighlight;
  authorName?: string;
  customerName?: string;
  senderName?: string;
  createdAt: string;
  sectionName?: string;
  ticketId?: string | number;
}

export interface GlobalSearchData {
  total: number;
  items: SearchResultItem[];
  aggregations?: Record<string, unknown>;
}

export interface ReportFilterParams {
  startDate?: string;
  endDate?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  creatorId?: number;
  assigneeId?: number;
  pageSize?: number;
}

export interface ReportSummary {
  total: number;
  pending: number;
  in_progress: number;
  closing: number;
  closed: number;
  avgHours: number;
}

export interface ReportStatItem {
  name: string;
  value: number;
}

export interface ReportCategoryStats {
  category1: ReportStatItem[];
  category2: ReportStatItem[];
}

export interface ReportTimeSeriesItem {
  date: string;
  count: number;
}

export interface ReportUserStat {
  userId: number;
  count: number;
  username: string;
  realName: string;
}

export interface ReportCrossMatrix {
  supporters: ReportUserStat[];
  requesters: ReportUserStat[];
}

export interface ReportPersonStats {
  creators: ReportUserStat[];
  assignees: ReportUserStat[];
  participants: ReportUserStat[];
}

export interface ReportCustomerStats {
  customerName: string;
  total: number;
  closed: number;
  active: number;
}

export type ReportDimension = 'day' | 'month' | 'quarter' | 'year';
export type ReportCategoryLevel = 'category2' | 'category3';
export type ReportPersonRole = 'creator' | 'assignee' | 'participant';

export interface ReportPersonDrillParams extends ReportFilterParams {
  userId: number;
  role: ReportPersonRole;
  categoryName?: string;
  categoryLevel?: ReportCategoryLevel;
}

export interface ReportCustomerDrillParams extends ReportFilterParams {
  customerName: string;
}

export type AiTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface AiTaskFile {
  name: string;
  url?: string;
  key?: string;
  size: number;
  path?: string;
  type?: string;
  mimeType?: string;
  isCore?: boolean;
  category?: 'core' | 'process' | string;
}

export interface AiTask {
  id: string;
  type: string;
  status: AiTaskStatus;
  params?: Record<string, unknown>;
  prompt?: string;
  progress?: number;
  currentStep?: string | null;
  lastAgentMessage?: string | null;
  error?: string | null;
  outputFiles?: AiTaskFile[];
  files?: AiTaskFile[];
  tokenUsage?: number | {
    input?: number;
    output?: number;
    total?: number;
  };
  userId?: number;
  creatorName?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AiTemplateVariable {
  name: string;
  label?: string;
  type?: 'text' | 'textarea' | 'select' | 'number' | 'boolean' | string;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
  options?: Array<string | { label: string; value: string | number | boolean }>;
}

export interface AiTemplate {
  name: string;
  title?: string;
  description?: string;
  variables?: AiTemplateVariable[];
}

export interface AiUploadUrl {
  url: string;
  key?: string;
  headers?: Record<string, string>;
}

export interface AiHealth {
  ok?: boolean;
  status?: string;
  version?: string;
}

export type AiTaskListData =
  | AiTask[]
  | PaginatedData<AiTask>
  | { data: AiTask[]; total?: number };

export interface AiListParams {
  page?: number;
  limit?: number;
  status?: AiTaskStatus | string;
  all?: '1';
}

export interface AiCreateTaskPayload {
  id?: string;
  type: string;
  params: Record<string, unknown>;
  prompt?: string;
  parentTaskId?: string;
  reviewMode?: 'review' | 'auto';
  attachments?: AiTaskFile[];
}

export interface AiChatMessagePayload {
  role: 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AiChatSession {
  id: string;
  title: string;
  userId: number;
  linkedTaskIds?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface BbsNotification {
  postId: number | string;
  unreadCount: number | string;
  post?: {
    title?: string;
  };
}

export type TicketListData = PaginatedData<Ticket>;
