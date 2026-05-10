import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Platform } from 'react-native';
import { useAuthStore } from '../../src/store/useAuthStore';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { reportService, DashboardSummary } from '../../src/services/report';
import { DashboardCard } from '../../src/components/DashboardCard';
import { logger } from '../../src/utils/logger';

export default function DashboardScreen() {
  const user = useAuthStore(state => state.user);
  const logout = useAuthStore(state => state.logout);
  const router = useRouter();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await reportService.getDashboardSummary();
      setSummary(data);
    } catch (error) {
      logger.error('Failed to fetch dashboard summary', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSummary();
  }, [fetchSummary]);

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  const isCardLoading = loading && !refreshing;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00A8D4" />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>欢迎回来, {user?.realName || user?.username} 👋</Text>
          <Text style={styles.subtitle}>让每次服务都有温度</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>概览数据</Text>
      <View style={styles.grid}>
        <DashboardCard title="总工单数" value={summary?.total} colors={['#ffffff', '#f4faff']} iconName="document-text" textColor="#0A2688" loading={isCardLoading} />
        <DashboardCard title="待接单" value={summary?.pending} colors={['#ffffff', '#fffaf0']} iconName="time" textColor="#ea580c" loading={isCardLoading} />
        <DashboardCard title="服务中" value={summary?.in_progress} colors={['#ffffff', '#e6f8fb']} iconName="people" textColor="#00A8D4" loading={isCardLoading} />
        <DashboardCard title="已关闭" value={summary?.closed} colors={['#ffffff', '#f0fdf4']} iconName="checkmark-circle" textColor="#16a34a" loading={isCardLoading} />
      </View>

      {summary?.avgHours !== undefined && (
        <View style={styles.statsBanner}>
          <View style={styles.statsLeft}>
            <Ionicons name="timer-outline" size={24} color="#00A8D4" />
            <Text style={styles.statsLabel}>平均处理时长</Text>
          </View>
          <Text style={styles.statsValue}>{summary.avgHours} 小时</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F8',
  },
  contentContainer: {
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0A2688',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
  },
  logoutButton: {
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  logoutText: {
    color: '#e11d48',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  statsBanner: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#0A2688',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statsLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#666666',
  },
  statsValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00A8D4',
  },
});
