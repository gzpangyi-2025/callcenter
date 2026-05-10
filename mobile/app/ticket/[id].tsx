import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Modal,
  ScrollView,
  SafeAreaView,
  Dimensions,
  Alert
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { API_BASE_URL } from '../../src/constants/config';
import { ticketsService, TicketItem, TicketStatus } from '../../src/services/tickets';
import { chatService, ChatMessage } from '../../src/services/chat';
import { useAuthStore } from '../../src/store/useAuthStore';
import { filesService } from '../../src/services/files';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '待接单', color: '#ea580c', bg: '#fff7ed' },
  in_progress: { label: '服务中', color: '#00A8D4', bg: '#e6f8fb' },
  closing: { label: '待确认', color: '#8b5cf6', bg: '#f5f3ff' },
  closed: { label: '已关单', color: '#16a34a', bg: '#f0fdf4' },
};

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const ticketId = Number(id);
  const currentUser = useAuthStore(state => state.user);

  const [ticket, setTicket] = useState<TicketItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [enterToSend, setEnterToSend] = useState(false);
  const [pastePreview, setPastePreview] = useState<{ uri: string; data?: string; isUploading: boolean } | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);
  const isAtBottomRef = useRef(true);

  useEffect(() => {
    loadTicket();

    // Setup chat service
    chatService.onMessageHistory((history) => {
      // Backend returns older messages first (usually), so we reverse to show newest at bottom if using inverted
      // Wait, standard chat apps put newest at bottom. If we don't invert, we scroll to end.
      setMessages(history);
      scrollToBottom();
    });

    chatService.onNewMessage((msg) => {
      setMessages((prev) => [...prev, msg]);
      if (isAtBottomRef.current || msg.sender.id === useAuthStore.getState().user?.id) {
        scrollToBottom();
      }
    });

    chatService.onMessageRecalled((data) => {
      setMessages((prev) => prev.map(m => m.id === data.messageId ? { ...m, isRecalled: true } : m));
    });

    chatService.onRecallError((data) => {
      Alert.alert('撤回失败', data.message);
    });

    chatService.connect(ticketId);

    return () => {
      chatService.disconnect();
    };
  }, [ticketId]);

  const loadTicket = async () => {
    try {
      const data = await ticketsService.getTicketById(ticketId);
      setTicket(data);
    } catch (error) {
      console.error('Failed to load ticket details:', error);
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      if (flatListRef.current) {
        flatListRef.current.scrollToEnd({ animated: true });
      }
    }, 100);
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    isAtBottomRef.current = isAtBottom;
    setShowScrollButton(!isAtBottom);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    chatService.sendMessage(inputText.trim(), 'text');
    setInputText('');
  };

  const handlePickImage = async () => {
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
          await uploadAndSendMedia(asset.uri, asset.fileName || 'upload.jpg', asset.mimeType || 'image/jpeg', 'image', asset.fileSize);
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('错误', '选择图片失败');
    }
  };

  const handlePickCamera = async () => {
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
        uploadAndSendMedia(asset.uri, asset.fileName || 'camera.jpg', asset.mimeType || 'image/jpeg', 'image', asset.fileSize);
      }
    } catch (error) {
      console.error('Error using camera:', error);
      Alert.alert('错误', '拍照失败');
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        for (const asset of result.assets) {
          await uploadAndSendMedia(asset.uri, asset.name, asset.mimeType || 'application/octet-stream', 'file', asset.size);
        }
      }
    } catch (error) {
      console.error('Error picking file:', error);
      Alert.alert('错误', '选择附件失败');
    }
  };

  const handlePasteClipboard = async () => {
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
          setInputText(prev => prev + text);
          return;
        }
      }
      
      Alert.alert('提示', '粘贴板中没有可识别的内容');
    } catch (error) {
      console.error('Error pasting:', error);
      Alert.alert('错误', '读取粘贴板失败');
    }
  };

  const confirmSendPaste = async () => {
    if (!pastePreview) return;
    setPastePreview(prev => prev ? { ...prev, isUploading: true } : null);
    await uploadAndSendMedia(pastePreview.uri, `paste_${Date.now()}.png`, 'image/png', 'image');
    setPastePreview(null);
  };

  const uploadAndSendMedia = async (uri: string, filename: string, mimeType: string, type: 'image' | 'file', fileSize?: number) => {
    try {
      setUploading(true);
      const res = await filesService.uploadFile(uri, filename, mimeType, 'tickets');
      if (res.code === 0 && res.data?.url) {
        chatService.sendMessage(
          type === 'image' ? '[图片]' : filename, 
          type, 
          res.data.url, 
          filename, 
          fileSize || res.data.size
        );
        scrollToBottom();
      } else {
        Alert.alert('上传失败', res.message || '未知错误');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      Alert.alert('上传失败', error instanceof Error ? error.message : '网络或服务器发生错误');
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '未知大小';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleOpenFile = async (item: ChatMessage) => {
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
      
      if (token) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + `token=${token}`;
      }
      
      const safeFullUrl = encodeURI(decodeURI(fullUrl));
      
      const { uri, status } = await FileSystem.downloadAsync(
        safeFullUrl,
        fileUri
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
      console.error('File open error:', error);
      Alert.alert('失败', '无法下载或打开文件');
    } finally {
      setDownloadingId(null);
    }
  };

  const renderHeader = () => {
    if (!ticket) return null;
    const config = STATUS_CONFIG[ticket.status] || STATUS_CONFIG['pending'];

    return (
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#0A2688" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle} numberOfLines={1}>{ticket.title}</Text>
            <Text style={styles.headerSubTitle} numberOfLines={1}>{ticket.ticketNo}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
            <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>
      </View>
    );
  };

  const handleCopyMessage = async (text: string, id: number) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleRecallMessage = (item: ChatMessage) => {
    Alert.alert('撤回消息', '确定要撤回这条消息吗？', [
      { text: '取消', style: 'cancel' },
      { 
        text: '确定', 
        style: 'destructive',
        onPress: () => chatService.recallMessage(item.id)
      }
    ]);
  };

  const renderMessageActions = (item: ChatMessage, isMe: boolean) => {
    if (item.type !== 'text' && !isMe) return null;
    const plainText = item.type === 'text' ? item.content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片]') : '';
    
    return (
      <View style={[styles.externalCopyContainer, isMe ? {marginRight: 8} : {marginLeft: 8}]}>
        {item.type === 'text' && (
          <TouchableOpacity 
            style={styles.externalCopyButton} 
            onPress={() => handleCopyMessage(plainText, item.id)}
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

  const renderMessageContent = (item: ChatMessage, isMe: boolean) => {
    const content = item.content;
    const parts = [];
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <Text key={`text-${lastIndex}`} style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
            {content.substring(lastIndex, match.index)}
          </Text>
        );
      }
      
      const alt = match[1];
      const url = match[2];
      // 从配置里拿一下根域名
      const baseUrl = API_BASE_URL.replace(/\/api$/, '');
      const fullUrl = url.startsWith('/') ? `${baseUrl}${url}` : url;
      
      parts.push(
        <TouchableOpacity key={`img-${match.index}`} onPress={() => setPreviewImage(fullUrl)}>
          <Image 
            source={{ uri: fullUrl }} 
            style={styles.messageImage} 
            contentFit="cover"
          />
        </TouchableOpacity>
      );
      
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < content.length) {
      parts.push(
        <Text key={`text-${lastIndex}`} style={[styles.messageText, isMe ? styles.messageTextMe : styles.messageTextOther]}>
          {content.substring(lastIndex)}
        </Text>
      );
    }
    
    return <View style={{flexDirection: 'column'}}>{parts}</View>;
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMe = item.sender?.id === currentUser?.id;
    const senderName = item.sender ? (item.sender.realName || item.sender.username) : '系统消息';
    
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
          <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: isMe ? 'flex-end' : 'flex-start'}}>
            {isMe && renderMessageActions(item, isMe)}
            <TouchableOpacity 
              activeOpacity={0.9}
              onLongPress={() => {
                if (isMe && !item.isRecalled) handleRecallMessage(item);
              }}
              style={[
                styles.messageBubble, 
                isMe ? styles.messageBubbleMe : styles.messageBubbleOther,
                item.type === 'file' ? styles.messageBubbleFile : null
              ]}
            >
              {item.type === 'image' && item.fileUrl ? (
                <TouchableOpacity onPress={() => setPreviewImage(item.fileUrl!.startsWith('/') ? `${API_BASE_URL.replace(/\/api$/, '')}${item.fileUrl}` : item.fileUrl!)}>
                  <Image 
                    source={{ uri: item.fileUrl!.startsWith('/') ? `${API_BASE_URL.replace(/\/api$/, '')}${item.fileUrl}` : item.fileUrl! }} 
                    style={styles.messageImage} 
                    contentFit="cover"
                  />
                </TouchableOpacity>
              ) : item.type === 'file' ? (
                <TouchableOpacity 
                  style={styles.fileContainer} 
                  onPress={() => handleOpenFile(item)}
                  disabled={downloadingId === item.id}
                >
                  {downloadingId === item.id ? (
                    <ActivityIndicator size="small" color={isMe ? "#ffffff" : "#00A8D4"} />
                  ) : (
                    <Ionicons name="document-text-outline" size={32} color={isMe ? "#ffffff" : "#00A8D4"} />
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
              ) : (
                renderMessageContent(item, isMe)
              )}
            </TouchableOpacity>
            {!isMe && renderMessageActions(item, isMe)}
          </View>
          <Text style={[styles.timeText, isMe ? styles.timeTextRight : styles.timeTextLeft]}>
            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#00A8D4" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {renderHeader()}
      
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMessage}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => {
          if (isAtBottomRef.current) scrollToBottom();
        }}
        onLayout={() => {
          if (isAtBottomRef.current) scrollToBottom();
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
      
      {showScrollButton && (
        <TouchableOpacity style={styles.scrollToBottomButton} onPress={scrollToBottom}>
          <Ionicons name="chevron-down" size={16} color="#ffffff" />
          <Text style={styles.scrollToBottomText}>回到最新</Text>
        </TouchableOpacity>
      )}

      <View style={styles.inputWrapper}>
        {pastePreview && (
          <View style={styles.pastePreviewContainer}>
            <View style={styles.pastePreviewHeader}>
              <Text style={styles.pastePreviewTitle}>准备发送剪贴板图片</Text>
              <TouchableOpacity onPress={() => setPastePreview(null)} style={styles.pastePreviewClose}>
                <Ionicons name="close-circle" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <Image 
              source={{ uri: pastePreview.uri }} 
              style={styles.pastePreviewImg} 
              contentFit="contain" 
            />
            <TouchableOpacity 
              style={[styles.pastePreviewSendBtn, pastePreview.isUploading && styles.pastePreviewSendBtnDisabled]} 
              onPress={confirmSendPaste}
              disabled={pastePreview.isUploading}
            >
              {pastePreview.isUploading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#ffffff" style={{marginRight: 6}} />
                  <Text style={styles.pastePreviewSendText}>发送</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.toolbarBtn} onPress={handlePickCamera}>
            <Ionicons name="camera-outline" size={20} color="#64748b" />
            <Text style={styles.toolbarIconText}>相机</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarBtn} onPress={handlePickImage}>
            <Ionicons name="image-outline" size={20} color="#64748b" />
            <Text style={styles.toolbarIconText}>图片</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarBtn} onPress={handlePickFile}>
            <Ionicons name="attach-outline" size={20} color="#64748b" />
            <Text style={styles.toolbarIconText}>附件</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarBtn} onPress={handlePasteClipboard}>
            <Ionicons name="clipboard-outline" size={20} color="#64748b" />
            <Text style={styles.toolbarIconText}>粘贴</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolbarBtn} onPress={() => setInputText('')}>
            <Ionicons name="trash-outline" size={20} color="#64748b" />
            <Text style={styles.toolbarIconText}>清除</Text>
          </TouchableOpacity>
          <View style={{flex: 1}} />
          <TouchableOpacity style={styles.toolbarTextBtn} onPress={() => setEnterToSend(!enterToSend)}>
            <Text style={[styles.toolbarText, enterToSend ? {color: '#00A8D4', fontWeight: 'bold'} : {color: '#64748b'}]}>
              {enterToSend ? "回车发送" : "回车换行"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder={enterToSend ? "输入消息... (回车发送)" : "输入消息... (回车换行)"}
            placeholderTextColor="#94a3b8"
            value={inputText}
            onChangeText={setInputText}
            multiline
            blurOnSubmit={false}
            submitBehavior={enterToSend ? "submit" : "newline"}
            returnKeyType={enterToSend ? "send" : "default"}
            enablesReturnKeyAutomatically={true}
            onSubmitEditing={enterToSend ? handleSend : undefined}
          />
          {inputText.trim().length > 0 && (
            <TouchableOpacity 
              style={styles.sendButton} 
              onPress={handleSend}
            >
              <Ionicons name="send" size={18} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={!!previewImage} transparent={true} animationType="fade">
        <TouchableOpacity 
          style={styles.previewContainer} 
          activeOpacity={1} 
          onPress={() => setPreviewImage(null)}
        >
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreviewImage(null)}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
          <ScrollView
            maximumZoomScale={3}
            minimumZoomScale={1}
            centerContent={true}
            contentContainerStyle={styles.previewScrollContent}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => setPreviewImage(null)}>
              {previewImage && (
                <Image
                  source={{ uri: previewImage }}
                  style={styles.previewImage}
                  contentFit="contain"
                />
              )}
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F4F6F8',
  },
  container: {
    flex: 1,
    backgroundColor: '#F4F6F8',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
    paddingRight: 8,
    paddingVertical: 4,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 2,
  },
  headerSubTitle: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  chatList: {
    padding: 16,
    paddingBottom: 32,
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'flex-end',
  },
  messageWrapperLeft: {
    justifyContent: 'flex-start',
  },
  messageWrapperRight: {
    justifyContent: 'flex-end',
  },
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
  messageContent: {
    maxWidth: '75%',
  },
  senderName: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 4,
    marginLeft: 4,
  },
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
  fileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileInfo: {
    marginLeft: 8,
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  fileSize: {
    fontSize: 12,
  },
  fileSizeMe: {
    color: 'rgba(255,255,255,0.8)',
  },
  fileSizeOther: {
    color: '#64748b',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageTextOther: {
    color: '#333333',
  },
  messageTextMe: {
    color: '#ffffff',
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginVertical: 4,
    backgroundColor: '#f1f5f9',
  },
  timeText: {
    fontSize: 10,
    color: '#94a3b8',
    marginTop: 4,
  },
  timeTextLeft: {
    textAlign: 'left',
    marginLeft: 4,
  },
  timeTextRight: {
    textAlign: 'right',
    marginRight: 4,
  },
  inputWrapper: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
  },
  attachButton: {
    padding: 8,
    marginRight: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 100,
    minHeight: 40,
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
  sendButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  inlineCopyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  inlineCopyText: {
    fontSize: 10,
    marginLeft: 2,
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
  toolbarText: {
    fontSize: 13,
  },
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
  externalCopyContainer: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
  },
  recalledContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  recalledText: {
    fontSize: 12,
    color: '#94a3b8',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    backgroundColor: '#00A8D4',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 100,
  },
  scrollToBottomText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  externalCopyInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  previewClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 20,
    zIndex: 10,
    padding: 10,
  },
  previewScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  quickPasteButton: {
    padding: 8,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  pastePreviewClose: {
    padding: 2,
  },
  pastePreviewImg: {
    width: 120,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
    alignSelf: 'center',
  },
  pastePreviewFooter: {
    marginTop: 12,
    alignItems: 'center',
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
  pastePreviewSendBtnDisabled: {
    backgroundColor: '#94a3b8',
  },
  pastePreviewSendText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
