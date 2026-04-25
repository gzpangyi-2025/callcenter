import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message } from '../../entities/message.entity';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeDoc, Ticket, Message]),
    SettingsModule,
    FilesModule,
  ],
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
