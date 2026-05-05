import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Card, Badge, Typography, Switch, Space, Tooltip, Tag, Tabs, Image, Button, Row, Col } from 'antd';
import {
  CodeOutlined, PauseCircleOutlined, PlayCircleOutlined,
  ClearOutlined, FullscreenOutlined, FullscreenExitOutlined,
  FileImageOutlined, FilePdfOutlined, FileWordOutlined,
  FilePptOutlined, FileExcelOutlined, FileMarkdownOutlined,
  DownloadOutlined, CheckCircleFilled, LoadingOutlined,
  ClockCircleFilled, RightOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

interface LogEntry {
  taskId: string;
  line: string;
  type: 'thought' | 'action' | 'output' | 'info' | 'error';
  timestamp: number;
}

interface FileEvent {
  taskId: string;
  eventType: 'file_ready';
  name: string;
  category: 'core' | 'process';
  size: number;
  url: string;
  mimeType: string;
  timestamp: number;
}

type StreamEvent = LogEntry | FileEvent;

interface Props {
  taskId: string;
  taskStatus: string;
}

const TYPE_COLORS: Record<string, string> = {
  thought: '#8b5cf6',
  action:  '#f59e0b',
  output:  '#10b981',
  info:    '#3b82f6',
  error:   '#ef4444',
};

/** Map MIME types to icons */
const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return <FileImageOutlined style={{ color: '#10b981', fontSize: 20 }} />;
  if (mimeType.includes('pdf')) return <FilePdfOutlined style={{ color: '#ef4444', fontSize: 20 }} />;
  if (mimeType.includes('word') || mimeType.includes('docx')) return <FileWordOutlined style={{ color: '#3b82f6', fontSize: 20 }} />;
  if (mimeType.includes('presentation') || mimeType.includes('pptx')) return <FilePptOutlined style={{ color: '#f59e0b', fontSize: 20 }} />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('xlsx')) return <FileExcelOutlined style={{ color: '#22c55e', fontSize: 20 }} />;
  if (mimeType.includes('markdown') || mimeType.includes('text')) return <FileMarkdownOutlined style={{ color: '#8b5cf6', fontSize: 20 }} />;
  return <FileMarkdownOutlined style={{ color: '#94a3b8', fontSize: 20 }} />;
};

/** Execution stages derived from progress step text */
interface Stage {
  key: string;
  label: string;
  status: 'done' | 'active' | 'pending';
}

const STAGE_KEYS = ['env', 'attachments', 'codex', 'upload', 'done'] as const;
const STAGE_LABELS: Record<string, string> = {
  env: '环境准备',
  attachments: '附件下载',
  codex: 'Codex 执行',
  upload: '上传产物',
  done: '完成',
};

function deriveStages(currentStep: string | null, progress: number, taskStatus: string): Stage[] {
  const stages: Stage[] = STAGE_KEYS.map(key => ({
    key,
    label: STAGE_LABELS[key],
    status: 'pending' as const,
  }));

  if (taskStatus === 'completed') {
    return stages.map(s => ({ ...s, status: 'done' as const }));
  }
  if (taskStatus === 'failed') {
    // Mark stages up to where it failed as done, current as active (will show error)
    let activeIdx = 2; // default to codex
    if (progress < 10) activeIdx = 0;
    else if (progress < 10) activeIdx = 1;
    return stages.map((s, i) => ({
      ...s,
      status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
    }));
  }

  // Running — determine current stage from progress
  let activeIdx = 0;
  if (progress >= 95) activeIdx = 4; // done
  else if (progress >= 85) activeIdx = 3; // upload
  else if (progress >= 10) activeIdx = 2; // codex
  else if (progress >= 7) activeIdx = 1;  // attachments
  else activeIdx = 0; // env

  return stages.map((s, i) => ({
    ...s,
    status: i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending',
  }));
}

