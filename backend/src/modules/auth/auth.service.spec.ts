import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let mockUserRepo: any;
  let mockRoleRepo: any;
  let mockJwtService: any;
  let mockConfigService: any;

  const mockUser: Partial<User> = {
    id: 1,
    username: 'testuser',
    password: '', // Will be set in beforeEach
    displayName: 'Test User',
    realName: '测试用户',
    isActive: true,
    role: {
      id: 1,
      name: 'tech',
      description: '技术支持',
      permissions: [],
    } as Role,
  };

  beforeEach(async () => {
    mockUser.password = await bcrypt.hash('correct_password', 10);

    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockRoleRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockJwtService = {
      sign: jest.fn().mockReturnValue('mocked_jwt_token'),
      verify: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          JWT_SECRET: 'test-secret',
          JWT_REFRESH_SECRET: 'test-refresh-secret',
          JWT_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Role), useValue: mockRoleRepo },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.login({
        username: 'testuser',
        password: 'correct_password',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.username).toBe('testuser');
      expect(result.user.role?.name).toBe('tech');
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      await expect(
        service.login({ username: 'testuser', password: 'wrong_password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ username: 'ghost', password: 'any' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for disabled user', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(
        service.login({ username: 'testuser', password: 'correct_password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('should return new tokens for valid refresh token', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 1 });
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.refreshToken('valid_refresh_token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('should throw UnauthorizedException for invalid refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.refreshToken('invalid_token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 1 });
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.refreshToken('valid_but_user_gone')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('register', () => {
    it('should successfully register a new user and return tokens', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      mockRoleRepo.findOne.mockResolvedValue({ id: 2, name: 'user', permissions: [] });
      mockUserRepo.create.mockImplementation((dto) => dto);
      mockUserRepo.save.mockImplementation(async (user) => ({ ...user, id: 2 }));

      const result = await service.register({
        username: 'newuser',
        password: 'password123',
        realName: 'New User'
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockUserRepo.create).toHaveBeenCalled();
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if username already exists', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      await expect(
        service.register({ username: 'testuser', password: 'password123' })
      ).rejects.toThrow('用户名已存在');
    });
  });

  describe('externalLogin', () => {
    it('should return tokens and external user profile for valid external ticket token', async () => {
      mockJwtService.verify.mockReturnValue({ role: 'external', ticketId: 100 });

      const result = await service.externalLogin('valid_token', 'Guest User');

      expect(result).toHaveProperty('accessToken');
      expect(result.user.username).toBe('Guest User');
      expect(result.user.ticketId).toBe(100);
      expect(result.user.role?.name).toBe('external');
    });

    it('should throw UnauthorizedException for invalid external token', async () => {
      mockJwtService.verify.mockImplementation(() => { throw new Error('Invalid'); });

      await expect(
        service.externalLogin('invalid_token', 'Guest User')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('bbsExternalLogin', () => {
    it('should return tokens and external user profile for valid BBS token', async () => {
      mockJwtService.verify.mockReturnValue({ role: 'external_bbs', bbsId: 200 });

      const result = await service.bbsExternalLogin('valid_bbs_token');

      expect(result).toHaveProperty('accessToken');
      expect(result.user.username).toBe('匿名访客');
      expect(result.user.bbsId).toBe(200);
    });

    it('should throw UnauthorizedException if role is incorrect', async () => {
      mockJwtService.verify.mockReturnValue({ role: 'user', bbsId: 200 });

      await expect(
        service.bbsExternalLogin('wrong_role_token')
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateUser', () => {
    it('should return user for valid active user id', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.validateUser(1);
      expect(result).toBeDefined();
      expect(result?.username).toBe('testuser');
    });

    it('should return null for non-existent user', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.validateUser(999);
      expect(result).toBeNull();
    });
  });
});
