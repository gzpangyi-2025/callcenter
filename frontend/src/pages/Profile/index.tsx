import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Tag, Button, Empty, Segmented, message, Row, Col, Modal, Form, Input, Select, Badge, Cascader } from 'antd';
import {
  CheckOutlined, PlusOutlined, FileTextOutlined, CustomerServiceOutlined, TeamOutlined, LoginOutlined,
  MessageOutlined, RobotOutlined
} from '@ant-design/icons';
import { ticketsAPI, usersAPI, categoryAPI } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { useNavigate } from 'react-router-dom';
import type { CategoryNode } from '../../types/api';
import type { CreateTicketDto, Ticket } from '../../types/ticket';
import type { User } from '../../types/user';

const { Option } = Select;

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待接单' },
  in_progress: { color: 'blue', text: '服务中' },
  closing: { color: 'volcano', text: '待确认' },
  closed: { color: 'green', text: '已关闭' },
};

const typeMap: Record<string, string> = {
  software: '软件问题', hardware: '硬件问题', network: '网络问题',
  security: '安全问题', database: '数据库', other: '其他',
};

type ProfileTab = 'created' | 'assigned' | 'participated';
type AssigneeOption = { value: number; label: string };
type CreateTicketFormValues = CreateTicketDto & { categoryPath?: string[] };
type TabBadge = { total: number; newCount: number; unreadCount: number };

const categorySearchFilter = (input: string, path: CategoryNode[]) =>
  path.some((opt) => opt.label.toLowerCase().includes(input.toLowerCase()));

