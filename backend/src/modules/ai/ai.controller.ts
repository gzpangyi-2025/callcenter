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
import { AuditService } from '../audit/audit.service';
import { AuditType } from '../../entities/audit-log.entity';
import type { AuthenticatedRequest } from '../../common/types/auth.types';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { User } from '../../entities/user.entity';

import { IsString, IsObject, IsOptional } from 'class-validator';

export class CreateAiTaskDto {
  @IsString()
  type!: string;

  @IsObject()
  params!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  attachments?: Array<{ name: string; url: string; size: number }>;

  @IsOptional()
  @IsString()
  reviewMode?: 'review' | 'auto';

  @IsOptional()
  @IsString()
  parentTaskId?: string;
}

@Controller('ai')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
@Permissions('ai:access')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiChatService: AiChatService,
    private readonly auditService: AuditService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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
  async createTask(
    @Body() body: CreateAiTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.aiService.createTask(body, req.user.id);
    // 审计日志
    this.auditService.log({
      type: AuditType.AI_TASK,
      action: body.parentTaskId ? 'modify_task' : 'create_task',
      userId: req.user.id,
      username: req.user.username ?? req.user.realName ?? null,
      targetName: body.type,
      detail: body.parentTaskId
        ? `增量修改任务，父任务: ${body.parentTaskId}`
        : `提交AI任务 [${body.type}]，模式: ${body.reviewMode ?? 'auto'}`,
      ip: req.ip ?? null,
    });
    return result;
  }

  /** GET /api/ai/tasks — 任务列表（当前用户） */
  @Get('tasks')
  async listTasks(
    @Req() req: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('all') all?: string,
  ) {
    const roleObj = req.user.role as any;
    const isAdmin = roleObj?.name === 'admin';
    const showAll = isAdmin && all === '1';

    const result = await this.aiService.listTasks({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status: status || undefined,
      userId: showAll ? undefined : req.user.id,
    });

    // Enrich with creator names when admin views all
    if (showAll && result?.data?.length > 0) {
      const userIds = [...new Set(result.data.map((t: any) => t.userId).filter(Boolean))];
      if (userIds.length > 0) {
        const users = await this.userRepo.find({ where: { id: In(userIds) }, select: ['id', 'username', 'realName', 'displayName'] });
        const userMap = new Map(users.map(u => [u.id, u.realName || u.displayName || u.username]));
        for (const task of result.data) {
          task.creatorName = task.userId ? userMap.get(task.userId) ?? `用户#${task.userId}` : '-';
        }
      }
    }

    return result;
  }

  /** GET /api/ai/tasks/:id — 获取任务详情 */
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.aiService.getTask(id);
  }

  /** POST /api/ai/tasks/:id/cancel — 取消任务 */
  @Post('tasks/:id/cancel')
  async cancelTask(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const result = await this.aiService.cancelTask(id);
    this.auditService.log({
      type: AuditType.AI_TASK,
      action: 'cancel_task',
      userId: req.user.id,
      username: req.user.username ?? req.user.realName ?? null,
      targetName: id,
      detail: `取消AI任务 ${id}`,
      ip: req.ip ?? null,
    });
    return result;
  }

  /** DELETE /api/ai/tasks/:id — 删除任务及COS文件 */
  @Delete('tasks/:id')
  async deleteTask(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const result = await this.aiService.deleteTask(id);
    this.auditService.log({
      type: AuditType.AI_TASK,
      action: 'delete_task',
      userId: req.user.id,
      username: req.user.username ?? req.user.realName ?? null,
      targetName: id,
      detail: `删除AI任务 ${id}（COS文件已清理）`,
      ip: req.ip ?? null,
    });
    return result;
  }

  /** POST /api/ai/tasks/:id/resume — 继续任务（审阅回复） */
  @Post('tasks/:id/resume')
  resumeTask(@Param('id') id: string, @Body('input') input: string) {
    return this.aiService.resumeTask(id, input);
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
