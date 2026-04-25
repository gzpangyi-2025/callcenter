import type { User } from './user';

export type TicketStatus = 'pending' | 'in_progress' | 'closing' | 'closed';

export interface Ticket {
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
  serviceNo?: string;
  creator: User;
  creatorId: number;
  assignee?: User;
  assigneeId?: number;
  participants?: User[];
  createdAt: string;
  updatedAt: string;
  assignedAt?: string;
  closedAt?: string;
  isRoomLocked?: boolean;
  disableExternal?: boolean;
  hasActiveScreenShare?: boolean;
}

export interface CreateTicketDto {
  title: string;
  description: string;
  type?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  customerName?: string;
  serviceNo?: string;
  assigneeId?: number;
}

export interface UpdateTicketDto extends Partial<CreateTicketDto> {
  status?: TicketStatus;
}

export interface TicketQueryParams {
  page?: number;
  pageSize?: number;
  status?: TicketStatus;
  type?: string;
  keyword?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  creatorId?: number;
  assigneeId?: number;
  customerName?: string;
  isDashboard?: boolean;
}

export interface TicketBadgeSummary {
  unreadCount: number;
  newCount: number;
  total: number;
}
