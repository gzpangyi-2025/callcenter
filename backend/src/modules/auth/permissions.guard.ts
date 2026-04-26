import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果未设置 @Permissions 验证，默认允许（或你可以选择默认拦截，当前配合系统保持放行）
    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // 如果没有 user 或其不包含 role，拒绝访问 (例外：external 临时通行证有自己的鉴别)
    if (!user || !user.role) {
      return false;
    }

    // 针对外部用户的特殊处理
    if (user.role === 'external' || user.role.name === 'external') {
      // 外部用户仅允许查看工单（controller 内部会进一步校验 ticketId）或 BBS帖子
      return (
        requiredPermissions.includes('tickets:read') ||
        requiredPermissions.includes('bbs:read')
      );
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
}
