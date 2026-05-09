import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CodexConfigTab from './CodexConfigTab';
import { settingsAPI } from '../../../services/api';

// Mock the API service
vi.mock('../../../services/api', () => ({
  settingsAPI: {
    getCodexConfig: vi.fn(),
    saveCodexConfig: vi.fn(),
  },
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('CodexConfigTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsAPI.getCodexConfig).mockResolvedValue({
      code: 0,
      data: {
        storageProvider: 'tencent',
        cosSecretId: 'AKID-test',
        cosSecretKey: 'secret-key',
        cosBucket: 'callcenter-test',
        cosRegion: 'ap-guangzhou',
        concurrency: 2,
        maxResumeAttempts: 3,
      },
    });
    vi.mocked(settingsAPI.saveCodexConfig).mockResolvedValue({
      code: 0,
      data: {
        restartRequired: false,
      },
    });
  });

  it('renders tencent form fields by default based on api response', async () => {
    render(<CodexConfigTab />);

    // Wait for the data to load and set the provider
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入腾讯云 API 密钥的 SecretId')).toBeInTheDocument();
    });
    // Check that S3 fields are not present
    expect(screen.queryByPlaceholderText('例如: https://s3-cn-beijing.capitalonline.net')).not.toBeInTheDocument();
  });

  it('switches to rendering S3 fields when S3 radio is clicked', async () => {
    render(<CodexConfigTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入腾讯云 API 密钥的 SecretId')).toBeInTheDocument();
    });

    // Click the S3 radio button
    const s3Radio = screen.getByText('🌐 首云 (S3兼容)');
    fireEvent.click(s3Radio);

    // Verify S3 fields are rendered
    await waitFor(() => {
      expect(screen.getByPlaceholderText('例如: https://s3-cn-beijing.capitalonline.net')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('请输入 Access Key')).toBeInTheDocument();
    });

    // Verify Tencent fields are hidden
    expect(screen.queryByPlaceholderText('输入腾讯云 API 密钥的 SecretId')).not.toBeInTheDocument();
  });

  it('submits updated concurrency values', async () => {
    render(<CodexConfigTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入腾讯云 API 密钥的 SecretId')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /保存 AI 协作配置/ }));

    await waitFor(() => {
      expect(settingsAPI.saveCodexConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          concurrency: 2,
          maxResumeAttempts: 3,
          storageProvider: 'tencent',
        }),
      );
    });
  });
});