const TaskLogPanel: React.FC<Props> = ({ taskId, taskStatus }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<FileEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [, setCurrentStep] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const token = localStorage.getItem('accessToken') ?? '';
    const url = `/api/ai/tasks/${taskId}/logs/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        if ('eventType' in data && data.eventType === 'file_ready') {
          // File event
          setFiles((prev) => {
            // Deduplicate by name
            if (prev.some(f => f.name === data.name)) return prev;
            return [...prev, data as FileEvent];
          });
        } else {
          // Log entry
          const entry = data as LogEntry;
          setLogs((prev) => {
            const next = [...prev, entry];
            return next.length > 1000 ? next.slice(-1000) : next;
          });

          // Try to extract progress info from log lines
          if (entry.type === 'info' || entry.type === 'output') {
            // Parse step info from specific patterns
            if (entry.line.includes('正在调用 Codex')) {
              setCurrentStep('codex');
              setProgress(10);
            } else if (entry.line.includes('正在上传产物文件')) {
              setCurrentStep('upload');
              setProgress(85);
            } else if (entry.line.includes('任务完成')) {
              setCurrentStep('done');
              setProgress(100);
            }
          }
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      setConnected(false);
    };

    eventSourceRef.current = es;
  }, [taskId]);

  useEffect(() => {
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

  const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  const isActive = taskStatus === 'running' || taskStatus === 'pending';
  const panelHeight = expanded ? 500 : 280;

  // Separate files into core and process
  const { coreFiles, processFiles } = useMemo(() => {
    const core: FileEvent[] = [];
    const proc: FileEvent[] = [];
    for (const f of files) {
      if (f.category === 'core') core.push(f);
      else proc.push(f);
    }
    return { coreFiles: core, processFiles: proc };
  }, [files]);

  const stages = deriveStages(currentStep, progress, taskStatus);

  // ── Progress Overview Tab ──────────────────────────────────────

  const renderProgressTab = () => (
    <div style={{ padding: '12px 16px' }}>
      {/* Stage progress bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '8px 0 16px',
        overflowX: 'auto',
      }}>
        {stages.map((stage, i) => (
          <React.Fragment key={stage.key}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 20,
              background: stage.status === 'active' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
              border: stage.status === 'active' ? '1px solid #818cf8' : '1px solid transparent',
              transition: 'all 0.3s',
            }}>
              {stage.status === 'done' ? (
                <CheckCircleFilled style={{ color: '#10b981', fontSize: 14 }} />
              ) : stage.status === 'active' ? (
                <LoadingOutlined spin style={{ color: '#818cf8', fontSize: 14 }} />
              ) : (
                <ClockCircleFilled style={{ color: '#d1d5db', fontSize: 14 }} />
              )}
              <Text style={{
                fontSize: 12,
                color: stage.status === 'done' ? '#10b981' : stage.status === 'active' ? '#818cf8' : '#9ca3af',
                fontWeight: stage.status === 'active' ? 600 : 400,
                whiteSpace: 'nowrap',
              }}>
                {stage.label}
              </Text>
            </div>
            {i < stages.length - 1 && (
              <RightOutlined style={{ color: '#d1d5db', fontSize: 10, flexShrink: 0 }} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Real-time file gallery */}
      {files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#9ca3af' }}>
          {isActive ? '等待文件生成...' : '暂无实时文件'}
        </div>
      ) : (
        <div style={{ maxHeight: panelHeight - 80, overflowY: 'auto' }}>
          {/* Core outputs first */}
          {coreFiles.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ fontSize: 12, color: '#818cf8', display: 'block', marginBottom: 8 }}>
                🎯 核心产物 ({coreFiles.length})
              </Text>
              <Row gutter={[8, 8]}>
                {coreFiles.map((f, i) => renderFileCard(f, i))}
              </Row>
            </div>
          )}

          {/* Process materials */}
          {processFiles.length > 0 && (
            <div>
              <Text type="secondary" strong style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                过程材料 ({processFiles.length})
              </Text>
              {processFiles.some(f => f.mimeType.startsWith('image/')) && (
                <div style={{ marginBottom: 8 }}>
                  <Image.PreviewGroup>
                    <Row gutter={[6, 6]}>
                      {processFiles.filter(f => f.mimeType.startsWith('image/')).map((f, i) => (
                        <Col key={i} span={4}>
                          <div style={{
                            borderRadius: 6,
                            overflow: 'hidden',
                            border: '1px solid #f0f0f0',
                            aspectRatio: '1',
                            animation: 'fadeIn 0.3s ease-in',
                          }}>
                            <Image
                              src={f.url}
                              alt={f.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              preview={{ mask: <Text style={{ color: '#fff', fontSize: 10 }}>预览</Text> }}
                            />
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Image.PreviewGroup>
                </div>
              )}
              {/* Non-image process files */}
              {processFiles.filter(f => !f.mimeType.startsWith('image/')).map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '4px 8px', borderBottom: '1px dashed #f0f0f0',
                }}>
                  {getFileIcon(f.mimeType)}
                  <Text ellipsis style={{ fontSize: 12, flex: 1 }}>{f.name.split('/').pop()}</Text>
                  <a href={f.url} target="_blank" rel="noopener noreferrer">
                    <Button size="small" type="link" icon={<DownloadOutlined />}>下载</Button>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderFileCard = (f: FileEvent, i: number) => {
    const displayName = f.name.split('/').pop() || f.name;
    const isImage = f.mimeType.startsWith('image/');

    if (isImage) {
      return (
        <Col key={i} span={8}>
          <div style={{
            borderRadius: 8,
            overflow: 'hidden',
            border: '2px solid #818cf8',
            animation: 'fadeIn 0.3s ease-in',
          }}>
            <Image
              src={f.url}
              alt={displayName}
              style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }}
            />
            <div style={{ padding: '4px 6px', fontSize: 11, color: '#666', textAlign: 'center' }}>
              {displayName}
            </div>
          </div>
        </Col>
      );
    }

    return (
      <Col key={i} span={24}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderRadius: 8,
          border: '2px solid #818cf8', background: 'rgba(129, 140, 248, 0.04)',
          animation: 'fadeIn 0.3s ease-in',
        }}>
          {getFileIcon(f.mimeType)}
          <div style={{ flex: 1 }}>
            <Text strong style={{ fontSize: 13 }}>{displayName}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {(f.size / 1024).toFixed(0)} KB
            </Text>
          </div>
          <a href={f.url} target="_blank" rel="noopener noreferrer">
            <Button size="small" type="primary" icon={<DownloadOutlined />}>下载</Button>
          </a>
        </div>
      </Col>
    );
  };

  // ── Raw Log Tab ────────────────────────────────────────────────

  const renderLogTab = () => (
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
  );

  // ── Render ─────────────────────────────────────────────────────

  const tabItems = [
    {
      key: 'progress',
      label: (
        <Space size={4}>
          <span>📊</span>
          <span>进度概览</span>
          {files.length > 0 && (
            <Tag color="blue" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
              {files.length} 文件
            </Tag>
          )}
        </Space>
      ),
      children: renderProgressTab(),
    },
    {
      key: 'logs',
      label: (
        <Space size={4}>
          <span>📋</span>
          <span>原始日志</span>
          <Tag color="default" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
            {logs.length} 行
          </Tag>
        </Space>
      ),
      children: renderLogTab(),
    },
  ];

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
      <Tabs
        defaultActiveKey="progress"
        size="small"
        items={tabItems}
        style={{ margin: '0 12px' }}
        tabBarStyle={{ marginBottom: 0 }}
      />
      {/* CSS animation for file cards */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Card>
  );
};

export default TaskLogPanel;
