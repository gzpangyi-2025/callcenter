export type TicketStatus = 'pending' | 'in_progress' | 'closing' | 'closed';

export const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; bg: string }> = {
  pending: { label: '待接单', color: '#ea580c', bg: '#fff7ed' },
  in_progress: { label: '服务中', color: '#00A8D4', bg: '#e6f8fb' },
  closing: { label: '待确认', color: '#8b5cf6', bg: '#f5f3ff' },
  closed: { label: '已关单', color: '#16a34a', bg: '#f0fdf4' },
};
