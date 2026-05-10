import api from './api';

export type TicketStatus = 'pending' | 'in_progress' | 'closing' | 'closed';

export interface TicketItem {
  id: number;
  ticketNo: string;
  title: string;
  description: string;
  status: TicketStatus;
  type: string;
  category1?: string;
  category2?: string;
  category3?: string;
  customerName?: string;
  createdAt: string;
  creator?: {
    id: number;
    username: string;
    realName?: string;
    displayName?: string;
  };
  assignee?: {
    id: number;
    username: string;
    realName?: string;
    displayName?: string;
  };
  hasActiveScreenShare?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GetTicketsParams {
  page?: number;
  pageSize?: number;
  status?: TicketStatus | '';
  type?: string;
  keyword?: string;
}

export const ticketsService = {
  getTickets: async (params: GetTicketsParams): Promise<PaginatedResponse<TicketItem>> => {
    // 过滤掉空的 status，确保后端不会按空字符串查询
    const queryParams = { ...params };
    if (!queryParams.status) {
      delete queryParams.status;
    }
    
    const response = await api.get('/tickets', { params: queryParams });
    return response.data.data; // 后端返回 { code: 0, data: { items, total... } }
  },

  getTicketById: async (id: number): Promise<TicketItem> => {
    const response = await api.get(`/tickets/${id}`);
    return response.data.data;
  },
};
