import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { logger } from '../utils/logger';

import { ChatMessage } from '../services/chat';
import { API_BASE_URL } from '../constants/config';
import {
  createChatViewerImageKey,
  normalizeChatImageUrl,
} from '../features/chatImageViewer';

interface ChatMessageBubbleProps {
  item: ChatMessage;
  isMe: boolean;
  downloadingId: number | null;
  onOpenImage: (imageKey: string) => void;
  onOpenFile: (item: ChatMessage) => void;
  onRecall: (item: ChatMessage) => void;
  formatBytes: (bytes?: number) => string;
}

const RECALL_WINDOW_MS = 10 * 60 * 1000;

export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  item,
  isMe,
  downloadingId,
  onOpenImage,
  onOpenFile,
  onRecall,
  formatBytes,
}: ChatMessageBubbleProps) {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const senderName = item.sender ? (item.sender.realName || item.sender.username) : '系统消息';

  const handleCopy = useCallback(async (text: string, id: number) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      logger.error('Copy failed:', error);
    }
  }, []);

  if (item.isRecalled) {
    return (
      <View style={styles.recalledContainer}>
        <Text style={styles.recalledText}>
          {isMe ? '您' : `"${senderName}"`}撤回了一条消息
        </Text>
      </View>
    );
  }

  const initial = senderName.charAt(0).toUpperCase();
  const itemFileUrl = item.fileUrl ? normalizeChatImageUrl(item.fileUrl, API_BASE_URL) : '';
  const itemImageKey = itemFileUrl ? createChatViewerImageKey(item.id, 'file', itemFileUrl) : '';

  const renderActions = () => {
    if (item.type !== 'text' && !isMe) return null;
    const plainText = item.type === 'text' ? item.content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片]') : '';

    return (
      <View style={[styles.externalCopyContainer, isMe ? styles.actionMarginRight : styles.actionMarginLeft]}>
        {item.type === 'text' && (
          <TouchableOpacity
            style={styles.externalCopyButton}
            onPress={() => handleCopy(plainText, item.id)}
          >
            <View style={styles.externalCopyInner}>
              {copiedId === item.id ? (
                <Ionicons name="checkmark" size={16} color="#10b981" />
              ) : (
                <Ionicons name="copy-outline" size={16} color="#94a3b8" />
              )}
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderContent = () => {
    if (item.type === 'image' && item.fileUrl) {
      return (
        <TouchableOpacity onPress={() => onOpenImage(itemImageKey)}>
          <Image
            source={{ uri: itemFileUrl }}
            style={styles.messageImage}
            contentFit="cover"
          />
        </TouchableOpacity>
      );
    }

    if (item.type === 'file') {
      return (
        <TouchableOpacity
          style={styles.fileContainer}
          onPress={() => onOpenFile(item)}
          disabled={downloadingId === item.id}
        >
          {downloadingId === item.id ? (
            <ActivityIndicator size="small" color={isMe ? '#ffffff' : '#00A8D4'} />
          ) : (
            <Ionicons name="document-text-outline" size={32} color={isMe ? '#ffffff' : '#00A8D4'} />
          )}
          <View style={styles.fileInfo}>
            <Text style={[styles.fileName, isMe ? styles.messageTextMe : styles.messageTextOther]} numberOfLines={2} ellipsizeMode="middle">
              {item.fileName || '未知附件'}
            </Text>
            <Text style={[styles.fileSize, isMe ? styles.fileSizeMe : styles.fileSizeOther]}>
              {formatBytes(item.fileSize)}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    // Text message with possible inline markdown images
    return <MessageTextContent item={item} isMe={isMe} onOpenImage={onOpenImage} />;
  };

  const canRecall = isMe && !item.isRecalled && (Date.now() - new Date(item.createdAt).getTime() < RECALL_WINDOW_MS);

  return (
    <View style={[styles.messageWrapper, isMe ? styles.messageWrapperRight : styles.messageWrapperLeft]}>
      {!isMe && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
      )}
      <View style={styles.messageContent}>
        {!isMe && (
          <Text style={styles.senderName}>{senderName}</Text>
        )}
        <View style={[styles.bubbleRow, isMe ? styles.bubbleRowEnd : styles.bubbleRowStart]}>
          {isMe && renderActions()}
          <TouchableOpacity
            activeOpacity={0.9}
            style={[
              styles.messageBubble,
              isMe ? styles.messageBubbleMe : styles.messageBubbleOther,
              item.type === 'file' ? styles.messageBubbleFile : null,
            ]}
          >
            {renderContent()}
          </TouchableOpacity>
          {!isMe && renderActions()}
        </View>
        <View style={[styles.metaRow, isMe ? styles.metaRowEnd : styles.metaRowStart]}>
          <Text style={[styles.timeText, isMe ? styles.timeTextRight : styles.timeTextLeft]}>
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {canRecall && (
            <TouchableOpacity onPress={() => onRecall(item)} style={styles.recallButton}>
              <Text style={styles.recallButtonText}>撤回</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

// ---------- Inline text + markdown image renderer ----------

interface MessageTextContentProps {
  item: ChatMessage;
  isMe: boolean;
  onOpenImage: (imageKey: string) => void;
}

function MessageTextContent({ item, isMe, onOpenImage }: MessageTextContentProps) {
  const content = item.content;
  const parts: React.ReactNode[] = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`text-${lastIndex}`} style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
          {content.substring(lastIndex, match.index)}
        </Text>,
      );
    }

    const url = match[2];
    const fullUrl = normalizeChatImageUrl(url, API_BASE_URL);
    const imageKey = createChatViewerImageKey(item.id, 'markdown', fullUrl, match.index);

    parts.push(
      <TouchableOpacity key={`img-${match.index}`} onPress={() => onOpenImage(imageKey)}>
        <Image source={{ uri: fullUrl }} style={styles.messageImage} contentFit="cover" />
      </TouchableOpacity>,
    );

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(
      <Text key={`text-${lastIndex}`} style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
        {content.substring(lastIndex)}
      </Text>,
    );
  }

  return <View style={styles.textColumn}>{parts}</View>;
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'flex-end',
  },
  messageWrapperLeft: { justifyContent: 'flex-start' },
  messageWrapperRight: { justifyContent: 'flex-end' },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: {
    color: '#64748b',
    fontSize: 16,
    fontWeight: 'bold',
  },
  messageContent: { maxWidth: '75%' },
  senderName: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    marginLeft: 4,
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end' },
  bubbleRowStart: { justifyContent: 'flex-start' },
  bubbleRowEnd: { justifyContent: 'flex-end' },
  messageBubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageBubbleOther: {
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  messageBubbleMe: {
    backgroundColor: '#00A8D4',
    borderBottomRightRadius: 4,
  },
  messageBubbleFile: {
    minWidth: 200,
    maxWidth: '100%',
  },
  fileContainer: { flexDirection: 'row', alignItems: 'center' },
  fileInfo: { marginLeft: 8, flex: 1 },
  fileName: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
  fileSize: { fontSize: 12 },
  fileSizeMe: { color: 'rgba(255,255,255,0.8)' },
  fileSizeOther: { color: '#64748b' },
  messageText: { fontSize: 15, lineHeight: 22 },
  messageTextOther: { color: '#333333' },
  messageTextMe: { color: '#ffffff' },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginVertical: 4,
    backgroundColor: '#f1f5f9',
  },
  textColumn: { flexDirection: 'column' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  metaRowStart: { justifyContent: 'flex-start' },
  metaRowEnd: { justifyContent: 'flex-end' },
  timeText: { fontSize: 10, color: '#94a3b8' },
  timeTextLeft: { textAlign: 'left', marginLeft: 4 },
  timeTextRight: { textAlign: 'right', marginRight: 4 },
  externalCopyButton: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    alignSelf: 'flex-end',
    marginBottom: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  externalCopyContainer: { alignSelf: 'flex-end', flexDirection: 'row' },
  externalCopyInner: { flexDirection: 'row', alignItems: 'center' },
  actionMarginRight: { marginRight: 8 },
  actionMarginLeft: { marginLeft: 8 },
  recalledContainer: { alignItems: 'center', marginVertical: 8 },
  recalledText: {
    fontSize: 12,
    color: '#94a3b8',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  recallButton: { marginLeft: 6 },
  recallButtonText: { fontSize: 10, color: '#94a3b8' },
});
