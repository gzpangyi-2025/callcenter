/**
 * Tests for the unified logger utility.
 */

import { logger } from '../logger';

describe('logger', () => {
  it('should expose debug, info, warn, error methods', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should not throw when calling any log level', () => {
    expect(() => logger.debug('test debug')).not.toThrow();
    expect(() => logger.info('test info')).not.toThrow();
    expect(() => logger.warn('test warn')).not.toThrow();
    expect(() => logger.error('test error')).not.toThrow();
  });

  it('should accept multiple arguments', () => {
    expect(() => logger.error('error', { code: 500 }, new Error('fail'))).not.toThrow();
  });
});
