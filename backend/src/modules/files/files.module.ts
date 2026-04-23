import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { FilesController } from './files.controller';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'oss'),
      serveRoot: '/api/files/static',
    }),
  ],
  controllers: [FilesController],
})
export class FilesModule {}
