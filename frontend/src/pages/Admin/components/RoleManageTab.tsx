import React, { useState, useEffect } from 'react';
import {
  List, Card, Checkbox, message, Button, Spin, Tag,
  Modal, Form, Input, Tooltip, Popconfirm, Badge,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, LockOutlined,
} from '@ant-design/icons';
import { rolesAPI } from '../../../services/api';

interface RoleManageTabProps {
  onRolesChange?: (roles: any[]) => void;
}

export const RoleManageTab: React.FC<RoleManageTabProps> = ({ onRolesChange }) => {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [checkedPerms, setCheckedPerms] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 新建角色 Modal 状态
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [createCheckedPerms, setCreateCheckedPerms] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        rolesAPI.getAll(),
        rolesAPI.getPermissions(),
      ]);
      const rolesData = (rolesRes as any).code === 0 ? (rolesRes as any).data : [];
      const permsData = (permsRes as any).code === 0 ? (permsRes as any).data : [];
      setRoles(rolesData);
      setPermissions(permsData);
      onRolesChange?.(rolesData);
    } catch {
      message.error('获取角色数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSelectRole = (role: any) => {
    setSelectedRole(role);
    setCheckedPerms(role.permissions?.map((p: any) => p.id) || []);
  };

  const handleSavePermissions = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      const res: any = await rolesAPI.updatePermissions(selectedRole.id, checkedPerms);
      if (res.code === 0) {
        message.success(`${selectedRole.name} 权限更新成功`);
        fetchData();
      }
    } catch {
      message.error('配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenCreate = () => {
    createForm.resetFields();
    setCreateCheckedPerms([]);
    setCreateModalOpen(true);
  };

  const handleCreateRole = async () => {
    let values: any;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const res: any = await rolesAPI.create({
        name: values.name,
        description: values.description || '',
        permissionIds: createCheckedPerms,
      });
      if (res.code === 0) {
        message.success(`角色「${values.name}」创建成功`);
        setCreateModalOpen(false);
        fetchData();
      }
    } catch {
      // 错误由全局拦截器处理
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRole = async (roleId: number, roleName: string) => {
    try {
      const res: any = await rolesAPI.deleteRole(roleId);
      if (res.code === 0) {
        message.success(`角色「${roleName}」已删除`);
        if (selectedRole?.id === roleId) setSelectedRole(null);
        fetchData();
      }
    } catch {
      // 错误由全局拦截器处理
    }
  };

  // 将权限列表按模块分组（复用）
  const groupedPermissions = (perms: any[]) =>
    perms.reduce((acc, perm) => {
      let moduleName = `🧩 其他模块 (${perm.resource})`;
      if (perm.resource === 'admin') moduleName = '⚙️ 后台管理 (Admin)';
      if (perm.resource === 'bbs') moduleName = '💬 交流论坛 (BBS)';
      if (perm.resource === 'knowledge') moduleName = '📖 知识库 (Knowledge)';
      if (perm.resource === 'report') moduleName = '📊 数据报表 (Report)';
      if (perm.resource === 'ticket') moduleName = '🎫 工单系统 (Ticket)';
      if (!acc[moduleName]) acc[moduleName] = [];
      acc[moduleName].push(perm);
      return acc;
    }, {} as Record<string, any[]>);

  const PermissionCheckboxGroup = ({
    value,
    onChange,
  }: {
    value: number[];
    onChange: (v: number[]) => void;
  }) => (
    <Checkbox.Group
      style={{ width: '100%' }}
      value={value}
      onChange={(v) => onChange(v as number[])}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {Object.entries(groupedPermissions(permissions)).map(([moduleName, perms]) => (
          <Card
            key={moduleName}
            title={<span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{moduleName}</span>}
            size="small"
            style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            headStyle={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
            bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 18px' }}
          >
            {(perms as any[]).map((perm) => (
              <Checkbox key={perm.id} value={perm.id} style={{ marginLeft: 0 }}>
                <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {perm.description || `${perm.resource}:${perm.action}`}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2, fontFamily: 'monospace' }}>
                    {perm.resource}:{perm.action}
                  </span>
                </div>
              </Checkbox>
            ))}
          </Card>
        ))}
      </div>
    </Checkbox.Group>
  );

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 560, minHeight: 500 }}>
      {/* 角色列表侧栏 */}
      <div
        style={{
          width: isMobile ? '100%' : 240,
          borderRight: isMobile ? 'none' : '1px solid var(--border)',
          borderBottom: isMobile ? '1px solid var(--border)' : 'none',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 新建角色按钮 */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={handleOpenCreate}
          >
            新建角色
          </Button>
        </div>

        {/* 角色列表 */}
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: isMobile ? 200 : '100%' }}>
          <List
            loading={loading}
            dataSource={roles}
            renderItem={(role) => {
              const isBuiltIn = role.id <= 4;
              const isSelected = selectedRole?.id === role.id;
              return (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '12px 16px',
                    background: isSelected ? 'var(--hover)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                    transition: 'all 0.2s',
                  }}
                  onClick={() => handleSelectRole(role)}
                  actions={[
                    isBuiltIn ? (
                      <Tooltip key="lock" title="内置角色不可删除">
                        <LockOutlined style={{ color: 'var(--text-muted)', fontSize: 13 }} />
                      </Tooltip>
                    ) : (
                      <Popconfirm
                        key="del"
                        title={`确定删除角色「${role.name}」吗？`}
                        description="该角色下不能有用户，否则无法删除。"
                        onConfirm={(e) => { e?.stopPropagation(); handleDeleteRole(role.id, role.name); }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="确定删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Popconfirm>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{role.name}</span>
                        {isBuiltIn && <Tag color="default" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>内置</Tag>}
                      </div>
                    }
                    description={
                      <div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{role.description || '暂无描述'}</span>
                        <Badge
                          count={role.permissions?.length || 0}
                          showZero
                          style={{ backgroundColor: 'var(--primary)', marginLeft: 6, fontSize: 10 }}
                        />
                      </div>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </div>
      </div>

      {/* 权限配置面板 */}
      <div style={{ flex: 1, padding: isMobile ? 12 : 24, overflowY: 'auto' }}>
        {!selectedRole ? (
          <div style={{ textAlign: 'center', marginTop: 120, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
            <div>请在左侧选择一个角色来配置权限</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>或点击「新建角色」创建自定义角色</div>
          </div>
        ) : (
          <Spin spinning={loading}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 20,
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>
                  配置权限：<Tag color="blue">{selectedRole.name}</Tag>
                </h3>
                {selectedRole.description && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {selectedRole.description}
                  </div>
                )}
              </div>
              <Button type="primary" onClick={handleSavePermissions} loading={saving}>
                保存权限配置
              </Button>
            </div>

            <PermissionCheckboxGroup value={checkedPerms} onChange={setCheckedPerms} />
          </Spin>
        )}
      </div>

      {/* 新建角色 Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlusOutlined style={{ color: 'var(--primary)' }} />
            新建自定义角色
          </div>
        }
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleCreateRole}
        confirmLoading={creating}
        okText="创建角色"
        cancelText="取消"
        width={isMobile ? '95vw' : 720}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingTop: 8 } }}
      >
        <Form form={createForm} layout="vertical">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Form.Item
              name="name"
              label="角色名称"
              rules={[{ required: true, message: '请输入角色名称' }]}
              style={{ flex: 1, minWidth: 160 }}
            >
              <Input placeholder="例如：高级客服、财务审计" maxLength={50} showCount />
            </Form.Item>
            <Form.Item
              name="description"
              label="角色描述"
              style={{ flex: 2, minWidth: 200 }}
            >
              <Input placeholder="简述该角色的职责范围" maxLength={100} />
            </Form.Item>
          </div>
        </Form>

        <div style={{ marginBottom: 8, fontWeight: 600, color: 'var(--text-primary)' }}>
          选择权限
          <Tag style={{ marginLeft: 8 }} color="blue">{createCheckedPerms.length} 项已选</Tag>
        </div>
        <PermissionCheckboxGroup value={createCheckedPerms} onChange={setCreateCheckedPerms} />
      </Modal>
    </div>
  );
};
