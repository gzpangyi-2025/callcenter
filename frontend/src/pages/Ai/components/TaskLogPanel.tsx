import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Badge, Typography, Switch, Space, Tooltip, Tag } from 'antd';
import {
  CodeOutlined, PauseCircleOutlined, PlayCircleOutlined,
  ClearOutlined, FullscreenOutlined, FullscreenExitOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface LogEntry {
  taskId: string;
  line: string;
  type: 'thought' | 'action' | 'output' | 'info' | 'error';
  timestamp: number;
}

interface Props {
  taskId: string;
  taskStatus: string;
}

const TYPE_COLORS: Record<string, string> = {
  thought: '#8b5cf6',  // purple
  action:  '#f59e0b',  // amber
  output:  '#10b981',  // green
  info:    '#3b82f6',  // blue
  error:   '#ef4444',  // red
};

const TaskLogPanel: React.FC<Props> = ({ taskId, taskStatus }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const token = localStorage.getItem('accessToken') ?? '';
    // Note: EventSource doesn't support custom headers natively.
    // We pass the token as a query param; the backend should accept it.
    // For now, the JWT guard reads from Authorization header set by cookie.
    const url = `/api/ai/tasks/${taskId}/logs/stream`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        setLogs((prev) => {
          const next = [...prev, entry];
          // Keep last 1000 lines in memory
          return next.length > 1000 ? next.slice(-1000) : next;
        });
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      setConnected(false);
      // Auto-reconnect is handled by EventSource itself
    };

    eventSourceRef.current = es;
  }, [taskId]);

  useEffect(() => {
    // Only connect for running/pending tasks
    if (taskStatus === 'running' || taskStatus === 'pending') {
      connect();
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [taskId, taskStatus, connect]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Strip ANSI escape codes for display
  const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  const isActive = taskStatus === 'running' || taskStatus === 'pending';
  const panelHeight = expanded ? 500 : 280;

  return (
    <Card
      size="small"
      title={
        <Space>
          <CodeOutlined style={{ color: '#10b981' }} />
          <span>实时执行日志</span>
          {connected && isActive ? (
            <Badge status="processing" text={<Text type="secondary" style={{ fontSize: 12 }}>实时连接中</Text>} />
          ) : isActive ? (
            <Badge status="warning" text={<Text type="secondary" style={{ fontSize: 12 }}>连接中...</Text>} />
          ) : (
            <Badge status="default" text={<Text type="secondary" style={{ fontSize: 12 }}>任务已结束</Text>} />
          )}
          <Tag color="default" style={{ fontSize: 11 }}>{logs.length} 行</Tag>
        </Space>
      }
      extra={
        <Space size="small">
          <Tooltip title={autoScroll ? '关闭自动滚动' : '开启自动滚动'}>
            <Switch
              size="small"
              checked={autoScroll}
              onChange={setAutoScroll}
              checkedChildren={<PlayCircleOutlined />}
              unCheckedChildren={<PauseCircleOutlined />}
            />
          </Tooltip>
          <Tooltip title="清空日志">
            <ClearOutlined
              style={{ cursor: 'pointer', color: '#999' }}
              onClick={() => setLogs([])}
            />
          </Tooltip>
          <Tooltip title={expanded ? '收起' : '展开'}>
            {expanded ? (
              <FullscreenExitOutlined
                style={{ cursor: 'pointer', color: '#999' }}
                onClick={() => setExpanded(false)}
              />
            ) : (
              <FullscreenOutlined
                style={{ cursor: 'pointer', color: '#999' }}
                onClick={() => setExpanded(true)}
              />
            )}
          </Tooltip>
        </Space>
      }
      style={{ marginTop: 12 }}
      styles={{
        body: { padding: 0 },
      }}
    >
      <div
        ref={containerRef}
        style={{
          height: panelHeight,
          overflow: 'auto',
          background: '#1a1a2e',
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: 12,
          lineHeight: '20px',
          padding: '8px 12px',
          color: '#e2e8f0',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#64748b', padding: '20px 0', textAlign: 'center' }}>
            {isActive ? '等待日志输出...' : '暂无日志记录'}
          </div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <span style={{ color: '#64748b', flexShrink: 0, userSelect: 'none' }}>
                {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              <span
                style={{
                  color: TYPE_COLORS[entry.type] ?? '#e2e8f0',
                  fontWeight: entry.type === 'error' ? 600 : 400,
                }}
              >
                {stripAnsi(entry.line)}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};

export default TaskLogPanel;
