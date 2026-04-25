import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { SearchModule } from '../search/search.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [SearchModule, FilesModule],
  providers: [BackupService],
  controllers: [BackupController],
})
export class BackupModule {}
