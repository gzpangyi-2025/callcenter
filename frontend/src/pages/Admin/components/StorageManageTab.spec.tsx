import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { StorageManageTab } from './StorageManageTab';
import { settingsAPI } from '../../../services/api';

// Mock the API service
vi.mock('../../../services/api', () => ({
  settingsAPI: {
    getAll: vi.fn(),
    saveStorage: vi.fn(),
    getMigrationStats: vi.fn(),
    migrateStorage: vi.fn(),
  },
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('StorageManageTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsAPI.getAll).mockResolvedValue({
      code: 0,
      data: {
        'storage.provider': 'cos',
        'storage.cos.secretId': 'AKID-test',
        'storage.cos.secretKey': 'secret-key',
        'storage.cos.bucket': 'callcenter-test',
        'storage.cos.region': 'ap-guangzhou',
      },
    });
    vi.mocked(settingsAPI.getMigrationStats).mockResolvedValue({
      code: 0,
      data: {
        localFiles: 0,
      },
    });
    vi.mocked(settingsAPI.saveStorage).mockResolvedValue({
      code: 0,
      message: 'ok',
    });
  });

  it('renders cos form fields by default based on api response', async () => {
    render(<StorageManageTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('请输入以 AKID 开头的标识')).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('例如: https://s3-cn-beijing.capitalonline.net')).not.toBeInTheDocument();
  });

  it('switches to rendering S3 fields when S3 radio is clicked', async () => {
    render(<StorageManageTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('请输入以 AKID 开头的标识')).toBeInTheDocument();
    });

    const s3Radio = screen.getByText('🌐 首云 (S3 兼容)');
    fireEvent.click(s3Radio);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('例如: https://s3-cn-beijing.capitalonline.net')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('请输入 Access Key')).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('请输入以 AKID 开头的标识')).not.toBeInTheDocument();
  });

  it('submits the selected storage provider', async () => {
    render(<StorageManageTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('请输入以 AKID 开头的标识')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /保存存储配置/ }));

    await waitFor(() => {
      expect(settingsAPI.saveStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'cos',
        }),
      );
    });
  });
});
