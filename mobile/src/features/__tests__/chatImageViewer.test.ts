import {
  buildChatViewerImages,
  closeChatImageViewerState,
  createChatViewerImageKey,
  extractMarkdownImageUrls,
  normalizeChatImageUrl,
  openChatImageViewerState,
} from '../chatImageViewer';
import { ChatMessage } from '../../services/chat';

const API_BASE_URL = 'http://192.168.50.51/api';

const createMessage = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 1,
  content: 'hello',
  type: 'text',
  createdAt: '2026-05-10T00:00:00.000Z',
  sender: {
    id: 10,
    username: 'demo',
  },
  ...overrides,
});

describe('chat image viewer helpers', () => {
  it('normalizes relative file URLs against the API host', () => {
    expect(normalizeChatImageUrl('/uploads/a.png', API_BASE_URL)).toBe(
      'http://192.168.50.51/uploads/a.png',
    );
    expect(normalizeChatImageUrl('https://example.com/a.png', API_BASE_URL)).toBe(
      'https://example.com/a.png',
    );
  });

  it('extracts markdown image URLs with stable source markers', () => {
    const images = extractMarkdownImageUrls('before ![one](/a.png) after ![two](https://x/b.jpg)', API_BASE_URL);

    expect(images).toEqual([
      { keyMarker: 7, uri: 'http://192.168.50.51/a.png' },
      { keyMarker: 28, uri: 'https://x/b.jpg' },
    ]);
  });

  it('builds one ordered viewer image list from file and markdown messages', () => {
    const messages = [
      createMessage({
        id: 11,
        type: 'image',
        content: '[image]',
        fileUrl: '/files/one.png',
      }),
      createMessage({
        id: 12,
        content: 'inline ![shot](/files/two.png)',
      }),
    ];

    expect(buildChatViewerImages(messages, API_BASE_URL)).toEqual([
      {
        key: createChatViewerImageKey(11, 'file', 'http://192.168.50.51/files/one.png'),
        uri: 'http://192.168.50.51/files/one.png',
        messageId: 11,
        source: 'file',
      },
      {
        key: createChatViewerImageKey(12, 'markdown', 'http://192.168.50.51/files/two.png', 7),
        uri: 'http://192.168.50.51/files/two.png',
        messageId: 12,
        source: 'markdown',
      },
    ]);
  });

  it('resets index and remounts after close to avoid stale zoom state', () => {
    const opened = openChatImageViewerState({ visible: false, imageIndex: 0, remountKey: 3 }, 2);
    const closed = closeChatImageViewerState(opened);

    expect(opened).toEqual({ visible: true, imageIndex: 2, remountKey: 4 });
    expect(closed).toEqual({ visible: false, imageIndex: 0, remountKey: 5 });
  });

  it('remounts when reopening the same image', () => {
    const firstOpen = openChatImageViewerState({ visible: false, imageIndex: 0, remountKey: 0 }, 1);
    const closed = closeChatImageViewerState(firstOpen);
    const secondOpen = openChatImageViewerState(closed, 1);

    expect(secondOpen.visible).toBe(true);
    expect(secondOpen.imageIndex).toBe(1);
    expect(secondOpen.remountKey).toBeGreaterThan(firstOpen.remountKey);
  });
});
