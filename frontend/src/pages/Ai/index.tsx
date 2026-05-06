import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Table, Tag, Space, Modal, Form, Select, Input, message,
  Typography, Tooltip, Badge, Descriptions, Spin, Empty, Alert,
  Row, Col, Statistic, Progress, Tabs, Upload, Radio, Image, Popconfirm, Switch,
} from 'antd';
import {
  RobotOutlined, PlusOutlined, ReloadOutlined, EyeOutlined,
  StopOutlined, DownloadOutlined, ThunderboltOutlined, EditOutlined,
  ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  LoadingOutlined, InboxOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { aiAPI, filesAPI } from '../../services/api';
import { useAuthStore, type User } from '../../stores/authStore';
import TaskLogPanel from './components/TaskLogPanel';
import AiChatPanel from './components/AiChatPanel';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: '排队中', color: 'blue',    icon: <ClockCircleOutlined /> },
  running:   { label: '执行中', color: 'orange',  icon: <LoadingOutlined spin /> },
  paused:    { label: '待确认', color: 'gold',    icon: <ExclamationCircleOutlined /> },
  completed: { label: '已完成', color: 'green',   icon: <CheckCircleOutlined /> },
  failed:    { label: '执行失败', color: 'red',   icon: <ExclamationCircleOutlined /> },
  cancelled: { label: '已取消', color: 'default', icon: <StopOutlined /> },
};

