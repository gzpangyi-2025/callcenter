import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 如果未设置 @Roles，默认允许
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    
    // 如果没有 user 或者 user 没有 role 属性，拒绝访问
    if (!user) {
      this.logger.debug('RolesGuard: no user in request');
      return false;
    }

    const userRole = user.role?.name || user.role;
    this.logger.debug(`RolesGuard -> userRole: ${userRole}, required: ${requiredRoles}`);
    return requiredRoles.includes(userRole);
  }
}
