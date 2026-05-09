import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { ExtUsersController } from './ext-users.controller';
import { ExtUsersService } from './ext-users.service';
import { ExtTicketsController } from './ext-tickets.controller';
import { ExtTicketsService } from './ext-tickets.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Ticket])],
  controllers: [ExtUsersController, ExtTicketsController],
  providers: [ExtUsersService, ExtTicketsService],
})
export class ExtModule {}
