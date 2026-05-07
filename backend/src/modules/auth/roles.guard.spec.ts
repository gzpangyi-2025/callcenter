import { Test, TestingModule } from '@nestjs/testing';
import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true if no roles required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('should return false if no user', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({}),
      }),
    } as any;
    expect(guard.canActivate(mockContext)).toBe(false);
  });

  it('should return false if user role does not match', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user: { role: { name: 'user' } },
        }),
      }),
    } as any;
    expect(guard.canActivate(mockContext)).toBe(false);
  });

  it('should return true if user role matches (object role)', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user: { role: { name: 'admin' } },
        }),
      }),
    } as any;
    expect(guard.canActivate(mockContext)).toBe(true);
  });

  it('should return true if user role matches (string role)', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user: { role: 'admin' },
        }),
      }),
    } as any;
    expect(guard.canActivate(mockContext)).toBe(true);
  });
});
