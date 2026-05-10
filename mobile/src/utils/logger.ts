/**
 * Unified logger for the mobile app.
 *
 * In __DEV__ mode (Expo dev builds): all levels are printed.
 * In production builds: only warn and error are printed.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.info('WebSocket connected');
 *   logger.warn('Retrying...', { attempt: 3 });
 *   logger.error('Upload failed', error);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// In production, only warn and error are printed.
// __DEV__ is a React Native global defined by Metro bundler.
const MIN_LEVEL: LogLevel = typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'warn';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LEVEL];
}

function noop(): void {
  // intentionally empty
}

export const logger: Logger = {
  debug: shouldLog('debug')
    ? (...args: unknown[]) => console.log('[DEBUG]', ...args)
    : noop,
  info: shouldLog('info')
    ? (...args: unknown[]) => console.log('[INFO]', ...args)
    : noop,
  warn: shouldLog('warn')
    ? (...args: unknown[]) => console.warn('[WARN]', ...args)
    : noop,
  error: shouldLog('error')
    ? (...args: unknown[]) => console.error('[ERROR]', ...args)
    : noop,
};
