import { Test, TestingModule } from '@nestjs/testing';
import { RoleInitService } from './role-init.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { User } from '../../entities/user.entity';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
}));

describe('RoleInitService', () => {
  let service: RoleInitService;
  let mockRoleRepo: any;
  let mockPermRepo: any;
  let mockUserRepo: any;

  beforeEach(async () => {
    mockRoleRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    mockPermRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleInitService,
        { provide: getRepositoryToken(Role), useValue: mockRoleRepo },
        { provide: getRepositoryToken(Permission), useValue: mockPermRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get<RoleInitService>(RoleInitService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize roles, permissions and admin', async () => {
    // Mock for roles: return null for all 5 roles.
    // Mock for permissions: return null for all 19 permissions.
    // Mock for adminUser: return null
    // Mock for adminRole: return valid role

    // Counter for mockRoleRepo.findOne calls
    let roleFindOneCallCount = 0;
    mockRoleRepo.findOne.mockImplementation(async () => {
      roleFindOneCallCount++;
      if (roleFindOneCallCount === 6) {
        // The 6th call is looking for the 'admin' role to attach to the admin user
        return { id: 1, name: 'admin' };
      }
      return null;
    });

    mockPermRepo.findOne.mockResolvedValue(null);
    mockUserRepo.findOne.mockResolvedValue(null);

    await service.onModuleInit();

    expect(mockRoleRepo.save).toHaveBeenCalledTimes(5);
    expect(mockPermRepo.save).toHaveBeenCalledTimes(19);
    expect(mockUserRepo.save).toHaveBeenCalledTimes(1);
    expect(mockUserRepo.save).toHaveBeenCalledWith(expect.objectContaining({ username: 'admin', password: 'hashedPassword' }));
  });

  it('should skip if already initialized', async () => {
    mockRoleRepo.findOne.mockResolvedValue({ id: 1 });
    mockPermRepo.findOne.mockResolvedValue({ id: 1 });
    mockUserRepo.findOne.mockResolvedValue({ id: 1 });

    await service.onModuleInit();

    expect(mockRoleRepo.save).not.toHaveBeenCalled();
    expect(mockPermRepo.save).not.toHaveBeenCalled();
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });
});
