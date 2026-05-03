import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UnauthorizedException,
  ParseIntPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import {
  AllowExternalAccess,
  Permissions,
} from '../auth/permissions.decorator';
import { BbsService } from './bbs.service';
import type { AuthenticatedUser } from '../../common/types/auth.types';

/** 从 Express Request 中提取经过 JWT 认证的用户信息 */
const getUser = (req: { user?: unknown }): AuthenticatedUser =>
  req.user as AuthenticatedUser;

/** 判断用户是否可以绕过所有权检查（admin 或拥有指定权限） */
const canBypassOwnership = (
  user: AuthenticatedUser,
  permissionCode: string,
): boolean => {
  const isAdmin = user.role?.name === 'admin';
  const hasPerm = user.role?.permissions?.some(
    (p) => `${p.resource}:${p.action}` === permissionCode,
  );
  return isAdmin || !!hasPerm;
};

// ───────── DTO 定义 ─────────

interface CreateSectionDto {
  name: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

interface UpdateSectionDto {
  name?: string;
  icon?: string;
  description?: string;
  sortOrder?: number;
}

interface CreateTagDto {
  name: string;
  color?: string;
}

interface CreatePostDto {
  title: string;
  content: string;
  tags?: string[];
  sectionId?: number;
}

interface UpdatePostDto {
  title?: string;
  content?: string;
  tags?: string[];
  sectionId?: number;
}

interface MigratePostsDto {
  ids: number[];
  targetSectionId: number;
}

@Controller('bbs')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class BbsController {
  constructor(private readonly bbsService: BbsService) {}

  // ───────── 板块路由 ─────────
  @Get('sections')
  @Permissions('bbs:read')
  findAllSections() {
    return this.bbsService.findAllSections();
  }

  @Post('sections')
  @Permissions('bbs:edit')
  createSection(@Body() body: CreateSectionDto) {
    return this.bbsService.createSection(body);
  }

  @Put('sections/:id')
  @Permissions('bbs:edit')
  updateSection(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSectionDto,
  ) {
    return this.bbsService.updateSection(id, body);
  }

  @Delete('sections/:id')
  @Permissions('bbs:delete')
  removeSection(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.removeSection(id);
  }

  // ───────── 预设标签路由 ─────────
  @Get('tags')
  @Permissions('bbs:read')
  findAllTags() {
    return this.bbsService.findAllTags();
  }

  @Post('tags')
  @Permissions('bbs:edit')
  createTag(@Body() body: CreateTagDto) {
    return this.bbsService.createTag(body);
  }

  @Delete('tags/:id')
  @Permissions('bbs:delete')
  removeTag(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.removeTag(id);
  }

  // ───────── 帖子迁移 ─────────
  @Put('posts/migrate')
  @Permissions('bbs:edit')
  migrateToSection(@Body() body: MigratePostsDto) {
    return this.bbsService.migrateToSection(body.ids, body.targetSectionId);
  }

  // ───────── 帖子路由 ─────────
  @Get('posts')
  @Permissions('bbs:read')
  findAll(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('tag') tag: string,
    @Query('search') search: string,
    @Query('sortBy') sortBy: string,
    @Query('status') status: string,
    @Query('sectionId') sectionId: string,
  ) {
    return this.bbsService.findAll(
      Number(page) || 1,
      Number(pageSize) || 20,
      tag,
      search,
      sortBy,
      status,
      sectionId ? Number(sectionId) : undefined,
    );
  }

  @Get('posts/:id')
  @Permissions('bbs:read')
  @AllowExternalAccess('bbs')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    if (user.role?.name === 'external') {
      // 外部用户仅能查看被分享的帖子（bbsId 保存在 JWT payload 中）
      const bbsId = (user as AuthenticatedUser & { bbsId?: number }).bbsId;
      if (bbsId !== id) {
        throw new UnauthorizedException('无权访问该论坛帖子');
      }
    }
    const post = await this.bbsService.findOne(id);
    await this.bbsService.incrementView(id);
    return post;
  }

  @Post('posts/:id/share')
  @Permissions('bbs:read')
  async generateShareToken(@Param('id', ParseIntPipe) id: number) {
    const token = await this.bbsService.generateShareToken(id);
    return { token };
  }

  @Post('posts')
  @Permissions('bbs:create')
  create(@Body() body: CreatePostDto, @Request() req: { user?: unknown }) {
    return this.bbsService.create(body, getUser(req).id);
  }

  @Put('posts/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePostDto,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    return this.bbsService.update(
      id,
      body,
      user.id,
      canBypassOwnership(user, 'bbs:edit'),
    );
  }

  @Delete('posts/batch')
  batchRemove(@Body('ids') ids: number[], @Request() req: { user?: unknown }) {
    const user = getUser(req);
    return this.bbsService.batchRemove(
      ids,
      user.id,
      canBypassOwnership(user, 'bbs:delete'),
    );
  }

  @Delete('posts/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    return this.bbsService.remove(
      id,
      user.id,
      canBypassOwnership(user, 'bbs:delete'),
    );
  }

  @Put('posts/:id/pin')
  @Permissions('bbs:edit')
  togglePin(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.togglePin(id);
  }

  @Put('posts/:id/archive')
  @Permissions('bbs:edit')
  archive(@Param('id', ParseIntPipe) id: number) {
    return this.bbsService.archive(id);
  }

  @Get('posts/:id/comments')
  @Permissions('bbs:read')
  @AllowExternalAccess('bbs')
  getComments(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    const user = getUser(req);
    if (user.role?.name === 'external' && user.bbsId !== id) {
      throw new UnauthorizedException('无权访问该论坛帖子的评论');
    }
    return this.bbsService.getComments(id);
  }

  @Post('posts/:id/comments')
  @Permissions('bbs:comment')
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body('content') content: string,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.addComment(id, content, getUser(req).id);
  }

  // ───────── 订阅及通知 API ─────────
  @Get('notifications')
  @Permissions('bbs:read')
  getNotifications(@Request() req: { user?: unknown }) {
    return this.bbsService.getUnreadNotifications(getUser(req).id);
  }

  @Post('posts/:id/subscribe')
  @Permissions('bbs:read')
  subscribe(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.subscribe(id, getUser(req).id);
  }

  @Delete('posts/:id/subscribe')
  @Permissions('bbs:read')
  unsubscribe(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.unsubscribe(id, getUser(req).id);
  }

  @Get('posts/:id/subscribe')
  @Permissions('bbs:read')
  getSubscriptionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.getSubscriptionStatus(id, getUser(req).id);
  }

  @Post('posts/:id/clearUnread')
  @Permissions('bbs:read')
  clearUnread(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user?: unknown },
  ) {
    return this.bbsService.clearUnread(id, getUser(req).id);
  }
}
