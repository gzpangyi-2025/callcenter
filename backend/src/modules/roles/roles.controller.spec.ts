import { Test, TestingModule } from '@nestjs/testing';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

describe('RolesController', () => {
  let controller: RolesController;
  let mockRolesService: any;

  beforeEach(async () => {
    mockRolesService = {
      findAllRoles: jest.fn(),
      findAllPermissions: jest.fn(),
      createRole: jest.fn(),
      updateRolePermissions: jest.fn(),
      deleteRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [
        {
          provide: RolesService,
          useValue: mockRolesService,
        },
      ],
    }).compile();

    controller = module.get<RolesController>(RolesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRoles', () => {
    it('should return all roles', async () => {
      const data = [{ id: 1, name: 'Admin' }];
      mockRolesService.findAllRoles.mockResolvedValue(data);
      const result = await controller.getRoles();
      expect(result).toEqual({ code: 0, data });
      expect(mockRolesService.findAllRoles).toHaveBeenCalled();
    });
  });

  describe('getPermissions', () => {
    it('should return all permissions', async () => {
      const data = [{ id: 1, resource: 'admin' }];
      mockRolesService.findAllPermissions.mockResolvedValue(data);
      const result = await controller.getPermissions();
      expect(result).toEqual({ code: 0, data });
      expect(mockRolesService.findAllPermissions).toHaveBeenCalled();
    });
  });

  describe('createRole', () => {
    it('should create a role', async () => {
      const data = { id: 1, name: 'Admin' };
      mockRolesService.createRole.mockResolvedValue(data);
      const body = { name: 'Admin', description: 'Desc', permissionIds: [1] };
      const result = await controller.createRole(body);
      expect(result).toEqual({ code: 0, message: '角色创建成功', data });
      expect(mockRolesService.createRole).toHaveBeenCalledWith(body);
    });
  });

  describe('updatePermissions', () => {
    it('should update role permissions', async () => {
      const data = { id: 1, permissions: [] };
      mockRolesService.updateRolePermissions.mockResolvedValue(data);
      const result = await controller.updatePermissions(1, [1, 2]);
      expect(result).toEqual({ code: 0, message: '权限更新成功', data });
      expect(mockRolesService.updateRolePermissions).toHaveBeenCalledWith(1, [1, 2]);
    });
  });

  describe('deleteRole', () => {
    it('should delete a role', async () => {
      const data = { success: true };
      mockRolesService.deleteRole.mockResolvedValue(data);
      const result = await controller.deleteRole(5);
      expect(result).toEqual({ code: 0, message: '角色删除成功', data });
      expect(mockRolesService.deleteRole).toHaveBeenCalledWith(5);
    });
  });
});
