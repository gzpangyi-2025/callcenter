import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: Record<string, string> = {};

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    const rows = await this.settingRepository.find();
    this.cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** 获取所有配置，以 key-value 对象返回 */
  async getAll(): Promise<Record<string, string>> {
    return this.cache;
  }

  /** 批量保存（upsert）一组 key-value */
  async saveMany(data: Record<string, string>): Promise<void> {
    const entries = Object.entries(data).filter(
      ([, v]) => v !== undefined && v !== null,
    );
    for (const [key, value] of entries) {
      await this.settingRepository.save({ key, value: String(value) });
    }
    await this.refreshCache();
  }

  /** 获取单个 key */
  async get(key: string): Promise<string | null> {
    return this.cache[key] ?? null;
  }

  /** 设置单个 key */
  async set(key: string, value: string): Promise<void> {
    await this.settingRepository.save({ key, value });
    await this.refreshCache();
  }
}
