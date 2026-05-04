import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    private readonly chatGateway: ChatGateway,
  ) {}

  async findAllRoles() {
    return this.roleRepository.find({
      relations: ['permissions'],
      order: { id: 'ASC' },
    });
  }

  async findAllPermissions() {
    return this.permissionRepository.find({
      order: { resource: 'ASC', action: 'ASC' },
    });
  }

  async createRole(data: {
    name: string;
    description?: string;
    permissionIds?: number[];
  }) {
    const existing = await this.roleRepository.findOne({
      where: { name: data.name },
    });
    if (existing) throw new BadRequestException('角色名称已存在');

    const role = this.roleRepository.create({
      name: data.name,
      description: data.description || '',
      isActive: true,
    });

    if (data.permissionIds && data.permissionIds.length > 0) {
      role.permissions = await this.permissionRepository.findBy({
        id: In(data.permissionIds),
      });
    } else {
      role.permissions = [];
    }

    const saved = await this.roleRepository.save(role);

    // 广播角色列表变更
    this.chatGateway.server.emit('rolesUpdated', { type: 'created', roleId: saved.id, roleName: saved.name });

    return saved;
  }

  async deleteRole(roleId: number) {
    // 保护内置角色（id <= 4）
    if (roleId <= 4) {
      throw new BadRequestException('内置角色不允许删除');
    }

    const role = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['users'],
    });
    if (!role) throw new NotFoundException('角色不存在');

    if (role.users && role.users.length > 0) {
      throw new BadRequestException(
        `该角色下还有 ${role.users.length} 个用户，请先重新分配角色后再删除`,
      );
    }

    await this.roleRepository.remove(role);

    // 广播角色列表变更
    this.chatGateway.server.emit('rolesUpdated', { type: 'deleted', roleId, roleName: role.name });

    return { success: true };
  }

  async updateRolePermissions(roleId: number, permissionIds: number[]) {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('角色不存在');

    let permissions: Permission[] = [];
    if (permissionIds && permissionIds.length > 0) {
      permissions = await this.permissionRepository.findBy({
        id: In(permissionIds),
      });
    }

    role.permissions = permissions;
    const saved = await this.roleRepository.save(role);

    // 广播权限变更，通知所有在线客户端立即刷新
    this.chatGateway.server.emit('permissionsUpdated', {
      roleId: role.id,
      roleName: role.name,
      permissions: permissions.map((p) => ({
        id: p.id,
        resource: p.resource,
        action: p.action,
      })),
    });

    return saved;
  }
}
