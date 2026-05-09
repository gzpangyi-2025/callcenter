import { Test, TestingModule } from '@nestjs/testing';
import { ExtUsersService, SyncUserDto } from './ext-users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { BadRequestException } from '@nestjs/common';

describe('ExtUsersService', () => {
  let service: ExtUsersService;

  const mockUserRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    query: jest.fn().mockResolvedValue([{ id: 1 }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtUsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<ExtUsersService>(ExtUsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw BadRequestException for users without employeeId', async () => {
    const users: SyncUserDto[] = [
      { employeeId: '', realName: 'No ID User' } as any,
    ];

    await expect(service.syncUsers(users)).rejects.toThrow(BadRequestException);
  });

  it('should insert a new user if employeeId is not found', async () => {
    mockUserRepository.findOne.mockResolvedValue(null);
    mockUserRepository.create.mockReturnValue({
      id: 1,
      employeeId: 'E001',
      realName: 'New User',
    });
    mockUserRepository.save.mockResolvedValue({ id: 1 });

    const users: SyncUserDto[] = [
      {
        employeeId: 'E001',
        realName: 'New User',
        department: 'IT',
        email: 'a@a.com',
        phone: '123',
        position: 'A',
        isActive: 1,
      },
    ];

    const result = await service.syncUsers(users);

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(0);
    expect(mockUserRepository.findOne).toHaveBeenCalledWith({
      where: { employeeId: 'E001' },
    });
    expect(mockUserRepository.create).toHaveBeenCalled();
    expect(mockUserRepository.save).toHaveBeenCalled();
  });

  it('should update an existing user if employeeId matches and data changed', async () => {
    const existingUser = {
      id: 2,
      employeeId: 'E002',
      realName: 'Old Name',
      department: 'HR',
    };
    mockUserRepository.findOne.mockResolvedValue(existingUser);
    mockUserRepository.save.mockResolvedValue(existingUser);

    const users: SyncUserDto[] = [
      {
        employeeId: 'E002',
        realName: 'New Name',
        department: 'HR',
        email: 'a@a.com',
        phone: '123',
        position: 'A',
        isActive: 1,
      },
    ];

    const result = await service.syncUsers(users);

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(1);
    expect(mockUserRepository.save).toHaveBeenCalled();
    expect(existingUser.realName).toBe('New Name'); // verify it got updated
  });

  it('should not update if existing user data is identical', async () => {
    const existingUser = {
      id: 3,
      employeeId: 'E003',
      realName: 'Same Name',
      department: 'Finance',
      email: 'a@a.com',
      phone: '123',
      position: 'A',
      isActive: true,
    };
    mockUserRepository.findOne.mockResolvedValue(existingUser);

    const users: SyncUserDto[] = [
      {
        employeeId: 'E003',
        realName: 'Same Name',
        department: 'Finance',
        email: 'a@a.com',
        phone: '123',
        position: 'A',
        isActive: 1,
      },
    ];

    const result = await service.syncUsers(users);

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(0);
    expect(mockUserRepository.save).not.toHaveBeenCalled();
  });
});
