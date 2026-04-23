import { Module } from '@nestjs/common';
import { InfraService } from './infra.service';
import { InfraController } from './infra.controller';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  providers: [InfraService],
  controllers: [InfraController],
})
export class InfraModule {}
