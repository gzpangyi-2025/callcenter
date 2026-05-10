/**
 * Tests for reportService — dashboard summary API.
 */

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import api from '../api';
import { reportService } from '../report';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reportService', () => {
  describe('getDashboardSummary', () => {
    it('should call GET /report/summary and return data', async () => {
      const mockSummary = { total: 100, pending: 10, in_progress: 20, closing: 5, closed: 65, avgHours: 4.5 };
      (api.get as jest.Mock).mockResolvedValueOnce({ data: mockSummary });

      const result = await reportService.getDashboardSummary();

      expect(api.get).toHaveBeenCalledWith('/report/summary');
      expect(result).toEqual(mockSummary);
    });

    it('should propagate API errors', async () => {
      (api.get as jest.Mock).mockRejectedValueOnce(new Error('timeout'));

      await expect(reportService.getDashboardSummary()).rejects.toThrow('timeout');
    });
  });
});
