/**
 * Chat image viewer — uses react-native-image-viewing for
 * native-quality pinch-to-zoom and swipe navigation.
 *
 * Patches applied via patch-package:
 * 1. Hard boundary clamp (prevents dragging image out of screen).
 * 2. Global tap-to-close (tap anywhere on screen to dismiss).
 * 3. Flat image Y-axis snap (prevents vertical scroll on short images).
 *
 * Our customizations:
 * 1. keyExtractor → unique keys prevent the "black screen" bug.
 * 2. remountKey → forces fresh mount to reset zoom state.
 * 3. EmptyHeader → hides ✕ button (WeChat-style, tap-to-close instead).
 */

import React from 'react';
import { View } from 'react-native';
import ImageViewing from 'react-native-image-viewing';

import { ChatViewerImage } from '../features/chatImageViewer';

interface ChatImageViewerProps {
  images: ChatViewerImage[];
  imageIndex: number;
  remountKey: number;
  visible: boolean;
  onClose: () => void;
}

/** Empty header — removes the default "✕" close button. */
function EmptyHeader() {
  return <View />;
}

export function ChatImageViewer({
  images,
  imageIndex,
  remountKey,
  visible,
  onClose,
}: ChatImageViewerProps) {
  if (!visible || images.length === 0) {
    return null;
  }

  return (
    <ImageViewing
      key={remountKey}
      images={images.map(({ uri }) => ({ uri }))}
      imageIndex={Math.min(Math.max(imageIndex, 0), images.length - 1)}
      visible={visible}
      onRequestClose={onClose}
      keyExtractor={(_imageSrc, index) => images[index]?.key ?? String(index)}
      HeaderComponent={EmptyHeader}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
      delayLongPress={1000}
    />
  );
}
