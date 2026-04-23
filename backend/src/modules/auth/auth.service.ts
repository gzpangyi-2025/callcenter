import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existing = await this.userRepository.findOne({
      where: { username: registerDto.username },
    });
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // 获取默认用户角色 - 新注册用户默认为外部共享用户组
    let defaultRole = await this.roleRepository.findOne({
      where: { name: 'external' },
      relations: ['permissions'],
    });
    if (!defaultRole) {
      defaultRole = await this.roleRepository.save(
        this.roleRepository.create({ name: 'external', description: '外部共享用户' }),
      );
      defaultRole.permissions = [];
    }

    const user = this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
      displayName: registerDto.displayName || registerDto.realName || registerDto.username,
      realName: registerDto.realName,
      roleId: defaultRole.id,
    });

    const savedUser = await this.userRepository.save(user);
    savedUser.role = defaultRole;
    return this.generateTokens(savedUser);
  }

  async login(loginDto: LoginDto) {
    const user = await this.userRepository.findOne({
      where: { username: loginDto.username },
      relations: ['role', 'role.permissions'],
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('账号已被禁用');
    }

    return this.generateTokens(user);
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ['role', 'role.permissions'],
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('无效的刷新令牌');
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('无效的刷新令牌');
    }
  }

  private generateTokens(user: User) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role?.name,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        realName: user.realName,
        email: user.email,
        avatar: user.avatar,
        role: user.role
          ? { id: user.role.id, name: user.role.name, permissions: user.role.permissions || [] }
          : null,
      },
    };
  }

  async externalLogin(ticketToken: string, nickname: string) {
    try {
      const invitePayload = this.jwtService.verify(ticketToken, {
        secret: this.configService.get('JWT_SECRET'),
      });

      if (!invitePayload || invitePayload.role !== 'external' || !invitePayload.ticketId) {
        throw new UnauthorizedException('无效的外链 Token');
      }

      // 生成带自定义昵称的访问令牌
      const newPayload = {
        sub: `ext-${Date.now()}`,
        username: nickname,
        role: 'external',
        ticketId: invitePayload.ticketId,
      };

      const accessToken = this.jwtService.sign(newPayload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: '7d', // 给外部用的固定长时间免刷 token
      });

      return {
        accessToken,
        user: {
          id: -1,
          username: nickname,
          displayName: nickname,
          ticketId: invitePayload.ticketId,
          role: { id: -1, name: 'external' }
        }
      };
    } catch (e) {
      throw new UnauthorizedException('无效的外链 Token 或验证失败');
    }
  }

  async bbsExternalLogin(token: string) {
    try {
      const invitePayload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });

      if (!invitePayload || invitePayload.role !== 'external_bbs' || !invitePayload.bbsId) {
        throw new UnauthorizedException('无效的外链 Token');
      }

      // 生成带自定义信息的访问令牌
      const newPayload = {
        sub: `ext-bbs-${Date.now()}`,
        username: '匿名访客',
        role: 'external',
        bbsId: invitePayload.bbsId,
      };

      const accessToken = this.jwtService.sign(newPayload, {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: '7d', // 给外部用的固定长时间免刷 token
      });

      return {
        accessToken,
        user: {
          id: -1,
          username: '匿名访客',
          displayName: '匿名访客',
          bbsId: invitePayload.bbsId,
          role: { id: -1, name: 'external' }
        }
      };
    } catch (e) {
      throw new UnauthorizedException('无效的外链 Token 或验证失败');
    }
  }

  async validateUser(userId: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id: userId, isActive: true },
      relations: ['role', 'role.permissions'],
    });
  }
}
