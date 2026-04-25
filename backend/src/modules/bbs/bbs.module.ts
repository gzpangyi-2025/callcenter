import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BbsController } from './bbs.controller';
import { BbsService } from './bbs.service';
import { Post } from '../../entities/post.entity';
import { PostComment } from '../../entities/post-comment.entity';
import { BbsSection } from '../../entities/bbs-section.entity';
import { BbsTag } from '../../entities/bbs-tag.entity';
import { BbsSubscription } from '../../entities/bbs-subscription.entity';
import { SearchModule } from '../search/search.module';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Post,
      PostComment,
      BbsSection,
      BbsTag,
      BbsSubscription,
    ]),
    SearchModule,
    AuthModule,
    ChatModule,
    FilesModule,
  ],
  controllers: [BbsController],
  providers: [BbsService],
})
export class BbsModule {}
