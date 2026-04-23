import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { BbsService } from './bbs.service';

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
  createSection(@Body() body: any) {
    return this.bbsService.createSection(body);
  }

  @Put('sections/:id')
  @Permissions('bbs:edit')
  updateSection(@Param('id') id: string, @Body() body: any) {
    return this.bbsService.updateSection(Number(id), body);
  }

  @Delete('sections/:id')
  @Permissions('bbs:delete')
  removeSection(@Param('id') id: string) {
    return this.bbsService.removeSection(Number(id));
  }

  // ───────── 预设标签路由 ─────────
  @Get('tags')
  @Permissions('bbs:read')
  findAllTags() {
    return this.bbsService.findAllTags();
  }

  @Post('tags')
  @Permissions('bbs:edit')
  createTag(@Body() body: any) {
    return this.bbsService.createTag(body);
  }

  @Delete('tags/:id')
  @Permissions('bbs:delete')
  removeTag(@Param('id') id: string) {
    return this.bbsService.removeTag(Number(id));
  }

  // ───────── 帖子迁移 ─────────
  @Put('posts/migrate')
  @Permissions('bbs:edit')
  migrateToSection(@Body() body: { ids: number[]; targetSectionId: number }) {
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
  async findOne(@Param('id') id: string, @Request() req: any) {
    if (req.user?.role === 'external' || req.user?.role?.name === 'external') {
       if (Number(req.user.bbsId) !== Number(id)) {
           throw new UnauthorizedException('无权访问该论坛帖子');
       }
    }
    const post = await this.bbsService.findOne(Number(id));
    await this.bbsService.incrementView(Number(id));
    return post;
  }

  @Post('posts/:id/share')
  @Permissions('bbs:read')
  async generateShareToken(@Param('id') id: string) {
    const token = await this.bbsService.generateShareToken(Number(id));
    return { token };
  }

  @Post('posts')
  @Permissions('bbs:create')
  create(@Body() body: any, @Request() req: any) {
    return this.bbsService.create(body, req.user.id);
  }

  @Put('posts/:id')
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    const hasEditPerm = req.user.role?.permissions?.some((p: any) => `${p.resource}:${p.action}` === 'bbs:edit');
    const canBypass = req.user.role?.name === 'admin' || req.user.username === 'admin' || hasEditPerm;
    return this.bbsService.update(Number(id), body, req.user.id, canBypass);
  }

  @Delete('posts/batch')
  batchRemove(@Body('ids') ids: number[], @Request() req: any) {
    const hasDeletePerm = req.user.role?.permissions?.some((p: any) => `${p.resource}:${p.action}` === 'bbs:delete');
    const canBypass = req.user.role?.name === 'admin' || req.user.username === 'admin' || hasDeletePerm;
    return this.bbsService.batchRemove(ids, req.user.id, canBypass);
  }

  @Delete('posts/:id')
  remove(@Param('id') id: string, @Request() req: any) {
    const hasDeletePerm = req.user.role?.permissions?.some((p: any) => `${p.resource}:${p.action}` === 'bbs:delete');
    const canBypass = req.user.role?.name === 'admin' || req.user.username === 'admin' || hasDeletePerm;
    return this.bbsService.remove(Number(id), req.user.id, canBypass);
  }

  @Put('posts/:id/pin')
  @Permissions('bbs:edit')
  togglePin(@Param('id') id: string) {
    return this.bbsService.togglePin(Number(id));
  }

  @Put('posts/:id/archive')
  @Permissions('bbs:edit')
  archive(@Param('id') id: string) {
    return this.bbsService.archive(Number(id));
  }

  @Get('posts/:id/comments')
  @Permissions('bbs:read')
  getComments(@Param('id') id: string) {
    return this.bbsService.getComments(Number(id));
  }

  @Post('posts/:id/comments')
  @Permissions('bbs:comment')
  addComment(@Param('id') id: string, @Body('content') content: string, @Request() req: any) {
    return this.bbsService.addComment(Number(id), content, req.user.id);
  }

  // ───────── 订阅及通知 API ─────────
  @Get('notifications')
  @Permissions('bbs:read')
  getNotifications(@Request() req: any) {
    return this.bbsService.getUnreadNotifications(req.user.id);
  }

  @Post('posts/:id/subscribe')
  @Permissions('bbs:read')
  subscribe(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.subscribe(Number(id), req.user.id);
  }

  @Delete('posts/:id/subscribe')
  @Permissions('bbs:read')
  unsubscribe(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.unsubscribe(Number(id), req.user.id);
  }

  @Get('posts/:id/subscribe')
  @Permissions('bbs:read')
  getSubscriptionStatus(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.getSubscriptionStatus(Number(id), req.user.id);
  }

  @Post('posts/:id/clearUnread')
  @Permissions('bbs:read')
  clearUnread(@Param('id') id: string, @Request() req: any) {
    return this.bbsService.clearUnread(Number(id), req.user.id);
  }
}

