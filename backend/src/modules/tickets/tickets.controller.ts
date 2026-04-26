import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  ParseIntPipe,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { TicketsService } from './tickets.service';
import { TicketsExportService } from './tickets-export.service';
import { CreateTicketDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketStatus } from '../../entities/ticket.entity';
import type { AuthenticatedUser } from '../../common/types/auth.types';

/** 从 Express Request 中提取经过 JWT 认证的用户信息 */
const getUser = (req: { user?: unknown }): AuthenticatedUser =>
  req.user as AuthenticatedUser;

@Controller('tickets')
@UseGuards(AuthGuard('jwt'), RolesGuard, PermissionsGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly ticketsExportService: TicketsExportService,
  ) {}

  @Post()
  @Permissions('tickets:create')
  async create(@Body() createDto: CreateTicketDto, @Req() req: any) {
    const ticket = await this.ticketsService.create(createDto, getUser(req).id);
    return { code: 0, message: '工单创建成功', data: ticket };
  }

  @Get()
  @Permissions('tickets:read')
  async findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.findAll({
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 10,
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('test-reload')
  @Permissions('admin:access')
  async testReload() {
    return { code: 0, message: 'PM2 Reload Successful!' };
  }

  @Get('aggregates')
  @Permissions('tickets:read')
  async getAggregates(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: TicketStatus,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('isDashboard') isDashboard?: string,
    @Query('category1') category1?: string,
    @Query('category2') category2?: string,
    @Query('category3') category3?: string,
    @Query('customerName') customerName?: string,
    @Query('creatorId') creatorId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    const result = await this.ticketsService.getAggregates({
      status,
      type,
      keyword,
      category1,
      category2,
      category3,
      customerName,
      creatorId: creatorId ? parseInt(creatorId) : undefined,
      assigneeId: assigneeId ? parseInt(assigneeId) : undefined,
      isDashboard: isDashboard === 'true',
    });
    return { code: 0, data: result };
  }

  @Get('my/badges')
  @Permissions('tickets:read')
  async getMyBadges(@Req() req: any) {
    const data = await this.ticketsService.getMyBadges(getUser(req).id);
    return { code: 0, data };
  }

  @Post('batch/summary')
  @Permissions('tickets:read')
  async getBatchSummary(@Body('ids') ids: number[]) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { code: 0, data: [] };
    }
    const data = await this.ticketsService.getBatchSummary(ids);
    return { code: 0, data };
  }

  @Get('my/created')
  @Permissions('tickets:read')
  async myCreated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'creator',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/assigned')
  @Permissions('tickets:read')
  async myAssigned(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'assignee',
    );
    return { code: 0, data: tickets };
  }

  @Get('my/participated')
  @Permissions('tickets:read')
  async myParticipated(@Req() req: any) {
    const tickets = await this.ticketsService.getMyTickets(
      getUser(req).id,
      'participant',
    );
    return { code: 0, data: tickets };
  }

  @Get(':id')
  @Permissions('tickets:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (getUser(req).role?.name === 'external' && req.user.ticketId !== id) {
      throw new ForbiddenException('外部用户无权访问此工单');
    }
    const ticket = await this.ticketsService.findOne(id);
    return { code: 0, data: ticket };
  }

  @Get('no/:ticketNo')
  @Permissions('tickets:read')
  async findByNo(@Param('ticketNo') ticketNo: string) {
    const ticket = await this.ticketsService.findByTicketNo(ticketNo);
    return { code: 0, data: ticket };
  }

  @Put(':id')
  @Permissions('tickets:read') // 基础权限检查；底层 service 会根据创建人或 tickets:edit 权限决定是否放行
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateTicketDto,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.update(
      id,
      updateDto,
      getUser(req),
    );
    return { code: 0, message: '工单更新成功', data: ticket };
  }

  @Post(':id/read')
  @Permissions('tickets:read')
  async readTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (typeof getUser(req).id === 'string') {
      return { code: 0, message: 'external user skipped' };
    }
    await this.ticketsService.readTicket(id, getUser(req).id);
    return { code: 0, message: 'success' };
  }

  @Post(':id/assign')
  @Permissions('tickets:assign')
  async assign(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.assign(id, getUser(req).id);
    return { code: 0, message: '接单成功', data: ticket };
  }

  @Post(':id/request-close')
  @Permissions('tickets:assign')
  async requestClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.requestClose(id, getUser(req).id);
    return { code: 0, message: '已申请关单，等待创建者确认', data: ticket };
  }

  @Post(':id/confirm-close')
  @Permissions('tickets:read')
  async confirmClose(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const ticket = await this.ticketsService.confirmClose(id, getUser(req).id);
    return { code: 0, message: '工单已关闭', data: ticket };
  }

  @Delete('batch')
  @Permissions('tickets:delete')
  async deleteBatch(@Body('ids') ids: number[], @Req() req: any) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { code: -1, message: '请求参数错误，未提供有效的 IDs' };
    }
    await this.ticketsService.batchDelete(ids, getUser(req));
    return { code: 0, message: `成功删除了 ${ids.length} 条工单` };
  }

  @Delete(':id')
  @Permissions('tickets:delete')
  async deleteTicket(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    await this.ticketsService.deleteTicket(id, getUser(req));
    return { code: 0, message: '工单已删除' };
  }

  @Post(':id/share')
  @Permissions('tickets:share')
  async generateShareLink(
    @Param('id', ParseIntPipe) id: number,
    @Req() _req: any,
  ) {
    const token = await this.ticketsService.generateShareToken(id);
    return { code: 0, message: '分享外链生成成功', data: { token } };
  }

  @Post(':id/invite')
  @Permissions('tickets:read')
  async inviteParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Body('userId') targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.inviteParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '邀请成功', data: ticket };
  }

  @Delete(':id/participants/:userId')
  @Permissions('tickets:read')
  async removeParticipant(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.removeParticipant(
      id,
      getUser(req).id,
      targetUserId,
    );
    return { code: 0, message: '专家已移除', data: ticket };
  }

  @Post(':id/room-lock')
  @Permissions('tickets:read')
  async toggleRoomLock(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { locked: boolean; disableExternal?: boolean },
    @Req() req: any,
  ) {
    const ticket = await this.ticketsService.toggleRoomLock(
      id,
      getUser(req).id,
      body.locked,
      !!body.disableExternal,
    );
    return {
      code: 0,
      message: body.locked ? '房间已锁定' : '房间已解锁',
      data: ticket,
    };
  }

  @Get(':id/export-chat-zip')
  @Permissions('tickets:read')
  async exportChatZip(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出聊天记录');
    }
    await this.ticketsExportService.exportChatZip(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }

  @Get(':id/export-report')
  @Permissions('tickets:read')
  async exportReport(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
    @Res() res: Response,
  ) {
    if (getUser(req).role?.name === 'external') {
      throw new ForbiddenException('外部用户无权导出报告');
    }
    await this.ticketsExportService.exportReport(
      id,
      getUser(req).id,
      getUser(req).role?.name || '',
      res,
    );
  }
}
