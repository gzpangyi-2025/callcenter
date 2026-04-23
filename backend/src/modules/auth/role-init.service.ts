import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { User } from '../../entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class RoleInitService implements OnModuleInit {
  private readonly logger = new Logger(RoleInitService.name);

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    const rolesToSeed = [
      { name: 'admin', description: '超级管理员' },
      { name: 'director', description: '技术总监' },
      { name: 'tech', description: '技术支持工程师(二线)' },
      { name: 'user', description: '普通用户(一线工程师)' },
      { name: 'external', description: '外部共享用户' },
    ];

    for (const roleData of rolesToSeed) {
      const existing = await this.roleRepository.findOne({ where: { name: roleData.name } });
      if (!existing) {
        await this.roleRepository.save(this.roleRepository.create(roleData));
        this.logger.log(`Initialized missing role: ${roleData.name}`);
      }
    }

    const permissionsToSeed = [
      { resource: 'tickets', action: 'read', description: '查看工单' },
      { resource: 'tickets', action: 'create', description: '创建工单' },
      { resource: 'tickets', action: 'delete', description: '删除工单' },
      { resource: 'tickets', action: 'assign', description: '分配接单' },
      { resource: 'tickets', action: 'edit', description: '编辑任意工单' },
      { resource: 'tickets', action: 'share', description: '生成外联分享' },
      { resource: 'knowledge', action: 'read', description: '查看知识库' },
      { resource: 'knowledge', action: 'manage', description: '编辑/删除知识库' },
      { resource: 'knowledge', action: 'generate', description: 'AI知识库生成' },
      { resource: 'knowledge', action: 'export_history', description: '直接导出聊天记录' },
      { resource: 'admin', action: 'access', description: '访问后台面板' },
      { resource: 'report', action: 'read', description: '查看数据报表' },
      { resource: 'settings', action: 'read', description: '查看系统设置' },
      { resource: 'settings', action: 'edit', description: '修改系统设置' },
      { resource: 'bbs', action: 'read', description: '查看论坛帖子' },
      { resource: 'bbs', action: 'create', description: '发布新帖子' },
      { resource: 'bbs', action: 'edit', description: '编辑/管理帖子（含置顶归档）' },
      { resource: 'bbs', action: 'delete', description: '删除帖子' },
      { resource: 'bbs', action: 'comment', description: '发表评论' },
    ];

    for (const permData of permissionsToSeed) {
      const existing = await this.permissionRepository.findOne({ 
        where: { resource: permData.resource, action: permData.action } 
      });
      if (!existing) {
        await this.permissionRepository.save(this.permissionRepository.create(permData));
        this.logger.log(`Initialized missing permission: ${permData.resource}:${permData.action}`);
      }
    }

    // 初始化超级管理员
    const adminUser = await this.userRepository.findOne({ where: { username: 'admin' } });
    if (!adminUser) {
      const adminRole = await this.roleRepository.findOne({ where: { name: 'admin' } });
      if (adminRole) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await this.userRepository.save(
          this.userRepository.create({
            username: 'admin',
            password: hashedPassword,
            email: 'admin@callcenter.local',
            realName: '超级管理员',
            displayName: 'Admin',
            roleId: adminRole.id,
            isActive: true,
          })
        );
        this.logger.log('Initialized default admin user: admin / admin123');
      }
    }
  }
}
