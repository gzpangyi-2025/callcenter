import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import * as express from 'express';

import { NestExpressApplication } from '@nestjs/platform-express';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const logger = new Logger('Bootstrap');

// 开启全局代理：自动读取环境中的 HTTP_PROXY / HTTPS_PROXY，不硬编码端口
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
  const envProxy = new EnvHttpProxyAgent();
  setGlobalDispatcher(envProxy);
  logger.log('🌐 Proxy Agent dynamically configured for global fetch.');
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 信任反向代理，让 req.ip 自动解析 X-Forwarded-For 获取客户端真实验互联网 IP
  app.set('trust proxy', 1);

  // 全局前缀
  app.setGlobalPrefix('api');

  // 配置默认的载荷限制（解决 413 Payload Too Large 问题）
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 全局异常拦截器
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Cookie解析
  app.use(cookieParser());

  // 静态文件服务（Logo 等上传文件）
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  // CORS配置
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:3001'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 CallCenter Backend running on http://localhost:${port}`);
}
bootstrap().catch((err) => {
  logger.error('❌ 启动失败:', err);
  process.exit(1);
});
