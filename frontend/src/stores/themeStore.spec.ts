import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(localStorage.setItem).mockClear();
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({ theme: 'trustfar' });
  });

  it('updates localStorage and the document theme attribute', () => {
    useThemeStore.getState().setTheme('light');

    expect(localStorage.setItem).toHaveBeenCalledWith('app-theme', 'light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
