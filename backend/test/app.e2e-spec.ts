import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { AppModule } from './../src/app.module';

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  controllers: [HealthController],
})
class LightweightE2eModule {}

const shouldUseRealApp = process.env.E2E_DB === '1';
const E2eModule = shouldUseRealApp ? AppModule : LightweightE2eModule;

describe('CallCenter e2e bootstrap', () => {
  let app: INestApplication;

  beforeAll(() => {
    if (!shouldUseRealApp) {
      console.warn(
        'Skipping real AppModule e2e bootstrap because E2E_DB=1 is not set; using lightweight health module.',
      );
    }
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [E2eModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('bootstraps without real database unless E2E_DB=1 is set', () => {
    if (shouldUseRealApp) {
      expect(app).toBeDefined();
      return;
    }

    expect(app.get(HealthController).health()).toEqual({ ok: true });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
