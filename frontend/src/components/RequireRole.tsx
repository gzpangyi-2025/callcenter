import React from 'react';
import { useAuthStore } from '../stores/authStore';
import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

interface RequireRoleProps {
  roles: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showError?: boolean;
}

export const RequireRole: React.FC<RequireRoleProps> = ({ roles, children, fallback, showError }) => {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // 如果包含 roles 数组，或者拥有超级管理员权限 admin
  const roleName = typeof user?.role === 'string' ? user.role : (user?.role as any)?.name;
  const userRoleStr = roleName || '';
  const hasAccess = roles.includes(userRoleStr) || userRoleStr === 'admin';

  if (hasAccess) {
    return <>{children}</>;
  }

  if (showError) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="抱歉，您没有权限访问此功能。"
        extra={<Button type="primary" onClick={() => navigate('/')}>返回首页</Button>}
      />
    );
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return null;
};
