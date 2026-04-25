import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketsExportService } from './tickets-export.service';
import { Ticket } from '../../entities/ticket.entity';
import { TicketReadState } from '../../entities/ticket-read-state.entity';
import { Message } from '../../entities/message.entity';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { User } from '../../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, User, TicketReadState, Message]),
    ChatModule, // 引入 ChatModule 以获得 ChatGateway 实例
    AuthModule,
    FilesModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsExportService],
  exports: [TicketsService, TicketsExportService],
})
export class TicketsModule {}
