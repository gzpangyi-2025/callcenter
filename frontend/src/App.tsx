import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import LoginPage from './pages/Login';
import MainLayout from './components/MainLayout';
import Dashboard from './pages/Dashboard';
import TicketList from './pages/Tickets';
import TicketDetail from './pages/Tickets/TicketDetail';
import ProfilePage from './pages/Profile';
import AdminPage from './pages/Admin';
import KnowledgePage from './pages/Knowledge';
import ReportsPage from './pages/Reports';
import TicketShared from './pages/Tickets/TicketShared';
import BbsShared from './pages/BBS/BbsShared';
import BbsList from './pages/BBS';
import BbsPostDetail from './pages/BBS/BbsPostDetail';
import BbsPostForm from './pages/BBS/BbsPostForm';
import GlobalSearch from './pages/GlobalSearch';
import AiPage from './pages/Ai';
import { useAuthStore } from './stores/authStore';
import { useSocketStore } from './stores/socketStore';
import { authAPI } from './services/api';
import { RequirePermission } from './components/RequirePermission';
import './styles/variables.css';
import './styles/markdown.css';
import './styles/antd-overrides.css';
import './styles/chat.css';
import './styles/screen-share.css';
import './styles/login.css';
import './styles/layout.css';



const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user, clearAuth } = useAuthStore();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // role 统一为对象格式，直接取 name 字段判断
  if (user?.role?.name === 'external') {
    // 外部游客禁止进入内部工作区
    clearAuth();
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

const AppContent: React.FC = () => {
  const { isAuthenticated, accessToken, setAuth, clearAuth } = useAuthStore();
  const { connect, disconnect } = useSocketStore();

  // 验证登录状态
  useEffect(() => {
    if (isAuthenticated) {
      authAPI.getMe()
        .then((res: any) => {
          if (res.code === 0) {
            const token = localStorage.getItem('accessToken');
            if (token) setAuth(res.data, token);
          }
        })
        .catch(() => clearAuth());
    }
  }, []);

  // 全局 Socket 生命周期管理
  useEffect(() => {
    if (isAuthenticated && accessToken) {
      connect(accessToken);
    } else {
      disconnect();
    }
    return () => {
      // 组件卸载时不断开（SPA不会卸载App），
      // 仅在登出时通过 else 分支断开
    };
  }, [isAuthenticated, accessToken]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/external/ticket/:token" element={<TicketShared />} />
        <Route path="/external/bbs/:token" element={<BbsShared />} />
        <Route path="/" element={
          <ProtectedRoute><MainLayout /></ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="tickets" element={<TicketList />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="admin" element={
            <RequirePermission permissions={['admin:access']}>
              <AdminPage />
            </RequirePermission>
          } />
          <Route path="knowledge" element={
            <RequirePermission permissions={['knowledge:read']}>
              <KnowledgePage />
            </RequirePermission>
          } />
          <Route path="reports" element={
            <RequirePermission permissions={['report:read']}>
              <ReportsPage />
            </RequirePermission>
          } />
          <Route path="bbs">
            <Route index element={<BbsList />} />
            <Route path="new" element={<BbsPostForm />} />
            <Route path=":id" element={<BbsPostDetail />} />
            <Route path=":id/edit" element={<BbsPostForm />} />
          </Route>
          <Route path="ai" element={
            <RequirePermission permissions={['ai:access']}>
              <AiPage />
            </RequirePermission>
          } />
          <Route path="search" element={<GlobalSearch />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

import { useThemeStore } from './stores/themeStore';

const App: React.FC = () => {
  const currentTheme = useThemeStore(s => s.theme);
  
  // 针对不同主题配不同的 Antd Token 覆写
  const getThemeConfig = () => {
    if (currentTheme === 'trustfar') {
      return {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#0056b3',
          borderRadius: 8,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          colorBgContainer: '#ffffff',
          colorText: '#1e293b',
        },
        components: {
          Table: { headerBg: '#e2e8f0', rowHoverBg: '#e0f2fe' },
          Card: { colorBgContainer: '#ffffff' },
          Input: { colorBgContainer: '#f0f4f8' },
          Select: { colorBgContainer: '#f0f4f8' },
          Modal: { contentBg: '#ffffff', headerBg: '#ffffff' },
        }
      };
    }
    
    if (currentTheme === 'light') {
      return {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
          colorBgContainer: '#ffffff',
          colorText: '#0f172a',
        },
        components: {
          Table: { headerBg: '#f1f5f9', rowHoverBg: '#e2e8f0' },
          Card: { colorBgContainer: '#ffffff' },
          Input: { colorBgContainer: '#f8fafc' },
          Select: { colorBgContainer: '#f8fafc' },
          Modal: { contentBg: '#ffffff', headerBg: '#ffffff' },
        }
      };
    }
    
    // 默认暗黑主题
    return {
      algorithm: theme.darkAlgorithm,
      token: {
        colorPrimary: '#4f46e5',
        borderRadius: 8,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      },
      components: {
        Table: { headerBg: '#1e293b', rowHoverBg: '#334155' },
        Card: { colorBgContainer: '#1e293b' },
        Input: { colorBgContainer: '#0f172a' },
        Select: { colorBgContainer: '#0f172a' },
        Modal: { contentBg: '#1e293b', headerBg: '#1e293b' },
      }
    };
  };

  return (
    <ConfigProvider
      locale={zhCN}
      theme={getThemeConfig()}
    >
      <AntApp>
        <AppContent />
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
