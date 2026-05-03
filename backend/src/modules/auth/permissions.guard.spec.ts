import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { EXTERNAL_ACCESS_KEY, PERMISSIONS_KEY } from './permissions.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  const createMockContext = (
    user: any,
    permissions?: string[],
    externalAccess?: string[],
  ): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === PERMISSIONS_KEY) return permissions;
      if (key === EXTERNAL_ACCESS_KEY) return externalAccess;
      return undefined;
    });

    return {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn() as any,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
        getResponse: jest.fn(),
        getNext: jest.fn(),
      }),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as unknown as ExecutionContext;
  };

  it('should allow access when no @Permissions() decorator is set', () => {
    const context = createMockContext(
      { id: 1, role: { name: 'user' } },
      undefined,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user is missing', () => {
    const context = createMockContext(undefined, ['tickets:read']);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny access when user has no role', () => {
    const context = createMockContext({ id: 1, role: null }, ['tickets:read']);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should grant admin users full access regardless of permissions', () => {
    const context = createMockContext(
      { id: 1, role: { name: 'admin' }, username: 'admin' },
      ['tickets:delete', 'admin:access'],
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny admin access for username "admin" with non-admin role', () => {
    const context = createMockContext(
      { id: 1, role: { name: 'tech' }, username: 'admin' },
      ['admin:access'],
    );
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny external users for tickets:read unless route is explicitly marked', () => {
    const context = createMockContext({ id: -1, role: { name: 'external' } }, [
      'tickets:read',
    ]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow external users for an explicitly marked ticket route', () => {
    const context = createMockContext(
      { id: -1, role: { name: 'external' } },
      ['tickets:read'],
      ['ticket'],
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow external users for an explicitly marked bbs route', () => {
    const context = createMockContext({ id: -1, role: { name: 'external' } }, [
      'bbs:read',
    ], ['bbs']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny external users for non-read permissions', () => {
    const context = createMockContext({ id: -1, role: { name: 'external' } }, [
      'tickets:delete',
    ]);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should deny external users for routes without permissions unless explicitly marked', () => {
    const context = createMockContext(
      { id: -1, role: { name: 'external' } },
      undefined,
    );
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should grant access when user has matching permission code', () => {
    const context = createMockContext(
      {
        id: 1,
        role: {
          name: 'tech',
          permissions: [{ code: 'tickets:read' }, { code: 'tickets:create' }],
        },
      },
      ['tickets:create'],
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user lacks the required permission', () => {
    const context = createMockContext(
      {
        id: 1,
        role: {
          name: 'user',
          permissions: [{ code: 'tickets:read' }],
        },
      },
      ['tickets:delete'],
    );
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should support resource:action format when code is missing', () => {
    const context = createMockContext(
      {
        id: 1,
        role: {
          name: 'tech',
          permissions: [{ resource: 'tickets', action: 'assign' }],
        },
      },
      ['tickets:assign'],
    );
    expect(guard.canActivate(context)).toBe(true);
  });
});
