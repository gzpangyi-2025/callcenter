import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RequirePermission } from './RequirePermission';
import { useAuthStore } from '../stores/authStore';

const renderProtectedText = () =>
  render(
    <RequirePermission permissions={['tickets:read']}>
      <span>protected content</span>
    </RequirePermission>,
  );

describe('RequirePermission', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('renders children for users with the requested permission', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'agent',
        role: {
          id: 2,
          name: 'user',
          permissions: [{ resource: 'tickets', action: 'read' }],
        },
      },
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderProtectedText();

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('renders children for admin users', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'admin',
        role: { id: 1, name: 'admin', permissions: [] },
      },
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderProtectedText();

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('hides children from users without permission', () => {
    useAuthStore.setState({
      user: {
        id: 2,
        username: 'viewer',
        role: { id: 3, name: 'user', permissions: [] },
      },
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderProtectedText();

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});
