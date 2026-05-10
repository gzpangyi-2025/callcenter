import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { TicketItem } from '../services/tickets';
import { STATUS_CONFIG } from '../constants/tickets';
import type { ScreenShareState } from '../hooks/useScreenShare';

interface ChatHeaderProps {
  ticket: TicketItem;
  screenShare?: Pick<ScreenShareState, 'isViewing' | 'hasActiveShare' | 'sharerName'> & {
    joinViewing: () => void;
  };
}

export function ChatHeader({ ticket, screenShare }: ChatHeaderProps) {
  const router = useRouter();
  const config = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.pending;

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

        <View style={styles.actionsContainer}>
          {screenShare && (
            <TouchableOpacity 
              style={[
                styles.iconButton, 
                screenShare.hasActiveShare && styles.iconButtonActive
              ]}
              onPress={() => {
                if (screenShare.hasActiveShare && !screenShare.isViewing) {
                  screenShare.joinViewing();
                }
              }}
            >
              <Ionicons 
                name="desktop-outline" 
                size={20} 
                color={screenShare.hasActiveShare ? '#10b981' : '#64748b'} 
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="mic-outline" size={20} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="download-outline" size={20} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="information-circle-outline" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    marginLeft: 12,
    padding: 2,
  },
  iconButtonActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 6,
    padding: 2,
  },
});
