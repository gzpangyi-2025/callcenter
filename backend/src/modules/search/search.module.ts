import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { SearchSubscriber } from './search.subscriber';
import { Post } from '../../entities/post.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Message } from '../../entities/message.entity';
import { KnowledgeDoc } from '../../entities/knowledge-doc.entity';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const isProd = process.env.NODE_ENV === 'production';
        const node =
          configService.get(isProd ? 'ES_NODE_PROD' : 'ES_NODE') ||
          'http://localhost:9200';
        const username =
          configService.get(isProd ? 'ES_USERNAME_PROD' : 'ES_USERNAME') || '';
        const password =
          configService.get(isProd ? 'ES_PASSWORD_PROD' : 'ES_PASSWORD') || '';
        const rejectUnauthorizedStr =
          configService.get(
            isProd
              ? 'ES_TLS_REJECT_UNAUTHORIZED_PROD'
              : 'ES_TLS_REJECT_UNAUTHORIZED',
          ) || 'true';

        return {
          node,
          auth: username && password ? { username, password } : undefined,
          tls: {
            rejectUnauthorized: rejectUnauthorizedStr === 'true',
          },
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Post, Ticket, Message, KnowledgeDoc]),
  ],
  providers: [SearchService, SearchSubscriber],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
