import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like, In } from 'typeorm';
import { AuditLog, AuditType } from '../../entities/audit-log.entity';
import { Setting } from '../../entities/setting.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>,
  ) {}

  /**
   * 写入一条审计记录（内部自动检查开关）
   */
  async log(params: {
    type: AuditType;
    action: string;
    userId?: number | null;
    username?: string | null;
    targetId?: number | null;
    targetName?: string | null;
    detail?: string | null;
    ip?: string | null;
  }) {
    try {
      // 检查该审计类型的开关是否启用
      const settingKey = `audit.${params.type}`;
      const setting = await this.settingRepository.findOne({
        where: { key: settingKey },
      });
      // 默认开启（setting 不存在或值不为 'false' 时均视为开启）
      if (setting && setting.value === 'false') {
        return;
      }

      const log = this.auditLogRepository.create({
        type: params.type,
        action: params.action,
        userId: params.userId ?? null,
        username: params.username ?? null,
        targetId: params.targetId ?? null,
        targetName: params.targetName ?? null,
        detail: params.detail ?? null,
        ip: params.ip ?? null,
      });
      await this.auditLogRepository.save(log);
    } catch (err) {
      // 审计写入失败不应影响主业务流程，仅打印错误
      this.logger.error('审计日志写入失败:', err);
    }
  }

  /**
   * 查询审计日志（分页 + 筛选）
   */
  async findAll(query: {
    page?: number;
    pageSize?: number;
    type?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const {
      page = 1,
      pageSize = 20,
      type,
      keyword,
      startDate,
      endDate,
    } = query;

    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC');

    if (type) {
      qb.andWhere('log.type = :type', { type });
    }
    if (keyword) {
      qb.andWhere(
        '(log.action LIKE :kw OR log.username LIKE :kw OR log.targetName LIKE :kw OR log.detail LIKE :kw)',
        { kw: `%${keyword}%` },
      );
    }
    if (startDate) {
      qb.andWhere('log.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('log.createdAt <= :endDate', {
        endDate: endDate + ' 23:59:59',
      });
    }

    const total = await qb.getCount();
    const items = await qb
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getMany();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 按条件批量删除审计日志
   */
  async batchDelete(params: {
    type?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { type, startDate, endDate } = params;

    const qb = this.auditLogRepository.createQueryBuilder('log');

    if (type) {
      qb.andWhere('log.type = :type', { type });
    }
    if (startDate) {
      qb.andWhere('log.createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('log.createdAt <= :endDate', {
        endDate: endDate + ' 23:59:59',
      });
    }

    // 先统计将要被删除的数量
    const count = await qb.getCount();

    // 构建删除查询
    const deleteQb = this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .from(AuditLog);

    if (type) {
      deleteQb.andWhere('type = :type', { type });
    }
    if (startDate) {
      deleteQb.andWhere('createdAt >= :startDate', { startDate });
    }
    if (endDate) {
      deleteQb.andWhere('createdAt <= :endDate', {
        endDate: endDate + ' 23:59:59',
      });
    }

    await deleteQb.execute();
    return { deleted: count };
  }

  /**
   * 获取审计开关状态
   */
  async getSettings() {
    const keys = [
      'audit.ticket_status',
      'audit.user_login',
      'audit.external_login',
    ];
    const settings = await this.settingRepository.find({
      where: { key: In(keys) },
    });

    const result: Record<string, boolean> = {
      ticket_status: true,
      user_login: true,
      external_login: true,
    };

    for (const s of settings) {
      const shortKey = s.key.replace('audit.', '');
      result[shortKey] = s.value !== 'false';
    }

    return result;
  }

  /**
   * 更新审计开关
   */
  async updateSettings(data: Record<string, boolean>) {
    for (const [key, value] of Object.entries(data)) {
      const fullKey = `audit.${key}`;
      const existing = await this.settingRepository.findOne({
        where: { key: fullKey },
      });
      if (existing) {
        existing.value = String(value);
        await this.settingRepository.save(existing);
      } else {
        await this.settingRepository.save(
          this.settingRepository.create({ key: fullKey, value: String(value) }),
        );
      }
    }
    return this.getSettings();
  }
}
