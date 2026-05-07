import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { HttpStatus } from '@nestjs/common';
import * as express from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: any;
  let mockAuditService: any;
  let mockRes: Partial<express.Response>;
  let mockReq: Partial<express.Request>;

  beforeEach(async () => {
    mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      refreshToken: jest.fn(),
      externalLogin: jest.fn(),
      bbsExternalLogin: jest.fn(),
    };

    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockRes = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn((data) => data as any),
    };

    mockReq = {
      ip: '127.0.0.1',
      headers: {},
      secure: false,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register a user', async () => {
      const registerDto = { username: 'test', password: 'password', role: 'user' };
      const resultData = { accessToken: 'token', refreshToken: 'refresh', user: { id: 1 } };
      mockAuthService.register.mockResolvedValue(resultData);

      const result = await controller.register(registerDto, mockReq as any, mockRes as any);

      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', 'refresh', expect.any(Object));
      expect(result).toEqual({
        code: 0,
        message: '注册成功',
        data: { accessToken: 'token', user: { id: 1 } },
      });
    });
  });

  describe('login', () => {
    it('should login a user and log audit', async () => {
      const loginDto = { username: 'test', password: 'password' };
      const resultData = { accessToken: 'token', refreshToken: 'refresh', user: { id: 1, username: 'test' } };
      mockAuthService.login.mockResolvedValue(resultData);

      const result = await controller.login(loginDto, mockReq as any, mockRes as any);

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
      expect(mockAuditService.log).toHaveBeenCalled();
      expect(mockRes.cookie).toHaveBeenCalled();
      expect(result).toEqual({
        code: 0,
        message: '登录成功',
        data: { accessToken: 'token', user: { id: 1, username: 'test' } },
      });
    });

    it('should throw error and log audit on failure', async () => {
      const loginDto = { username: 'test', password: 'password' };
      mockAuthService.login.mockRejectedValue(new Error('Invalid password'));

      await expect(controller.login(loginDto, mockReq as any, mockRes as any)).rejects.toThrow('Invalid password');
      expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'login_failed',
      }));
    });
  });

  describe('refresh', () => {
    it('should return 401 if no refresh token', async () => {
      const reqWithoutCookie = { cookies: {} } as any;
      const result = await controller.refresh(reqWithoutCookie, mockRes as any);
      expect(mockRes.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(result).toEqual({ code: -1, message: '请重新登录' });
    });

    it('should refresh token successfully', async () => {
      const reqWithCookie = { cookies: { refreshToken: 'oldRefresh' }, secure: false } as any;
      const resultData = { accessToken: 'newToken', refreshToken: 'newRefresh', user: { id: 1 } };
      mockAuthService.refreshToken.mockResolvedValue(resultData);

      const result = await controller.refresh(reqWithCookie, mockRes as any);

      expect(mockAuthService.refreshToken).toHaveBeenCalledWith('oldRefresh');
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', 'newRefresh', expect.any(Object));
      expect(result).toEqual({
        code: 0,
        message: '刷新成功',
        data: { accessToken: 'newToken', user: { id: 1 } },
      });
    });
  });

  describe('logout', () => {
    it('should clear cookie and return success', () => {
      const result = controller.logout(mockRes as any);
      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken', expect.any(Object));
      expect(result).toEqual({ code: 0, message: '退出成功' });
    });
  });

  describe('getProfile', () => {
    it('should return user profile', () => {
      const reqWithUser = { user: { id: 1, username: 'test' } } as any;
      const result = controller.getProfile(reqWithUser);
      expect(result).toEqual({ code: 0, data: { id: 1, username: 'test' } });
    });
  });

  describe('externalLogin', () => {
    it('should return error if missing params', async () => {
      const result = await controller.externalLogin({ ticketToken: '', nickname: '' }, mockReq as any);
      expect(result).toEqual({ code: -1, message: '缺少 token 或昵称参数' });
    });

    it('should perform external login', async () => {
      const data = { user: { ticketId: 123 } };
      mockAuthService.externalLogin.mockResolvedValue(data);

      const result = await controller.externalLogin({ ticketToken: 'abc', nickname: 'Guest' }, mockReq as any);

      expect(mockAuthService.externalLogin).toHaveBeenCalledWith('abc', 'Guest');
      expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'external_login' }));
      expect(result).toEqual({ code: 0, message: '临时接入成功', data });
    });
  });

  describe('bbsExternalLogin', () => {
    it('should return error if missing token', async () => {
      const result = await controller.bbsExternalLogin({ token: '' }, mockReq as any);
      expect(result).toEqual({ code: -1, message: '缺少 token 参数' });
    });

    it('should perform bbs external login', async () => {
      const data = { user: { bbsId: 456 } };
      mockAuthService.bbsExternalLogin.mockResolvedValue(data);

      const result = await controller.bbsExternalLogin({ token: 'xyz' }, mockReq as any);

      expect(mockAuthService.bbsExternalLogin).toHaveBeenCalledWith('xyz');
      expect(mockAuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'external_login' }));
      expect(result).toEqual({ code: 0, message: '临时接入 BBS 成功', data });
    });
  });
});
