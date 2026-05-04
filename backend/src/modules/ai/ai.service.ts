// ─────────────────────────────────────────────────────────────────────────────
//  AI Service — forwards requests to the codex-worker sidecar service
// ─────────────────────────────────────────────────────────────────────────────
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface CreateAiTaskDto {
  type: string;
  params: Record<string, unknown>;
  prompt?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly worker: AxiosInstance;

  constructor(private readonly config: ConfigService) {
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
      const res = await this.worker.post('/api/tasks', {
        ...dto,
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
}
