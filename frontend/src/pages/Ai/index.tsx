import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Table, Tag, Space, Modal, Form, Select, Input, message,
  Typography, Tooltip, Badge, Descriptions, Spin, Empty, Alert,
  Row, Col, Statistic, Progress, Tabs, Upload,
} from 'antd';
import {
  RobotOutlined, PlusOutlined, ReloadOutlined, EyeOutlined,
  StopOutlined, DownloadOutlined, ThunderboltOutlined,
  ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  LoadingOutlined, InboxOutlined,
} from '@ant-design/icons';
import { aiAPI, filesAPI } from '../../services/api';
import TaskLogPanel from './components/TaskLogPanel';
import AiChatPanel from './components/AiChatPanel';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: '排队中', color: 'blue',    icon: <ClockCircleOutlined /> },
  running:   { label: '执行中', color: 'orange',  icon: <LoadingOutlined spin /> },
  completed: { label: '已完成', color: 'green',   icon: <CheckCircleOutlined /> },
  failed:    { label: '执行失败', color: 'red',   icon: <ExclamationCircleOutlined /> },
  cancelled: { label: '已取消', color: 'default', icon: <StopOutlined /> },
};

const AiPage: React.FC = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
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
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, boolean>>({});
  const [uploadedAttachments, setUploadedAttachments] = useState<Array<{ name: string; url: string; size: number }>>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

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

  // ── Fetch tasks ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (p = page, s = status) => {
    setLoading(true);
    try {
      const res: any = await aiAPI.listTasks({ page: p, limit: 15, status: s });
      // Trace the full response shape to console for debugging
      console.debug('[AI] listTasks raw response:', res);
      // Axios response: res.data = what the backend returned
      // Backend returns the Worker response directly: { success, data: Task[], total }
      const payload = res?.data;
      if (!payload) return;
      // Handle both shapes: { data: [...] } and { items: [...] } and plain array
      const list = Array.isArray(payload) ? payload
        : Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.items) ? payload.items
        : [];
      setTasks(list);
      setTotal(payload?.total ?? list.length);
    } catch (err) {
      console.error('[AI] fetchTasks error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

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
      const hasRunning = tasks.some(t => t.status === 'pending' || t.status === 'running');
      if (hasRunning) {
        fetchTasks();
      } else {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
      }
    }, 3000);
  }, [tasks, fetchTasks]);

  useEffect(() => {
    const hasRunning = tasks.some(t => t.status === 'pending' || t.status === 'running');
    if (hasRunning) {
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

  // ── Cancel task ──────────────────────────────────────────────────────────

  const handleCancel = async (taskId: string) => {
    try {
      await aiAPI.cancelTask(taskId);
      message.success('任务取消请求已发送');
      fetchTasks();
    } catch {}
  };

  // ── View task detail + files ──────────────────────────────────────────────

  const handleViewDetail = async (task: any) => {
    setSelectedTask(task);
    setDetailOpen(true);
    if (task.status === 'completed') {
      setFilesLoading(true);
      try {
        const res: any = await aiAPI.getTaskFiles(task.id);
        console.debug('[AI] getTaskFiles raw response:', res);
        // Worker returns { success, data: [{name, url, size}] }
        const files = Array.isArray(res?.data) ? res.data
          : Array.isArray(res?.data?.data) ? res.data.data
          : [];
        setTaskFiles(files);
      } catch {
        setTaskFiles([]);
      } finally {
        setFilesLoading(false);
      }
    } else {
      setTaskFiles([]);
    }
  };

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
      title: '当前步骤',
      dataIndex: 'currentStep',
      key: 'currentStep',
      ellipsis: true,
      render: (s: string) => s ? <Text type="secondary" style={{ fontSize: 12 }}>{s}</Text> : '-',
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (d: string) => (
        <Tooltip title={dayjs(d).format('YYYY-MM-DD HH:mm:ss')}>
          <Text style={{ fontSize: 12 }}>{dayjs(d).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          {(record.status === 'pending' || record.status === 'running') && (
            <Tooltip title="取消任务">
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => handleCancel(record.id)}
              />
            </Tooltip>
          )}
        </Space>
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

      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button icon={<ReloadOutlined />} onClick={() => { fetchTasks(1, status); checkWorkerHealth(); }}>
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
          onChange={s => { setStatus(s); fetchTasks(1, s); setPage(1); }}
          options={[
            { label: '排队中', value: 'pending' },
            { label: '执行中', value: 'running' },
            { label: '已完成', value: 'completed' },
            { label: '执行失败', value: 'failed' },
            { label: '已取消', value: 'cancelled' },
          ]}
        />
      </div>

      {/* Table */}
      <Card style={{ borderRadius: 12 }}>

        <Table
          dataSource={tasks}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: 15,
            total,
            onChange: p => { setPage(p); fetchTasks(p, status); },
            showTotal: t => `共 ${t} 条记录`,
          }}
          locale={{ emptyText: <Empty description="暂无 AI 任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          size="middle"
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
        onCancel={() => { setDetailOpen(false); setSelectedTask(null); setTaskFiles([]); }}
        footer={null}
        width={1000}
      >
        {selectedTask && (
          <Row gutter={16}>
            <Col span={selectedTask.status === 'completed' ? 15 : 24}>
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
                    输入 {selectedTask.tokenUsage.input || 0} / 输出 {selectedTask.tokenUsage.output || 0}
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

            {/* Real-time log panel — shown for running/pending tasks and completed tasks with detail */}
            <TaskLogPanel taskId={selectedTask.id} taskStatus={selectedTask.status} />
            </Col>

            {/* Output files - Right Column */}
            {selectedTask.status === 'completed' && (
              <Col span={9}>
                <Card size="small" title={`产物文件 (${taskFiles.length})`} style={{ borderRadius: 8, height: '100%' }} styles={{ body: { padding: '12px' } }}>
                  <div style={{ maxHeight: 'calc(80vh - 120px)', overflowY: 'auto', paddingRight: 4 }}>
                    {filesLoading ? (
                      <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
                    ) : taskFiles.length === 0 ? (
                      <Empty description="暂无产物文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      (() => {
                        const coreExts = ['.pptx', '.ppt', '.docx', '.doc', '.xlsx', '.xls', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
                        const coreFiles: any[] = [];
                        const otherFiles: any[] = [];
                        let hiddenCount = 0;

                        taskFiles.forEach((f: any) => {
                          const fullName = f.name || f.key || '';
                          const ext = fullName.includes('.') ? fullName.substring(fullName.lastIndexOf('.')).toLowerCase() : '';
                          
                          // Hide historical junk that shouldn't be shown
                          if (
                            fullName.includes('node_modules/') || 
                            fullName.includes('venv/') || 
                            fullName.includes('__pycache__/') ||
                            ['.py', '.pyc', '.js', '.cjs', '.mjs', '.ts', '.so', '.h', '.c', '.cpp', '.json', '.lock'].includes(ext) ||
                            fullName.endsWith('package.json') ||
                            fullName.endsWith('LICENSE.md') ||
                            fullName.endsWith('README.md')
                          ) {
                            hiddenCount++;
                            return;
                          }

                          if (coreExts.includes(ext) || fullName.endsWith('response.md')) {
                            coreFiles.push(f);
                          } else {
                            otherFiles.push(f);
                          }
                        });

                        // Sort core files to put response.md first
                        coreFiles.sort((a, b) => {
                          const aName = a.name || a.key || '';
                          const bName = b.name || b.key || '';
                          if (aName.endsWith('response.md')) return -1;
                          if (bName.endsWith('response.md')) return 1;
                          return aName.localeCompare(bName);
                        });

                        const renderFileItem = (f: any, i: number) => {
                          const fullName = f.name || f.key || `文件 ${i + 1}`;
                          const displayName = fullName.includes('/') ? fullName.split('/').pop()! : fullName;
                          const fileKey = `${selectedTask.id}/${fullName}`;
                          const isDownloading = !!downloadingFiles[fileKey];
                          return (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--border, #e5e7eb)' }}>
                              <Text style={{ fontSize: 13, wordBreak: 'break-all', paddingRight: 8 }} ellipsis={{ tooltip: displayName }}>
                                {fullName.endsWith('response.md') ? '💡 ' : (coreExts.includes(fullName.substring(fullName.lastIndexOf('.')).toLowerCase()) ? '📄 ' : '📃 ')}
                                {displayName}
                              </Text>
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
                            </div>
                          );
                        };

                        if (coreFiles.length === 0 && otherFiles.length === 0) {
                          return <Empty description={`所有产物已被过滤（隐藏了 ${hiddenCount} 个无关文件）`} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {coreFiles.length > 0 && (
                              <div>
                                <Text type="secondary" strong style={{ fontSize: 12, borderBottom: '1px solid #f0f0f0', display: 'block', paddingBottom: 4, marginBottom: 8 }}>
                                  核心产物
                                </Text>
                                <Space direction="vertical" style={{ width: '100%' }} size={0}>
                                  {coreFiles.map((f, i) => renderFileItem(f, i))}
                                </Space>
                              </div>
                            )}
                            {otherFiles.length > 0 && (
                              <div>
                                <Text type="secondary" strong style={{ fontSize: 12, borderBottom: '1px solid #f0f0f0', display: 'block', paddingBottom: 4, marginBottom: 8 }}>
                                  过程材料
                                </Text>
                                <Space direction="vertical" style={{ width: '100%' }} size={0}>
                                  {otherFiles.map((f, i) => renderFileItem(f, i + coreFiles.length))}
                                </Space>
                              </div>
                            )}
                            {hiddenCount > 0 && (
                              <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', display: 'block', marginTop: 8 }}>
                                已隐藏 {hiddenCount} 个构建/依赖文件
                              </Text>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </Card>
              </Col>
            )}
          </Row>
        )}
      </Modal>
    </div>
  );
};

export default AiPage;
