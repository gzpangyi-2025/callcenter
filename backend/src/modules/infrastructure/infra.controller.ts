import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InfraService } from './infra.service';
import { SearchService } from '../search/search.service';

@Controller('infra')
@UseGuards(AuthGuard('jwt'))
export class InfraController {
  constructor(
    private readonly infraService: InfraService,
    private readonly searchService: SearchService,
  ) {}

  @Get('env')
  getEnv() {
    return {
      code: 0,
      data: {
        config: this.infraService.getEnvConfig(),
        path: this.infraService.getEnvPath(),
      },
    };
  }

  @Post('env')
  async saveEnv(@Body() data: Record<string, string>) {
    await this.infraService.updateEnvConfig(data);
    return { code: 0, message: '配置已保存' };
  }

  @Post('restart')
  async restart() {
    const result = await this.infraService.restartService();
    if (result.success) {
      return { code: 0, message: '系统将在1秒后重启' };
    }
    return { code: 1, message: result.message };
  }

  @Post('test-es')
  async testEs(
    @Body()
    data: {
      node: string;
      username?: string;
      password?: string;
      rejectUnauthorized?: string;
    },
  ) {
    const result = await this.infraService.testElasticsearch(data);
    return { code: result.success ? 0 : 1, message: result.message };
  }

  @Post('test-redis')
  async testRedis(
    @Body() data: { host: string; port: number; password?: string },
  ) {
    const result: any = await this.infraService.testRedis(data);
    return { code: result.success ? 0 : 1, message: result.message };
  }

  @Post('test-mysql')
  async testMysql(
    @Body()
    data: {
      host: string;
      port: number;
      username: string;
      password?: string;
      database: string;
    },
  ) {
    const result = await this.infraService.testMysql(data);
    return { code: result.success ? 0 : 1, message: result.message };
  }

  @Post('rebuild-index')
  async rebuildIndex() {
    const result = await this.searchService.syncAll();
    return { code: 0, message: '索引重建成功', data: result };
  }
}
