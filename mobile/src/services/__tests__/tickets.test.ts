/**
 * Tests for ticketsService — REST API layer.
 *
 * Strategy: mock the api (axios) module to verify request params
 * and response data extraction.
 */

jest.mock('../api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import api from '../api';
import { ticketsService } from '../tickets';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ticketsService', () => {
  describe('getTickets', () => {
    it('should call GET /tickets with params and return paginated data', async () => {
      const mockData = {
        items: [{ id: 1, ticketNo: 'T001', title: 'Test', status: 'pending' }],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      };
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { code: 0, data: mockData },
      });

      const result = await ticketsService.getTickets({ page: 1, pageSize: 10, status: 'pending' });

      expect(api.get).toHaveBeenCalledWith('/tickets', {
        params: { page: 1, pageSize: 10, status: 'pending' },
      });
      expect(result).toEqual(mockData);
    });

    it('should strip empty status from params', async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { code: 0, data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 } },
      });

      await ticketsService.getTickets({ page: 1, status: '' });

      const calledParams = (api.get as jest.Mock).mock.calls[0][1].params;
      expect(calledParams.status).toBeUndefined();
      expect(calledParams.page).toBe(1);
    });

    it('should propagate API errors', async () => {
      (api.get as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

      await expect(ticketsService.getTickets({ page: 1 })).rejects.toThrow('Network Error');
    });
  });

  describe('getTicketById', () => {
    it('should call GET /tickets/:id and return ticket data', async () => {
      const mockTicket = { id: 42, ticketNo: 'T042', title: '紧急问题', status: 'in_progress' };
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { code: 0, data: mockTicket },
      });

      const result = await ticketsService.getTicketById(42);

      expect(api.get).toHaveBeenCalledWith('/tickets/42');
      expect(result).toEqual(mockTicket);
    });
  });
});
