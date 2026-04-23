import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  /** 获取所有配置，以 key-value 对象返回 */
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.settingRepository.find();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** 批量保存（upsert）一组 key-value */
  async saveMany(data: Record<string, string>): Promise<void> {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);
    for (const [key, value] of entries) {
      await this.settingRepository.save({ key, value: String(value) });
    }
  }

  /** 获取单个 key */
  async get(key: string): Promise<string | null> {
    const row = await this.settingRepository.findOne({ where: { key } });
    return row?.value ?? null;
  }

  /** 设置单个 key */
  async set(key: string, value: string): Promise<void> {
    await this.settingRepository.save({ key, value });
  }
}
