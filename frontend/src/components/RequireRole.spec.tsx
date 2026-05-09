import { render, screen } from '@testing-library/react';
import type React from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireRole } from './RequireRole';
import { useAuthStore } from '../stores/authStore';
import { makeAdminUser, makeUser } from '../test-utils/fixtures';

const mockNavigate = vi.fn<(path: string) => void>();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const renderWithRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('RequireRole', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
    });
  });

  it('renders children when the current user role is allowed', () => {
    useAuthStore.setState({
      user: makeUser({ role: { id: 2, name: 'support', permissions: [] } }),
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderWithRouter(
      <RequireRole roles={['support']}>
        <span>role content</span>
      </RequireRole>,
    );

    expect(screen.getByText('role content')).toBeInTheDocument();
  });

  it('allows admin users regardless of the requested roles', () => {
    useAuthStore.setState({
      user: makeAdminUser(),
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderWithRouter(
      <RequireRole roles={['support']}>
        <span>admin content</span>
      </RequireRole>,
    );

    expect(screen.getByText('admin content')).toBeInTheDocument();
  });

  it('renders fallback content for denied users when fallback is provided', () => {
    useAuthStore.setState({
      user: makeUser({ role: { id: 3, name: 'viewer', permissions: [] } }),
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderWithRouter(
      <RequireRole roles={['support']} fallback={<span>fallback content</span>}>
        <span>hidden content</span>
      </RequireRole>,
    );

    expect(screen.queryByText('hidden content')).not.toBeInTheDocument();
    expect(screen.getByText('fallback content')).toBeInTheDocument();
  });

  it('renders a 403 result and navigates home when the error action is clicked', async () => {
    useAuthStore.setState({
      user: makeUser({ role: { id: 3, name: 'viewer', permissions: [] } }),
      accessToken: 'token',
      isAuthenticated: true,
    });

    renderWithRouter(
      <RequireRole roles={['support']} showError>
        <span>hidden content</span>
      </RequireRole>,
    );

    expect(screen.getByText('403')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '返回首页' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('renders nothing when access is denied and no fallback is provided', () => {
    useAuthStore.setState({
      user: makeUser({ role: { id: 3, name: 'viewer', permissions: [] } }),
      accessToken: 'token',
      isAuthenticated: true,
    });

    const { container } = renderWithRouter(
      <RequireRole roles={['support']}>
        <span>hidden content</span>
      </RequireRole>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
