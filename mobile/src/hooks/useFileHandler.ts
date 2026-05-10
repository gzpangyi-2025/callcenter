import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { ChatMessage } from '../services/chat';
import { useAuthStore } from '../store/useAuthStore';
import { API_BASE_URL } from '../constants/config';
import { logger } from '../utils/logger';

export interface UseFileHandlerReturn {
  downloadingId: number | null;
  handleOpenFile: (item: ChatMessage) => Promise<void>;
  formatBytes: (bytes?: number) => string;
}

export function useFileHandler(): UseFileHandlerReturn {
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const formatBytes = useCallback((bytes?: number): string => {
    if (!bytes) return '未知大小';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }, []);

  const handleOpenFile = useCallback(async (item: ChatMessage) => {
    if (!item.fileUrl || !item.fileName) return;

    try {
      setDownloadingId(item.id);
      const baseUrl = API_BASE_URL.replace(/\/api$/, '');
      let fullUrl = item.fileUrl.startsWith('/') ? `${baseUrl}${item.fileUrl}` : item.fileUrl;
      if (fullUrl.includes('/api/files/static/')) {
        fullUrl = fullUrl.replace('/api/files/static/', '/api/files/download/');
      }

      const fileUri = `${FileSystem.documentDirectory}${item.fileName}`;
      const token = useAuthStore.getState().token;

      const safeFullUrl = encodeURI(decodeURI(fullUrl));

      const downloadOptions: { headers?: Record<string, string> } = {};
      if (token) {
        downloadOptions.headers = { Authorization: `Bearer ${token}` };
      }

      const { uri, status } = await FileSystem.downloadAsync(
        safeFullUrl,
        fileUri,
        downloadOptions,
      );

      if (status !== 200) {
        throw new Error(`Download failed with status ${status}`);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('提示', '该设备暂不支持预览文件');
      }
    } catch (error) {
      logger.error('File open error:', error);
      Alert.alert('失败', '无法下载或打开文件');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return {
    downloadingId,
    handleOpenFile,
    formatBytes,
  };
}
