import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ticketsService, TicketItem, TicketStatus } from '../../src/services/tickets';

const STATUS_FILTERS: { label: string; value: TicketStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '待接单', value: 'pending' },
  { label: '服务中', value: 'in_progress' },
  { label: '待确认', value: 'closing' },
  { label: '已关单', value: 'closed' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '待接单', color: '#ea580c', bg: '#fff7ed' },
  in_progress: { label: '服务中', color: '#00A8D4', bg: '#e6f8fb' },
  closing: { label: '待确认', color: '#8b5cf6', bg: '#f5f3ff' },
  closed: { label: '已关单', color: '#16a34a', bg: '#f0fdf4' },
};

export default function TicketsScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [activeStatus, setActiveStatus] = useState<TicketStatus | ''>('');

  const fetchTickets = useCallback(async (pageIndex: number, status: TicketStatus | '', isRefresh = false) => {
    if (loading) return;
    
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await ticketsService.getTickets({
        page: pageIndex,
        pageSize: 10,
        status: status,
      });

      if (isRefresh) {
        setTickets(data.items);
      } else {
        setTickets(prev => [...prev, ...data.items]);
      }

      setHasMore(pageIndex < data.totalPages);
      setPage(pageIndex);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets(1, activeStatus, true);
  }, [activeStatus, fetchTickets]);

  const onRefresh = () => {
    fetchTickets(1, activeStatus, true);
  };

  const onLoadMore = () => {
    if (!loading && hasMore && !refreshing) {
      fetchTickets(page + 1, activeStatus, false);
    }
  };

  const renderFilterBar = () => (
    <View style={styles.filterBar}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={STATUS_FILTERS}
        keyExtractor={item => item.value}
        renderItem={({ item }) => {
          const isActive = activeStatus === item.value;
          return (
            <TouchableOpacity
              style={[styles.filterItem, isActive && styles.filterItemActive]}
              onPress={() => setActiveStatus(item.value)}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );

  const renderTicketItem = ({ item }: { item: TicketItem }) => {
    const config = STATUS_CONFIG[item.status] || STATUS_CONFIG['pending'];
    const time = new Date(item.createdAt).toLocaleDateString();

    return (
      <TouchableOpacity 
        style={styles.ticketCard}
        activeOpacity={0.7}
        onPress={() => router.push(`/ticket/${item.id}` as any)}
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
  };

  const renderFooter = () => {
    if (!loading) return <View style={{ height: 100 }} />;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color="#00A8D4" />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>工单列表</Text>
      </View>
      
      {renderFilterBar()}

      <FlatList
        data={tickets}
        keyExtractor={item => item.id.toString()}
        renderItem={renderTicketItem}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00A8D4" />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          !loading && !refreshing ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={48} color="#cccccc" />
              <Text style={styles.emptyText}>暂无数据</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F8', // 避免纯白刺眼，使用护眼浅灰
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0A2688', // 银信科技主色调深蓝
  },
  filterBar: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  filterItem: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  filterItemActive: {
    backgroundColor: '#e6f8fb', // 银信主色调浅底
    borderColor: '#00A8D4', // 银信科技标准蓝
  },
  filterText: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#00A8D4',
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 100, // Safe space for bottom tab
  },
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
  footerLoader: {
    padding: 24,
    alignItems: 'center',
    height: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 16,
    color: '#999999',
    fontSize: 15,
  },
});
