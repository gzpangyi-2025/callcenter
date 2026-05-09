import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TitleFlashModule = typeof import('./titleFlash');

const loadTitleFlash = async (title = 'CallCenter'): Promise<TitleFlashModule> => {
  vi.resetModules();
  document.title = title;
  return import('./titleFlash');
};

describe('titleFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.title = 'CallCenter';
  });

  it('flashes the title with the unread badge and restores the original title', async () => {
    const { startTitleFlash, stopTitleFlash } = await loadTitleFlash('Helpdesk');

    startTitleFlash(3);
    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('🔴 (3条新消息) Helpdesk');

    vi.advanceTimersByTime(1000);
    expect(document.title).toBe('Helpdesk');

    stopTitleFlash();
    expect(document.title).toBe('Helpdesk');
  });

  it('does not create a new interval for the same badge count', async () => {
    const { startTitleFlash } = await loadTitleFlash('Helpdesk');

    startTitleFlash(2);
    startTitleFlash(2);

    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops flashing when started with a non-positive badge', async () => {
    const { startTitleFlash } = await loadTitleFlash('Helpdesk');

    startTitleFlash(1);
    expect(vi.getTimerCount()).toBe(1);

    startTitleFlash(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.title).toBe('Helpdesk');
  });

  it('cleans dirty hot-reload titles before storing the original title', async () => {
    const { startTitleFlash, stopTitleFlash } = await loadTitleFlash(
      '🔴 (9条新消息) Helpdesk',
    );

    startTitleFlash(1);
    vi.advanceTimersByTime(1000);
    stopTitleFlash();

    expect(document.title).toBe('Helpdesk');
  });

  it('stops flashing on visibility change when no unread badge remains', async () => {
    const { initVisibilityListener, startTitleFlash } = await loadTitleFlash('Helpdesk');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });

    initVisibilityListener(() => 0);
    startTitleFlash(1);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(vi.getTimerCount()).toBe(0);
    expect(document.title).toBe('Helpdesk');
  });
});
