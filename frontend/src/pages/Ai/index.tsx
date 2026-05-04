import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Button, Table, Tag, Space, Modal, Form, Select, Input, message,
  Typography, Tooltip, Badge, Descriptions, Spin, Empty, Alert,
  Row, Col, Statistic, Progress,
} from 'antd';
import {
  RobotOutlined, PlusOutlined, ReloadOutlined, EyeOutlined,
  StopOutlined, DownloadOutlined, ThunderboltOutlined,
  ClockCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { aiAPI } from '../../services/api';
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

  // ── Fetch tasks ──────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async (p = page, s = status) => {
    setLoading(true);
    try {
      const res: any = await aiAPI.listTasks({ page: p, limit: 15, status: s });
      if (res?.data) {
        // Worker returns: { success, data: Task[], total, page, limit }
        // Axios wraps it so the actual payload is in res.data
        const payload = res.data;
        setTasks(Array.isArray(payload.data) ? payload.data : (payload.items || []));
        setTotal(payload.total || 0);
      }
    } catch {
      // global interceptor handles error display
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

      await aiAPI.createTask(payload);
      message.success('任务已提交，正在排队执行');
      setCreateOpen(false);
      form.resetFields();
      setSelectedTemplate(null);
      setUseRawPrompt(false);
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
        setTaskFiles(res?.data || []);
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
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <RobotOutlined style={{
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }} />
            AI 协作
          </Title>
          <Text type="secondary">由 Codex Worker 驱动的智能任务引擎</Text>
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
        </Space>
      </div>

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
      <Row gutter={16} style={{ marginBottom: 24 }}>
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

      {/* Filters + Table */}
      <Card style={{ borderRadius: 12 }}>
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
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
        </Form>
      </Modal>

      {/* ── Task Detail Modal ──────────────────────────────────────────── */}
      <Modal
        title={<Space><ThunderboltOutlined style={{ color: '#818cf8' }} />任务详情</Space>}
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setSelectedTask(null); setTaskFiles([]); }}
        footer={null}
        width={640}
      >
        {selectedTask && (
          <>
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

            {/* Output files */}
            {selectedTask.status === 'completed' && (
              <Card size="small" title="产物文件" style={{ borderRadius: 8 }}>
                {filesLoading ? (
                  <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
                ) : taskFiles.length === 0 ? (
                  <Empty description="暂无产物文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {taskFiles.map((f: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--border, #e5e7eb)' }}>
                        <Text style={{ fontSize: 13 }}>{f.name || f.key || `文件 ${i + 1}`}</Text>
                        <Button
                          size="small"
                          type="link"
                          icon={<DownloadOutlined />}
                          href={f.url}
                          target="_blank"
                        >
                          下载
                        </Button>
                      </div>
                    ))}
                  </Space>
                )}
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default AiPage;
