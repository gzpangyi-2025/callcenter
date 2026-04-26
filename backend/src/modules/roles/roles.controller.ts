import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions('admin:access')
  async getRoles() {
    const data = await this.rolesService.findAllRoles();
    return { code: 0, data };
  }

  @Get('permissions')
  @Permissions('admin:access')
  async getPermissions() {
    const data = await this.rolesService.findAllPermissions();
    return { code: 0, data };
  }

  @Post(':id/permissions')
  @Permissions('admin:access')
  async updatePermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body('permissionIds') permissionIds: number[],
  ) {
    const data = await this.rolesService.updateRolePermissions(
      id,
      permissionIds,
    );
    return { code: 0, message: '权限更新成功', data };
  }
}
