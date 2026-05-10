import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { PastePreview } from '../hooks/useMediaPicker';

interface ChatInputBarProps {
  inputText: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  enterToSend: boolean;
  onToggleEnterToSend: () => void;
  onPickCamera: () => void;
  onPickImage: () => void;
  onPickFile: () => void;
  onPasteClipboard: () => void;
  onClearInput: () => void;
  pastePreview: PastePreview | null;
  onConfirmPaste: () => void;
  onCancelPaste: () => void;
}

export function ChatInputBar({
  inputText,
  onChangeText,
  onSend,
  enterToSend,
  onToggleEnterToSend,
  onPickCamera,
  onPickImage,
  onPickFile,
  onPasteClipboard,
  onClearInput,
  pastePreview,
  onConfirmPaste,
  onCancelPaste,
}: ChatInputBarProps) {
  return (
    <View style={styles.inputWrapper}>
      {pastePreview && (
        <View style={styles.pastePreviewContainer}>
          <View style={styles.pastePreviewHeader}>
            <Text style={styles.pastePreviewTitle}>准备发送剪贴板图片</Text>
            <TouchableOpacity onPress={onCancelPaste} style={styles.pastePreviewClose}>
              <Ionicons name="close-circle" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>
          <Image source={{ uri: pastePreview.uri }} style={styles.pastePreviewImg} contentFit="contain" />
          <TouchableOpacity
            style={[styles.pastePreviewSendBtn, pastePreview.isUploading && styles.pastePreviewSendBtnDisabled]}
            onPress={onConfirmPaste}
            disabled={pastePreview.isUploading}
          >
            {pastePreview.isUploading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <>
                <Ionicons name="send" size={16} color="#ffffff" style={styles.sendIcon} />
                <Text style={styles.pastePreviewSendText}>发送</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onPickCamera}>
          <Ionicons name="camera-outline" size={20} color="#64748b" />
          <Text style={styles.toolbarIconText}>相机</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onPickImage}>
          <Ionicons name="image-outline" size={20} color="#64748b" />
          <Text style={styles.toolbarIconText}>图片</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onPickFile}>
          <Ionicons name="attach-outline" size={20} color="#64748b" />
          <Text style={styles.toolbarIconText}>附件</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onPasteClipboard}>
          <Ionicons name="clipboard-outline" size={20} color="#64748b" />
          <Text style={styles.toolbarIconText}>粘贴</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolbarBtn} onPress={onClearInput}>
          <Ionicons name="trash-outline" size={20} color="#64748b" />
          <Text style={styles.toolbarIconText}>清除</Text>
        </TouchableOpacity>
        <View style={styles.spacer} />
        <TouchableOpacity style={styles.toolbarTextBtn} onPress={onToggleEnterToSend}>
          <Text style={[styles.toolbarText, enterToSend ? styles.toolbarTextActive : styles.toolbarTextInactive]}>
            {enterToSend ? '回车发送' : '回车换行'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder={enterToSend ? '输入消息... (回车发送)' : '输入消息... (回车换行)'}
          placeholderTextColor="#94a3b8"
          value={inputText}
          onChangeText={onChangeText}
          multiline
          blurOnSubmit={enterToSend}
          submitBehavior={enterToSend ? 'submit' : 'newline'}
          returnKeyType={enterToSend ? 'send' : 'default'}
          enablesReturnKeyAutomatically
          onSubmitEditing={enterToSend ? onSend : undefined}
        />
        {inputText.trim().length > 0 && (
          <TouchableOpacity style={styles.sendButton} onPress={onSend}>
            <Ionicons name="send" size={18} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrapper: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 15,
    maxHeight: 100,
    minHeight: 36,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    color: '#333333',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00A8D4',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    marginBottom: 2,
  },
  toolbar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f1f5f9',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
  },
  toolbarBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginHorizontal: 3,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarIconText: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 0,
  },
  toolbarTextBtn: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 1,
    justifyContent: 'center',
  },
  toolbarText: { fontSize: 13 },
  toolbarTextActive: { color: '#00A8D4', fontWeight: 'bold' },
  toolbarTextInactive: { color: '#64748b' },
  spacer: { flex: 1 },
  sendIcon: { marginRight: 6 },
  pastePreviewContainer: {
    padding: 12,
    backgroundColor: '#f8fafc',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  pastePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pastePreviewTitle: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  pastePreviewClose: { padding: 2 },
  pastePreviewImg: {
    width: 120,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
  },
  pastePreviewSendBtn: {
    flexDirection: 'row',
    backgroundColor: '#00A8D4',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    alignSelf: 'center',
    marginTop: 12,
  },
  pastePreviewSendBtnDisabled: { backgroundColor: '#94a3b8' },
  pastePreviewSendText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
