import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { ChatGateway } from '../chat/chat.gateway';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly chatGateway: ChatGateway,
  ) {}

  async findAll() {
    return this.userRepository.find({
      select: ['id', 'username', 'email', 'displayName', 'realName', 'phone', 'isActive', 'createdAt'],
      relations: ['role'],
      order: { id: 'ASC' },
    });
  }

  async search(q: string) {
    if (!q || q.trim().length === 0) return [];
    return this.userRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.username', 'user.displayName', 'user.realName'])
      .where('user.isActive = :active', { active: true })
      .andWhere(
        '(user.username LIKE :q OR user.realName LIKE :q OR user.displayName LIKE :q)',
        { q: `%${q.trim()}%` },
      )
      .take(10)
      .getMany();
  }

  async updateRole(userId: number, roleId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const role = await this.roleRepository.findOne({ where: { id: roleId }, relations: ['permissions'] });
    if (!role) throw new NotFoundException('角色不存在');

    user.role = role;
    user.roleId = role.id;
    const saved = await this.userRepository.save(user);

    // 广播角色变更，通知所有在线客户端立即刷新权限
    this.chatGateway.server.emit('permissionsUpdated', {
      type: 'roleChange',
      userId,
      roleId: role.id,
      roleName: role.name,
    });

    return saved;
  }

  async updateUser(userId: number, data: { displayName?: string; realName?: string; email?: string; phone?: string }) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    if (data.displayName !== undefined) user.displayName = data.displayName;
    if (data.realName !== undefined) user.realName = data.realName;
    if (data.email !== undefined) user.email = data.email;
    if (data.phone !== undefined) user.phone = data.phone;

    return this.userRepository.save(user);
  }

  async resetPassword(userId: number, newPassword?: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    // 默认重置为 123456
    const password = newPassword || '123456';
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    await this.userRepository.save(user);

    return { success: true, newPassword: password };
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('用户不存在');

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('原密码错误');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.userRepository.save(user);

    return { success: true };
  }

  async deleteUser(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    // Cannot delete the root admin user normally, let's just allow it or maybe protect id=1
    if (user.id === 1) {
      throw new BadRequestException('系统初始管理员不能删除');
    }
    await this.userRepository.remove(user);
    return { success: true };
  }
}

