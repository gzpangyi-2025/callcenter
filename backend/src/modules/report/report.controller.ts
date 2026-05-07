import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import * as express from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';
import { ReportService } from './report.service';

@Controller('report')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('summary')
  // No permission required - Dashboard uses this for all users
  async getSummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getSummary(startDate, endDate);
    return { code: 0, data };
  }

  @Get('by-category')
  @Permissions('report:read')
  async getCategoryStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getCategoryStats(startDate, endDate);
    return { code: 0, data };
  }

  @Get('by-category3')
  @Permissions('report:read')
  async getCategory3Stats(
    @Query('category2') category2: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getCategory3Stats(
      category2,
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('by-category2')
  @Permissions('report:read')
  async getCategory2Stats(
    @Query('category1') category1: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getCategory2Stats(
      category1,
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('by-person')
  @Permissions('report:read')
  async getByPerson(
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getByPerson(
      limit ? parseInt(limit, 10) : undefined,
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('by-customer')
  @Permissions('report:read')
  async getByCustomer(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getByCustomer(startDate, endDate);
    return { code: 0, data };
  }

  @Get('time-series')
  @Permissions('report:read')
  async getTimeSeries(
    @Query('dimension') dimension?: 'day' | 'month' | 'quarter' | 'year',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getTimeSeries(
      dimension || 'day',
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('cross-matrix')
  @Permissions('report:read')
  async getCrossMatrix(
    @Query('categoryName') categoryName: string,
    @Query('level') level?: 'category2' | 'category3',
    @Query('limit') limit?: string,
    @Query('parentCategory') parentCategory?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.getCrossMatrix(
      categoryName,
      level || 'category2',
      limit ? parseInt(limit, 10) : 8,
      parentCategory,
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('drill/person-tickets')
  @Permissions('report:read')
  async drillPersonTickets(
    @Query('userId') userId: string,
    @Query('role') role: string,
    @Query('categoryName') categoryName?: string,
    @Query('categoryLevel') categoryLevel?: 'category2' | 'category3',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.drillPersonTickets(
      parseInt(userId, 10),
      role as 'creator' | 'assignee' | 'participant',
      categoryName,
      categoryLevel || 'category3',
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('drill/customer-tickets')
  @Permissions('report:read')
  async drillCustomerTickets(
    @Query('customerName') customerName: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.reportService.drillCustomerTickets(
      customerName,
      startDate,
      endDate,
    );
    return { code: 0, data };
  }

  @Get('export-xlsx')
  @Permissions('report:read')
  async exportXlsx(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Res() res: express.Response,
  ) {
    const buffer = await this.reportService.exportAllTickets(
      startDate,
      endDate,
    );
    const filename = encodeURIComponent(
      `工单数据导出_${startDate || '全部'}_${endDate || '至今'}.xlsx`,
    );
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