const AiPage: React.FC = () => {
  const user = useAuthStore(s => s.user) as User | null;
  const isAdmin = user?.role?.name === 'admin';

  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [showAll, setShowAll] = useState(false); // 管理员查看全部
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [useRawPrompt, setUseRawPrompt] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [taskFiles, setTaskFiles] = useState<any[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const taskFilesRequestSeqRef = useRef(0);
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, boolean>>({});
  const [uploadedAttachments, setUploadedAttachments] = useState<Array<{ name: string; url: string; size: number }>>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<any>(null);
  const [modifyForm] = Form.useForm();

  // Text file preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');

  /**
   * Force-download a file using fetch + Blob URL.
   * This works in Chrome even when the page has an invalid certificate,
   * because we fetch from the same-origin proxy endpoint and create a blob: URL
   * with an explicit download attribute — bypassing Chrome's cross-origin filename stripping.
   */
  const handleFileDownload = useCallback(async (taskId: string, filename: string, displayName: string) => {
    const key = `${taskId}/${filename}`;
    setDownloadingFiles(prev => ({ ...prev, [key]: true }));
    try {
      // Pass filename as query parameter to avoid all URL path encoding issues.
      const proxyUrl = `/api/ai/tasks/${taskId}/download?file=${encodeURIComponent(filename)}`;
      // callcenter backend uses JWT Bearer auth — must send the token manually.
      const token = localStorage.getItem('accessToken') ?? '';
      const resp = await fetch(proxyUrl, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = displayName;   // filename with correct extension
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      message.error('文件下载失败，请重试');
      console.error('[Download]', err);
    } finally {
      setDownloadingFiles(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  /**
   * Preview a text file (.md, .txt, .json) inline.
   */
  const handleFilePreview = useCallback(async (taskId: string, filename: string, displayName: string) => {
    try {
      const proxyUrl = `/api/ai/tasks/${taskId}/download?file=${encodeURIComponent(filename)}`;
      const token = localStorage.getItem('accessToken') ?? '';
      const resp = await fetch(proxyUrl, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      setPreviewContent(text);
      setPreviewTitle(displayName);
      setPreviewOpen(true);
    } catch (err) {
      message.error('文件预览失败');
      console.error('[Preview]', err);
    }
  }, []);

  // ── Fetch tasks ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (p = page, s = status, all = showAll) => {
    setLoading(true);
    try {
      const params: any = { page: p, limit: 20, status: s };
      if (isAdmin && all) params.all = '1';
      const res: any = await aiAPI.listTasks(params);
      console.debug('[AI] listTasks raw response:', res);
      const payload = res?.data;
      if (!payload) return;
      const list = Array.isArray(payload) ? payload
        : Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.items) ? payload.items
        : [];
      setTasks(list);
      setTotal(payload?.total ?? list.length);
      setSelectedRowKeys([]);
    } catch (err) {
      console.error('[AI] fetchTasks error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, status, showAll, isAdmin]);

  // ── Worker health check ──────────────────────────────────────────────────

  const checkWorkerHealth = useCallback(async () => {
    setWorkerStatus('checking');
    try {
      await aiAPI.health();
      setWorkerStatus('online');
    } catch {
      setWorkerStatus('offline');
    }
  }, []);

  // ── Templates ────────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    try {
      const res: any = await aiAPI.getTemplates();
      if (res?.data) setTemplates(res.data);
    } catch {}
  }, []);

  // ── Polling for running tasks ─────────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      const hasActive = tasks.some(t => t.status === 'pending' || t.status === 'running');
      if (hasActive) {
        fetchTasks();
      } else {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
      }
    }, 3000);
  }, [tasks, fetchTasks]);

  useEffect(() => {
    const hasActive = tasks.some(t => t.status === 'pending' || t.status === 'running');
    if (hasActive) {
      startPolling();
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [tasks, startPolling]);

  useEffect(() => {
    fetchTasks(1, undefined);
    fetchTemplates();
    checkWorkerHealth();
  }, [fetchTasks, fetchTemplates, checkWorkerHealth]);

  // ── Create task ──────────────────────────────────────────────────────────

  const handleCreate = async (values: any) => {
    setCreating(true);
    try {
      const payload: any = {
        type: values.type,
        params: {},
      };

      // Build payload with template params or raw prompt
      if (useRawPrompt) {
        payload.prompt = values.rawPrompt;
      } else {
        // Build params from template variables
        const template = templates.find(t => t.name === values.type);
        if (template?.variables) {
          for (const v of template.variables) {
            if (values[`param_${v.name}`] !== undefined) {
              payload.params[v.name] = values[`param_${v.name}`];
            }
          }
        }
      }

      // Include uploaded attachments
      if (uploadedAttachments.length > 0) {
        payload.attachments = uploadedAttachments;
      }

      // Include review mode
      if (values.reviewMode) {
        payload.reviewMode = values.reviewMode;
      }

      await aiAPI.createTask(payload);
      message.success('任务已提交，正在排队执行');
      setCreateOpen(false);
      form.resetFields();
      setSelectedTemplate(null);
      setUseRawPrompt(false);
      setUploadedAttachments([]);
      fetchTasks(1, status);
    } catch {
      // global interceptor handles
    } finally {
      setCreating(false);
    }
  };

  // ── Modify task ──────────────────────────────────────────────────────────

  const handleModifySubmit = async (values: any) => {
    setCreating(true);
    try {
      await aiAPI.createTask({
        type: 'modify_task',
        prompt: values.prompt,
        parentTaskId: modifyTarget.id,
        params: modifyTarget.params || {},
      });
      message.success('增量修改任务已提交，正在排队执行');
      setModifyOpen(false);
      setDetailOpen(false);
      modifyForm.resetFields();
      setModifyTarget(null);
      fetchTasks(1, status);
    } catch {
      // global interceptor handles
    } finally {
      setCreating(false);
    }
  };

  // ── Resume paused task ──────────────────────────────────────────────────

  const handleResumeSubmit = async (values: { input: string }) => {
    if (!selectedTask) return;
    try {
      await aiAPI.resumeTask(selectedTask.id, values.input);
      message.success('审阅意见已提交，任务继续执行');
      fetchTasks();
    } catch {
      // handled by global interceptor
    }
  };

  // ── Cancel task ──────────────────────────────────────────────────────────

  const handleCancel = async (taskId: string) => {
    try {
      await aiAPI.cancelTask(taskId);
      message.success('任务取消请求已发送');
      fetchTasks();
    } catch {}
  };

  // ── Delete task ──────────────────────────────────────────────────────────

  const handleDelete = async (taskId: string) => {
    try {
      await aiAPI.deleteTask(taskId);
      message.success('任务已删除，COS 文件已清理');
      if (detailOpen && selectedTask?.id === taskId) {
        setDetailOpen(false);
        setSelectedTask(null);
      }
      fetchTasks();
    } catch {
      message.error('删除失败，请重试');
    }
  };

  // ── Batch delete ────────────────────────────────────────────────────────

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDeleting(true);
    let successCount = 0;
    for (const id of selectedRowKeys) {
      try {
        await aiAPI.deleteTask(id as string);
        successCount++;
      } catch {
        // continue
      }
    }
    message.success(`成功删除 ${successCount} 个任务`);
    setSelectedRowKeys([]);
    setBatchDeleting(false);
    fetchTasks();
  };

  // ── View task detail + files ──────────────────────────────────────────────

  const fetchTaskFiles = useCallback(async (taskId: string) => {
    const requestSeq = ++taskFilesRequestSeqRef.current;
    setFilesLoading(true);
    try {
      const res: any = await aiAPI.getTaskFiles(taskId);
      console.debug('[AI] getTaskFiles raw response:', res);
      const files = Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.data?.data) ? res.data.data
        : [];
      if (requestSeq === taskFilesRequestSeqRef.current && selectedTaskIdRef.current === taskId) {
        setTaskFiles(files);
      }
    } catch {
      if (requestSeq === taskFilesRequestSeqRef.current && selectedTaskIdRef.current === taskId) {
        setTaskFiles([]);
      }
    } finally {
      if (requestSeq === taskFilesRequestSeqRef.current && selectedTaskIdRef.current === taskId) {
        setFilesLoading(false);
      }
    }
  }, []);

  const handleViewDetail = async (task: any) => {
    selectedTaskIdRef.current = task.id;
    taskFilesRequestSeqRef.current += 1;
    setSelectedTask(task);
    setDetailOpen(true);
    setTaskFiles([]);
    if (task.status === 'completed') {
      fetchTaskFiles(task.id);
    } else {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    selectedTaskIdRef.current = selectedTask?.id ?? null;
  }, [selectedTask?.id]);

  // Sync selectedTask with tasks array updates
  useEffect(() => {
    if (detailOpen && selectedTask) {
      const updated = tasks.find(t => t.id === selectedTask.id);
      if (updated && (
        updated.status !== selectedTask.status ||
        updated.progress !== selectedTask.progress ||
        updated.currentStep !== selectedTask.currentStep ||
        updated.lastAgentMessage !== selectedTask.lastAgentMessage
      )) {
        setSelectedTask(updated);
        // If task just transitioned to completed, fetch output files
        if (updated.status === 'completed' && selectedTask.status !== 'completed') {
          fetchTaskFiles(updated.id);
        }
        // If task transitioned to paused, also fetch files (phase1 artifacts)
        if (updated.status === 'paused' && selectedTask.status !== 'paused') {
          fetchTaskFiles(updated.id);
        }
      }
    }
  }, [tasks, detailOpen, selectedTask, fetchTaskFiles]);

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = [
    {
      title: '任务类型',
      dataIndex: 'type',
      key: 'type',
      width: 160,
      render: (t: string) => (
        <Space>
          <RobotOutlined style={{ color: '#818cf8' }} />
          <Text strong style={{ fontSize: 13 }}>{t}</Text>
        </Space>
      ),
    },
    // 管理员查看全部时显示发起人
    ...(showAll ? [{
      title: '发起人',
      dataIndex: 'creatorName',
      key: 'creatorName',
      width: 90,
      render: (name: string) => <Text style={{ fontSize: 12 }}>{name || '-'}</Text>,
    }] : []),
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: TaskStatus) => {
        const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.pending;
        return (
          <Tag icon={cfg.icon} color={cfg.color} style={{ borderRadius: 8 }}>
            {cfg.label}
          </Tag>
        );
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 130,
      render: (p: number, record: any) => {
        if (record.status === 'completed') return <Progress percent={100} size="small" status="success" />;
        if (record.status === 'failed') return <Progress percent={p || 0} size="small" status="exception" />;
        if (record.status === 'running') return <Progress percent={p || 10} size="small" status="active" />;
        return <Progress percent={0} size="small" />;
      },
    },
    {
      title: '任务简介',
      dataIndex: 'prompt',
      key: 'prompt',
      ellipsis: true,
      width: 200,
      render: (p: string) => p
        ? <Tooltip title={p}><Text type="secondary" style={{ fontSize: 12 }}>{p.length > 30 ? p.slice(0, 30) + '…' : p}</Text></Tooltip>
        : <Text type="secondary" style={{ fontSize: 12 }}>-</Text>,
    },
    {
      title: '产物大小',
      dataIndex: 'outputFiles',
      key: 'fileSize',
      width: 90,
      render: (files: any[] | null) => {
        if (!files || files.length === 0) return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>;
        const totalBytes = files.reduce((sum: number, f: any) => sum + (f.size || 0), 0);
        const display = totalBytes < 1024 ? `${totalBytes} B`
          : totalBytes < 1024 * 1024 ? `${(totalBytes / 1024).toFixed(0)} KB`
          : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
        return <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{display}</Text>;
      },
    },
    {
      title: '当前步骤',
      dataIndex: 'currentStep',
      key: 'currentStep',
      width: 120,
      ellipsis: true,
      render: (s: string) => s ? <Text type="secondary" style={{ fontSize: 12 }}>{s}</Text> : '-',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 140,
      render: (d: string) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>{dayjs(d).format('MM-DD HH:mm:ss')}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          {record.status === 'completed' ? (
            <Tooltip title="增量修改">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => { setModifyTarget(record); setModifyOpen(true); }}
              />
            </Tooltip>
          ) : (record.status === 'pending' || record.status === 'running') ? (
            <Tooltip title="取消任务">
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => handleCancel(record.id)}
              />
            </Tooltip>
          ) : (
            <Button size="small" icon={<EditOutlined />} disabled style={{ visibility: 'hidden' }} />
          )}
          {['completed', 'failed', 'cancelled'].includes(record.status) ? (
            <Popconfirm
              title="确认删除此任务？"
              description="将同时删除 COS 上的产物文件，此操作不可恢复。"
              onConfirm={() => handleDelete(record.id)}
              okText="确认删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ) : (
            <div style={{ width: 24 }} />
          )}
        </div>
      ),
    },
  ];

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = {
    total: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <RobotOutlined style={{
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }} />
            AI 协作
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>由 Codex Worker 驱动的智能任务引擎</Text>
        </div>
        <Space>
          <Badge
            status={workerStatus === 'online' ? 'success' : workerStatus === 'offline' ? 'error' : 'processing'}
            text={
              <Text style={{ fontSize: 12 }}>
                Worker: {workerStatus === 'online' ? '在线' : workerStatus === 'offline' ? '离线' : '检测中...'}
              </Text>
            }
          />
        </Space>
      </div>

      <Tabs
        defaultActiveKey="chat"
        items={[
          {
            key: 'chat',
            label: (
              <span>
                <RobotOutlined style={{ marginRight: 6 }} />
                AI 对话
              </span>
            ),
            children: (
              <Card 
                style={{ borderRadius: 12, height: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }} 
                styles={{ body: { padding: 0, flex: 1, display: 'flex', overflow: 'hidden' } }}
              >
                <AiChatPanel tasks={tasks} onViewTaskDetail={handleViewDetail} onTaskCreated={() => fetchTasks(1, status)} />
              </Card>
            ),
          },
          {
            key: 'tasks',
            label: (
              <span>
                <ThunderboltOutlined style={{ marginRight: 6 }} />
                任务中心
              </span>
            ),
            children: (
              <>

      {workerStatus === 'offline' && (
        <Alert
          type="error"
          showIcon
          message="Codex Worker 服务不可达"
          description="Tokyo 节点 AI 服务当前无法连接，请检查服务状态。"
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {[
          { title: '本页任务', value: stats.total, icon: <ThunderboltOutlined />, color: '#818cf8' },
          { title: '执行中', value: stats.running, icon: <LoadingOutlined />, color: '#f59e0b' },
          { title: '已完成', value: stats.completed, icon: <CheckCircleOutlined />, color: '#10b981' },
          { title: '失败', value: stats.failed, icon: <ExclamationCircleOutlined />, color: '#ef4444' },
        ].map(s => (
          <Col key={s.title} xs={12} sm={6}>
            <Card size="small" style={{ borderRadius: 12, textAlign: 'center' }}>
              <Statistic
                title={s.title}
                value={s.value}
                prefix={React.cloneElement(s.icon as any, { style: { color: s.color } })}
                valueStyle={{ color: s.color, fontWeight: 700 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon={<ReloadOutlined />} onClick={() => { fetchTasks(1, status, showAll); checkWorkerHealth(); }}>
          刷新
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setCreateOpen(true); fetchTemplates(); }}
          style={{ background: 'linear-gradient(135deg, #818cf8, #a78bfa)', border: 'none' }}
          disabled={workerStatus === 'offline'}
        >
          提交任务
        </Button>
        <Select
          placeholder="筛选状态"
          allowClear
          style={{ width: 140 }}
          value={status}
          onChange={s => { setStatus(s); fetchTasks(1, s, showAll); setPage(1); }}
          options={[
            { label: '排队中', value: 'pending' },
            { label: '执行中', value: 'running' },
            { label: '已完成', value: 'completed' },
            { label: '执行失败', value: 'failed' },
            { label: '已取消', value: 'cancelled' },
          ]}
        />
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Switch size="small" checked={showAll} onChange={v => { setShowAll(v); setPage(1); fetchTasks(1, status, v); }} />
            <Text style={{ fontSize: 12 }}>查看全部用户任务</Text>
          </div>
        )}
        {selectedRowKeys.length > 0 && (
          <Popconfirm
            title={`确认批量删除 ${selectedRowKeys.length} 个任务？`}
            description="将同时删除 COS 上的产物文件，此操作不可恢复。"
            onConfirm={handleBatchDelete}
            okText="确认删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} loading={batchDeleting}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
        )}
      </div>

      {/* Table */}
      <Card style={{ borderRadius: 12 }}>

        <Table
          dataSource={tasks}
          columns={columns}
          rowKey="id"
          loading={loading}
          rowSelection={{
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            getCheckboxProps: (record: any) => ({
              disabled: !['completed', 'failed', 'cancelled'].includes(record.status),
            }),
          }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: p => { setPage(p); fetchTasks(p, status, showAll); },
            showTotal: t => `共 ${t} 条记录`,
            showSizeChanger: false,
          }}
          locale={{ emptyText: <Empty description="暂无 AI 任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          size="middle"
          scroll={{ x: 1200 }}
        />
      </Card>
              </>
            ),
          },
        ]}
      />

      {/* ── Create Task Modal ──────────────────────────────────────────── */}
      <Modal
        title={<Space><RobotOutlined style={{ color: '#818cf8' }} />提交 AI 任务</Space>}
        open={createOpen}
        onCancel={() => { setCreateOpen(false); form.resetFields(); setSelectedTemplate(null); setUseRawPrompt(false); }}
        onOk={() => form.submit()}
        confirmLoading={creating}
        okText="提交任务"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item name="type" label="任务类型" rules={[{ required: true, message: '请选择任务类型' }]}>
            <Select
              placeholder="选择任务模板"
              onChange={name => {
                const t = templates.find(tp => tp.name === name);
                setSelectedTemplate(t || null);
                form.resetFields(Object.keys(form.getFieldsValue()).filter(k => k.startsWith('param_')));
              }}
              options={templates.map(t => ({
                label: (
                  <Space>
                    <span>{t.title || t.name}</span>
                    <Text type="secondary" style={{ fontSize: 11 }}>{t.description}</Text>
                  </Space>
                ),
                value: t.name,
              }))}
            />
          </Form.Item>

          {/* Render template variables dynamically */}
          {selectedTemplate?.variables?.map((v: any) => (
            <Form.Item
              key={v.name}
              name={`param_${v.name}`}
              label={v.label || v.name}
              rules={v.required ? [{ required: true, message: `请填写 ${v.label || v.name}` }] : []}
            >
              {v.type === 'select' ? (
                <Select
                  placeholder={v.placeholder}
                  options={(v.options || []).map((o: string) => ({ label: o, value: o }))}
                />
              ) : v.multiline ? (
                <TextArea rows={4} placeholder={v.placeholder || v.description} />
              ) : (
                <Input placeholder={v.placeholder || v.description} />
              )}
            </Form.Item>
          ))}

          {/* Raw prompt toggle */}
          <div style={{ borderTop: '1px dashed var(--border, #e5e7eb)', paddingTop: 12, marginTop: 4 }}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, marginBottom: 8 }}
              onClick={() => setUseRawPrompt(!useRawPrompt)}
            >
              {useRawPrompt ? '▲ 使用模板参数' : '▼ 或直接输入自定义 Prompt'}
            </Button>
            {useRawPrompt && (
              <Form.Item name="rawPrompt" label="自定义 Prompt" rules={[{ required: useRawPrompt, message: '请输入 Prompt' }]}>
                <TextArea rows={6} placeholder="直接描述你需要 AI 完成的任务..." />
              </Form.Item>
            )}
          </div>

          {/* Review Mode */}
          <div style={{ borderTop: '1px dashed var(--border, #e5e7eb)', paddingTop: 12, marginTop: 4 }}>
            <Form.Item name="reviewMode" label="执行模式" initialValue="auto">
              <Radio.Group>
                <Radio.Button value="auto">🚀 直通模式</Radio.Button>
                <Radio.Button value="review">🔍 审阅模式</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12 }}>
              直通模式：全程自动执行，适合不想等待确认的场景。审阅模式：先生成大纲和样图，确认后再执行。
            </Text>
          </div>

          {/* Attachments */}
          <div style={{ borderTop: '1px dashed var(--border, #e5e7eb)', paddingTop: 12, marginTop: 4 }}>
            <Form.Item label={`附件（${uploadedAttachments.length} 个已上传）`}>
              <Upload.Dragger
                multiple
                fileList={[]}
                showUploadList={false}
                beforeUpload={() => false}
                onChange={async (info) => {
                  const file = info.file as any;
                  if (file.status) return; // Skip antd-triggered events
                  setUploadingCount(c => c + 1);
                  try {
                    // Use existing filesAPI.upload which handles COS STS + fallback
                    const res: any = await filesAPI.upload(file);
                    const url = res?.data?.url || res?.url || '';
                    setUploadedAttachments(prev => [...prev, { name: file.name, url, size: file.size }]);
                    message.success(`附件 ${file.name} 上传成功`);
                  } catch (err: any) {
                    message.error(`上传失败: ${err.message || '未知错误'}`);
                  } finally {
                    setUploadingCount(c => c - 1);
                  }
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ color: '#818cf8' }} />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">支持上传参考资料、模板文件等，Codex 可直接读取</p>
              </Upload.Dragger>
              {uploadedAttachments.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {uploadedAttachments.map((att, i) => (
                    <Tag
                      key={i}
                      closable
                      onClose={() => setUploadedAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ marginBottom: 4 }}
                    >
                      📎 {att.name} ({(att.size / 1024).toFixed(1)} KB)
                    </Tag>
                  ))}
                </div>
              )}
              {uploadingCount > 0 && (
                <div style={{ marginTop: 4 }}>
                  <LoadingOutlined spin /> 正在上传 {uploadingCount} 个文件...
                </div>
              )}
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* ── Task Detail Modal ──────────────────────────────────────────── */}
      <Modal
        title={<Space><ThunderboltOutlined style={{ color: '#818cf8' }} />任务详情</Space>}
        open={detailOpen}
        onCancel={() => {
          selectedTaskIdRef.current = null;
          taskFilesRequestSeqRef.current += 1;
          setDetailOpen(false);
          setSelectedTask(null);
          setTaskFiles([]);
          setFilesLoading(false);
        }}
        footer={
          selectedTask?.status === 'completed' ? (
            <Button 
              type="primary" 
              icon={<EditOutlined />} 
              onClick={() => { setModifyTarget(selectedTask); setModifyOpen(true); }}
            >
              基于此任务进行增量修改
            </Button>
          ) : null
        }
        width={1000}
      >
        {selectedTask && (
          <Row gutter={16}>
            <Col span={15}>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="任务ID" span={2}>
                <Text code style={{ fontSize: 11 }}>{selectedTask.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="类型">{selectedTask.type}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {(() => {
                  const cfg = STATUS_CONFIG[selectedTask.status as TaskStatus] || STATUS_CONFIG.pending;
                  return <Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="进度" span={2}>
                <Progress percent={selectedTask.status === 'completed' ? 100 : (selectedTask.progress || 0)} />
              </Descriptions.Item>
              {selectedTask.currentStep && (
                <Descriptions.Item label="当前步骤" span={2}>{selectedTask.currentStep}</Descriptions.Item>
              )}
              {selectedTask.error && (
                <Descriptions.Item label="错误信息" span={2}>
                  <Text type="danger">{selectedTask.error}</Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="提交时间">{dayjs(selectedTask.createdAt).format('MM-DD HH:mm:ss')}</Descriptions.Item>
              {selectedTask.completedAt && (
                <Descriptions.Item label="完成时间">{dayjs(selectedTask.completedAt).format('MM-DD HH:mm:ss')}</Descriptions.Item>
              )}
              {selectedTask.tokenUsage && (
                <Descriptions.Item label="Token 用量" span={2}>
                  <Text type="secondary">
                    {typeof selectedTask.tokenUsage === 'object'
                      ? `输入 ${(selectedTask.tokenUsage.input || 0).toLocaleString()} / 输出 ${(selectedTask.tokenUsage.output || 0).toLocaleString()} (合计 ${(selectedTask.tokenUsage.total || 0).toLocaleString()})`
                      : `合计 ${Number(selectedTask.tokenUsage).toLocaleString()}`}
                  </Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {/* Prompt preview */}
            {selectedTask.prompt && (
              <Card size="small" title="Prompt" style={{ marginBottom: 16, borderRadius: 8 }}>
                <Paragraph
                  ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                  style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                >
                  {selectedTask.prompt}
                </Paragraph>
              </Card>
            )}

            {/* Paused state - User Input Form */}
            {selectedTask.status === 'paused' && (
              <Card 
                size="small" 
                style={{ marginBottom: 16, borderRadius: 8, border: '1px solid #f59e0b', background: '#fffbeb' }}
                title={<span style={{ color: '#d97706' }}><ExclamationCircleOutlined /> 任务已挂起，等待您的审核/回复</span>}
              >
                {/* Show agent's last message (outline / questions) */}
                {selectedTask.lastAgentMessage && (
                  <div style={{ 
                    marginBottom: 12, padding: 12, background: '#fff', borderRadius: 6, 
                    border: '1px solid #e5e7eb', maxHeight: 300, overflow: 'auto',
                    fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  }}>
                    {selectedTask.lastAgentMessage}
                  </div>
                )}
                <Form onFinish={handleResumeSubmit} layout="vertical">
                  <Form.Item 
                    name="input" 
                    rules={[{ required: true, message: '请输入您的意见或选择按默认继续' }]}
                    style={{ marginBottom: 12 }}
                  >
                    <TextArea 
                      rows={3} 
                      placeholder="请参考上方的大纲和样图回答系统的问题，例如选定风格、提供大纲修改意见等..." 
                    />
                  </Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit">发送回复</Button>
                    <Button 
                      onClick={() => handleResumeSubmit({ input: '按默认继续' })}
                    >
                      按默认继续
                    </Button>
                  </Space>
                </Form>
              </Card>
            )}

            {/* Real-time log panel — shown for running/pending tasks and completed tasks with detail */}
            <TaskLogPanel key={selectedTask.id} taskId={selectedTask.id} taskStatus={selectedTask.status} />
            </Col>

            {/* Output files - Right Column */}
            {(selectedTask.status === 'completed' || selectedTask.status === 'running' || selectedTask.status === 'pending') && (
              <Col span={9}>
                {selectedTask.status === 'completed' ? (
                <Card size="small" title={`产物文件 (${taskFiles.length})`} style={{ borderRadius: 8, height: '100%' }} styles={{ body: { padding: '12px' } }}>
                <div style={{ maxHeight: 'calc(80vh - 120px)', overflowY: 'auto', paddingRight: 4 }}>
                    {filesLoading ? (
                      <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
                    ) : taskFiles.length === 0 ? (
                      <Empty description="暂无产物文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      (() => {
                        const coreFiles: any[] = [];
                        const processFiles: any[] = [];
                        let hiddenCount = 0;

                        // Junk extensions to hide completely
                        const junkExts = new Set(['.py', '.pyc', '.js', '.cjs', '.mjs', '.ts', '.so', '.h', '.c', '.cpp', '.lock', '.sh', '.bat', '.yml', '.yaml', '.toml', '.cfg']);

                        taskFiles.forEach((f: any) => {
                          const fullName = f.name || f.key || '';
                          const ext = fullName.includes('.') ? fullName.substring(fullName.lastIndexOf('.')).toLowerCase() : '';
                          
                          // Hide junk files completely
                          if (
                            fullName.includes('node_modules/') || 
                            fullName.includes('venv/') || 
                            fullName.includes('__pycache__/') ||
                            junkExts.has(ext) ||
                            fullName.endsWith('package.json') ||
                            fullName.endsWith('LICENSE') ||
                            fullName.endsWith('LICENSE.md') ||
                            fullName.endsWith('README.md')
                          ) {
                            hiddenCount++;
                            return;
                          }

                          // Use backend category if available (new tasks)
                          if (f.category === 'core') {
                            coreFiles.push(f);
                          } else if (f.category === 'process') {
                            processFiles.push(f);
                          } else {
                            // Fallback for historical tasks without category:
                            // response.md, manifest.json, and live/ directory files are process materials
                            if (fullName.endsWith('response.md') || fullName.endsWith('manifest.json') || fullName.includes('live/')) {
                              processFiles.push(f);
                            } else {
                              coreFiles.push(f);
                            }
                          }
                        });

                        const renderFileItem = (f: any, i: number, isCore: boolean) => {
                          const fullName = f.name || f.key || `文件 ${i + 1}`;
                          const displayName = fullName.includes('/') ? fullName.split('/').pop()! : fullName;
                          const fileKey = `${selectedTask.id}/${fullName}`;
                          const isDownloading = !!downloadingFiles[fileKey];
                          const ext = displayName.split('.').pop()?.toLowerCase() ?? '';
                          const isPreviewable = ['md', 'txt', 'json', 'csv'].includes(ext);
                          const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
                          return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderBottom: '1px dashed var(--border, #e5e7eb)' }}>
                              <Text style={{ fontSize: 13, wordBreak: 'break-all', paddingRight: 8 }} ellipsis={{ tooltip: displayName }}>
                                {isCore ? '📦 ' : '📃 '}{displayName}
                              </Text>
                              <Space size={4} style={{ flexShrink: 0 }}>
                                {isPreviewable && (
                                  <Button
                                    size="small"
                                    type="link"
                                    icon={<EyeOutlined />}
                                    onClick={() => handleFilePreview(selectedTask.id, fullName, displayName)}
                                    style={{ padding: '0 4px' }}
                                  >
                                    预览
                                  </Button>
                                )}
                                {isImage && f.url && (
                                  <Image
                                    src={f.url}
                                    width={24}
                                    height={24}
                                    style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
                                    preview={{ mask: <EyeOutlined /> }}
                                  />
                                )}
                                <Button
                                  size="small"
                                  type="link"
                                  icon={isDownloading ? <LoadingOutlined spin /> : <DownloadOutlined />}
                                  loading={isDownloading}
                                  onClick={() => handleFileDownload(selectedTask.id, fullName, displayName)}
                                  style={{ padding: '0 4px' }}
                                >
                                  {isDownloading ? '下载中' : '下载'}
                                </Button>
                              </Space>
                            </div>
                          );
                        };

                        if (coreFiles.length === 0 && processFiles.length === 0) {
                          return <Empty description={`所有产物已被过滤（隐藏了 ${hiddenCount} 个无关文件）`} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* Core outputs - highlighted */}
                            {coreFiles.length > 0 && (
                              <Card
                                size="small"
                                title={<Text strong style={{ fontSize: 13 }}>🎯 核心产物 ({coreFiles.length})</Text>}
                                style={{ borderRadius: 8, border: '1px solid #818cf8', background: 'rgba(129, 140, 248, 0.04)' }}
                                styles={{ body: { padding: '4px 0' } }}
                              >
                                {coreFiles.map((f, i) => renderFileItem(f, i, true))}
                              </Card>
                            )}
                            {/* Process materials - secondary */}
                            {processFiles.length > 0 && (
                              <Card
                                size="small"
                                title={<Text type="secondary" strong style={{ fontSize: 12 }}>过程材料 ({processFiles.length})</Text>}
                                style={{ borderRadius: 8 }}
                                styles={{ body: { padding: '4px 0' } }}
                              >
                                {processFiles.map((f, i) => renderFileItem(f, i + coreFiles.length, false))}
                              </Card>
                            )}
                            {hiddenCount > 0 && (
                              <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', display: 'block' }}>
                                已隐藏 {hiddenCount} 个构建/依赖文件
                              </Text>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </Card>
                ) : (
                  /* Running/Pending — show real-time status */
                  <Card size="small" title="📡 实时产物" style={{ borderRadius: 8, height: '100%' }} styles={{ body: { padding: '16px 12px' } }}>
                    <div style={{ textAlign: 'center', color: '#9ca3af' }}>
                      <LoadingOutlined spin style={{ fontSize: 24, color: '#818cf8', marginBottom: 12 }} />
                      <div style={{ fontSize: 13, marginBottom: 4 }}>任务执行中...</div>
                      <div style={{ fontSize: 11 }}>文件生成后将在「进度概览」中实时展示</div>
                    </div>
                  </Card>
                )}
              </Col>
            )}
          </Row>
        )}
      </Modal>

      {/* ── Modify Task Modal ──────────────────────────────────────────── */}
      <Modal
        title={<Space><EditOutlined style={{ color: '#8b5cf6' }} />基于当前任务修改</Space>}
        open={modifyOpen}
        onCancel={() => { setModifyOpen(false); modifyForm.resetFields(); setModifyTarget(null); }}
        onOk={() => modifyForm.submit()}
        confirmLoading={creating}
        okText="提交修改"
        cancelText="取消"
        width={500}
        destroyOnClose
      >
        {modifyTarget && (
          <div style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>原任务 ID: {modifyTarget.id}</Text><br/>
            <Text type="secondary" style={{ fontSize: 12 }}>类型: {modifyTarget.type}</Text>
          </div>
        )}
        <Form form={modifyForm} layout="vertical" onFinish={handleModifySubmit}>
          <Form.Item 
            name="prompt" 
            label="增量修改需求" 
            rules={[{ required: true, message: '请输入您需要修改的内容' }]}
            extra="例如：将背景颜色改为蓝色、将第二页的标题修改为'架构总结'等"
          >
            <TextArea rows={4} placeholder="描述你想如何修改原有的生成产物..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Text File Preview Modal ───────────────────────────────────── */}
      <Modal
        title={<Space><EyeOutlined style={{ color: '#818cf8' }} />{previewTitle}</Space>}
        open={previewOpen}
        onCancel={() => { setPreviewOpen(false); setPreviewContent(''); }}
        footer={null}
        width={800}
      >
        <div style={{
          maxHeight: 600,
          overflow: 'auto',
          padding: 16,
          background: '#f8fafc',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {previewContent}
        </div>
      </Modal>
    </div>
  );
};

export default AiPage;
