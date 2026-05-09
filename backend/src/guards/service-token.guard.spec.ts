import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ServiceTokenGuard } from './service-token.guard';

const createContext = (authorization?: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () =>
        ({
          headers: authorization ? { authorization } : {},
        }) as Request,
    }),
  }) as ExecutionContext;

describe('ServiceTokenGuard', () => {
  const originalServiceToken = process.env.SERVICE_TOKEN;

  afterEach(() => {
    if (originalServiceToken === undefined) {
      delete process.env.SERVICE_TOKEN;
    } else {
      process.env.SERVICE_TOKEN = originalServiceToken;
    }
  });

  it('rejects requests without an Authorization header', () => {
    process.env.SERVICE_TOKEN = 'expected-token';
    const guard = new ServiceTokenGuard();

    expect(() => guard.canActivate(createContext())).toThrow(
      new UnauthorizedException('Missing Authorization header'),
    );
  });

  it('rejects non-Bearer authorization formats', () => {
    process.env.SERVICE_TOKEN = 'expected-token';
    const guard = new ServiceTokenGuard();

    expect(() =>
      guard.canActivate(createContext('Basic expected-token')),
    ).toThrow(new UnauthorizedException('Invalid Authorization format'));
  });

  it('rejects when SERVICE_TOKEN is not configured on the server', () => {
    delete process.env.SERVICE_TOKEN;
    const guard = new ServiceTokenGuard();

    expect(() =>
      guard.canActivate(createContext('Bearer expected-token')),
    ).toThrow(
      new UnauthorizedException('Server SERVICE_TOKEN is not configured'),
    );
  });

  it('rejects mismatched bearer tokens', () => {
    process.env.SERVICE_TOKEN = 'expected-token';
    const guard = new ServiceTokenGuard();

    expect(() =>
      guard.canActivate(createContext('Bearer wrong-token')),
    ).toThrow(new UnauthorizedException('Invalid Service Token'));
  });

  it('allows requests with the configured service token', () => {
    process.env.SERVICE_TOKEN = 'expected-token';
    const guard = new ServiceTokenGuard();

    expect(guard.canActivate(createContext('Bearer expected-token'))).toBe(
      true,
    );
  });
});
