import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { TicketCard } from '../../src/components/TicketCard';
import { useTicketList } from '../../src/hooks/useTicketList';
import type { TicketItem } from '../../src/services/tickets';
import type { TicketStatus } from '../../src/constants/tickets';

const STATUS_FILTERS: { label: string; value: TicketStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '待接单', value: 'pending' },
  { label: '服务中', value: 'in_progress' },
  { label: '待确认', value: 'closing' },
  { label: '已关单', value: 'closed' },
];

export default function TicketsScreen() {
  const {
    tickets,
    loading,
    refreshing,
    activeStatus,
    setActiveStatus,
    onRefresh,
    onLoadMore,
  } = useTicketList();

  const renderTicketItem = useCallback(({ item }: { item: TicketItem }) => (
    <TicketCard item={item} />
  ), []);

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

  const renderFooter = () => {
    if (!loading) return <View style={styles.footerSpacer} />;
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
    backgroundColor: '#F4F6F8',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0A2688',
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
    backgroundColor: '#e6f8fb',
    borderColor: '#00A8D4',
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
    paddingBottom: 100,
  },
  footerSpacer: {
    height: 100,
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
