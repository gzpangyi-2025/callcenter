import { InfraService } from './infra.service';
import { exec } from 'child_process';

// Mock external modules
jest.mock('@elastic/elasticsearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    info: jest.fn().mockResolvedValue({
      version: { number: '8.10.2' },
      cluster_name: 'test',
    }),
  })),
}));
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  })),
}));
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn().mockResolvedValue({
    ping: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('child_process', () => ({
  exec: jest.fn(
    (
      _cmd: string,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, 'reloaded', '');
    },
  ),
}));

const fs = require('fs');

describe('InfraService', () => {
  let service: InfraService;
  const mockedExec = exec as jest.MockedFunction<typeof exec>;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new InfraService();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('DB_HOST=localhost\nDB_PORT=3306\n# comment\n');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('getEnvConfig', () => {
    it('should parse .env and return key-value pairs', () => {
      const config = service.getEnvConfig();
      expect(config).toEqual({ DB_HOST: 'localhost', DB_PORT: '3306' });
    });

    it('should return empty object if .env missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(service.getEnvConfig()).toEqual({});
    });
  });

  describe('updateEnvConfig', () => {
    it('should update existing whitelisted keys in-place', async () => {
      await service.updateEnvConfig({ DB_HOST: '127.0.0.1' });
      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = (fs.writeFileSync as jest.Mock).mock
        .calls[0][1] as string;
      expect(written).toContain('DB_HOST=127.0.0.1');
      expect(written).toContain('DB_PORT=3306');
    });

    it('should append new whitelisted keys', async () => {
      await service.updateEnvConfig({ REDIS_HOST: '127.0.0.1' });
      const written = (fs.writeFileSync as jest.Mock).mock
        .calls[0][1] as string;
      expect(written).toContain('REDIS_HOST=127.0.0.1');
    });

    it('should create .env if missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      await service.updateEnvConfig({ DB_HOST: 'test' });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // create + write
    });

    it('should reject non-whitelisted keys', async () => {
      await expect(
        service.updateEnvConfig({ PATH: '/evil', DB_HOST: 'ok' }),
      ).rejects.toThrow('不允许修改以下环境变量: PATH');
    });

    it('should reject LD_PRELOAD injection', async () => {
      await expect(
        service.updateEnvConfig({ LD_PRELOAD: '/lib/evil.so' }),
      ).rejects.toThrow('不允许修改以下环境变量');
    });
  });

  describe('testElasticsearch', () => {
    it('should return success on valid connection', async () => {
      const result = await service.testElasticsearch({
        node: 'http://localhost:9200',
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain('8.10.2');
    });

    it('should fail if node is empty', async () => {
      const result = await service.testElasticsearch({ node: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('testRedis', () => {
    it('should return success on valid connection', async () => {
      const result = await service.testRedis({ host: 'localhost', port: 6379 });
      expect(result).toEqual({ success: true, message: '连接成功！' });
    });

    it('should fail if host/port missing', async () => {
      const result = await service.testRedis({ host: '', port: 0 });
      expect((result as any).success).toBe(false);
    });
  });

  describe('testMysql', () => {
    it('should return success on valid connection', async () => {
      const result = await service.testMysql({
        host: 'localhost',
        port: 3306,
        username: 'root',
        database: 'test',
      });
      expect(result.success).toBe(true);
    });

    it('should fail if required fields missing', async () => {
      const result = await service.testMysql({
        host: '',
        port: 0,
        username: '',
        database: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('restartService', () => {
    it('should return success on first call', async () => {
      const result = await service.restartService();
      expect(result.success).toBe(true);
      expect(mockedExec).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);

      expect(mockedExec).toHaveBeenCalledWith(
        'pm2 reload callcenter-backend',
        expect.any(Function),
      );
    });

    it('should reject rapid successive restarts (rate limiting)', async () => {
      await service.restartService(); // first call OK
      await expect(service.restartService()).rejects.toThrow('操作过于频繁');
    });
  });
});
