/**
 * Tests for ChatImageViewer — wraps react-native-image-viewing
 * with keyExtractor fix and WeChat-style UX.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ChatImageViewer } from '../ChatImageViewer';
import { ChatViewerImage } from '../../features/chatImageViewer';

const mockImageViewing = jest.fn((_props: unknown) => null);

jest.mock('react-native-image-viewing', () => ({
  __esModule: true,
  default: (props: unknown) => mockImageViewing(props),
}));

const images: ChatViewerImage[] = [
  { key: '1:file:0:https://example.com/a.png', uri: 'https://example.com/a.png', messageId: 1, source: 'file' },
  { key: '2:file:0:https://example.com/b.png', uri: 'https://example.com/b.png', messageId: 2, source: 'file' },
];

describe('ChatImageViewer', () => {
  beforeEach(() => {
    mockImageViewing.mockClear();
  });

  it('does not render when hidden', () => {
    render(
      <ChatImageViewer
        images={images}
        imageIndex={0}
        remountKey={1}
        visible={false}
        onClose={jest.fn()}
      />,
    );
    expect(mockImageViewing).not.toHaveBeenCalled();
  });

  it('passes correct props including keyExtractor and swipeToClose', () => {
    const onClose = jest.fn();

    render(
      <ChatImageViewer
        images={images}
        imageIndex={1}
        remountKey={2}
        visible
        onClose={onClose}
      />,
    );

    expect(mockImageViewing).toHaveBeenCalledWith(expect.objectContaining({
      doubleTapToZoomEnabled: true,
      swipeToCloseEnabled: true,
      imageIndex: 1,
      images: [{ uri: images[0].uri }, { uri: images[1].uri }],
      onRequestClose: onClose,
      visible: true,
    }));

    // Verify keyExtractor is provided (the fix for duplicate key)
    const props = mockImageViewing.mock.calls[0][0] as Record<string, unknown>;
    expect(props.keyExtractor).toBeDefined();
  });

  it('keyExtractor returns unique keys from image data', () => {
    render(
      <ChatImageViewer
        images={images}
        imageIndex={0}
        remountKey={3}
        visible
        onClose={jest.fn()}
      />,
    );

    const props = mockImageViewing.mock.calls[0][0] as {
      keyExtractor: (_src: unknown, index: number) => string;
    };
    const key0 = props.keyExtractor(null, 0);
    const key1 = props.keyExtractor(null, 1);

    expect(key0).toBe(images[0].key);
    expect(key1).toBe(images[1].key);
    expect(key0).not.toBe(key1); // unique!
  });

  it('clamps out-of-range imageIndex', () => {
    render(
      <ChatImageViewer
        images={images}
        imageIndex={99}
        remountKey={4}
        visible
        onClose={jest.fn()}
      />,
    );

    expect(mockImageViewing).toHaveBeenCalledWith(expect.objectContaining({
      imageIndex: 1, // clamped to last
    }));
  });

  it('passes EmptyHeader to hide default close button', () => {
    render(
      <ChatImageViewer
        images={images}
        imageIndex={0}
        remountKey={5}
        visible
        onClose={jest.fn()}
      />,
    );

    const props = mockImageViewing.mock.calls[0][0] as Record<string, unknown>;
    expect(props.HeaderComponent).toBeDefined();

    // EmptyHeader renders an empty View — verify it's a function component
    const HeaderComponent = props.HeaderComponent as React.FC;
    expect(typeof HeaderComponent).toBe('function');
  });

  it('remountKey change produces different component key', () => {
    const { rerender } = render(
      <ChatImageViewer
        images={images}
        imageIndex={0}
        remountKey={1}
        visible
        onClose={jest.fn()}
      />,
    );

    const firstCallCount = mockImageViewing.mock.calls.length;

    rerender(
      <ChatImageViewer
        images={images}
        imageIndex={0}
        remountKey={2}
        visible
        onClose={jest.fn()}
      />,
    );

    // remountKey change should trigger a new render of ImageViewing
    expect(mockImageViewing.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});
