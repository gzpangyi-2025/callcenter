import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { TicketItem } from '../services/tickets';
import { STATUS_CONFIG } from '../constants/tickets';

interface TicketCardProps {
  item: TicketItem;
}

export const TicketCard = React.memo(function TicketCard({ item }: TicketCardProps) {
  const router = useRouter();
  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const time = new Date(item.createdAt).toLocaleDateString();

  return (
    <TouchableOpacity
      style={styles.ticketCard}
      activeOpacity={0.7}
      onPress={() => router.push(`/ticket/${item.id}` as `/ticket/${number}`)}
    >
      <View style={styles.ticketHeader}>
        <Text style={styles.ticketNo}>{item.ticketNo}</Text>
        <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
          <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
        </View>
      </View>

      <Text style={styles.ticketTitle} numberOfLines={2}>{item.title}</Text>

      <View style={styles.ticketFooter}>
        <View style={styles.footerInfo}>
          <Ionicons name="time-outline" size={14} color="#666666" />
          <Text style={styles.footerText}>{time}</Text>
        </View>
        <View style={styles.footerInfo}>
          <Ionicons name="person-outline" size={14} color="#666666" />
          <Text style={styles.footerText}>
            {item.creator?.realName || item.creator?.username || 'System'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  ticketCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ffffff',
    shadowColor: '#0A2688',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  ticketNo: {
    color: '#94a3b8',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  ticketTitle: {
    color: '#333333',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    lineHeight: 22,
  },
  ticketFooter: {
    flexDirection: 'row',
    gap: 16,
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    color: '#666666',
    fontSize: 13,
  },
});
