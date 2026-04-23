import { Injectable, NotFoundException } from '@nestjs/common';
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
      permissions: permissions.map(p => ({ id: p.id, resource: p.resource, action: p.action })),
    });

    return saved;
  }
}
