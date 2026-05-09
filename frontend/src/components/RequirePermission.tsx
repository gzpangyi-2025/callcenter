import React from 'react';
import { useAuthStore } from '../stores/authStore';

interface PermissionLike {
  code?: string;
  resource?: string;
  action?: string;
}

interface RequirePermissionProps {
  permissions: string[];
  children: React.ReactNode;
}

const isPermissionLike = (permission: unknown): permission is PermissionLike =>
  typeof permission === 'object' && permission !== null;

export const RequirePermission: React.FC<RequirePermissionProps> = ({ permissions, children }) => {
  const { user } = useAuthStore();

  if (!user || !user.role) {
    return null;
  }

  const roleObj = user.role;
  // 超级管理员/系统管理员天然拥有全部展示权 (或者叫 admin 的用户)
  if (roleObj.name === 'admin' || user.username === 'admin') {
    return <>{children}</>;
  }

  // 临时外部用户无任何常规操作界面展示权
  if (roleObj.name === 'external') {
    return null;
  }

  const userPermissions = roleObj.permissions || [];
  
  // 检查是否具备所需权限之一
  const hasPermission = permissions.some((requiredCode) => {
    return userPermissions.some((p) => {
      if (!isPermissionLike(p)) return false;
      const pCode = p.code || `${p.resource}:${p.action}`;
      return pCode === requiredCode;
    });
  });

  if (!hasPermission) {
    return null;
  }

  return <>{children}</>;
};
