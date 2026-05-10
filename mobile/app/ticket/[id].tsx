import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/constants/config';
import { ChatImageViewer } from '../../src/components/ChatImageViewer';
import { ChatHeader } from '../../src/components/ChatHeader';
import { ChatMessageBubble } from '../../src/components/ChatMessageBubble';
import { ChatInputBar } from '../../src/components/ChatInputBar';
import {
  buildChatViewerImages,
  openChatImageViewerState,
  closeChatImageViewerState,
} from '../../src/features/chatImageViewer';
import type { ChatMessage } from '../../src/services/chat';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useChatMessages } from '../../src/hooks/useChatMessages';
import { useMediaPicker } from '../../src/hooks/useMediaPicker';
import { useFileHandler } from '../../src/hooks/useFileHandler';
import { useScreenShare } from '../../src/hooks/useScreenShare';
import { ScreenSharePanel } from '../../src/components/ScreenSharePanel';
import { chatService } from '../../src/services/chat';
import type { Socket } from 'socket.io-client';

export default function TicketDetailScreen() {
  const { id } = useLocalSearchParams();
  const ticketId = Number(id);
  const currentUser = useAuthStore(state => state.user);
  
  const [socket, setSocket] = useState<Socket | null>(chatService.getSocket());

  useEffect(() => {
    chatService.onSocketChange((s) => {
      setSocket(s);
    });
    // Ensure we have the latest when component mounts
    setSocket(chatService.getSocket());
  }, []);

  // ---- Screen Share ----
  const screenShare = useScreenShare(socket, ticketId, currentUser?.id ?? null);

  // ---- Chat messages, scrolling, ticket loading ----
  const {
    ticket,
    loading,
    messages,
    showScrollButton,
    flatListRef,
    scrollToBottom,
    handleScroll,
    sendTextMessage,
    recallMessage,
  } = useChatMessages(ticketId);

  // ---- Text input state ----
  const [inputText, setInputText] = useState('');
  const [enterToSend, setEnterToSend] = useState(false);

  const handleSend = useCallback(() => {
    sendTextMessage(inputText);
    setInputText('');
  }, [inputText, sendTextMessage]);

  const appendText = useCallback((text: string) => {
    setInputText(prev => prev + text);
  }, []);

  // ---- Media picker (camera, gallery, file, clipboard) ----
  const {
    pastePreview,
    handlePickImage,
    handlePickCamera,
    handlePickFile,
    handlePasteClipboard,
    confirmSendPaste,
    cancelPaste,
  } = useMediaPicker(scrollToBottom, appendText);

  // ---- File download / share ----
  const { downloadingId, handleOpenFile, formatBytes } = useFileHandler();

  // ---- Image viewer state ----
  const [imageViewerState, setImageViewerState] = useState({
    visible: false,
    imageIndex: 0,
    remountKey: 0,
  });

  const viewerImages = useMemo(() => buildChatViewerImages(messages, API_BASE_URL), [messages]);
  const viewerImageIndexByKey = useMemo(() => {
    return new Map(viewerImages.map((image, index) => [image.key, index]));
  }, [viewerImages]);

  const openImagePreview = useCallback((imageKey: string) => {
    const imageIndex = viewerImageIndexByKey.get(imageKey);
    if (imageIndex == null) return;
    setImageViewerState((prev) => openChatImageViewerState(prev, imageIndex));
  }, [viewerImageIndexByKey]);

  const closeImagePreview = useCallback(() => {
    setImageViewerState(closeChatImageViewerState);
  }, []);

  // ---- Message rendering ----
  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isMe = item.sender?.id === currentUser?.id;
    return (
      <ChatMessageBubble
        item={item}
        isMe={isMe}
        downloadingId={downloadingId}
        onOpenImage={openImagePreview}
        onOpenFile={handleOpenFile}
        onRecall={recallMessage}
        formatBytes={formatBytes}
      />
    );
  }, [currentUser?.id, downloadingId, openImagePreview, handleOpenFile, recallMessage, formatBytes]);

  // ---- Loading state ----
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
      {ticket && <ChatHeader ticket={ticket} screenShare={screenShare} />}

      <ScreenSharePanel 
        screenShare={screenShare} 
        onStopViewing={screenShare.stopViewing} 
        onRetry={screenShare.joinViewing}
      />

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderMessage}
        contentContainerStyle={styles.chatList}
        onContentSizeChange={() => {
          // auto-scroll only when already at bottom
        }}
        onLayout={scrollToBottom}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />

      {showScrollButton && (
        <TouchableOpacity style={styles.scrollToBottomButton} onPress={scrollToBottom}>
          <Ionicons name="chevron-down" size={16} color="#ffffff" />
          <Text style={styles.scrollToBottomText}>回到最新</Text>
        </TouchableOpacity>
      )}

      <ChatInputBar
        inputText={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        enterToSend={enterToSend}
        onToggleEnterToSend={() => setEnterToSend(!enterToSend)}
        onPickCamera={handlePickCamera}
        onPickImage={handlePickImage}
        onPickFile={handlePickFile}
        onPasteClipboard={handlePasteClipboard}
        onClearInput={() => setInputText('')}
        pastePreview={pastePreview}
        onConfirmPaste={confirmSendPaste}
        onCancelPaste={cancelPaste}
      />

      <ChatImageViewer
        images={viewerImages}
        imageIndex={imageViewerState.imageIndex}
        remountKey={imageViewerState.remountKey}
        visible={imageViewerState.visible}
        onClose={closeImagePreview}
      />
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
  chatList: {
    padding: 16,
    paddingBottom: 32,
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
});
