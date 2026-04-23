import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Menu, Avatar, Dropdown, Button, Drawer, Badge, Modal, Form, Input, message, Popover, List, Spin, Tag, Typography } from 'antd';
import {
  DashboardOutlined, FileTextOutlined,
  UserOutlined, SettingOutlined, LogoutOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined,
  MenuOutlined, BookOutlined, EditOutlined, BgColorsOutlined,
  BarChartOutlined, FireOutlined, KeyOutlined,
  BellOutlined, MessageOutlined, NotificationOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useSocketStore } from '../stores/socketStore';
import { useThemeStore } from '../stores/themeStore';
import { authAPI, ticketsAPI, usersAPI, bbsAPI } from '../services/api';

const { Sider, Header, Content } = Layout;

const MainLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm] = Form.useForm();
  const [pwdModalOpen, setPwdModalOpen] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdForm] = Form.useForm();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();
  const { profileBadge, socket, setMyTicketIds, unreadMap, newTicketIds, bbsUnreadMap } = useSocketStore();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [bbsNotifications, setBbsNotifications] = useState<any[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);

  // 监听工单与BBS红点变化，拉取通知详情
  useEffect(() => {
    let isMounted = true;
    setNotificationsLoading(true);
    
    const allIds = Array.from(new Set([...Object.keys(unreadMap).map(Number), ...newTicketIds]));
    const fetchTickets = allIds.length > 0 ? ticketsAPI.getBatchSummary(allIds) : Promise.resolve({ code: 0, data: [] });
    const hasBbs = Object.keys(bbsUnreadMap).length > 0;
    const fetchBbs = hasBbs ? bbsAPI.getNotifications() : Promise.resolve([]);

    Promise.all([fetchTickets, fetchBbs])
      .then(([tRes, bRes]: any[]) => {
        if (isMounted) {
          if (tRes.code === 0) setNotifications(tRes.data);
          setBbsNotifications(bRes || []);
          setNotificationsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setNotificationsLoading(false);
      });

    return () => { isMounted = false; };
  }, [unreadMap, newTicketIds, bbsUnreadMap]);

  // 在应用级别预加载 myTicketIds，确保 profileBadge 在未访问个人主页时也能正确计算
  const loadMyTicketIds = useCallback(async () => {
    try {
      const [createdRes, assignedRes, participatedRes] = await Promise.all([
        ticketsAPI.myCreated(),
        ticketsAPI.myAssigned(),
        ticketsAPI.myParticipated(),
      ]);
      const created = (createdRes as any).code === 0 ? ((createdRes as any).data || []) : [];
      const assigned = (assignedRes as any).code === 0 ? ((assignedRes as any).data || []) : [];
      const participated = (participatedRes as any).code === 0 ? ((participatedRes as any).data || []) : [];
      const allIds = [...new Set([...created, ...assigned, ...participated].map((t: any) => t.id))];
      setMyTicketIds(allIds);
    } catch {}
  }, [setMyTicketIds]);

  // 首次挂载时加载
  useEffect(() => {
    loadMyTicketIds();
  }, [loadMyTicketIds]);

  // 监听 ticketEvent，有新工单/状态变更时刷新 myTicketIds
  useEffect(() => {
    if (!socket) return;
    const handler = () => loadMyTicketIds();
    socket.on('ticketEvent', handler);
    return () => { socket.off('ticketEvent', handler); };
  }, [socket, loadMyTicketIds]);

  // 监听窗口大小变化，判断是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
      if (window.innerWidth > 768) setMobileMenuOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 路由切换时自动关闭移动端菜单
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } finally {
      clearAuth();
      navigate('/login');
    }
  };

  const menuItems: any[] = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/tickets', icon: <FileTextOutlined />, label: '工单广场' },
    { key: '/profile',
      icon: <UserOutlined />,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <span>个人主页</span>
          {profileBadge > 0 && (
            <Badge
              count={profileBadge}
              size="small"
              style={{
                boxShadow: 'none',
                background: '#ff4d4f',
                fontSize: 10,
                fontWeight: 700,
              }}
            />
          )}
        </span>
      ),
    },
  ];

  const roleObj = user?.role as any;
  const userPermissions = roleObj?.permissions || [];
  const hasAdminAccess = roleObj?.name === 'admin' || userPermissions.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === 'admin:access';
  });

  const hasKnowledgeAccess = roleObj?.name === 'admin' || userPermissions.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === 'knowledge:read';
  });

  const hasReportAccess = roleObj?.name === 'admin' || userPermissions.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === 'report:read';
  });

  const hasBbsAccess = roleObj?.name === 'admin' || userPermissions.some((p: any) => {
    const pCode = p.code || `${p.resource}:${p.action}`;
    return pCode === 'bbs:read';
  });

  if (hasBbsAccess) {
    menuItems.push({ key: '/bbs', icon: <FireOutlined />, label: '交流论坛' });
  }

  if (hasReportAccess) {
    menuItems.push({ key: '/reports', icon: <BarChartOutlined />, label: '数据报表' });
  }

  if (hasKnowledgeAccess) {
    menuItems.push({ key: '/knowledge', icon: <BookOutlined />, label: '知识库' });
  }

  if (hasAdminAccess) {
    menuItems.push({ key: '/admin', icon: <SettingOutlined />, label: '后台管理' });
  }

  const userMenu = {
    items: [
      { key: 'profile', icon: <EditOutlined />, label: '个人信息', onClick: () => {
        profileForm.setFieldsValue({
          realName: user?.realName || '',
          email: user?.email || '',
          phone: user?.phone || '',
        });
        setProfileModalOpen(true);
      }},
      { key: 'password', icon: <KeyOutlined />, label: '修改密码', onClick: () => setPwdModalOpen(true) },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout, danger: true },
    ],
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
    if (isMobile) setMobileMenuOpen(false);
  };

  const handleChangePassword = async (values: any) => {
    if (values.newPassword !== values.confirmPassword) {
      return message.error('两次输入的新密码不一致');
    }
    setPwdSaving(true);
    try {
      const res: any = await usersAPI.changeMyPassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      });
      if (res.code === 0) {
        message.success('密码修改成功，请重新登录');
        setPwdModalOpen(false);
        pwdForm.resetFields();
        handleLogout();
      } else {
        message.error(res.message || '密码修改失败');
      }
    } catch (err: any) {
      if (err.response?.data?.message) {
//         message.error(err.response.data.message); // Removed by global interceptor refactor
      } else {
        message.error('请求失败，请稍后重试');
      }
    } finally {
      setPwdSaving(false);
    }
  };

  const currentTheme = useThemeStore(s => s.theme);
  const isDark = currentTheme === 'dark';

  const siderMenu = (
    <Menu
      theme={isDark ? "dark" : "light"}
      mode="inline"
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={handleMenuClick}
      style={{ borderRight: 'none', marginTop: 8, background: 'transparent' }}
    />
  );

  const renderNotificationContent = () => {
    if (notificationsLoading) {
      return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
    }

    const ticketSource = notifications.map(t => {
      const isNew = newTicketIds.includes(t.id);
      const unreadCount = unreadMap[t.id] || 0;
      return { ...t, type: 'ticket', isNew, unreadCount };
    });

    const bbsSource = bbsNotifications.map(b => {
      return { id: b.postId, title: b.post?.title, type: 'bbs', isNew: false, unreadCount: b.unreadCount };
    });

    const dataSource = [...ticketSource, ...bbsSource];

    if (dataSource.length === 0) {
      return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>暂无新系统通知🎉</div>;
    }

    return (
      <List
        className="notification-list"
        itemLayout="horizontal"
        dataSource={dataSource}
        style={{ width: 320, maxHeight: 400, overflowY: 'auto' }}
        renderItem={(item: any) => (
          <List.Item
            style={{ cursor: 'pointer', padding: '12px 16px', transition: 'background 0.3s' }}
            onClick={() => {
              setNotificationOpen(false);
              if (item.type === 'ticket') {
                navigate(`/tickets/${item.id}`);
              } else {
                navigate(`/bbs/${item.id}`);
              }
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <List.Item.Meta
              avatar={
                <Avatar style={{ background: item.type === 'bbs' ? '#f59e0b' : (item.isNew ? '#10b981' : '#3b82f6') }}>
                  {item.type === 'bbs' ? <FireOutlined /> : (item.isNew ? <NotificationOutlined /> : <MessageOutlined />)}
                </Avatar>
              }
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Typography.Text ellipsis style={{ flex: 1, maxWidth: 160 }}>{item.title}</Typography.Text>
                  {item.type === 'ticket' && item.isNew && <Tag color="green" style={{ margin: 0 }}>新任务</Tag>}
                </div>
              }
              description={
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {item.type === 'ticket' ? `工单: #${item.ticketNo}` : '交流互动'}
                  {item.unreadCount > 0 && (
                    <span style={{ color: '#ef4444', marginLeft: 8 }}>
                      ({item.unreadCount} 条未读消息)
                    </span>
                  )}
                </div>
              }
            />
          </List.Item>
        )}
      />
    );
  };

  return (
    <Layout className="main-layout">
      {/* 桌面端：固定侧边栏 */}
      {!isMobile && (
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={240}
          style={{ position: 'fixed', height: '100vh', left: 0, top: 0, zIndex: 100 }}
        >
          <div className="logo-area">
            <h2>{collapsed ? '📞' : '📞 CallCenter'}</h2>
          </div>
          {siderMenu}
        </Sider>
      )}

      {/* 手机端：抽屉侧边栏 */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          width={260}
          styles={{
            body: { padding: 0, background: 'var(--bg-secondary)' },
            header: { background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' },
          }}
          title={
            <span style={{
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 700,
              fontSize: 18,
            }}>
              📞 CallCenter
            </span>
          }
        >
          {siderMenu}
        </Drawer>
      )}

      <Layout style={{
        marginLeft: isMobile ? 0 : (collapsed ? 80 : 240),
        transition: 'margin-left 0.2s',
      }}>
        <Header className="app-header" style={{
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border)',
          height: 56,
          position: 'sticky',
          top: 0,
          zIndex: 99,
        }}>
          {isMobile ? (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMobileMenuOpen(true)}
              style={{ color: 'var(--text-primary)', fontSize: 18 }}
            />
          ) : (
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ color: 'var(--text-primary)', fontSize: 18 }}
            />
          )}

          {isMobile && (
            <span style={{
              fontWeight: 600,
              fontSize: 16,
              background: 'linear-gradient(135deg, #818cf8, #a78bfa)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              CallCenter
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Input.Search
              placeholder="全站搜索..."
              allowClear
              onFocus={(e) => e.target.select()}
              onSearch={value => { if(value) navigate(`/search?q=${encodeURIComponent(value)}`) }}
              style={{ width: 280, display: isMobile ? 'none' : 'block' }}
            />
            
            <Dropdown menu={{
              items: [
                { key: 'dark', label: '🌙 暗黑风格 (默认)' },
                { key: 'trustfar', label: '🌊 银信科技主题' },
                { key: 'light', label: '☀️ 明亮风格' },
              ],
              onClick: ({ key }) => useThemeStore.getState().setTheme(key)
            }} placement="bottomRight">
              <Button type="text" style={{ color: 'var(--text-primary)' }} icon={<BgColorsOutlined />} />
            </Dropdown>

            <Popover
              content={renderNotificationContent}
              title={<div style={{ textAlign: 'center', padding: '12px 0 4px', fontWeight: 600, fontSize: 16 }}>通知中心</div>}
              trigger="click"
              open={notificationOpen}
              onOpenChange={setNotificationOpen}
              placement="bottomRight"
              overlayInnerStyle={{ padding: 0 }}
            >
              <Badge count={profileBadge} size="small" offset={[-4, 4]}>
                <Button type="text" style={{ color: 'var(--text-primary)' }} icon={<BellOutlined />} />
              </Badge>
            </Popover>

            <Dropdown menu={userMenu} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size={isMobile ? 28 : 32} style={{ background: 'linear-gradient(135deg, #4f46e5, #818cf8)' }}>
                  {user?.realName?.[0] || user?.displayName?.[0]?.toUpperCase() || 'U'}
                </Avatar>
                {!isMobile && (
                  <span style={{ fontWeight: 500, fontSize: 14 }}>
                    {user?.realName || '未知姓名'} <span style={{ fontSize: 12, color: 'var(--text-color-secondary)' }}>({user?.username})</span>
                  </span>
                )}
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className="content-area">
          <Outlet />
        </Content>
      </Layout>

      {/* 个人信息编辑弹窗 */}
      <Modal
        title="编辑个人信息"
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        onOk={() => profileForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={profileSaving}
        destroyOnClose
      >
        <Form
          form={profileForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={async (values: any) => {
            setProfileSaving(true);
            try {
              const res: any = await usersAPI.updateMe(values);
              if (res.code === 0) {
                message.success('个人信息已更新');
                setProfileModalOpen(false);
                // 刷新用户信息到 authStore
                const meRes: any = await authAPI.getMe();
                if (meRes.code === 0) {
                  const token = localStorage.getItem('accessToken');
                  if (token) useAuthStore.getState().setAuth(meRes.data, token);
                }
              }
            } catch (err: any) {
//               message.error(err.response?.data?.message || '更新失败'); // Removed by global interceptor refactor
            } finally {
              setProfileSaving(false);
            }
          }}
        >
          <Form.Item label="用户名">
            <Input value={user?.username} disabled />
          </Form.Item>
          <Form.Item name="realName" label="中文姓名" rules={[{ required: true, message: '请输入中文姓名' }]}>
            <Input placeholder="请输入中文姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="请输入电话号码" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 修改密码弹窗 */}
      <Modal title="修改密码" open={pwdModalOpen}
        onCancel={() => { setPwdModalOpen(false); pwdForm.resetFields(); }}
        onOk={() => pwdForm.submit()}
        confirmLoading={pwdSaving}
        width={400} okText="提交" cancelText="取消" destroyOnClose>
        <Form form={pwdForm} layout="vertical" onFinish={handleChangePassword} style={{ marginTop: 16 }}>
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password placeholder="输入当前密码" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码长度不能少于 6 位' }]}>
            <Input.Password placeholder="输入新密码" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}>
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default MainLayout;
