import React, { useState, useEffect } from 'react';
import { List, Card, Checkbox, message, Button, Spin, Tag } from 'antd';
import { rolesAPI } from '../../../services/api';

export const RoleManageTab: React.FC = () => {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [checkedPerms, setCheckedPerms] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
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
      const [rolesRes, permsRes] = await Promise.all([
        rolesAPI.getAll(),
        rolesAPI.getPermissions()
      ]);
      if ((rolesRes as any).code === 0) setRoles((rolesRes as any).data);
      if ((permsRes as any).code === 0) setPermissions((permsRes as any).data);
    } catch (err) {
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
    } catch (err) {
      message.error('配置失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 500, minHeight: 500 }}>
      {/* 角色列表 */}
      <div style={{ width: isMobile ? '100%' : 250, borderRight: isMobile ? 'none' : '1px solid var(--border)', borderBottom: isMobile ? '1px solid var(--border)' : 'none', overflowY: 'auto', maxHeight: isMobile ? 200 : '100%' }}>
        <List
          loading={loading}
          dataSource={roles}
          renderItem={(role) => (
            <List.Item 
              style={{ 
                cursor: 'pointer', 
                padding: '16px 24px',
                background: selectedRole?.id === role.id ? 'var(--hover)' : 'transparent',
                borderLeft: selectedRole?.id === role.id ? '4px solid var(--primary)' : '4px solid transparent'
              }}
              onClick={() => handleSelectRole(role)}
            >
              <List.Item.Meta 
                title={<span style={{ fontWeight: 600 }}>{role.name}</span>} 
                description={role.description} 
              />
            </List.Item>
          )}
        />
      </div>

      {/* 权限配置面板 */}
      <div style={{ flex: 1, padding: isMobile ? 12 : 24, overflowY: 'auto' }}>
        {!selectedRole ? (
          <div style={{ textAlign: 'center', marginTop: 100, color: 'var(--text-muted)' }}>
            请在左侧选择一个角色配置权限
          </div>
        ) : (
          <Spin spinning={loading}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h3 style={{ margin: 0 }}>配置权限: <Tag color="blue">{selectedRole.name}</Tag></h3>
              <Button type="primary" onClick={handleSavePermissions} loading={saving}>保存权限配置</Button>
            </div>
            
            <Checkbox.Group 
              style={{ width: '100%' }}
              value={checkedPerms}
              onChange={(checkedValues) => setCheckedPerms(checkedValues as number[])}
            >
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
                {Object.entries(
                  permissions.reduce((acc, perm) => {
                    let moduleName = `🧩 其他模块 (${perm.resource})`;
                    if (perm.resource === 'admin') moduleName = '⚙️ 后台管理 (Admin)';
                    if (perm.resource === 'bbs') moduleName = '💬 交流论坛 (BBS)';
                    if (perm.resource === 'knowledge') moduleName = '📖 知识库 (Knowledge)';
                    if (perm.resource === 'report') moduleName = '📊 数据报表 (Report)';
                    if (perm.resource === 'ticket') moduleName = '🎫 工单系统 (Ticket)';
                    
                    if (!acc[moduleName]) acc[moduleName] = [];
                    acc[moduleName].push(perm);
                    return acc;
                  }, {} as Record<string, any[]>)
                ).map(([moduleName, perms]) => (
                  <Card 
                    key={moduleName}
                    title={<span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{moduleName}</span>}
                    size="small"
                    style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
                    headStyle={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                    bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 20px' }}
                  >
                    {(perms as any[]).map(perm => (
                      <Checkbox key={perm.id} value={perm.id} style={{ marginLeft: 0 }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{perm.description || `${perm.resource}:${perm.action}`}</span>
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
          </Spin>
        )}
      </div>
    </div>
  );
};
