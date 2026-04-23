import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { Setting } from '../../entities/setting.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Global() // 全局模块，方便其他模块直接注入 AuditService
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, Setting])],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
