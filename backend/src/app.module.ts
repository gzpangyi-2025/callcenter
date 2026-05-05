import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { ChatModule } from './modules/chat/chat.module';
import { FilesModule } from './modules/files/files.module';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { Ticket } from './entities/ticket.entity';
import { Message } from './entities/message.entity';
import { Setting } from './entities/setting.entity';
import { KnowledgeDoc } from './entities/knowledge-doc.entity';
import { AuditLog } from './entities/audit-log.entity';
import { TicketCategory } from './entities/ticket-category.entity';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportModule } from './modules/report/report.module';
import { CategoryModule } from './modules/category/category.module';
import { Post } from './entities/post.entity';
import { PostComment } from './entities/post-comment.entity';
import { BbsSection } from './entities/bbs-section.entity';
import { BbsTag } from './entities/bbs-tag.entity';
import { TicketReadState } from './entities/ticket-read-state.entity';
import { BbsSubscription } from './entities/bbs-subscription.entity';
import { AiChatSession } from './entities/ai-chat-session.entity';
import { AiChatMessage } from './entities/ai-chat-message.entity';
import { BbsModule } from './modules/bbs/bbs.module';
import { SearchModule } from './modules/search/search.module';
import { BackupModule } from './modules/backup/backup.module';
import { InfraModule } from './modules/infrastructure/infra.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    // 环境变量配置
    ConfigModule.forRoot({ isGlobal: true }),

    // 数据库连接
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST') || 'localhost',
        port: parseInt(configService.get('DB_PORT') || '3306'),
        username: configService.get('DB_USERNAME') || 'root',
        password: configService.get('DB_PASSWORD') || '',
        database: configService.get('DB_DATABASE') || 'callcenter',
        entities: [
          User,
          Role,
          Permission,
          Ticket,
          Message,
          Setting,
          KnowledgeDoc,
          AuditLog,
          TicketCategory,
          Post,
          PostComment,
          BbsSection,
          BbsTag,
          TicketReadState,
          BbsSubscription,
          AiChatSession,
          AiChatMessage,
        ],
        synchronize: process.env.NODE_ENV !== 'production', // 生产环境禁用自动同步，防止数据丢失
        charset: 'utf8mb4',
        logging: process.env.NODE_ENV !== 'production',
      }),
    }),

    // 定时任务
    ScheduleModule.forRoot(),

    // 业务模块
    AuthModule,
    TicketsModule,
    ChatModule,
    FilesModule,
    UsersModule,
    RolesModule,
    SettingsModule,
    KnowledgeModule,
    AuditModule,
    ReportModule,
    CategoryModule,
    BbsModule,
    SearchModule,
    BackupModule,
    InfraModule,
    AiModule,
  ],
})
export class AppModule {}
