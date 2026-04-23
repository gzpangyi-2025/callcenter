import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, Statistic, Tag, Empty } from 'antd';
import {
  FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined,
  TeamOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { ticketsAPI, reportAPI } from '../../services/api';
import { useSocketStore } from '../../stores/socketStore';
import { useNavigate } from 'react-router-dom';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待接单' },
  in_progress: { color: 'blue', text: '服务中' },
  closing: { color: 'volcano', text: '待确认' },
  closed: { color: 'green', text: '已关闭' },
};

/** 格式化时间差为 Xd Xh Xm Xs */
function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0 || days > 0) parts.push(`${hours}时`);
  parts.push(`${minutes}分`);
  parts.push(`${seconds}秒`);
  return parts.join('');
}

const LiveTimer: React.FC<{ since: string }> = ({ since }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = now - new Date(since).getTime();
  return <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--primary-light)' }}>{formatDuration(elapsed)}</span>;
};

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({ total: 0, pending: 0, inProgress: 0, closed: 0 });
  const [pendingTop5, setPendingTop5] = useState<any[]>([]);
  const [progressTop5, setProgressTop5] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const { socket } = useSocketStore();
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const [res, sumRes]: any[] = await Promise.all([
        ticketsAPI.getAll({ pageSize: 100, isDashboard: true }),
        reportAPI.getSummary()
      ]);

      if (sumRes.code === 0) {
        setStats({
          total: sumRes.data.total || 0,
          pending: sumRes.data.pending || 0,
          inProgress: (sumRes.data.in_progress || 0) + (sumRes.data.closing || 0),
          closed: sumRes.data.closed || 0,
        });
      }

      if (res.code === 0) {
        const allItems = res.data.items || [];

        // 待接单 Top5 — 按创建时间降序（最老的在前）
        const pending = allItems
          .filter((t: any) => t.status === 'pending')
          .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .slice(0, 5);
        setPendingTop5(pending);

        // 服务中 Top5 — 按接单时间降序（最老的在前）
        const progress = allItems
          .filter((t: any) => ['in_progress', 'closing'].includes(t.status))
          .sort((a: any, b: any) => new Date(a.assignedAt || a.createdAt).getTime() - new Date(b.assignedAt || b.createdAt).getTime())
          .slice(0, 5);
        setProgressTop5(progress);
      }
    } catch {}
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => loadData();
    socket.on('ticketEvent', handler);
    return () => { socket.off('ticketEvent', handler); };
  }, [socket, loadData]);

  const statCards = [
    { key: 'total', title: '总工单数', value: stats.total, icon: <FileTextOutlined />, color: '#818cf8' },
    { key: 'pending', title: '待接单', value: stats.pending, icon: <ClockCircleOutlined />, color: '#f59e0b' },
    { key: 'in_progress', title: '服务中', value: stats.inProgress, icon: <TeamOutlined />, color: '#3b82f6' },
    { key: 'closed', title: '已关闭', value: stats.closed, icon: <CheckCircleOutlined />, color: '#10b981' },
  ];

  const renderTicketRow = (ticket: any, timeField: string, showPerson: string) => (
    <div
      key={ticket.id}
      className="ticket-card"
      style={{ marginBottom: 10, cursor: 'pointer', padding: '12px 16px' }}
      onClick={() => navigate(`/tickets/${ticket.id}`)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Tag color={statusMap[ticket.status]?.color} style={{ margin: 0, fontSize: 11 }}>
              {statusMap[ticket.status]?.text}
            </Tag>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticket.title}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {ticket.ticketNo} · {showPerson}: {
              showPerson === '接单人'
                ? (ticket.assignee?.realName || ticket.assignee?.displayName || ticket.assignee?.username || '-')
                : (ticket.creator?.realName || ticket.creator?.displayName || ticket.creator?.username || '-')
            }
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
            ⏱ {showPerson === '接单人' ? '已持续' : '工单时长'}
          </div>
          <LiveTimer since={ticket[timeField] || ticket.createdAt} />
        </div>
      </div>
    </div>
  );

  const [filteredTickets, setFilteredTickets] = useState<any[]>([]);
  const [filteredLoading, setFilteredLoading] = useState(false);

  // When activeFilter changes, load matching tickets from backend
  useEffect(() => {
    if (!activeFilter) { setFilteredTickets([]); return; }
    const loadFiltered = async () => {
      setFilteredLoading(true);
      try {
        const statusParam = activeFilter === 'total' ? undefined
          : activeFilter === 'in_progress' ? 'in_progress' // backend handles closing separately
          : activeFilter;
        const res: any = await ticketsAPI.getAll({
          pageSize: 200,
          status: statusParam as any,
        });
        if (res.code === 0) {
          let items = res.data.items || [];
          // For in_progress filter, also include 'closing' status
          if (activeFilter === 'in_progress') {
            const res2: any = await ticketsAPI.getAll({ pageSize: 200, status: 'closing' });
            if (res2.code === 0) items = [...items, ...(res2.data.items || [])];
          }
          setFilteredTickets(items);
        }
      } catch {} finally { setFilteredLoading(false); }
    };
    loadFiltered();
  }, [activeFilter]);

  const getFilterTitle = () => statCards.find(c => c.key === activeFilter)?.title || '筛选结果';
  const getFilterCount = () => {
    if (!activeFilter) return 0;
    const card = statCards.find(c => c.key === activeFilter);
    return card?.value || 0;
  };

  return (
    <div className="fade-in">
      <h2 style={{ marginBottom: 24, fontSize: 22, fontWeight: 600 }}>仪表盘</h2>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((item) => {
          const isActive = activeFilter === item.key;
          return (
            <Col xs={12} sm={12} md={6} key={item.key}>
              <Card
                className={`stat-card ${isActive ? 'active' : ''}`}
                onClick={() => setActiveFilter(prev => prev === item.key ? null : item.key)}
                style={{
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  background: isActive ? `linear-gradient(135deg, ${item.color}35, ${item.color}15)` : `linear-gradient(135deg, ${item.color}10, transparent)`,
                  border: isActive ? `2px solid ${item.color}` : `1px solid ${item.color}30`,
                  boxShadow: isActive ? `0 8px 24px ${item.color}50` : 'none',
                  transform: isActive ? 'translateY(-4px) scale(1.02)' : 'none',
                  opacity: isActive ? 1 : 0.8
                }}
              >
                <Statistic
                  title={<span style={{ color: 'var(--text-secondary)' }}>{item.title}</span>}
                  value={item.value}
                  prefix={<span style={{ color: item.color, fontSize: 24 }}>{item.icon}</span>}
                  valueStyle={{ color: item.color, fontWeight: 700, fontSize: 32 }}
                />
              </Card>
            </Col>
          );
        })}
      </Row>

      {activeFilter ? (
         <Card
           title={<span style={{ color: 'var(--text-primary)' }}>筛选结果 · {getFilterTitle()} ({getFilterCount()})</span>}
           style={{ borderRadius: 12 }}
           bodyStyle={{ padding: filteredTickets.length === 0 ? 24 : '8px 12px', maxHeight: '500px', overflowY: 'auto' }}
           extra={<a onClick={() => setActiveFilter(null)}>取消筛选</a>}
           loading={filteredLoading}
         >
           {filteredTickets.length === 0 && !filteredLoading ? (
             <Empty description="暂无匹配的工单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
           ) : (
             filteredTickets.map(t => renderTicketRow(t, t.assignedAt ? 'assignedAt' : 'createdAt', t.assigneeId ? '接单人' : '创建人'))
           )}
         </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {/* 服务中 Top 5 */}
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: 'var(--text-primary)' }}><ThunderboltOutlined style={{ color: '#3b82f6', marginRight: 8 }} />服务中 · Top 5</span>}
              style={{ borderRadius: 12 }}
              bodyStyle={{ padding: progressTop5.length === 0 ? 24 : '8px 12px' }}
            >
              {progressTop5.length === 0 ? (
                <Empty description="暂无服务中的工单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                progressTop5.map((t) => renderTicketRow(t, 'assignedAt', '接单人'))
              )}
            </Card>
          </Col>

          {/* 待接单 Top 5 */}
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: 'var(--text-primary)' }}><ClockCircleOutlined style={{ color: '#f59e0b', marginRight: 8 }} />待接单 · Top 5</span>}
              style={{ borderRadius: 12 }}
              bodyStyle={{ padding: pendingTop5.length === 0 ? 24 : '8px 12px' }}
            >
              {pendingTop5.length === 0 ? (
                <Empty description="暂无待接单的工单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                pendingTop5.map((t) => renderTicketRow(t, 'createdAt', '创建人'))
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default Dashboard;
