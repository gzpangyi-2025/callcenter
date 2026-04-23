import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReportService } from '../src/modules/report/report.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const reportService = app.get(ReportService);
  const sum = await reportService.getSummary();
  console.log("ACTUAL GET SUMMARY OUTPUT:", sum);
  
  const cat2 = await reportService.getCategory2Stats('网络安全');
  console.log("ACTUAL GET CAT 2 OUTPUT:", cat2);
  
  const cross = await reportService.getCrossMatrix('网络安全', 'category2', 5);
  console.log("ACTUAL GET CROSS MATRIX OUTPUT:", JSON.stringify(cross, null, 2));

  await app.close();
}
bootstrap();
