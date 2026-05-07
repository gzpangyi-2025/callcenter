import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { Client } from '@elastic/elasticsearch';
import { Redis } from 'ioredis';
import * as mysql from 'mysql2/promise';

@Injectable()
export class InfraService {
  private readonly logger = new Logger(InfraService.name);
  private readonly envPath = path.join(process.cwd(), '.env');

  /** 允许通过 API 修改的 .env 键白名单 */
  private static readonly ALLOWED_ENV_KEYS = new Set([
    'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE',
    'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD',
    'ELASTICSEARCH_NODE', 'ELASTICSEARCH_USERNAME', 'ELASTICSEARCH_PASSWORD',
    'JWT_SECRET', 'JWT_EXPIRES_IN',
    'STORAGE_TYPE', 'COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION', 'COS_DOMAIN',
    'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_REGION', 'S3_DOMAIN',
    'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY',
  ]);

  /** 重启限流：上次重启时间 */
  private lastRestartTime = 0;
  private static readonly RESTART_COOLDOWN_MS = 60_000; // 60 秒冷却

  getEnvPath() {
    return this.envPath;
  }

  getEnvConfig() {
    if (!fs.existsSync(this.envPath)) {
      return {};
    }

    const content = fs.readFileSync(this.envPath, 'utf-8');
    const lines = content.split('\n');
    const config: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        config[key] = value;
      }
    }

    return config;
  }

  async updateEnvConfig(updates: Record<string, string>) {
    // 白名单校验：拒绝不在白名单中的键
    const invalidKeys = Object.keys(updates).filter(
      (k) => !InfraService.ALLOWED_ENV_KEYS.has(k),
    );
    if (invalidKeys.length > 0) {
      throw new BadRequestException(
        `不允许修改以下环境变量: ${invalidKeys.join(', ')}`,
      );
    }

    if (!fs.existsSync(this.envPath)) {
      fs.writeFileSync(this.envPath, '', 'utf-8');
    }

    const content = fs.readFileSync(this.envPath, 'utf-8');
    const lines = content.split('\n');
    const updatedKeys = new Set<string>();

    const newLines = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
          updatedKeys.add(key);
          return `${key}=${updates[key]}`;
        }
      }
      return line;
    });

    // Append new keys that were not found in the file
    let addedAny = false;
    for (const [key, value] of Object.entries(updates)) {
      if (!updatedKeys.has(key)) {
        if (!addedAny) {
          newLines.push('');
          addedAny = true;
        }
        newLines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(this.envPath, newLines.join('\n'), 'utf-8');
    this.logger.log('Updated .env configuration');
  }

  async restartService() {
    const now = Date.now();
    const elapsed = now - this.lastRestartTime;
    if (elapsed < InfraService.RESTART_COOLDOWN_MS) {
      const waitSec = Math.ceil((InfraService.RESTART_COOLDOWN_MS - elapsed) / 1000);
      throw new BadRequestException(`操作过于频繁，请 ${waitSec} 秒后再试`);
    }
    this.lastRestartTime = now;

    this.logger.log('Restarting service via PM2...');
    try {
      // Execute in background so the response can be sent to client
      setTimeout(() => {
        exec('pm2 reload callcenter-backend', (err, stdout, stderr) => {
          if (err) {
            this.logger.error('Failed to reload pm2', stderr);
          } else {
            this.logger.log('PM2 reloaded successfully', stdout);
          }
        });
      }, 1000);
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      this.logger.error('Failed to schedule restart', msg);
      return { success: false, message: msg };
    }
  }

  async testElasticsearch(config: {
    node: string;
    username?: string;
    password?: string;
    rejectUnauthorized?: string;
  }) {
    try {
      if (!config.node) throw new Error('Elasticsearch Node URL is required');

      const client = new Client({
        node: config.node,
        auth:
          config.username && config.password
            ? {
                username: config.username,
                password: config.password,
              }
            : undefined,
        tls: {
          rejectUnauthorized: config.rejectUnauthorized !== 'false',
        },
      });

      const info = await client.info();
      return {
        success: true,
        message: `连接成功！版本: ${info.version.number}, 集群: ${info.cluster_name}`,
      };
    } catch (e: unknown) {
      return {
        success: false,
        message: `连接失败: ${e instanceof Error ? e.message : 'unknown'}`,
      };
    }
  }

  async testRedis(config: { host: string; port: number; password?: string }) {
    return new Promise((resolve) => {
      try {
        if (!config.host || !config.port) {
          return resolve({
            success: false,
            message: 'Redis host and port are required',
          });
        }

        const client = new Redis({
          host: config.host,
          port: config.port,
          password: config.password || undefined,
          lazyConnect: true,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
        });

        client
          .connect()
          .then(() => {
            resolve({ success: true, message: '连接成功！' });
            client.disconnect();
          })
          .catch((e: Error) => {
            resolve({ success: false, message: `连接失败: ${e.message}` });
          });
      } catch (e: unknown) {
        resolve({
          success: false,
          message: `连接失败: ${e instanceof Error ? e.message : 'unknown'}`,
        });
      }
    });
  }

  async testMysql(config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    database: string;
  }) {
    try {
      if (
        !config.host ||
        !config.port ||
        !config.username ||
        !config.database
      ) {
        throw new Error(
          'MySQL host, port, username, and database are required',
        );
      }

      const connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password || undefined,
        database: config.database,
        connectTimeout: 5000,
      });

      await connection.ping();
      await connection.end();

      return { success: true, message: '连接成功！' };
    } catch (e: unknown) {
      return {
        success: false,
        message: `连接失败: ${e instanceof Error ? e.message : 'unknown'}`,
      };
    }
  }
}
