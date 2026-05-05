import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Response } from 'express';
import * as path from 'path';
import { FilesService } from '../files/files.service';

export interface CreateAiTaskDto {
  type: string;
  params: Record<string, unknown>;
  prompt?: string;
  attachments?: Array<{ name: string; url: string; size: number }>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly worker: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    private readonly filesService: FilesService,
  ) {
    const baseURL = this.config.get<string>(
      'CODEX_WORKER_URL',
      'http://43.130.240.106:3100',
    );
    const apiKey = this.config.get<string>('CODEX_WORKER_API_KEY', '');

    this.worker = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
    });

    this.logger.log(`Codex Worker URL: ${baseURL}`);
  }

  /** Submit a new AI task */
  async createTask(dto: CreateAiTaskDto, userId: number) {
    try {
      // Resolve attachment URLs to absolute COS presigned URLs
      // (worker runs on a different server and can't access relative paths)
      let resolvedAttachments = dto.attachments;
      if (dto.attachments && dto.attachments.length > 0) {
        resolvedAttachments = await Promise.all(
          dto.attachments.map(async (att) => {
            if (att.url.startsWith('http')) return att; // Already absolute
            // Extract COS key from relative path like /api/files/static/<key>
            const cosKey = att.url.replace('/api/files/static/', '');
            const absoluteUrl = await this.filesService.getPresignedUrl(cosKey, att.name, false);
            return { ...att, url: absoluteUrl };
          }),
        );
        this.logger.log(`Resolved ${resolvedAttachments.length} attachment URLs for task`);
      }

      const res = await this.worker.post('/api/tasks', {
        ...dto,
        attachments: resolvedAttachments,
        userId,
      });
      return res.data;
    } catch (err: any) {
      this.handleWorkerError(err, 'createTask');
    }
  }

  /** List tasks (optionally filtered by userId) */
  async listTasks(query: { page?: number; limit?: number; status?: string; userId?: number }) {
    try {
      const res = await this.worker.get('/api/tasks', { params: query });
      return res.data;
    } catch (err: any) {
      this.handleWorkerError(err, 'listTasks');
    }
  }

  /** Get a single task by ID */
  async getTask(taskId: string) {
    try {
      const res = await this.worker.get(`/api/tasks/${taskId}`);
      return res.data;
    } catch (err: any) {
      if (err.response?.status === 404) {
        throw new NotFoundException(`Task ${taskId} not found`);
      }
      this.handleWorkerError(err, 'getTask');
    }
  }

  /** Cancel a task */
  async cancelTask(taskId: string) {
    try {
      const res = await this.worker.post(`/api/tasks/${taskId}/cancel`);
      return res.data;
    } catch (err: any) {
      this.handleWorkerError(err, 'cancelTask');
    }
  }

  /** Get download URLs for task output files */
  async getTaskFiles(taskId: string) {
    try {
      const res = await this.worker.get(`/api/tasks/${taskId}/files`);
      return res.data;
    } catch (err: any) {
      this.handleWorkerError(err, 'getTaskFiles');
    }
  }

  /** Get available prompt templates */
  async getTemplates() {
    try {
      const res = await this.worker.get('/api/templates');
      return res.data;
    } catch (err: any) {
      this.handleWorkerError(err, 'getTemplates');
    }
  }

  /** Health check for the worker */
  async workerHealth() {
    try {
      const res = await this.worker.get('/health');
      return res.data;
    } catch (err: any) {
      throw new ServiceUnavailableException('Codex Worker is unavailable');
    }
  }

  /**
   * Proxy-download a task output file through CallCenter backend.
   * Resolves Chrome cross-origin download restrictions by serving the COS
   * file as a same-origin response with correct Content-Disposition.
   */
  async proxyDownload(taskId: string, filename: string, res: Response) {
    // 1. Get the presigned URL list from Worker
    let files: Array<{ name: string; url: string; size: number }>;
    try {
      const filesRes = await this.worker.get(`/api/tasks/${taskId}/files`);
      files = filesRes.data?.data ?? filesRes.data ?? [];
    } catch (err: any) {
      throw new NotFoundException(`Task ${taskId} files not found`);
    }

    // 2. Find the matching file by filename (decoded, handles URL-encoded names)
    const decodedFilename = decodeURIComponent(filename);
    const file = files.find(
      (f) => path.basename(f.name) === decodedFilename || f.name === decodedFilename,
    );
    if (!file) {
      throw new NotFoundException(`File "${filename}" not found in task ${taskId}`);
    }

    // 3. Stream COS → NestJS → Browser
    try {
      const upstream = await axios.get(file.url, { responseType: 'stream', proxy: false });
      const ext = path.extname(decodedFilename).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.pdf': 'application/pdf', '.txt': 'text/plain',
        '.py': 'text/x-python', '.js': 'text/javascript',
        '.zip': 'application/zip',
      };
      const contentType = mimeMap[ext] ?? 'application/octet-stream';
      const encodedName = encodeURIComponent(decodedFilename);

      res.set({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'Content-Length': upstream.headers['content-length'] ?? '',
        'Cache-Control': 'no-cache',
      });

      upstream.data.pipe(res);
    } catch (err: any) {
      this.logger.error(`[proxyDownload] Failed to stream file: ${err.message}`);
      throw new ServiceUnavailableException('文件下载失败，请重试');
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private handleWorkerError(err: any, context: string): never {
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      this.logger.error(`[${context}] Worker unreachable: ${err.message}`);
      throw new ServiceUnavailableException(
        'AI 服务暂时不可用，请稍后重试',
      );
    }
    if (err.response?.status === 400) {
      throw new BadRequestException(err.response.data?.message || '请求参数错误');
    }
    this.logger.error(`[${context}] Worker error: ${err.message}`);
    throw new ServiceUnavailableException('AI 服务请求失败');
  }

  /**
   * Proxy SSE log stream from codex-worker to the browser.
   * Sets up proper SSE headers and pipes the upstream response directly.
   */
  async proxyLogStream(taskId: string, res: Response) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering for SSE
    });
    res.flushHeaders();

    try {
      const baseURL = this.config.get<string>(
        'CODEX_WORKER_URL',
        'http://43.130.240.106:3100',
      );
      const apiKey = this.config.get<string>('CODEX_WORKER_API_KEY', '');

      const upstream = await axios.get(
        `${baseURL}/api/tasks/${taskId}/logs/stream`,
        {
          responseType: 'stream',
          timeout: 0, // No timeout for SSE
          headers: {
            Accept: 'text/event-stream',
            ...(apiKey ? { 'X-API-Key': apiKey } : {}),
          },
        },
      );

      // Pipe upstream SSE directly to the client
      upstream.data.pipe(res);

      // Clean up when client disconnects
      res.on('close', () => {
        upstream.data.destroy();
      });
    } catch (err: any) {
      this.logger.error(`[proxyLogStream] Failed for task ${taskId}: ${err.message}`);
      // Write an error event and close
      res.write(`data: ${JSON.stringify({ error: 'Failed to connect to log stream' })}\n\n`);
      res.end();
    }
  }
}
