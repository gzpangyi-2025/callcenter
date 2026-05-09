import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiResponse,
  ReportCategoryStats,
  ReportDimension,
  ReportSummary,
  ReportTimeSeriesItem,
} from '../../types/api';
import ReportsPage from '.';

interface ChartProps {
  onEvents?: {
    click?: (param: { name: string; dataIndex: number }) => void;
  };
}

const reportApiMock = vi.hoisted(() => ({
  getSummary: vi.fn<() => Promise<ApiResponse<ReportSummary>>>(),
  getCategoryStats: vi.fn<() => Promise<ApiResponse<ReportCategoryStats>>>(),
  getTimeSeries: vi.fn<(dimension?: ReportDimension) => Promise<ApiResponse<ReportTimeSeriesItem[]>>>(),
  getCategory2Stats: vi.fn(),
  getCategory3Stats: vi.fn(),
  getCrossMatrix: vi.fn(),
  exportXlsx: vi.fn(),
}));

const ticketsApiMock = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

vi.mock('echarts-for-react', () => ({
  default: ({ onEvents }: ChartProps) => (
    <button type="button" onClick={() => onEvents?.click?.({ name: '硬件设备', dataIndex: 0 })}>
      mock chart
    </button>
  ),
}));

vi.mock('../../services/api', () => ({
  reportAPI: reportApiMock,
  ticketsAPI: ticketsApiMock,
}));

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportApiMock.getSummary.mockResolvedValue({
      code: 0,
      data: {
        total: 12,
        pending: 3,
        in_progress: 4,
        closing: 1,
        closed: 5,
        avgHours: 6.5,
      },
    });
    reportApiMock.getCategoryStats.mockResolvedValue({
      code: 0,
      data: {
        category1: [{ name: '硬件设备', value: 7 }],
        category2: [{ name: '服务器', value: 5 }],
      },
    });
    reportApiMock.getTimeSeries.mockResolvedValue({
      code: 0,
      data: [{ date: '2026-01-01', count: 2 }],
    });
    reportApiMock.getCategory2Stats.mockResolvedValue({
      code: 0,
      data: [{ name: '服务器', value: 5 }],
    });
    reportApiMock.getCategory3Stats.mockResolvedValue({
      code: 0,
      data: [],
    });
  });

  it('loads the report overview from summary, category, and time-series APIs', async () => {
    render(<ReportsPage />);

    expect(await screen.findByText('报表总览')).toBeInTheDocument();
    expect(await screen.findByText('总工单数')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('工单趋势分析')).toBeInTheDocument();
    expect(reportApiMock.getSummary).toHaveBeenCalled();
    expect(reportApiMock.getCategoryStats).toHaveBeenCalled();
    expect(reportApiMock.getTimeSeries).toHaveBeenCalledWith('day');
  });

  it('reloads the trend series when the dimension changes', async () => {
    render(<ReportsPage />);

    fireEvent.click(await screen.findByText('12个月'));

    await waitFor(() => {
      expect(reportApiMock.getTimeSeries).toHaveBeenLastCalledWith('month');
    });
  });
});
