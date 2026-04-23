import React from 'react';
import { useAuthStore } from '../stores/authStore';

interface RequirePermissionProps {
  permissions: string[];
  children: React.ReactNode;
}

export const RequirePermission: React.FC<RequirePermissionProps> = ({ permissions, children }) => {
  const { user } = useAuthStore();

  if (!user || !user.role) {
    return null;
  }

  const roleObj: any = user.role;
  // 超级管理员/系统管理员天然拥有全部展示权 (或者叫 admin 的用户)
  if (roleObj.name === 'admin' || user.username === 'admin') {
    return <>{children}</>;
  }

  // 临时外部用户无任何常规操作界面展示权
  if (roleObj.name === 'external' || roleObj === 'external') {
    return null;
  }

  const userPermissions = roleObj.permissions || [];
  
  // 检查是否具备所需权限之一
  const hasPermission = permissions.some((requiredCode) => {
    return userPermissions.some((p: any) => {
      const pCode = p.code || `${p.resource}:${p.action}`;
      return pCode === requiredCode;
    });
  });

  if (!hasPermission) {
    return null;
  }

  return <>{children}</>;
};
