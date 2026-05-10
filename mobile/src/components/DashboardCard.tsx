import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

interface DashboardCardProps {
  title: string;
  value: number | string | undefined;
  colors: readonly [string, string];
  iconName: keyof typeof Ionicons.glyphMap;
  textColor: string;
  loading: boolean;
}

export function DashboardCard({ title, value, colors, iconName, textColor, loading }: DashboardCardProps) {
  return (
    <LinearGradient colors={colors} style={styles.card} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: textColor }]}>{title}</Text>
        <Ionicons name={iconName} size={20} color={textColor} style={styles.cardIcon} />
      </View>
      {loading ? (
        <ActivityIndicator color={textColor} style={styles.cardLoading} />
      ) : (
        <Text style={[styles.cardValue, { color: textColor }]}>{value !== undefined ? value : '--'}</Text>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '47%',
    padding: 16,
    borderRadius: 20,
    marginBottom: 16,
    shadowColor: '#0A2688',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardIcon: {
    opacity: 0.8,
  },
  cardLoading: {
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  cardValue: {
    fontSize: 32,
    fontWeight: '800',
  },
});
