import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockAuthService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockAuthService = {
      validateUser: jest.fn(),
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should validate external user', async () => {
      const payload = { role: 'external', sub: 1, username: 'guest', ticketId: 10, bbsId: 20 };
      const result = await strategy.validate(payload);
      expect(result).toEqual({
        id: 1,
        username: 'guest',
        displayName: 'guest',
        role: { id: -1, name: 'external', permissions: [] },
        ticketId: 10,
        bbsId: 20,
      });
      expect(mockAuthService.validateUser).not.toHaveBeenCalled();
    });

    it('should validate normal user', async () => {
      const payload = { sub: 1 };
      const user = { id: 1, username: 'test', displayName: 'Test', realName: 'R', role: 'admin' };
      mockAuthService.validateUser.mockResolvedValue(user);
      
      const result = await strategy.validate(payload);
      expect(result).toEqual({
        id: 1,
        username: 'test',
        displayName: 'Test',
        realName: 'R',
        role: 'admin',
      });
      expect(mockAuthService.validateUser).toHaveBeenCalledWith(1);
    });

    it('should return null if user not found', async () => {
      const payload = { sub: 1 };
      mockAuthService.validateUser.mockResolvedValue(null);
      const result = await strategy.validate(payload);
      expect(result).toBeNull();
    });
  });

  describe('constructor', () => {
    it('should throw error if JWT_SECRET is not set', () => {
      mockConfigService.get.mockReturnValue(null);
      expect(() => new JwtStrategy(mockConfigService as any, mockAuthService as any)).toThrow();
    });
  });
});
