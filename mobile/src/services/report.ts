import api from './api';

export interface DashboardSummary {
  total: number;
  pending: number;
  in_progress: number;
  closing: number;
  closed: number;
  avgHours: number;
}

export const reportService = {
  getDashboardSummary: async (): Promise<DashboardSummary> => {
    const response = await api.get('/report/summary');
    return response.data;
  },
};
