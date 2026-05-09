import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

type RequestConfig = {
  headers: Record<string, string>;
  _retry?: boolean;
};

type ResponseError = {
  config: RequestConfig;
  response?: {
    status?: number;
    data?: { message?: string };
  };
  message?: string;
};

let mockRequestFulfilled: ((config: RequestConfig) => RequestConfig) | undefined;
let mockResponseRejected: ((error: ResponseError) => Promise<unknown>) | undefined;
const mockConnect = vi.fn();
const mockApiClient = vi.fn();
const mockAxiosPost = vi.fn();

Object.assign(mockApiClient, {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: {
    request: {
      use: vi.fn((fulfilled: (config: RequestConfig) => RequestConfig) => {
        mockRequestFulfilled = fulfilled;
      }),
    },
    response: {
      use: vi.fn(
        (
          _fulfilled: (response: unknown) => unknown,
          rejected: (error: ResponseError) => Promise<unknown>,
        ) => {
          mockResponseRejected = rejected;
        },
      ),
    },
  },
});

vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn(() => mockApiClient),
    post: mockAxiosPost,
  };
  return { default: mockAxios };
});

vi.mock('antd', () => ({
  message: {
    error: vi.fn(),
  },
}));

vi.mock('cos-js-sdk-v5', () => ({
  default: vi.fn(),
}));

vi.mock('../stores/socketStore', () => ({
  useSocketStore: {
    getState: () => ({ connect: mockConnect }),
  },
}));

describe('api interceptors', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await import('./api');
  });

  it('adds the access token to outgoing requests', () => {
    localStorage.setItem('accessToken', 'old-token');

    const config = mockRequestFulfilled?.({ headers: {} });

    expect(config?.headers.Authorization).toBe('Bearer old-token');
  });

  it('refreshes an expired token and retries the original request', async () => {
    mockAxiosPost.mockResolvedValue({
      data: { data: { accessToken: 'new-token' } },
    });
    mockApiClient.mockResolvedValue({ code: 0 });

    const originalRequest: RequestConfig = { headers: {} };
    const result = await mockResponseRejected?.({
      config: originalRequest,
      response: { status: 401 },
    });

    expect(localStorage.getItem('accessToken')).toBe('new-token');
    expect(originalRequest._retry).toBe(true);
    expect(originalRequest.headers.Authorization).toBe('Bearer new-token');
    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('new-token');
    });
    expect(mockApiClient).toHaveBeenCalledWith(originalRequest);
    expect(result).toEqual({ code: 0 });
  });
});
