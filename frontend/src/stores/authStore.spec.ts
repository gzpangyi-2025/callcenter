import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { makeUser } from '../test-utils/fixtures';

describe('authStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(localStorage.getItem).mockClear();
    vi.mocked(localStorage.setItem).mockClear();
    vi.mocked(localStorage.removeItem).mockClear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('stores the authenticated user and token', () => {
    const user = makeUser({ id: 7, username: 'alice' });

    useAuthStore.getState().setAuth(user, 'token-123');

    expect(localStorage.setItem).toHaveBeenCalledWith('accessToken', 'token-123');
    expect(useAuthStore.getState()).toMatchObject({
      user,
      accessToken: 'token-123',
      isAuthenticated: true,
    });
  });

  it('clears authentication state and removes the stored token', () => {
    useAuthStore.setState({
      user: makeUser(),
      accessToken: 'token-123',
      isAuthenticated: true,
    });

    useAuthStore.getState().clearAuth();

    expect(localStorage.removeItem).toHaveBeenCalledWith('accessToken');
    expect(useAuthStore.getState()).toMatchObject({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });
});