const ProfilePage: React.FC = () => {
  const [tab, setTab] = useState<ProfileTab>('created');
  const [createdTickets, setCreatedTickets] = useState<Ticket[]>([]);
  const [assignedTickets, setAssignedTickets] = useState<Ticket[]>([]);
  const [participatedTickets, setParticipatedTickets] = useState<Ticket[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
  const [assigneeSearching, setAssigneeSearching] = useState(false);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { socket, unreadMap, newTicketIds, clearNewTicket, clearUnread, setMyTicketIds } = useSocketStore();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [createdRes, assignedRes, participatedRes] = await Promise.all([
        ticketsAPI.myCreated(),
        ticketsAPI.myAssigned(),
        ticketsAPI.myParticipated(),
      ]);
      const created = createdRes.code === 0 ? createdRes.data : [];
      const assigned = assignedRes.code === 0 ? assignedRes.data : [];
      const participated = participatedRes.code === 0 ? participatedRes.data : [];

      setCreatedTickets(created);
      setAssignedTickets(assigned);
      setParticipatedTickets(participated);

      // 将所有相关工单 ID 同步到 socketStore，供全局 badge 计算使用
      const allIds = [...created, ...assigned, ...participated].map((t) => t.id);
      setMyTicketIds(allIds);
    } catch {}
  }, [setMyTicketIds]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => loadData();
    socket.on('ticketEvent', handler);
    return () => { socket.off('ticketEvent', handler); };
  }, [socket, loadData]);

  // 加载工单分类树
  useEffect(() => {
    categoryAPI.getTree().then((res) => {
      if (res.code === 0 && res.data?.length > 0) setCategoryTree(res.data);
    }).catch(() => {});
  }, []);

  // NEW 标记在用户点击卡片进入工单时清除（renderTicketCard 的 onClick 中已处理）
  // 不再在切换 tab 时自动清除，让用户能看到哪些卡片是新到达的

  const handleAssign = async (id: number) => {
    try {
      const res = await ticketsAPI.assign(id);
      if (res.code === 0) { message.success('接单成功'); loadData(); }
} catch { /* handled globally */ } // Removed by global interceptor refactor
  };

  const handleCreate = async (values: CreateTicketFormValues) => {
    try {
      const { categoryPath, ...submitData } = values;
      if (categoryPath && categoryPath.length > 0) {
        submitData.category1 = categoryPath[0] || '';
        submitData.category2 = categoryPath[1] || '';
        submitData.category3 = categoryPath[2] || '';
        submitData.type = 'other';
      }
      const res = await ticketsAPI.create(submitData);
      if (res.code === 0) { message.success('工单创建成功'); setCreateModalOpen(false); createForm.resetFields(); loadData(); }
} catch { /* handled globally */ } // Removed by global interceptor refactor
  };

  const handleAssigneeSearch = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value) { setAssigneeOptions([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setAssigneeSearching(true);
      try {
        const res = await usersAPI.search(value);
        if (res.code === 0) {
          setAssigneeOptions(res.data.map((u: User) => ({
            value: u.id,
            label: `${u.realName || u.displayName || u.username} (${u.username})`,
          })));
        }
      } catch {} finally { setAssigneeSearching(false); }
    }, 300);
  };

  // 计算每个 tab 中未读消息总数和新工单数量
  const getTabBadge = (tickets: Ticket[]): TabBadge => {
    const unreadCount = tickets.reduce((sum, t) => sum + (unreadMap[t.id] || 0), 0);
    const newCount = tickets.filter((t) => newTicketIds.includes(t.id)).length;
    return { unreadCount, newCount, total: unreadCount + newCount };
  };

  const createdBadge = getTabBadge(createdTickets);
  const assignedBadge = getTabBadge(assignedTickets);
  const participatedBadge = getTabBadge(participatedTickets);

  const tickets = tab === 'created' ? createdTickets : tab === 'assigned' ? assignedTickets : participatedTickets;

  // 渲染 Segmented 标签（内嵌角标）
  const makeTabLabel = (
    icon: React.ReactNode,
    label: string,
    count: number,
    badge: TabBadge
  ) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {icon}
      {label} ({count})
      {badge.total > 0 && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: badge.newCount > 0 ? '#ff4d4f' : '#1677ff',
          color: '#fff',
          borderRadius: 10,
          padding: '0 7px',
          fontSize: 11,
          fontWeight: 700,
          lineHeight: '18px',
          minWidth: 18,
          justifyContent: 'center',
          animation: 'pulse 1.5s infinite',
        }}>
          {badge.total}
        </span>
      )}
    </span>
  );

  const renderTicketCard = (ticket: Ticket) => {
    const unread = unreadMap[ticket.id] || 0;
    const isNew = newTicketIds.includes(ticket.id);

    return (
      <Col xs={24} sm={12} lg={8} key={ticket.id}>
        <div style={{ position: 'relative' }}>
          {/* 新工单角标 */}
          {isNew && (
            <span style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: '#ff4d4f',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: '10px 10px 10px 2px',
              padding: '2px 8px',
              zIndex: 2,
              boxShadow: '0 2px 8px rgba(255,77,79,0.5)',
              animation: 'pulse 1.5s infinite',
            }}>NEW</span>
          )}
          <div className="ticket-card" onClick={() => {
          // 进入工单时同时清晎 NEW 标记和未读数
          if (newTicketIds.includes(ticket.id)) clearNewTicket(ticket.id);
          clearUnread(ticket.id);
          navigate(`/tickets/${ticket.id}`);
        }} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ticket.ticketNo}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* 未读消息角标 */}
                {unread > 0 && (
                  <Badge count={unread} size="small" style={{ boxShadow: 'none' }}>
                    <MessageOutlined style={{ color: '#1677ff', fontSize: 14 }} />
                  </Badge>
                )}
                <Tag color={statusMap[ticket.status]?.color} style={{ margin: 0 }}>{statusMap[ticket.status]?.text}</Tag>
              </div>
            </div>
            <h4 style={{ marginBottom: 8, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <span>
                {ticket.category1 ? (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Tag color={ticket.category1 === '硬件设备' ? 'volcano' : 'geekblue'} style={{ fontSize: 11, margin: 0 }}>
                      {ticket.category2 ? `${ticket.category1} · ${ticket.category2}` : ticket.category1}
                    </Tag>
                    {ticket.category3 && <Tag style={{ margin: 0, fontSize: 11 }}>{ticket.category3}</Tag>}
                  </span>
                ) : (
                  <Tag style={{ fontSize: 11 }}>{typeMap[ticket.type] || ticket.type}</Tag>
                )}
              </span>
              <span>{new Date(ticket.createdAt).toLocaleDateString('zh-CN')}</span>
            </div>
            {tab === 'created' && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                {ticket.assignee ? `接单人: ${ticket.assignee.realName || ticket.assignee.displayName || ticket.assignee.username}` : '尚未被接单'}
              </div>
            )}
            {tab === 'assigned' && ticket.status === 'pending' && (
              <Button size="small" type="primary" block icon={<CheckOutlined />}
                onClick={(e) => { e.stopPropagation(); handleAssign(ticket.id); }}
                style={{ marginTop: 10, background: 'var(--info)', border: 'none', borderRadius: 6, fontSize: 12 }}>
                接单
              </Button>
            )}
            {tab === 'participated' && ticket.status !== 'closed' && (
              <Button size="small" type="primary" block icon={<LoginOutlined />}
                onClick={(e) => { e.stopPropagation(); navigate(`/tickets/${ticket.id}`); }}
                style={{ marginTop: 10, background: 'var(--primary)', border: 'none', borderRadius: 6, fontSize: 12 }}>
                进入会话
              </Button>
            )}
            {ticket.status === 'closed' && (
              <Button size="small" type="primary" block icon={<RobotOutlined />}
                onClick={(e) => { e.stopPropagation(); navigate(`/tickets/${ticket.id}`); }}
                style={{ marginTop: 10, background: 'linear-gradient(90deg, #7c3aed, #4f46e5)', border: 'none', borderRadius: 6, fontSize: 12 }}>
                📝 生成知识库
              </Button>
            )}
          </div>
        </div>
      </Col>
    );
  };

  return (
    <div className="fade-in">
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.08); }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
            个人主页 · {user?.realName || user?.displayName || user?.username}
          </h2>
          {(user?.employeeId || user?.department || user?.position) && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {user.employeeId && <Tag color="blue" bordered={false}>工号: {user.employeeId}</Tag>}
              {user.department && <Tag color="cyan" bordered={false}>部门: {user.department}</Tag>}
              {user.position && <Tag color="geekblue" bordered={false}>职位: {user.position}</Tag>}
            </div>
          )}
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          新建工单
        </Button>
      </div>

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as ProfileTab)}
        options={[
          {
            value: 'created',
            label: makeTabLabel(<FileTextOutlined />, '我申请的', createdTickets.length, createdBadge),
          },
          {
            value: 'assigned',
            label: makeTabLabel(<CustomerServiceOutlined />, '我接手的', assignedTickets.length, assignedBadge),
          },
          {
            value: 'participated',
            label: makeTabLabel(<TeamOutlined />, '我参与的', participatedTickets.length, participatedBadge),
          },
        ]}
        style={{ marginBottom: 20 }}
        block
      />

      {tickets.length === 0 ? (
        <Card style={{ borderRadius: 12 }}>
          <Empty description={tab === 'created' ? '还没有发起过工单' : tab === 'assigned' ? '还没有接手过工单' : '还没有参与任何工单'} />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {tickets.map(renderTicketCard)}
        </Row>
      )}

      {/* 创建工单弹窗 */}
      <Modal title="创建技术支持工单" open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); createForm.resetFields(); }}
        onOk={() => createForm.submit()}
        width={600} okText="提交" cancelText="取消">
        <Form form={createForm} layout="vertical" onFinish={handleCreate} style={{ marginTop: 16 }}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请简要描述问题" />
          </Form.Item>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请描述问题' }]}>
            <Input.TextArea rows={4} placeholder="请详细描述遇到的问题..." />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              {categoryTree.length > 0 ? (
                <Form.Item name="categoryPath" label="工单分类" rules={[{ required: true, message: '请选择工单分类' }]}>
                  <Cascader
                    options={categoryTree}
                    placeholder="支持类型 / 技术方向 / 品牌"
                    showSearch={{ filter: categorySearchFilter }}
                    changeOnSelect
                  />
                </Form.Item>
              ) : (
                <Form.Item name="type" label="问题类型" initialValue="other">
                  <Select>
                    <Option value="software">软件问题</Option>
                    <Option value="hardware">硬件问题</Option>
                    <Option value="network">网络问题</Option>
                    <Option value="security">安全问题</Option>
                    <Option value="database">数据库</Option>
                    <Option value="other">其他</Option>
                  </Select>
                </Form.Item>
              )}
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="customerName" label="客户名称">
                <Input placeholder="请输入客户名称" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="serviceNo" label="服务单号">
            <Input placeholder="关联的服务单号 (选填)" />
          </Form.Item>
          <Form.Item name="assigneeId" label="指定接单人">
            <Select showSearch allowClear
              placeholder="留空则发布到工单广场，输入姓名/用户名可定向派单"
              filterOption={false} onSearch={handleAssigneeSearch}
              loading={assigneeSearching} options={assigneeOptions}
              notFoundContent={assigneeSearching ? '搜索中...' : '输入用户名或姓名搜索'}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ProfilePage;
