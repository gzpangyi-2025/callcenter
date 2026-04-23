import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReportService } from '../src/modules/report/report.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const reportService = app.get(ReportService);
  try {
      const stats = await reportService.getCategoryStats();
      console.log("ACTUAL GET CATEGORY STATS:", stats);
  } catch(err) {
      console.log("ERROR IN GET CATEGORY STATS:", err);
  }
  await app.close();
}
bootstrap();
