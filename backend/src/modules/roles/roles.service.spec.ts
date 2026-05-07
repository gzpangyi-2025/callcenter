import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { ChatGateway } from '../chat/chat.gateway';
import { RolesService } from './roles.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';

describe('RolesService', () => {
  let service: RolesService;
  let mockRoleRepository: any;
  let mockPermissionRepository: any;
  let mockChatGateway: any;

  beforeEach(async () => {
    mockRoleRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };

    mockPermissionRepository = {
      find: jest.fn(),
      findBy: jest.fn(),
    };

    mockChatGateway = {
      server: {
        emit: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: getRepositoryToken(Permission),
          useValue: mockPermissionRepository,
        },
        {
          provide: ChatGateway,
          useValue: mockChatGateway,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllRoles', () => {
    it('should return all roles', async () => {
      const roles = [{ id: 1, name: 'Admin' }];
      mockRoleRepository.find.mockResolvedValue(roles);
      const result = await service.findAllRoles();
      expect(result).toEqual(roles);
      expect(mockRoleRepository.find).toHaveBeenCalledWith({
        relations: ['permissions'],
        order: { id: 'ASC' },
      });
    });
  });

  describe('findAllPermissions', () => {
    it('should return all permissions', async () => {
      const permissions = [{ id: 1, resource: 'admin' }];
      mockPermissionRepository.find.mockResolvedValue(permissions);
      const result = await service.findAllPermissions();
      expect(result).toEqual(permissions);
      expect(mockPermissionRepository.find).toHaveBeenCalledWith({
        order: { resource: 'ASC', action: 'ASC' },
      });
    });
  });

  describe('createRole', () => {
    it('should throw BadRequestException if role exists', async () => {
      mockRoleRepository.findOne.mockResolvedValue({ id: 1 });
      await expect(service.createRole({ name: 'Admin' })).rejects.toThrow(BadRequestException);
    });

    it('should create a role without permissions', async () => {
      mockRoleRepository.findOne.mockResolvedValue(null);
      const role = { name: 'Admin', description: 'Desc', isActive: true, permissions: [] };
      mockRoleRepository.create.mockReturnValue(role);
      mockRoleRepository.save.mockResolvedValue({ ...role, id: 1 });

      const result = await service.createRole({ name: 'Admin', description: 'Desc' });
      expect(result.id).toBe(1);
      expect(mockRoleRepository.save).toHaveBeenCalled();
      expect(mockChatGateway.server.emit).toHaveBeenCalledWith('rolesUpdated', { type: 'created', roleId: 1, roleName: 'Admin' });
    });

    it('should create a role with permissions', async () => {
      mockRoleRepository.findOne.mockResolvedValue(null);
      const role = { name: 'Admin', description: '', isActive: true, permissions: [] };
      const permissions = [{ id: 1 }, { id: 2 }];
      mockRoleRepository.create.mockReturnValue(role);
      mockPermissionRepository.findBy.mockResolvedValue(permissions);
      mockRoleRepository.save.mockResolvedValue({ ...role, id: 1, permissions });

      const result = await service.createRole({ name: 'Admin', permissionIds: [1, 2] });
      expect(result.permissions).toEqual(permissions);
      expect(mockPermissionRepository.findBy).toHaveBeenCalledWith({ id: In([1, 2]) });
    });
  });

  describe('deleteRole', () => {
    it('should throw BadRequestException if deleting built-in role', async () => {
      await expect(service.deleteRole(1)).rejects.toThrow(BadRequestException);
      await expect(service.deleteRole(4)).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if role not found', async () => {
      mockRoleRepository.findOne.mockResolvedValue(null);
      await expect(service.deleteRole(5)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if role has users', async () => {
      mockRoleRepository.findOne.mockResolvedValue({ id: 5, users: [{ id: 1 }] });
      await expect(service.deleteRole(5)).rejects.toThrow(BadRequestException);
    });

    it('should delete role successfully', async () => {
      const role = { id: 5, name: 'Custom', users: [] };
      mockRoleRepository.findOne.mockResolvedValue(role);
      mockRoleRepository.remove.mockResolvedValue(role);

      const result = await service.deleteRole(5);
      expect(result).toEqual({ success: true });
      expect(mockRoleRepository.remove).toHaveBeenCalledWith(role);
      expect(mockChatGateway.server.emit).toHaveBeenCalledWith('rolesUpdated', { type: 'deleted', roleId: 5, roleName: 'Custom' });
    });
  });

  describe('updateRolePermissions', () => {
    it('should throw NotFoundException if role not found', async () => {
      mockRoleRepository.findOne.mockResolvedValue(null);
      await expect(service.updateRolePermissions(1, [1])).rejects.toThrow(NotFoundException);
    });

    it('should update role permissions', async () => {
      const role = { id: 1, name: 'Admin', permissions: [] };
      const permissions = [{ id: 1, resource: 'admin', action: 'access' }];
      mockRoleRepository.findOne.mockResolvedValue(role);
      mockPermissionRepository.findBy.mockResolvedValue(permissions);
      mockRoleRepository.save.mockResolvedValue({ ...role, permissions });

      const result = await service.updateRolePermissions(1, [1]);
      expect(result.permissions).toEqual(permissions);
      expect(mockRoleRepository.save).toHaveBeenCalledWith({ ...role, permissions });
      expect(mockChatGateway.server.emit).toHaveBeenCalledWith('permissionsUpdated', {
        roleId: 1,
        roleName: 'Admin',
        permissions: [{ id: 1, resource: 'admin', action: 'access' }],
      });
    });

    it('should clear role permissions if empty array provided', async () => {
      const role = { id: 1, name: 'Admin', permissions: [] };
      mockRoleRepository.findOne.mockResolvedValue(role);
      mockRoleRepository.save.mockResolvedValue({ ...role, permissions: [] });

      const result = await service.updateRolePermissions(1, []);
      expect(result.permissions).toEqual([]);
      expect(mockPermissionRepository.findBy).not.toHaveBeenCalled();
    });
  });
});
