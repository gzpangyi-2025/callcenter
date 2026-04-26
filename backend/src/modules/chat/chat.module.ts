import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ScreenShareService } from './screen-share.service';
import { VoiceService } from './voice.service';
import { RoomService } from './room.service';
import { Message } from '../../entities/message.entity';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { Setting } from '../../entities/setting.entity';
import { SearchModule } from '../search/search.module';
import { SettingsModule } from '../settings/settings.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, User, Ticket, Setting]),
    SettingsModule,
    FilesModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
    }),
    SearchModule,
  ],
  providers: [
    ChatGateway,
    ChatService,
    ScreenShareService,
    VoiceService,
    RoomService,
  ],
  exports: [ChatService, ChatGateway, ScreenShareService],
})
export class ChatModule {}
