// ─────────────────────────────────────────────────────────────────────────────
//  AI Controller — REST endpoints exposed to the CallCenter frontend
//  All routes require JWT auth + ai:access permission
// ─────────────────────────────────────────────────────────────────────────────
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  Delete,
} from '@nestjs/common';
import * as express from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permissions } from '../auth/permissions.decorator';
import { AiService } from './ai.service';
import { AiChatService } from './ai-chat.service';
import type { AuthenticatedRequest } from '../../common/types/auth.types';

import { IsString, IsObject, IsOptional } from 'class-validator';

export class CreateAiTaskDto {
  @IsString()
  type!: string;

  @IsObject()
  params!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  prompt?: string;
}

@Controller('ai')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
@Permissions('ai:access')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiChatService: AiChatService,
  ) {}

  /** GET /api/ai/health — Codex Worker 健康检查 */
  @Get('health')
  workerHealth() {
    return this.aiService.workerHealth();
  }

  /** GET /api/ai/templates — 获取可用任务模板 */
  @Get('templates')
  getTemplates() {
    return this.aiService.getTemplates();
  }

  /** POST /api/ai/tasks — 提交新 AI 任务 */
  @Post('tasks')
  createTask(
    @Body() body: CreateAiTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiService.createTask(body, req.user.id);
  }

  /** GET /api/ai/tasks — 任务列表（当前用户） */
  @Get('tasks')
  listTasks(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('all') all?: string, // admin-only: list all users
  ) {
    const roleObj = req.user.role as any;
    const isAdmin = roleObj?.name === 'admin';
    
    return this.aiService.listTasks({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status: status || undefined,
      // Non-admins can only see their own tasks
      userId: isAdmin && all === '1' ? undefined : req.user.id,
    });
  }

  /** GET /api/ai/tasks/:id — 获取任务详情 */
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.aiService.getTask(id);
  }

  /** POST /api/ai/tasks/:id/cancel — 取消任务 */
  @Post('tasks/:id/cancel')
  cancelTask(@Param('id') id: string) {
    return this.aiService.cancelTask(id);
  }

  /** GET /api/ai/tasks/:id/files — 获取任务产物下载链接 */
  @Get('tasks/:id/files')
  getTaskFiles(@Param('id') id: string) {
    return this.aiService.getTaskFiles(id);
  }

  /**
   * GET /api/ai/tasks/:id/download?file=<filename>
   * 代理下载 — 通过 CallCenter 后端流转发 COS 文件。
   * 文件名通过 query parameter 传递，彻底避免 URL 路径编码问题。
   */
  @Get('tasks/:id/download')
  async downloadFile(
    @Param('id') taskId: string,
    @Query('file') filename: string,
    @Res() res: express.Response,
  ) {
    return this.aiService.proxyDownload(taskId, filename, res);
  }

  /**
   * GET /api/ai/tasks/:id/logs/stream
   * SSE 代理 — 将 codex-worker 的实时日志流转发给前端。
   */
  @Get('tasks/:id/logs/stream')
  async streamTaskLogs(
    @Param('id') taskId: string,
    @Res() res: express.Response,
  ) {
    return this.aiService.proxyLogStream(taskId, res);
  }

  // ── Chat Endpoints (Gemini Flash) ─────────────────────────────────────────

  /** POST /api/ai/chat — 发送消息 (SSE 流式返回) */
  @Post('chat')
  async chat(
    @Body() body: { sessionId?: string; message: string; images?: string[] },
    @Req() req: AuthenticatedRequest,
    @Res() res: express.Response,
  ) {
    return this.aiChatService.chatStream(
      { sessionId: body.sessionId, message: body.message, images: body.images, userId: req.user.id },
      res,
    );
  }

  /** GET /api/ai/chat/sessions — 会话列表 */
  @Get('chat/sessions')
  async chatSessions(@Req() req: AuthenticatedRequest) {
    const sessions = await this.aiChatService.listSessions(req.user.id);
    return { code: 0, data: sessions };
  }

  /** GET /api/ai/chat/sessions/:id — 会话详情（含消息） */
  @Get('chat/sessions/:id')
  async chatSessionDetail(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const session = await this.aiChatService.getSession(id, req.user.id);
    return { code: 0, data: session };
  }

  /** POST /api/ai/chat/sessions/:id/messages — 注入系统或大模型反馈消息 */
  @Post('chat/sessions/:id/messages')
  async injectMessage(
    @Param('id') id: string,
    @Body() body: { role: 'assistant' | 'system'; content: string; metadata?: any },
    @Req() req: AuthenticatedRequest,
  ) {
    const message = await this.aiChatService.injectMessage(id, req.user.id, body.role, body.content, body.metadata);
    return { code: 0, data: message };
  }

  /** DELETE /api/ai/chat/sessions/:id — 删除会话 */
  @Delete('chat/sessions/:id')
  async deleteChatSession(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.aiChatService.deleteSession(id, req.user.id);
    return { code: 0, message: '会话已删除' };
  }
}
