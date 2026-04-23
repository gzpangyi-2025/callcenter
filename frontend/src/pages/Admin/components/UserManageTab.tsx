import React, { useState, useEffect } from 'react';
import { Table, Select, message, Tag, Button, Modal, Form, Input, Popconfirm, Space, Tooltip } from 'antd';
import { EditOutlined, KeyOutlined, DeleteOutlined } from '@ant-design/icons';
import { usersAPI, rolesAPI } from '../../../services/api';
import type { User, Role } from '../../../types/user';

const { Option } = Select;

export const UserManageTab: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        usersAPI.getAll(),
        rolesAPI.getAll()
      ]);
      if ((usersRes as any).code === 0) setUsers((usersRes as any).data);
      if ((rolesRes as any).code === 0) setRoles((rolesRes as any).data);
    } catch (err) {
      message.error('获取用户数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRoleChange = async (userId: number, roleId: number) => {
    try {
      const res: any = await usersAPI.updateRole(userId, roleId);
      if (res.code === 0) {
        message.success('角色分配成功');
        fetchData();
      }
    } catch (err) {
      message.error('角色分配失败');
    }
  };

  const openEditModal = (user: any) => {
    setEditingUser(user);
    editForm.setFieldsValue({
      realName: user.realName || '',
      email: user.email || '',
      phone: user.phone || '',
    });
    setEditModalOpen(true);
  };

  const handleEditSave = async () => {
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      if (!editingUser) return;
      const res: any = await usersAPI.updateInfo(editingUser.id, values);
      if (res.code === 0) {
        message.success('用户信息更新成功');
        setEditModalOpen(false);
        fetchData();
      }
    } catch {
      message.error('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (userId: number) => {
    try {
      const res: any = await usersAPI.resetPassword(userId);
      if (res.code === 0) {
        message.success(`重置成功！新密码为：${res.data?.newPassword || '123456'}`, 5);
      }
    } catch {
      message.error('重置密码失败');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    try {
      const res: any = await usersAPI.delete(userId);
      if (res.code === 0) {
        message.success('删除成功');
        fetchData();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err: any) {
      if (err.response?.data?.message) {
//         message.error(err.response.data.message); // Removed by global interceptor refactor
      } else {
        message.error('删除失败');
      }
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60, fixed: isMobile ? undefined : 'left' as const },
    { title: '用户名', dataIndex: 'username', width: 120, ellipsis: true },
    { title: '中文姓名', dataIndex: 'realName', width: 120, render: (text: string, record: any) => `${text || '未知'} (${record.username})` },
    {
      title: '状态', dataIndex: 'isActive', width: 70,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'red'}>{isActive ? '活跃' : '禁用'}</Tag>
      )
    },
    { title: '注册时间', dataIndex: 'createdAt', width: 110, render: (date: string) => new Date(date).toLocaleDateString() },
    {
      title: '角色分配', key: 'role', width: 220,
      render: (_: any, record: any) => (
        <Select
          style={{ width: '100%' }}
          value={record.role?.id}
          onChange={(value) => handleRoleChange(record.id, value)}
          placeholder="分配角色"
        >
          {roles.map((r) => (
            <Option key={r.id} value={r.id}>{r.name} - {r.description}</Option>
          ))}
        </Select>
      )
    },
    {
      title: '操作', key: 'action', width: 120, fixed: isMobile ? undefined : 'right' as const,
      render: (_: any, record: any) => (
        <Space size="middle">
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined style={{ color: 'var(--primary)' }} />} onClick={() => openEditModal(record)} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Popconfirm
              title="确定将密码重置为 123456 吗？"
              onConfirm={() => handleResetPassword(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="text" size="small" danger icon={<KeyOutlined />} />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="删除用户">
            <Popconfirm
              title="确定要删除该用户吗？此操作不可恢复"
              onConfirm={() => handleDeleteUser(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={record.id === 1} />
            </Popconfirm>
          </Tooltip>
        </Space>
      )
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 10 }}
        size="small"
      />

      <Modal
        title={`编辑用户 - ${editingUser?.realName || editingUser?.username}`}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleEditSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="realName" label="中文姓名">
            <Input placeholder="输入中文姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="邮箱地址" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="联系电话" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
