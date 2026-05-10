import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';

import { chatService } from '../services/chat';
import { filesService } from '../services/files';
import { logger } from '../utils/logger';

export interface PastePreview {
  uri: string;
  data?: string;
  isUploading: boolean;
}

export interface UseMediaPickerReturn {
  pastePreview: PastePreview | null;
  handlePickImage: () => Promise<void>;
  handlePickCamera: () => Promise<void>;
  handlePickFile: () => Promise<void>;
  handlePasteClipboard: () => Promise<void>;
  confirmSendPaste: () => Promise<void>;
  cancelPaste: () => void;
}

/**
 * 修复 iOS 下 ImagePicker 的文件名后缀问题：
 * 当选择 HEIC 图片时，Expo ImagePicker (配置 quality < 1) 会自动将其转码为 JPEG，
 * 此时 asset.uri 是 .jpeg，但 asset.fileName 依然保留原始的 .HEIC 后缀。
 * 这会导致后端扩展名校验失败。此方法通过对比 uri 扩展名来修正 fileName。
 */
function resolveFilename(assetUri: string, providedName?: string | null, defaultExt = 'jpg'): string {
  let name = providedName || `upload.${defaultExt}`;
  
  const uriExtMatch = assetUri.match(/\.([a-zA-Z0-9]+)$/);
  const uriExt = uriExtMatch ? uriExtMatch[1].toLowerCase() : null;

  const nameExtMatch = name.match(/\.([a-zA-Z0-9]+)$/);
  const nameExt = nameExtMatch ? nameExtMatch[1].toLowerCase() : null;

  if (!nameExt && uriExt) {
    name = `${name}.${uriExt}`;
  } else if (nameExt && uriExt && nameExt !== uriExt) {
    // Extension mismatch! Replace original extension with the actual transcoded extension
    name = name.replace(new RegExp(`\\.${nameExt}$`, 'i'), `.${uriExt}`);
  } else if (!nameExt && !uriExt) {
    name = `${name}.${defaultExt}`;
  }

  return name;
}

export function useMediaPicker(scrollToBottom: () => void, appendText: (text: string) => void): UseMediaPickerReturn {
  const [pastePreview, setPastePreview] = useState<PastePreview | null>(null);

  const uploadAndSendMedia = useCallback(async (
    uri: string,
    filename: string,
    mimeType: string,
    type: 'image' | 'file',
    fileSize?: number,
  ) => {
    try {
      const res = await filesService.uploadFile(uri, filename, mimeType, 'tickets');
      if (res.code === 0 && res.data?.url) {
        chatService.sendMessage(
          type === 'image' ? '[图片]' : filename,
          type,
          res.data.url,
          filename,
          fileSize || res.data.size,
        );
        scrollToBottom();
      } else {
        Alert.alert('上传失败', res.message || '未知错误');
      }
    } catch (error) {
      logger.error('Upload failed:', error);
      Alert.alert('上传失败', error instanceof Error ? error.message : '网络或服务器发生错误');
    }
  }, [scrollToBottom]);

  const handlePickImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要权限', '我们需要访问您的相册才能发送图片');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        for (const asset of result.assets) {
          const finalName = resolveFilename(asset.uri, asset.fileName, 'jpg');
          await uploadAndSendMedia(asset.uri, finalName, asset.mimeType || 'image/jpeg', 'image', asset.fileSize);
        }
      }
    } catch (error) {
      logger.error('Error picking image:', error);
      Alert.alert('错误', '选择图片失败');
    }
  }, [uploadAndSendMedia]);

  const handlePickCamera = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('需要权限', '我们需要访问您的相机才能拍照');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const finalName = resolveFilename(asset.uri, asset.fileName, 'jpg');
        await uploadAndSendMedia(asset.uri, finalName, asset.mimeType || 'image/jpeg', 'image', asset.fileSize);
      }
    } catch (error) {
      logger.error('Error using camera:', error);
      Alert.alert('错误', '拍照失败');
    }
  }, [uploadAndSendMedia]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        for (const asset of result.assets) {
          const finalName = resolveFilename(asset.uri, asset.name, 'bin');
          await uploadAndSendMedia(asset.uri, finalName, asset.mimeType || 'application/octet-stream', 'file', asset.size);
        }
      }
    } catch (error) {
      logger.error('Error picking file:', error);
      Alert.alert('错误', '选择附件失败');
    }
  }, [uploadAndSendMedia]);

  const handlePasteClipboard = useCallback(async () => {
    try {
      const hasImage = await Clipboard.hasImageAsync();
      if (hasImage) {
        const image = await Clipboard.getImageAsync({ format: 'png' });
        if (image) {
          const tempUri = `${FileSystem.cacheDirectory}paste_${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(tempUri, image.data, { encoding: FileSystem.EncodingType.Base64 });
          setPastePreview({ uri: tempUri, data: image.data, isUploading: false });
          return;
        }
      }

      const hasString = await Clipboard.hasStringAsync();
      if (hasString) {
        const text = await Clipboard.getStringAsync();
        if (text) {
          appendText(text);
          return;
        }
      }

      Alert.alert('提示', '粘贴板中没有可识别的内容');
    } catch (error) {
      logger.error('Error pasting:', error);
      Alert.alert('错误', '读取粘贴板失败');
    }
  }, [appendText]);

  const confirmSendPaste = useCallback(async () => {
    if (!pastePreview) return;
    setPastePreview(prev => prev ? { ...prev, isUploading: true } : null);
    await uploadAndSendMedia(pastePreview.uri, `paste_${Date.now()}.png`, 'image/png', 'image');
    setPastePreview(null);
  }, [pastePreview, uploadAndSendMedia]);

  const cancelPaste = useCallback(() => {
    setPastePreview(null);
  }, []);

  return {
    pastePreview,
    handlePickImage,
    handlePickCamera,
    handlePickFile,
    handlePasteClipboard,
    confirmSendPaste,
    cancelPaste,
  };
}
