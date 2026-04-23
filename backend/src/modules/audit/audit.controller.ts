import { Controller, Get, Delete, Put, Query, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from './audit.service';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';

@Controller('audit')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @Permissions('settings:read')
  async getLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.auditService.findAll({
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
      type,
      keyword,
      startDate,
      endDate,
    });
    return { code: 0, data: result };
  }

  @Delete('logs')
  @Permissions('settings:edit')
  async deleteLogs(
    @Body() body: { type?: string; startDate?: string; endDate?: string },
  ) {
    const result = await this.auditService.batchDelete(body);
    return { code: 0, data: result };
  }

  @Get('settings')
  @Permissions('settings:read')
  async getSettings() {
    const data = await this.auditService.getSettings();
    return { code: 0, data };
  }

  @Put('settings')
  @Permissions('settings:edit')
  async updateSettings(@Body() body: Record<string, boolean>) {
    const data = await this.auditService.updateSettings(body);
    return { code: 0, data };
  }
}
