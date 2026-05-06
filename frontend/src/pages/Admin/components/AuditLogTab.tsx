import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Tag, Space, Select, Input, DatePicker, Button, Switch, Card,
  message, Popconfirm, Row, Col, Empty,
} from 'antd';
import {
  DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { auditAPI } from '../../../services/api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const typeOptions = [
  { value: '', label: '全部类型' },
  { value: 'ticket_status', label: '工单状态变更' },
  { value: 'user_login', label: '用户登录' },
  { value: 'external_login', label: '外部用户登录' },
  { value: 'ai_task', label: 'AI 任务' },
];

const typeTagMap: Record<string, { color: string; text: string }> = {
  ticket_status: { color: 'blue', text: '工单状态' },
  user_login: { color: 'green', text: '用户登录' },
  external_login: { color: 'orange', text: '外部登录' },
  ai_task: { color: 'purple', text: 'AI 任务' },
};

const actionTextMap: Record<string, string> = {
  created: '创建工单',
  assigned: '接单',
  requestClose: '申请关单',
  closed: '确认关闭',
  deleted: '删除工单',
  batchDeleted: '批量删除',
  login: '登录成功',
  login_failed: '登录失败',
  external_login: '外部接入',
  create_task: '提交AI任务',
  modify_task: '修改AI任务',
  cancel_task: '取消AI任务',
  delete_task: '删除AI任务',
};

export const AuditLogTab: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [settings, setSettings] = useState<Record<string, boolean>>({
    ticket_status: true,
    user_login: true,
    external_login: true,
    ai_task: true,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (typeFilter) params.type = typeFilter;
      if (keyword) params.keyword = keyword;
      if (dateRange) {
        params.startDate = dateRange[0];
        params.endDate = dateRange[1];
      }
      const res: any = await auditAPI.getLogs(params);
      if (res.code === 0) {
        setLogs(res.data.items || []);
        setTotal(res.data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, typeFilter, keyword, dateRange]);

  const loadSettings = useCallback(async () => {
    try {
      const res: any = await auditAPI.getSettings();
      if (res.code === 0) {
        setSettings(res.data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleSettingChange = async (key: string, checked: boolean) => {
    setSettingsLoading(true);
    try {
      const res: any = await auditAPI.updateSettings({ [key]: checked });
      if (res.code === 0) {
        setSettings(res.data);
        message.success(`${checked ? '已开启' : '已关闭'} ${typeTagMap[key]?.text || key} 审计`);
      }
    } catch {
      message.error('更新失败');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    setDeleting(true);
    try {
      const params: any = {};
      if (typeFilter) params.type = typeFilter;
      if (dateRange) {
        params.startDate = dateRange[0];
        params.endDate = dateRange[1];
      }
      const res: any = await auditAPI.deleteLogs(params);
      if (res.code === 0) {
        message.success(`成功删除 ${res.data.deleted} 条审计记录`);
        setPage(1);
        loadLogs();
      }
    } catch {
      message.error('删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (v: string) => {
        const t = typeTagMap[v];
        return t ? <Tag color={t.color}>{t.text}</Tag> : <Tag>{v}</Tag>;
      },
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => {
        const text = actionTextMap[v] || v;
        const color = v === 'login_failed' ? '#ef4444' : v === 'deleted' || v === 'batchDeleted' ? '#f97316' : 'var(--text-primary)';
        return <span style={{ fontWeight: 500, color }}>{text}</span>;
      },
    },
    {
      title: '操作人',
      dataIndex: 'username',
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '目标',
      dataIndex: 'targetName',
      width: 140,
      render: (v: string) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> : '-',
    },
    {
      title: '详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: (v: string) => <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{v || '-'}</span>,
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 130,
      render: (v: string) => v ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> : '-',
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* 审计开关区域 */}
      <Card
        size="small"
        title={<span style={{ fontWeight: 600 }}>🔐 审计开关</span>}
        style={{ marginBottom: 20, borderRadius: 10, border: '1px solid var(--border)' }}
      >
        <Row gutter={[24, 12]}>
           {[
            { key: 'ticket_status', label: '工单状态变更审计', desc: '记录工单创建、接单、关单、删除等操作' },
            { key: 'user_login', label: '用户登录审计', desc: '记录内部用户登录成功与失败' },
            { key: 'external_login', label: '外部用户登录审计', desc: '记录外部用户通过共享链接接入' },
            { key: 'ai_task', label: 'AI 任务审计', desc: '记录AI任务提交、修改、取消、删除操作' },
          ].map(item => (
            <Col xs={24} sm={8} key={item.key}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: settings[item.key] ? 'rgba(79, 70, 229, 0.08)' : 'var(--bg-hover)',
                border: `1px solid ${settings[item.key] ? 'rgba(79, 70, 229, 0.3)' : 'var(--border)'}`,
                transition: 'all 0.3s',
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.desc}</div>
                </div>
                <Switch
                  checked={settings[item.key]}
                  onChange={(checked) => handleSettingChange(item.key, checked)}
                  loading={settingsLoading}
                  size="small"
                />
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 筛选区域 */}
      <Card
        size="small"
        style={{ marginBottom: 16, borderRadius: 10, border: '1px solid var(--border)' }}
        bodyStyle={{ padding: '12px 16px' }}
      >
        <Space wrap size={[12, 8]}>
          <Select
            value={typeFilter}
            onChange={v => { setTypeFilter(v); setPage(1); }}
            options={typeOptions}
            style={{ width: 150 }}
            placeholder="类型"
          />
          <Input.Search
            placeholder="搜索操作人、目标、详情"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onSearch={() => { setPage(1); loadLogs(); }}
            allowClear
            style={{ width: 240 }}
          />
          <RangePicker
            value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
            onChange={(dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]);
              } else {
                setDateRange(null);
              }
              setPage(1);
            }}
            style={{ width: 260 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); loadLogs(); }}>
            刷新
          </Button>
          <Popconfirm
            title="批量删除审计日志"
            description={`确定要删除${typeFilter ? ` [${typeTagMap[typeFilter]?.text}] 类型` : '所有'}${dateRange ? ` ${dateRange[0]} ~ ${dateRange[1]} 时间范围内` : ''}的审计日志吗？此操作不可撤销。`}
            onConfirm={handleBatchDelete}
            okText="确定删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleting}>
              批量删除
            </Button>
          </Popconfirm>
        </Space>
      </Card>

      {/* 日志表格 */}
      <Table
        dataSource={logs}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
        locale={{ emptyText: <Empty description="暂无审计日志" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        scroll={{ x: 900 }}
        style={{ borderRadius: 10, overflow: 'hidden' }}
      />
    </div>
  );
};
