import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EXTERNAL_ACCESS_KEY, PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      targets,
    );
    const externalAccess = this.reflector.getAllAndOverride<string[]>(
      EXTERNAL_ACCESS_KEY,
      targets,
    );

    const { user } = context.switchToHttp().getRequest();

    // 如果未设置 @Permissions 验证，默认允许（或你可以选择默认拦截，当前配合系统保持放行）
    if (!requiredPermissions) {
      if (this.isExternalUser(user)) {
        return Array.isArray(externalAccess) && externalAccess.length > 0;
      }
      return true;
    }

    // 如果没有 user 或其不包含 role，拒绝访问 (例外：external 临时通行证有自己的鉴别)
    if (!user || !user.role) {
      return false;
    }

    // 外部分享 token 只允许访问显式标记的详情类路由，避免 tickets:read/bbs:read 被列表和搜索复用。
    if (this.isExternalUser(user)) {
      return Array.isArray(externalAccess) && externalAccess.length > 0;
    }

    // ⭐ 超级管理员通行权
    // 仅基于角色判断，不依赖 username，避免被注册同名账户绕过
    if (user.role.name === 'admin') {
      return true;
    }

    const permissions = user.role.permissions || [];
    // 检查用户所拥有的所有权限记录里，是否有包含 Controller 定义在此方法上的 ANY 或 ALL 需求
    // 这里我们使用: 用户具有需要的任一权限即放行
    const hasPermission = requiredPermissions.some((requiredCode) =>
      permissions.some((p: any) => {
        const pCode = p.code || `${p.resource}:${p.action}`;
        return pCode === requiredCode;
      }),
    );

    return hasPermission;
  }

  private isExternalUser(user: any): boolean {
    return user?.role === 'external' || user?.role?.name === 'external';
  }
}
