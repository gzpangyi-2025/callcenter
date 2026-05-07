import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { User } from '../../entities/user.entity';
import { ChatGateway } from '../chat/chat.gateway';
import { UsersService } from './users.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('UsersService', () => {
  let service: UsersService;
  let mockUserRepository: any;
  let mockRoleRepository: any;
  let mockChatGateway: any;

  beforeEach(async () => {
    mockUserRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };

    mockRoleRepository = {
      findOne: jest.fn(),
    };

    mockChatGateway = {
      server: {
        emit: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: ChatGateway,
          useValue: mockChatGateway,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const users = [{ id: 1, username: 'test' }];
      mockUserRepository.find.mockResolvedValue(users);
      const result = await service.findAll();
      expect(result).toEqual(users);
      expect(mockUserRepository.find).toHaveBeenCalledWith({
        select: ['id', 'username', 'email', 'displayName', 'realName', 'phone', 'isActive', 'createdAt'],
        relations: ['role'],
        order: { id: 'ASC' },
      });
    });
  });

  describe('search', () => {
    it('should return empty array if query is empty', async () => {
      const result = await service.search('   ');
      expect(result).toEqual([]);
    });

    it('should return matching users', async () => {
      const users = [{ id: 1, username: 'test' }];
      const queryBuilder: any = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(users),
      };
      mockUserRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.search('test');
      expect(result).toEqual(users);
      expect(mockUserRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(user.username LIKE :q OR user.realName LIKE :q OR user.displayName LIKE :q)',
        { q: '%test%' }
      );
    });
  });

  describe('updateRole', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.updateRole(1, 1)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if role not found', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 1 });
      mockRoleRepository.findOne.mockResolvedValue(null);
      await expect(service.updateRole(1, 1)).rejects.toThrow(NotFoundException);
    });

    it('should update user role and emit event', async () => {
      const user = { id: 1, role: null, roleId: null };
      const role = { id: 2, name: 'Admin' };
      mockUserRepository.findOne.mockResolvedValue(user);
      mockRoleRepository.findOne.mockResolvedValue(role);
      mockUserRepository.save.mockResolvedValue({ ...user, role, roleId: role.id });

      const result = await service.updateRole(1, 2);
      expect(result.roleId).toBe(2);
      expect(mockChatGateway.server.emit).toHaveBeenCalledWith('permissionsUpdated', {
        type: 'roleChange',
        userId: 1,
        roleId: 2,
        roleName: 'Admin',
      });
    });
  });

  describe('updateUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.updateUser(1, {})).rejects.toThrow(NotFoundException);
    });

    it('should update user fields', async () => {
      const user = { id: 1, displayName: 'Old' };
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.save.mockResolvedValue({ ...user, displayName: 'New', realName: 'R', email: 'E', phone: 'P' });

      const result = await service.updateUser(1, { displayName: 'New', realName: 'R', email: 'E', phone: 'P' });
      expect(result.displayName).toBe('New');
      expect(mockUserRepository.save).toHaveBeenCalledWith({ id: 1, displayName: 'New', realName: 'R', email: 'E', phone: 'P' });
    });
  });

  describe('resetPassword', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.resetPassword(1)).rejects.toThrow(NotFoundException);
    });

    it('should reset to default password', async () => {
      const user = { id: 1, password: 'old' };
      mockUserRepository.findOne.mockResolvedValue(user);
      
      const result = await service.resetPassword(1);
      expect(result).toEqual({ success: true, newPassword: '123456' });
      expect(user.password).toBe('hashedPassword');
      expect(mockUserRepository.save).toHaveBeenCalledWith(user);
    });

    it('should reset to provided password', async () => {
      const user = { id: 1, password: 'old' };
      mockUserRepository.findOne.mockResolvedValue(user);
      
      const result = await service.resetPassword(1, 'custom');
      expect(result).toEqual({ success: true, newPassword: 'custom' });
    });
  });

  describe('changePassword', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.changePassword(1, 'old', 'new')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if old password is wrong', async () => {
      const user = { id: 1, password: 'oldHashed' };
      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.changePassword(1, 'wrong', 'new')).rejects.toThrow(BadRequestException);
    });

    it('should change password successfully', async () => {
      const user = { id: 1, password: 'oldHashed' };
      mockUserRepository.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.changePassword(1, 'old', 'new');
      expect(result).toEqual({ success: true });
      expect(user.password).toBe('hashedPassword');
      expect(mockUserRepository.save).toHaveBeenCalledWith(user);
    });
  });

  describe('deleteUser', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.deleteUser(1)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if deleting root admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 1 });
      await expect(service.deleteUser(1)).rejects.toThrow(BadRequestException);
    });

    it('should delete user', async () => {
      const user = { id: 2 };
      mockUserRepository.findOne.mockResolvedValue(user);
      mockUserRepository.remove.mockResolvedValue(user);

      const result = await service.deleteUser(2);
      expect(result).toEqual({ success: true });
      expect(mockUserRepository.remove).toHaveBeenCalledWith(user);
    });
  });
});
