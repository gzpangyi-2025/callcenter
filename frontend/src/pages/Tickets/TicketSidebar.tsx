import React, { useState } from 'react';
import { Card, Space, Tag, Button, Descriptions, Popconfirm, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  CheckOutlined, CloseOutlined,
  FileWordOutlined, DeleteOutlined, ShareAltOutlined, RobotOutlined, UserAddOutlined, EditOutlined
} from '@ant-design/icons';
import { RequirePermission } from '../../components/RequirePermission';
import { useTicketContext } from './TicketContext';
import api, { ticketsAPI, knowledgeAPI } from '../../services/api';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待接单' },
  in_progress: { color: 'blue', text: '服务中' },
  closing: { color: 'volcano', text: '待确认' },
  closed: { color: 'green', text: '已关闭' },
};

const TicketSidebar: React.FC = () => {
  const { 
    ticket, user, id, externalTicketId, canInvite, serviceDuration, loadTicket,
    setEditModalOpen, setInviteModalOpen, setKnowledgeModalOpen,
    setDraftKnowledge, setDraftContent
  } = useTicketContext();
  
  const navigate = useNavigate();
  const [copiedExternalLink, setCopiedExternalLink] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [knowledgeGenerating, setKnowledgeGenerating] = useState(false);

  if (!ticket) return null;
  const currentTicketId = Number(id);

  const handleDelete = async () => {
    try {
      await api.delete(`/tickets/${id}`);
      message.success('工单已删除');
      navigate('/tickets');
    } catch (err: any) {
    }
  };

  const handleShare = async () => {
    try {
      const res: any = await api.post(`/tickets/${id}/share`);
      if (res.code === 0) {
        const link = `${window.location.origin}/external/ticket/${res.data.token}`;
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(link);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = link;
          textArea.style.position = "fixed";
          textArea.style.left = "-999999px";
          textArea.style.top = "-999999px";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        message.success('分享链接已复制到剪贴板！');
        setCopiedExternalLink(true);
        setTimeout(() => setCopiedExternalLink(false), 3000);
      }
    } catch (err: any) {
    }
  };

  const handleAssign = async () => {
    try {
      const res: any = await ticketsAPI.assign(Number(id));
      if (res.code === 0) message.success('接单成功');
    } catch (err: any) {
    }
  };

  const handleRequestClose = async () => {
    try {
      const res: any = await ticketsAPI.requestClose(Number(id));
      if (res.code === 0) message.success('已申请关单');
    } catch (err: any) {
    }
  };

  const handleConfirmClose = async () => {
    try {
      const res: any = await ticketsAPI.confirmClose(Number(id));
      if (res.code === 0) {
        message.success('工单已关闭');
        loadTicket();
      }
    } catch (err: any) {
    }
  };

  const handleGenerateKnowledge = async () => {
    setKnowledgeGenerating(true);
    const hide = message.loading('AI 正在深度分析工单聊天记录，生成阶段需要15-30秒，请耐心等待...', 0);
    try {
      const res: any = await knowledgeAPI.generateDraft(Number(id));
      hide();
      if (res.code === 0) {
        setDraftKnowledge(res.data);
        setDraftContent(res.data.content);
        setKnowledgeModalOpen(true);
        message.success('草稿生成完成，请校对后保存');
      } else if (res.code === 2) {
        message.info(res.message || '文档已存在，为您跳转');
        localStorage.setItem('knowledgeActiveTab', 'ai_doc');
        navigate(`/knowledge`);
      } else {
        message.error(res.message || '生成失败');
      }
    } catch (err: any) {
      hide();
    } finally {
      setKnowledgeGenerating(false);
    }
  };

  return (
    <>
      <Card style={{ borderRadius: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, lineHeight: 1.4 }}>{ticket.title}</h3>
          <Space wrap>
            <Tag color={statusMap[ticket.status]?.color}>{statusMap[ticket.status]?.text}</Tag>

            {ticket.status !== 'closed' && (ticket.creatorId === user?.id || (() => {
              const roleObj = user?.role as any;
              const perms = roleObj?.permissions || [];
              return roleObj?.name === 'admin' || perms.some((p: any) => {
                const c = p.code || `${p.resource}:${p.action}`;
                return c === 'tickets:edit';
              });
            })()) && (
              <Button size="small" type="dashed" icon={<EditOutlined />} onClick={() => setEditModalOpen(true)}>编辑</Button>
            )}
            
            <RequirePermission permissions={['tickets:share']}>
              <Button size="small" type="dashed" icon={copiedExternalLink ? <CheckOutlined style={{color: '#52c41a'}} /> : <ShareAltOutlined />} onClick={handleShare}>
                {copiedExternalLink ? '已复制' : '外链'}
              </Button>
            </RequirePermission>

            <RequirePermission permissions={['tickets:delete']}>
              <Popconfirm title="确定要删除该工单吗？" onConfirm={handleDelete} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                <Button size="small" danger type="text" icon={<DeleteOutlined />} />
              </Popconfirm>
            </RequirePermission>
          </Space>
        </div>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="工单号">{ticket.ticketNo}</Descriptions.Item>
          <Descriptions.Item label="工单分类">
            {ticket.category1 ? (
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <Tag color={ticket.category1 === '硬件设备' ? 'volcano' : 'geekblue'} style={{ margin: 0 }}>
                  {ticket.category2 ? `${ticket.category1} · ${ticket.category2}` : ticket.category1}
                </Tag>
                {ticket.category3 && <Tag style={{ margin: 0 }}>{ticket.category3}</Tag>}
              </span>
            ) : (
              <span>{ticket.type}</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="客户名称">{ticket.customerName || '-'}</Descriptions.Item>
          <Descriptions.Item label="服务单号">{ticket.serviceNo || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建人">{ticket.creator?.realName || ticket.creator?.displayName || '-'}</Descriptions.Item>
          <Descriptions.Item label="接单人">{ticket.assignee?.realName || ticket.assignee?.displayName || '未接单'}</Descriptions.Item>
          {ticket.participants && ticket.participants.length > 0 && (
            <Descriptions.Item label="参与专家">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {ticket.participants.map((p: any) => (
                  <Tag 
                    key={p.id} 
                    style={{ margin: 0 }}
                    closable={!!(!externalTicketId && canInvite)}
                    onClose={async (e) => {
                      e.preventDefault();
                      try {
                        await ticketsAPI.removeParticipant(Number(id), p.id);
                        message.success('专家已移除');
                        loadTicket();
                      } catch {
                        message.error('移除失败');
                      }
                    }}
                  >{p.realName || p.displayName || p.username}</Tag>
                ))}
              </div>
            </Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间">{new Date(ticket.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
          {ticket.assignedAt && (
            <Descriptions.Item label="接单时间">{new Date(ticket.assignedAt).toLocaleString('zh-CN')}</Descriptions.Item>
          )}
          {ticket.assignedAt && !ticket.closedAt && (
            <Descriptions.Item label="服务时长">
              <span style={{ color: 'var(--info)', fontWeight: 500 }}>⏱ {serviceDuration || '计算中...'}</span>
            </Descriptions.Item>
          )}
          {ticket.closedAt && (
            <Descriptions.Item label="关单时间">{new Date(ticket.closedAt).toLocaleString('zh-CN')}</Descriptions.Item>
          )}
        </Descriptions>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-primary)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text-primary)' }}>问题描述</div>
          {ticket.description}
        </div>
      </Card>
      <Card style={{ borderRadius: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {ticket.status === 'pending' && (
            <Button type="primary" block icon={<CheckOutlined />} onClick={handleAssign}
              style={{ background: 'var(--info)', border: 'none' }}>接单</Button>
          )}
          {ticket.status === 'in_progress' && (ticket.assigneeId === user?.id || ticket.creatorId === user?.id) && (
            <Button block icon={<UserAddOutlined />} onClick={() => setInviteModalOpen(true)}
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>邀请协作专家</Button>
          )}
          {ticket.status === 'in_progress' && ticket.assigneeId === user?.id && (
            <Button block icon={<CloseOutlined />} onClick={handleRequestClose}
              style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>申请关单</Button>
          )}
          {ticket.status === 'closing' && ticket.creatorId === user?.id && (
            <Button type="primary" block icon={<CheckOutlined />} onClick={handleConfirmClose}
              style={{ background: 'var(--success)', border: 'none' }}>确认关单</Button>
          )}
          {ticket.status === 'closed' && (
            <>
              <RequirePermission permissions={['knowledge:generate']}>
                <Button block type="primary" icon={<RobotOutlined />} onClick={handleGenerateKnowledge} loading={knowledgeGenerating}
                  style={{ background: 'linear-gradient(90deg, #7c3aed, #4f46e5)', border: 'none', fontWeight: 600 }}>
                  {knowledgeGenerating ? 'AI 分析生成中...' : '📝 生成知识库'}
                </Button>
              </RequirePermission>
              <RequirePermission permissions={['knowledge:export_history']}>
                <Button block type="default" onClick={async () => {
                  try {
                    const res: any = await knowledgeAPI.exportChatHistory(currentTicketId);
                    if (res.code === 0) {
                      message.success('聊天记录已导出至知识库！');
                      localStorage.setItem('knowledgeActiveTab', 'chat_history');
                      navigate('/knowledge');
                    } else if (res.code === 2) {
                      message.info(res.message || '归档已存在，为您跳转');
                      localStorage.setItem('knowledgeActiveTab', 'chat_history');
                      navigate('/knowledge');
                    }
                  } catch (err: any) {
                  }
                }} style={{ marginTop: 12 }}>
                  直接导出聊天记录到知识库
                </Button>
              </RequirePermission>
            </>
          )}
          
          {/* 生成处理报告 — 任何状态均可用 */}
          {!externalTicketId && (user?.role as any)?.name !== 'external' && (
            <Button block icon={<FileWordOutlined />} loading={exportingReport}
              onClick={async () => {
                setExportingReport(true);
                try {
                  const res = await api.get(`/tickets/${ticket.id}/export-report`, { responseType: 'blob' });
                  const blob = new Blob([res as any], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${ticket.ticketNo}_处理报告.docx`;
                  a.click();
                  URL.revokeObjectURL(url);
                  message.success('处理报告已生成');
                } catch (err: any) {
                } finally {
                  setExportingReport(false);
                }
              }}
              style={{ borderColor: '#2b579a', color: '#2b579a', fontWeight: 500 }}
            >
              {exportingReport ? '生成中...' : '📋 生成处理报告'}
            </Button>
          )}

          <RequirePermission permissions={['tickets:delete']}>
            <Popconfirm title="确定要删除该工单吗？删除后不可恢复！" onConfirm={handleDelete} okText="彻底删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Button block danger icon={<DeleteOutlined />}>直接删除</Button>
            </Popconfirm>
          </RequirePermission>
        </Space>
      </Card>
    </>
  );
};

export default TicketSidebar;
