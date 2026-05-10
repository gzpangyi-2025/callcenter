/**
 * Tests for filesService — file upload via fetch.
 *
 * Strategy: mock global fetch and useAuthStore to verify
 * correct FormData construction and error handling.
 */

jest.mock('../../store/useAuthStore', () => ({
  useAuthStore: {
    getState: jest.fn(() => ({ token: 'test-token' })),
  },
}));

jest.mock('../../constants/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api',
}));

import { filesService } from '../files';
import { useAuthStore } from '../../store/useAuthStore';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('filesService', () => {
  describe('uploadFile', () => {
    it('should upload file with correct URL and headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          code: 0,
          data: { url: '/files/test.jpg', originalName: 'test.jpg', filename: 'abc.jpg', size: 1024, mimetype: 'image/jpeg' },
        }),
      });

      const result = await filesService.uploadFile('/path/to/file', 'test.jpg', 'image/jpeg', 'tickets');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/files/upload',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
      expect(result.code).toBe(0);
      expect(result.data?.url).toBe('/files/test.jpg');
    });

    it('should throw when no auth token', async () => {
      (useAuthStore.getState as jest.Mock).mockReturnValueOnce({ token: null });

      await expect(filesService.uploadFile('/path', 'f.jpg', 'image/jpeg')).rejects.toThrow('未授权，请先登录');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw on non-ok response with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: () => Promise.resolve({ message: '文件太大' }),
      });

      await expect(filesService.uploadFile('/path', 'big.zip', 'application/zip')).rejects.toThrow('文件太大');
    });

    it('should throw on non-ok response with array message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: ['格式错误', '大小超限'] }),
      });

      await expect(filesService.uploadFile('/path', 'f.jpg', 'image/jpeg')).rejects.toThrow('格式错误, 大小超限');
    });

    it('should throw generic message when error response is not JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
      });

      await expect(filesService.uploadFile('/path', 'f.jpg', 'image/jpeg')).rejects.toThrow('Upload failed with status 500');
    });

    it('should use default module name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ code: 0, data: { url: '/f', originalName: 'f', filename: 'f', size: 1, mimetype: 'x' } }),
      });

      await filesService.uploadFile('/path', 'f.jpg', 'image/jpeg');

      // Verify FormData was constructed (we can check the body is FormData)
      const callBody = mockFetch.mock.calls[0][1].body;
      expect(callBody).toBeInstanceOf(FormData);
    });
  });
});
