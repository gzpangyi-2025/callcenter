import type { User } from '../stores/authStore';
import type { AiTask, ApiResponse } from '../types/api';
import type { Ticket } from '../types/ticket';
import type { User as ApiUser } from '../types/user';

export const apiOk = <T,>(data: T): ApiResponse<T> => ({ code: 0, data });

export const makePermission = (code: string) => {
  const [resource, action] = code.split(':');
  return {
    code,
    resource,
    action,
  };
};

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  username: 'agent',
  role: { id: 2, name: 'user', permissions: [] },
  ...overrides,
});

export const makeAdminUser = (overrides: Partial<User> = {}): User =>
  makeUser({
    id: 99,
    username: 'admin',
    role: { id: 1, name: 'admin', permissions: [] },
    ...overrides,
  });

export const makeApiUser = (overrides: Partial<ApiUser> = {}): ApiUser => ({
  id: 1,
  username: 'agent',
  realName: '技术同事',
  role: 'user',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

export const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => {
  const creator = makeApiUser();
  return {
    id: 1,
    ticketNo: 'T-1',
    title: '数据库连接异常',
    description: 'description',
    status: 'pending',
    type: 'incident',
    creator,
    creatorId: creator.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
};

export const makeAiTask = (overrides: Partial<AiTask> = {}): AiTask => ({
  id: 'task-1',
  type: 'ppt',
  status: 'pending',
  params: {},
  prompt: '生成汇报材料',
  progress: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
