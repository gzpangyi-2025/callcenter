import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Roles } from '../auth/roles.decorator';
import { Permissions } from '../auth/permissions.decorator';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 用户搜索 — 所有已登录用户可用（用于创建工单选人）
  @Get('search')
  async search(@Query('q') q: string) {
    const data = await this.usersService.search(q || '');
    return { code: 0, data };
  }

  // 当前用户修改自身信息（无需管理员权限）
  @Put('me')
  async updateMe(
    @Request() req: any,
    @Body() body: { realName?: string; email?: string; phone?: string },
  ) {
    const userId = req.user.sub || req.user.id;
    const data = await this.usersService.updateUser(userId, body);
    return { code: 0, message: '个人信息更新成功', data };
  }

  // 当前用户修改密码
  @Put('me/password')
  async changePassword(
    @Request() req: any,
    @Body() body: { oldPassword?: string; newPassword?: string },
  ) {
    if (!body.oldPassword || !body.newPassword) {
      return { code: -1, message: '原密码和新密码不能为空' };
    }
    const userId = req.user.sub || req.user.id;
    await this.usersService.changePassword(
      userId,
      body.oldPassword,
      body.newPassword,
    );
    return { code: 0, message: '密码修改成功' };
  }

  @Get()
  @Permissions('admin:access')
  async findAll() {
    const data = await this.usersService.findAll();
    return { code: 0, data };
  }

  @Put(':id/role')
  @Permissions('admin:access')
  async updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body('roleId', ParseIntPipe) roleId: number,
  ) {
    const data = await this.usersService.updateRole(id, roleId);
    return { code: 0, message: '角色更新成功', data };
  }

  @Put(':id/info')
  @Permissions('admin:access')
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      displayName?: string;
      realName?: string;
      email?: string;
      phone?: string;
    },
  ) {
    const data = await this.usersService.updateUser(id, body);
    return { code: 0, message: '用户信息更新成功', data };
  }

  @Put(':id/reset-password')
  @Permissions('admin:access')
  async resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { password?: string },
  ) {
    const data = await this.usersService.resetPassword(id, body?.password);
    return { code: 0, message: '密码重置成功', data };
  }

  @Delete(':id')
  @Permissions('admin:access')
  async deleteUser(@Param('id', ParseIntPipe) id: number) {
    await this.usersService.deleteUser(id);
    return { code: 0, message: '用户删除成功' };
  }
}
