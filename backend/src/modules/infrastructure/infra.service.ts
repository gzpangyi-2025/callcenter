import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Client } from '@elastic/elasticsearch';
import { Redis } from 'ioredis';
import * as mysql from 'mysql2/promise';

const execAsync = promisify(exec);

@Injectable()
export class InfraService {
  private readonly logger = new Logger(InfraService.name);
  private readonly envPath = path.join(process.cwd(), '.env');

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
    if (!fs.existsSync(this.envPath)) {
      fs.writeFileSync(this.envPath, '', 'utf-8');
    }

    const content = fs.readFileSync(this.envPath, 'utf-8');
    const lines = content.split('\n');
    const updatedKeys = new Set<string>();

    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        if (updates.hasOwnProperty(key)) {
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
    } catch (e: any) {
      this.logger.error('Failed to schedule restart', e.message);
      return { success: false, message: e.message };
    }
  }

  async testElasticsearch(config: { node: string; username?: string; password?: string; rejectUnauthorized?: string }) {
    try {
      if (!config.node) throw new Error('Elasticsearch Node URL is required');

      const client = new Client({
        node: config.node,
        auth: config.username && config.password ? {
          username: config.username,
          password: config.password,
        } : undefined,
        tls: {
          rejectUnauthorized: config.rejectUnauthorized !== 'false'
        }
      });

      const info = await client.info();
      return { success: true, message: `连接成功！版本: ${info.version.number}, 集群: ${info.cluster_name}` };
    } catch (e: any) {
      return { success: false, message: `连接失败: ${e.message}` };
    }
  }

  async testRedis(config: { host: string; port: number; password?: string }) {
    return new Promise((resolve) => {
      try {
        if (!config.host || !config.port) {
          return resolve({ success: false, message: 'Redis host and port are required' });
        }

        const client = new Redis({
          host: config.host,
          port: config.port,
          password: config.password || undefined,
          lazyConnect: true,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
        });

        client.connect()
          .then(() => {
            resolve({ success: true, message: '连接成功！' });
            client.disconnect();
          })
          .catch((e) => {
            resolve({ success: false, message: `连接失败: ${e.message}` });
          });
      } catch (e: any) {
        resolve({ success: false, message: `连接失败: ${e.message}` });
      }
    });
  }

  async testMysql(config: { host: string; port: number; username: string; password?: string; database: string }) {
    try {
      if (!config.host || !config.port || !config.username || !config.database) {
        throw new Error('MySQL host, port, username, and database are required');
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
    } catch (e: any) {
      return { success: false, message: `连接失败: ${e.message}` };
    }
  }
}
