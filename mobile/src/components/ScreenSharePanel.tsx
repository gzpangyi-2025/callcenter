import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';
import type { ScreenShareState } from '../hooks/useScreenShare';

interface ScreenSharePanelProps {
  screenShare: ScreenShareState;
  onStopViewing: () => void;
  onRetry: () => void;
}

export function ScreenSharePanel({ screenShare, onStopViewing, onRetry }: ScreenSharePanelProps) {
  const { isViewing, remoteStream, sharerName, connectionState } = screenShare;

  if (!isViewing && connectionState !== 'connecting' && connectionState !== 'reconnecting') return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="desktop-outline" size={18} color="#00A8D4" />
          <Text style={styles.headerText}>
            {connectionState === 'connected' ? `正在观看 ${sharerName} 的屏幕` : '正在连接...'}
          </Text>
        </View>
        <TouchableOpacity onPress={onStopViewing} style={styles.closeButton}>
          <Ionicons name="close-circle" size={24} color="#FF4D4F" />
        </TouchableOpacity>
      </View>
      
      <View style={styles.videoContainer}>
        {connectionState === 'connected' && remoteStream ? (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.rtcView}
            objectFit="contain"
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00A8D4" />
            <Text style={styles.loadingText}>
              {connectionState === 'reconnecting' ? '正在重连...' : '建立连接中...'}
            </Text>
            {connectionState === 'failed' && (
              <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
                <Text style={styles.retryText}>点击重试</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#000000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1E293B',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
  closeButton: {
    padding: 4,
  },
  videoContainer: {
    height: 220,
    width: '100%',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rtcView: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 13,
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#00A8D4',
    borderRadius: 6,
  },
  retryText: {
    color: '#fff',
    fontSize: 13,
  },
});
