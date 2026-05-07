import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let mockUsersService: any;

  beforeEach(async () => {
    mockUsersService = {
      search: jest.fn(),
      updateUser: jest.fn(),
      changePassword: jest.fn(),
      findAll: jest.fn(),
      updateRole: jest.fn(),
      resetPassword: jest.fn(),
      deleteUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('should return search results', async () => {
      const data = [{ id: 1 }];
      mockUsersService.search.mockResolvedValue(data);
      const result = await controller.search('test');
      expect(result).toEqual({ code: 0, data });
      expect(mockUsersService.search).toHaveBeenCalledWith('test');
    });

    it('should handle empty query', async () => {
      mockUsersService.search.mockResolvedValue([]);
      await controller.search('');
      expect(mockUsersService.search).toHaveBeenCalledWith('');
    });
  });

  describe('updateMe', () => {
    it('should update user info', async () => {
      const data = { id: 1, realName: 'test' };
      mockUsersService.updateUser.mockResolvedValue(data);
      const req = { user: { sub: 1 } };
      const body = { realName: 'test' };
      
      const result = await controller.updateMe(req, body);
      expect(result).toEqual({ code: 0, message: '个人信息更新成功', data });
      expect(mockUsersService.updateUser).toHaveBeenCalledWith(1, body);
    });

    it('should use req.user.id if sub is missing', async () => {
      mockUsersService.updateUser.mockResolvedValue({});
      await controller.updateMe({ user: { id: 2 } }, {});
      expect(mockUsersService.updateUser).toHaveBeenCalledWith(2, {});
    });
  });

  describe('changePassword', () => {
    it('should return error if passwords are missing', async () => {
      const result = await controller.changePassword({ user: { sub: 1 } }, {});
      expect(result).toEqual({ code: -1, message: '原密码和新密码不能为空' });
    });

    it('should change password successfully', async () => {
      mockUsersService.changePassword.mockResolvedValue(undefined);
      const result = await controller.changePassword(
        { user: { sub: 1 } },
        { oldPassword: 'old', newPassword: 'new' }
      );
      expect(result).toEqual({ code: 0, message: '密码修改成功' });
      expect(mockUsersService.changePassword).toHaveBeenCalledWith(1, 'old', 'new');
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const data = [{ id: 1 }];
      mockUsersService.findAll.mockResolvedValue(data);
      const result = await controller.findAll();
      expect(result).toEqual({ code: 0, data });
      expect(mockUsersService.findAll).toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('should update role', async () => {
      const data = { id: 1, roleId: 2 };
      mockUsersService.updateRole.mockResolvedValue(data);
      const result = await controller.updateRole(1, 2);
      expect(result).toEqual({ code: 0, message: '角色更新成功', data });
      expect(mockUsersService.updateRole).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('updateUser', () => {
    it('should update user', async () => {
      const data = { id: 1, displayName: 'test' };
      mockUsersService.updateUser.mockResolvedValue(data);
      const body = { displayName: 'test' };
      const result = await controller.updateUser(1, body);
      expect(result).toEqual({ code: 0, message: '用户信息更新成功', data });
      expect(mockUsersService.updateUser).toHaveBeenCalledWith(1, body);
    });
  });

  describe('resetPassword', () => {
    it('should reset password', async () => {
      const data = { success: true, newPassword: '123' };
      mockUsersService.resetPassword.mockResolvedValue(data);
      const result = await controller.resetPassword(1, { password: '123' });
      expect(result).toEqual({ code: 0, message: '密码重置成功', data });
      expect(mockUsersService.resetPassword).toHaveBeenCalledWith(1, '123');
    });
  });

  describe('deleteUser', () => {
    it('should delete user', async () => {
      mockUsersService.deleteUser.mockResolvedValue(undefined);
      const result = await controller.deleteUser(1);
      expect(result).toEqual({ code: 0, message: '用户删除成功' });
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith(1);
    });
  });
});
