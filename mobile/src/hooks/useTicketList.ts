import { useCallback, useEffect, useRef, useState } from 'react';

import { ticketsService, TicketItem } from '../services/tickets';
import type { TicketStatus } from '../constants/tickets';
import { logger } from '../utils/logger';

export interface UseTicketListReturn {
  tickets: TicketItem[];
  loading: boolean;
  refreshing: boolean;
  activeStatus: TicketStatus | '';
  setActiveStatus: (status: TicketStatus | '') => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export function useTicketList(): UseTicketListReturn {
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [activeStatus, setActiveStatus] = useState<TicketStatus | ''>('');
  const loadingRef = useRef(false);

  const fetchTickets = useCallback(async (pageIndex: number, status: TicketStatus | '', isRefresh = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

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
      logger.error('Failed to fetch tickets:', error);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets(1, activeStatus, true);
  }, [activeStatus, fetchTickets]);

  const onRefresh = useCallback(() => {
    fetchTickets(1, activeStatus, true);
  }, [activeStatus, fetchTickets]);

  const onLoadMore = useCallback(() => {
    if (!loading && hasMore && !refreshing) {
      fetchTickets(page + 1, activeStatus, false);
    }
  }, [loading, hasMore, refreshing, page, activeStatus, fetchTickets]);

  return {
    tickets,
    loading,
    refreshing,
    activeStatus,
    setActiveStatus,
    onRefresh,
    onLoadMore,
  };
}
