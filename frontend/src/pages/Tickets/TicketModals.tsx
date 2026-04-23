import React, { useState, useEffect, useRef } from 'react';
import { Modal, Select, Spin, Button, Form, Input, Cascader, message } from 'antd';
import { RobotOutlined, DownloadOutlined, SaveOutlined } from '@ant-design/icons';
import { MarkdownViewer } from '../../components/MarkdownViewer';
import { RequirePermission } from '../../components/RequirePermission';
import { useTicketContext } from './TicketContext';
import { usersAPI, ticketsAPI, knowledgeAPI, categoryAPI } from '../../services/api';

const TicketModals: React.FC = () => {
  const {
    id, ticket, socket, loadTicket,
    inviteModalOpen, setInviteModalOpen,
    lockModalOpen, setLockModalOpen,
    knowledgeModalOpen, setKnowledgeModalOpen,
    editModalOpen, setEditModalOpen,
    lockDisableExternal, setLockDisableExternal,
    draftKnowledge, draftContent, setDraftContent
  } = useTicketContext();

  // Invite Modal State
  const [selectedInviteUsers, setSelectedInviteUsers] = useState<number[]>([]);
  const [inviteOptions, setInviteOptions] = useState<any[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const inviteSearchTimer = useRef<any>(null);

  // AI Knowledge Modal State
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);

  // Edit Modal State
  const [editForm] = Form.useForm();
  const [editSaving, setEditSaving] = useState(false);
  const [categoryTree, setCategoryTree] = useState<any[]>([]);

  // ==================== 邀请专家逻辑 ====================
  const handleInviteSearch = (value: string) => {
    if (inviteSearchTimer.current) clearTimeout(inviteSearchTimer.current);
    if (!value) { setInviteOptions([]); return; }
    inviteSearchTimer.current = setTimeout(async () => {
      setInviteSearching(true);
      try {
        const res: any = await usersAPI.search(value);
        if (res.code === 0) {
          setInviteOptions(res.data.map((u: any) => ({
            value: u.id,
            label: `${u.realName || u.displayName || u.username} (${u.username})`,
          })));
        }
      } catch {} finally { setInviteSearching(false); }
    }, 300);
  };

  const handleConfirmInvite = async () => {
    if (selectedInviteUsers.length === 0) {
      message.warning('请先选择要邀请的工程师');
      return;
    }
    let successCount = 0;
    let failMessages: string[] = [];
    for (const userId of selectedInviteUsers) {
      try {
        const res: any = await ticketsAPI.inviteParticipant(Number(id), userId);
        if (res.code === 0) successCount++;
      } catch (err: any) {
        failMessages.push(err.response?.data?.message || '邀请失败');
      }
    }
    if (successCount > 0) message.success(`成功邀请 ${successCount} 名专家`);
    if (failMessages.length > 0) message.warning(failMessages.join('；'));
    setInviteModalOpen(false);
    setSelectedInviteUsers([]);
  };

  // ==================== 锁定房间逻辑 ====================
  const handleLockRoom = () => {
    socket?.emit('lockRoom', { ticketId: Number(id), disableExternal: lockDisableExternal });
    setLockModalOpen(false);
    message.success('房间已锁定');
  };

  // ==================== AI 知识库逻辑 ====================
  const handleSaveKnowledge = async () => {
    setKnowledgeSaving(true);
    try {
      const payload = {
        ...draftKnowledge,
        content: draftContent, // 用户校对后的正文
      };
      const res: any = await knowledgeAPI.saveKnowledge(payload);
      if (res.code === 0) {
        message.success('知识文档已成功保存入库！');
        setKnowledgeModalOpen(false);
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err: any) {
    } finally {
      setKnowledgeSaving(false);
    }
  };

  const downloadMd = () => {
    const blob = new Blob([draftContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `知识文档_${ticket?.ticketNo}_${new Date().getTime()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==================== 编辑工单逻辑 ====================
  useEffect(() => {
    if (editModalOpen && ticket) {
      editForm.setFieldsValue({
        title: ticket.title,
        description: ticket.description,
        type: ticket.type,
        categoryPath: ticket.category1 ? [ticket.category1, ticket.category2, ticket.category3].filter(Boolean) : undefined,
        customerName: ticket.customerName || '',
        serviceNo: ticket.serviceNo || '',
      });
      if (categoryTree.length === 0) {
        categoryAPI.getTree().then((res: any) => {
          if (res.code === 0 && res.data?.length > 0) setCategoryTree(res.data);
        }).catch(() => {});
      }
    }
  }, [editModalOpen, ticket, editForm, categoryTree.length]);

  const handleEditSubmit = async (values: any) => {
    setEditSaving(true);
    try {
      const submitData = { ...values };
      if (values.categoryPath && values.categoryPath.length > 0) {
        submitData.category1 = values.categoryPath[0] || '';
        submitData.category2 = values.categoryPath[1] || '';
        submitData.category3 = values.categoryPath[2] || '';
        submitData.type = 'other';
      }
      delete submitData.categoryPath;
      const res: any = await ticketsAPI.update(Number(id), submitData);
      if (res.code === 0) {
        message.success('工单已更新');
        setEditModalOpen(false);
        loadTicket();
      }
    } catch (err: any) {
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <>
      {/* 邀请专家弹窗 */}
      <Modal
        title="邀请协作专家"
        open={inviteModalOpen}
        onCancel={() => {
          setInviteModalOpen(false);
          setSelectedInviteUsers([]);
        }}
        onOk={handleConfirmInvite}
        okText="邀请"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ padding: '20px 0' }}>
          <div style={{ marginBottom: 12 }}>搜索并选择要邀请的工程师（可多选）：</div>
          <Select
            mode="multiple"
            showSearch
            placeholder="输入工程师名称或账号搜索"
            style={{ width: '100%' }}
            defaultActiveFirstOption={false}
            filterOption={false}
            value={selectedInviteUsers}
            onSearch={handleInviteSearch}
            onChange={(val) => setSelectedInviteUsers(val)}
            notFoundContent={inviteSearching ? <Spin size="small" /> : null}
            options={inviteOptions}
          />
        </div>
      </Modal>

      {/* 锁定房间弹窗 */}
      <Modal
        title="锁定聊天房间"
        open={lockModalOpen}
        onCancel={() => setLockModalOpen(false)}
        okText="确认锁定"
        cancelText="取消"
        onOk={handleLockRoom}
      >
        <div style={{ padding: '12px 0' }}>
          <p>锁定后，未受邀的内部人员将被立即移出房间且无法重新进入。</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={lockDisableExternal}
              onChange={(e) => setLockDisableExternal(e.target.checked)} />
            同时暂停外链访问（客户将无法通过分享链接进入）
          </label>
        </div>
      </Modal>

      {/* AI 知识库弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RobotOutlined style={{ color: '#7c3aed' }} /> AI 知识库编撰助手 (预览模式)
          </div>
        }
        open={knowledgeModalOpen}
        onCancel={() => setKnowledgeModalOpen(false)}
        width="90vw"
        style={{ top: 20 }}
        footer={[
          <Button key="cancel" onClick={() => setKnowledgeModalOpen(false)}>
            取消
          </Button>,
          <Button key="md" icon={<DownloadOutlined />} onClick={downloadMd}>
            下载 Markdown
          </Button>,
          <RequirePermission permissions={['knowledge:manage']} key="save_wrapper">
             <Button key="save" type="primary" icon={<SaveOutlined />} loading={knowledgeSaving} onClick={handleSaveKnowledge} style={{ background: '#7c3aed', borderColor: '#7c3aed' }}>
               保存入库
             </Button>
          </RequirePermission>
        ]}
      >
        <div style={{ display: 'flex', height: 'calc(100vh - 200px)', gap: 16, marginTop: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Markdown 源码 (支持人工编辑校对)</div>
            <textarea
              style={{
                flex: 1, resize: 'none', padding: 12, borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13
              }}
              value={draftContent}
              onChange={e => setDraftContent(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>实时渲染预览</div>
            <div style={{
              flex: 1, overflowY: 'auto', padding: 16, borderRadius: 8,
              border: '1px solid var(--border)', background: '#fff', color: '#333',
            }} className="markdown-body">
              <MarkdownViewer content={draftContent} />
            </div>
          </div>
        </div>
      </Modal>

      {/* 工单编辑弹窗 */}
      <Modal
        title="编辑工单"
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={() => editForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={editSaving}
        destroyOnClose
      >
        <Form
          form={editForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={handleEditSubmit}
        >
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入工单标题" />
          </Form.Item>
          {categoryTree.length > 0 ? (
            <Form.Item name="categoryPath" label="工单分类" rules={[{ required: true, message: '请选择分类' }]}>
              <Cascader
                options={categoryTree}
                placeholder="支持类型 / 技术方向 / 品牌"
                showSearch={{ filter: (input: string, path: any[]) => path.some((opt: any) => opt.label.toLowerCase().includes(input.toLowerCase())) }}
                changeOnSelect
              />
            </Form.Item>
          ) : (
            <Form.Item name="type" label="问题类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select options={[
                { value: 'software', label: '软件问题' },
                { value: 'hardware', label: '硬件问题' },
                { value: 'network', label: '网络问题' },
                { value: 'security', label: '安全问题' },
                { value: 'database', label: '数据库问题' },
                { value: 'other', label: '其他' },
              ]} />
            </Form.Item>
          )}
          <Form.Item name="customerName" label="客户名称">
            <Input placeholder="请输入客户名称" />
          </Form.Item>
          <Form.Item name="serviceNo" label="服务单号">
            <Input placeholder="请输入服务单号" />
          </Form.Item>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, message: '请输入问题描述' }]}>
            <Input.TextArea rows={4} placeholder="请输入问题描述" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default TicketModals;
