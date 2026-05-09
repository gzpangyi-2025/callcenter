import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ExtTicketsService, PushTicketDto } from './ext-tickets.service';
import { ServiceTokenGuard } from '../../guards/service-token.guard';

@Controller('ext/tickets')
@UseGuards(ServiceTokenGuard)
export class ExtTicketsController {
  constructor(private readonly extTicketsService: ExtTicketsService) {}

  @Post()
  async pushTicket(@Body() dto: PushTicketDto) {
    const data = await this.extTicketsService.createTicketFromOMM(dto);
    return {
      code: 0,
      message: '工单创建成功',
      data
    };
  }

  @Get(':serviceNo')
  async getTicketStatus(@Param('serviceNo') serviceNo: string) {
    const data = await this.extTicketsService.getTicketStatus(serviceNo);
    return {
      code: 0,
      data
    };
  }
}
