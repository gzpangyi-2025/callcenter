import { ChatMessage } from '../services/chat';

export type ChatViewerImageSource = 'file' | 'markdown';

export interface ChatViewerImage {
  key: string;
  uri: string;
  messageId: number;
  source: ChatViewerImageSource;
}

export interface ChatImageViewerState {
  visible: boolean;
  imageIndex: number;
  remountKey: number;
}

const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

export const normalizeChatImageUrl = (url: string, apiBaseUrl: string) => {
  const baseUrl = apiBaseUrl.replace(/\/api$/, '');
  return url.startsWith('/') ? `${baseUrl}${url}` : url;
};

export const createChatViewerImageKey = (
  messageId: number,
  source: ChatViewerImageSource,
  uri: string,
  marker: number | string = 0,
) => `${messageId}:${source}:${marker}:${uri}`;

export const extractMarkdownImageUrls = (content: string, apiBaseUrl: string) => {
  const images: { keyMarker: number; uri: string }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(MARKDOWN_IMAGE_REGEX);

  while ((match = regex.exec(content)) !== null) {
    images.push({
      keyMarker: match.index,
      uri: normalizeChatImageUrl(match[2], apiBaseUrl),
    });
  }

  return images;
};

export const buildChatViewerImages = (messages: ChatMessage[], apiBaseUrl: string): ChatViewerImage[] => {
  const images: ChatViewerImage[] = [];

  for (const message of messages) {
    if (message.type === 'image' && message.fileUrl) {
      const uri = normalizeChatImageUrl(message.fileUrl, apiBaseUrl);
      images.push({
        key: createChatViewerImageKey(message.id, 'file', uri),
        uri,
        messageId: message.id,
        source: 'file',
      });
    }

    for (const image of extractMarkdownImageUrls(message.content || '', apiBaseUrl)) {
      images.push({
        key: createChatViewerImageKey(message.id, 'markdown', image.uri, image.keyMarker),
        uri: image.uri,
        messageId: message.id,
        source: 'markdown',
      });
    }
  }

  return images;
};

export const openChatImageViewerState = (
  previous: ChatImageViewerState,
  imageIndex: number,
): ChatImageViewerState => ({
  visible: true,
  imageIndex,
  remountKey: previous.remountKey + 1,
});

export const closeChatImageViewerState = (previous: ChatImageViewerState): ChatImageViewerState => ({
  visible: false,
  imageIndex: 0,
  remountKey: previous.remountKey + 1,
});
