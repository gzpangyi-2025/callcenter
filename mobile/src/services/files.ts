import { API_BASE_URL } from '../constants/config';
import { useAuthStore } from '../store/useAuthStore';

interface UploadResponse {
  code: number;
  message: string;
  data?: {
    url: string;
    originalName: string;
    filename: string;
    size: number;
    mimetype: string;
  };
}

export const filesService = {
  async uploadFile(uri: string, filename: string, mimeType: string, moduleName: string = 'tickets'): Promise<UploadResponse> {
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('未授权，请先登录');
    }

    const formData = new FormData();
    // @ts-ignore - React Native's FormData requires a specific object format for files
    formData.append('file', {
      uri,
      name: filename,
      type: mimeType,
    });
    formData.append('module', moduleName);

    const response = await fetch(`${API_BASE_URL}/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        // Content-Type 必须留空，fetch 会自动加上 multipart/form-data 及其 boundary
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `Upload failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message) {
          errorMsg = Array.isArray(errorData.message) ? errorData.message.join(', ') : errorData.message;
        }
      } catch {
        // Fallback to generic message
      }
      throw new Error(errorMsg);
    }

    return response.json();
  }
};
