import {
  Controller,
  Get,
  Post,
  Delete,
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

  @Post()
  @Permissions('admin:access')
  async createRole(
    @Body() body: { name: string; description?: string; permissionIds?: number[] },
  ) {
    const data = await this.rolesService.createRole(body);
    return { code: 0, message: '角色创建成功', data };
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

  @Delete(':id')
  @Permissions('admin:access')
  async deleteRole(@Param('id', ParseIntPipe) id: number) {
    const data = await this.rolesService.deleteRole(id);
    return { code: 0, message: '角色删除成功', data };
  }
}

