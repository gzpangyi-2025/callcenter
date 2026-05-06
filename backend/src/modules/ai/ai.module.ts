// ─────────────────────────────────────────────────────────────────────────────
//  AI Module — proxy to codex-worker + Gemini Flash chat dispatcher
// ─────────────────────────────────────────────────────────────────────────────
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiChatService } from './ai-chat.service';
import { AiChatSession } from '../../entities/ai-chat-session.entity';
import { AiChatMessage } from '../../entities/ai-chat-message.entity';
import { User } from '../../entities/user.entity';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiChatSession, AiChatMessage, User]),
    SettingsModule,
    FilesModule,
  ],
  providers: [AiService, AiChatService],
  controllers: [AiController],
})
export class AiModule {}
