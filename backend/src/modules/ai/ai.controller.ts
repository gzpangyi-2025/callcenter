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
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permissions } from '../auth/permissions.decorator';
import { AiService } from './ai.service';
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
  constructor(private readonly aiService: AiService) {}

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
   * GET /api/ai/tasks/:id/files/*/download
   * 代理下载 — 通过 CallCenter 后端流转发 COS 文件。
   * 使用通配符路由捕获包含 '/' 的文件名（如 subdir/file.png）。
   */
  @Get('tasks/:id/files/*/download')
  async downloadFile(
    @Param('id') taskId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Express stores the wildcard match in req.params[0]
    const filename = (req.params as any)[0] as string;
    return this.aiService.proxyDownload(taskId, filename, res);
  }
}
