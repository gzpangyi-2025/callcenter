import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import * as XLSX from 'xlsx';

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private applyDateFilter(
    qb: any,
    alias: string,
    startDate?: string,
    endDate?: string,
  ) {
    if (startDate) {
      qb.andWhere(`${alias}.createdAt >= :startDate`, { startDate });
    }
    if (endDate) {
      qb.andWhere(`${alias}.createdAt <= :endDate`, {
        endDate: endDate + ' 23:59:59',
      });
    }
  }

  /**
   * 总览面板
   */
  async getSummary(startDate?: string, endDate?: string) {
    const qb = this.ticketRepository.createQueryBuilder('t');
    this.applyDateFilter(qb, 't', startDate, endDate);

    const total = await qb.getCount();

    // Note: Previous unused statusCounts query removed in favor of statusData below

    // Rebuild with date filter
    const statusQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'count');
    this.applyDateFilter(statusQb, 't', startDate, endDate);
    const statusData = await statusQb.groupBy('t.status').getRawMany();

    const statusMap: Record<string, number> = {};
    for (const r of statusData) {
      statusMap[r.status] = parseInt(r.count);
    }

    // 平均处理时长（仅已关闭工单）
    const avgQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('AVG(TIMESTAMPDIFF(HOUR, t.createdAt, t.closedAt))', 'avgHours')
      .where('t.status = :status', { status: 'closed' })
      .andWhere('t.closedAt IS NOT NULL');
    this.applyDateFilter(avgQb, 't', startDate, endDate);
    const avgResult = await avgQb.getRawOne();

    return {
      total,
      pending: statusMap['pending'] || 0,
      in_progress: statusMap['in_progress'] || 0,
      closing: statusMap['closing'] || 0,
      closed: statusMap['closed'] || 0,
      avgHours: avgResult?.avgHours
        ? parseFloat(parseFloat(avgResult.avgHours).toFixed(1))
        : 0,
    };
  }

  /**
   * 按工单分类(Category1 和 Category2)统计
   */
  async getCategoryStats(startDate?: string, endDate?: string) {
    const qb1 = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.category1', 'category1')
      .addSelect('COUNT(*)', 'total')
      .where('t.category1 IS NOT NULL')
      .andWhere('t.category1 != ""');
    this.applyDateFilter(qb1, 't', startDate, endDate);
    const category1Data = await qb1
      .groupBy('t.category1')
      .orderBy('total', 'DESC')
      .getRawMany();

    const qb2 = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.category2', 'category2')
      .addSelect('COUNT(*)', 'total')
      .where('t.category2 IS NOT NULL')
      .andWhere('t.category2 != ""');
    this.applyDateFilter(qb2, 't', startDate, endDate);
    const category2Data = await qb2
      .groupBy('t.category2')
      .orderBy('total', 'DESC')
      .limit(10)
      .getRawMany();

    return {
      category1: category1Data.map((r) => ({
        name: r.category1,
        value: parseInt(r.total),
      })),
      category2: category2Data.map((r) => ({
        name: r.category2,
        value: parseInt(r.total),
      })),
    };
  }

  /**
   * 下钻：按 Category1 获取下属所有 Category2 (Level 2 视图)
   */
  async getCategory2Stats(
    category1: string,
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.category2', 'category2')
      .addSelect('COUNT(*)', 'total')
      .where('t.category1 = :category1', { category1 })
      .andWhere('t.category2 IS NOT NULL')
      .andWhere('t.category2 != ""');
    this.applyDateFilter(qb, 't', startDate, endDate);
    const data = await qb
      .groupBy('t.category2')
      .orderBy('total', 'DESC')
      .getRawMany();

    return data.map((r) => ({
      name: r.category2,
      value: parseInt(r.total),
    }));
  }

  /**
   * 下钻：按 Category2 获取下级 Category3 分布 (Top 5)
   */
  async getCategory3Stats(
    category2: string,
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.category3', 'category3')
      .addSelect('COUNT(*)', 'total')
      .where('t.category2 = :category2', { category2 })
      .andWhere('t.category3 IS NOT NULL')
      .andWhere('t.category3 != ""');
    this.applyDateFilter(qb, 't', startDate, endDate);
    const data = await qb
      .groupBy('t.category3')
      .orderBy('total', 'DESC')
      .limit(5)
      .getRawMany();

    return data.map((r) => ({
      name: r.category3,
      value: parseInt(r.total),
    }));
  }

  /**
   * 按人员分类统计（三维度独立排行）
   */
  async getByPerson(limit?: number, startDate?: string, endDate?: string) {
    // 接单统计
    const assignQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.assigneeId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('t.assigneeId IS NOT NULL');
    this.applyDateFilter(assignQb, 't', startDate, endDate);
    if (limit) assignQb.limit(limit);
    const assignData = await assignQb
      .groupBy('t.assigneeId')
      .orderBy('count', 'DESC')
      .getRawMany();

    // 创建统计
    const createQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.creatorId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where('t.creatorId IS NOT NULL');
    this.applyDateFilter(createQb, 't', startDate, endDate);
    if (limit) createQb.limit(limit);
    const createData = await createQb
      .groupBy('t.creatorId')
      .orderBy('count', 'DESC')
      .getRawMany();

    // 参与统计
    const participateQb = this.ticketRepository
      .createQueryBuilder('t')
      .innerJoin('ticket_participants', 'tp', 'tp.ticketId = t.id')
      .select('tp.userId', 'userId')
      .addSelect('COUNT(*)', 'count');
    this.applyDateFilter(participateQb, 't', startDate, endDate);
    if (limit) participateQb.limit(limit);
    const participateData = await participateQb
      .groupBy('tp.userId')
      .orderBy('count', 'DESC')
      .getRawMany();

    // 收集所有 userId 一次性查用户名
    const allIds = new Set<number>();
    for (const r of [...assignData, ...createData, ...participateData]) {
      allIds.add(parseInt(r.userId));
    }

    const usersMap: Record<number, any> = {};
    if (allIds.size > 0) {
      const users = await this.userRepository
        .createQueryBuilder('u')
        .select(['u.id', 'u.username', 'u.realName', 'u.displayName'])
        .whereInIds([...allIds])
        .getMany();
      for (const u of users) {
        usersMap[u.id] = {
          username: u.username,
          realName: u.realName,
          displayName: u.displayName,
        };
      }
    }

    const mapRow = (r: any) => ({
      userId: parseInt(r.userId),
      count: parseInt(r.count),
      username: usersMap[parseInt(r.userId)]?.username || '-',
      realName:
        usersMap[parseInt(r.userId)]?.realName ||
        usersMap[parseInt(r.userId)]?.displayName ||
        '-',
    });

    return {
      creators: createData.map(mapRow),
      assignees: assignData.map(mapRow),
      participants: participateData.map(mapRow),
    };
  }

  /**
   * 按客户统计
   */
  async getByCustomer(startDate?: string, endDate?: string) {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.customerName', 'customerName')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        "SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END)",
        'closed',
      )
      .addSelect(
        "SUM(CASE WHEN t.status != 'closed' THEN 1 ELSE 0 END)",
        'active',
      )
      .where('t.customerName IS NOT NULL')
      .andWhere("t.customerName != ''");
    this.applyDateFilter(qb, 't', startDate, endDate);
    const data = await qb
      .groupBy('t.customerName')
      .orderBy('total', 'DESC')
      .getRawMany();

    return data.map((r) => ({
      customerName: r.customerName,
      total: parseInt(r.total),
      closed: parseInt(r.closed),
      active: parseInt(r.active),
    }));
  }

  /**
   * 时间趋势 (多维度支持)
   */
  async getTimeSeries(
    dimension: 'day' | 'month' | 'quarter' | 'year' = 'day',
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.ticketRepository.createQueryBuilder('t');

    // 如果没有显示传入时间范围，按维度加上默认过滤以提升性能
    if (!startDate && !endDate) {
      if (dimension === 'day') {
        qb.andWhere('t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)');
      } else if (dimension === 'month') {
        qb.andWhere('t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)');
      } else if (dimension === 'quarter') {
        qb.andWhere('t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 QUARTER)');
      } else if (dimension === 'year') {
        qb.andWhere('t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 3 YEAR)');
      }
    } else {
      this.applyDateFilter(qb, 't', startDate, endDate);
    }

    let dateExpr = 'DATE(t.createdAt)';

    if (dimension === 'month') {
      dateExpr = 'DATE_FORMAT(t.createdAt, "%Y-%m")';
    } else if (dimension === 'quarter') {
      dateExpr = 'CONCAT(YEAR(t.createdAt), "-Q", QUARTER(t.createdAt))';
    } else if (dimension === 'year') {
      dateExpr = 'YEAR(t.createdAt)';
    }

    qb.select(`${dateExpr}`, 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy(`${dateExpr}`)
      .orderBy('MIN(t.createdAt)', 'ASC');

    const data = await qb.getRawMany();

    return data.map((r) => ({
      date: String(r.date),
      count: parseInt(r.count),
    }));
  }

  /**
   * 矩阵统计：工单类型与人员的汇总交叉统计 (如指定 Category2 或 Category3 的提单和接单排行)
   */
  async getCrossMatrix(
    categoryName: string,
    level: 'category2' | 'category3' = 'category2',
    limit: number = 8,
    parentCategory?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const colName = `t.${level}`;

    // 获取特定技术方向下 提供支持排名 (接单人)
    const assignQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.assigneeId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where(`${colName} = :categoryName`, { categoryName })
      .andWhere('t.assigneeId IS NOT NULL');
    // 如果提供了父分类，限定查询范围（例如只查虚拟化软件下的IBM，不混入硬件设备下的IBM）
    if (parentCategory && level === 'category3') {
      assignQb.andWhere('t.category2 = :parentCategory', { parentCategory });
    }
    this.applyDateFilter(assignQb, 't', startDate, endDate);
    const assignData = await assignQb
      .groupBy('t.assigneeId')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    // 获取特定技术方向下 申请支持排名 (开单人)
    const createQb = this.ticketRepository
      .createQueryBuilder('t')
      .select('t.creatorId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .where(`${colName} = :categoryName`, { categoryName })
      .andWhere('t.creatorId IS NOT NULL');
    if (parentCategory && level === 'category3') {
      createQb.andWhere('t.category2 = :parentCategory', { parentCategory });
    }
    this.applyDateFilter(createQb, 't', startDate, endDate);
    const createData = await createQb
      .groupBy('t.creatorId')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    const allIds = new Set<number>();
    for (const r of [...assignData, ...createData]) {
      allIds.add(parseInt(r.userId));
    }

    const usersMap: Record<number, any> = {};
    if (allIds.size > 0) {
      const users = await this.userRepository
        .createQueryBuilder('u')
        .select(['u.id', 'u.username', 'u.realName', 'u.displayName'])
        .whereInIds([...allIds])
        .getMany();
      for (const u of users) {
        usersMap[u.id] = {
          username: u.username,
          realName: u.realName,
          displayName: u.displayName,
        };
      }
    }

    const mapRow = (r: any) => ({
      userId: parseInt(r.userId),
      count: parseInt(r.count),
      username: usersMap[parseInt(r.userId)]?.username || '-',
      realName:
        usersMap[parseInt(r.userId)]?.realName ||
        usersMap[parseInt(r.userId)]?.displayName ||
        '-',
    });

    return {
      supporters: assignData.map(mapRow),
      requesters: createData.map(mapRow),
    };
  }

  /**
   * 下钻：人员 → 工单列表 (兼容 Category 查询)
   */
  async drillPersonTickets(
    userId: number,
    role: 'creator' | 'assignee' | 'participant',
    categoryName?: string,
    categoryLevel: 'category2' | 'category3' = 'category3',
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.creator', 'creator')
      .leftJoinAndSelect('t.assignee', 'assignee');

    if (role === 'creator') {
      qb.where('t.creatorId = :userId', { userId });
    } else if (role === 'assignee') {
      qb.where('t.assigneeId = :userId', { userId });
    } else {
      qb.innerJoin(
        'ticket_participants',
        'tp',
        'tp.ticketId = t.id AND tp.userId = :userId',
        { userId },
      );
    }

    if (categoryName) {
      qb.andWhere(`t.${categoryLevel} = :categoryName`, { categoryName });
    }

    this.applyDateFilter(qb, 't', startDate, endDate);
    qb.orderBy('t.createdAt', 'DESC');

    return qb.getMany();
  }

  /**
   * 下钻：客户 → 工单列表
   */
  async drillCustomerTickets(
    customerName: string,
    startDate?: string,
    endDate?: string,
  ) {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.creator', 'creator')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .where('t.customerName = :customerName', { customerName });
    this.applyDateFilter(qb, 't', startDate, endDate);
    qb.orderBy('t.createdAt', 'DESC');
    return qb.getMany();
  }

  /**
   * 导出所有工单数据为 XLSX
   */
  async exportAllTickets(
    startDate?: string,
    endDate?: string,
  ): Promise<Buffer> {
    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.creator', 'creator')
      .leftJoinAndSelect('t.assignee', 'assignee')
      .leftJoinAndSelect('t.participants', 'participants');
    this.applyDateFilter(qb, 't', startDate, endDate);
    qb.orderBy('t.createdAt', 'DESC');

    const tickets = await qb.getMany();

    const statusMap: Record<string, string> = {
      pending: '待接单',
      in_progress: '服务中',
      closing: '待确认关单',
      closed: '已关单',
    };

    const typeMap: Record<string, string> = {
      software: '软件问题',
      hardware: '硬件问题',
      network: '网络问题',
      security: '安全问题',
      database: '数据库问题',
      other: '其他',
    };

    const formatDate = (d: any) =>
      d
        ? new Date(d).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '';

    const rows = tickets.map((t) => ({
      工单编号: t.ticketNo || '',
      标题: t.title || '',
      描述: t.description || '',
      工单类型: typeMap[t.type] || t.type || '',
      工单状态: statusMap[t.status] || t.status || '',
      服务单号: t.serviceNo || '',
      客户名称: t.customerName || '',
      '支持类型 (大类)': t.category1 || '',
      '技术方向 (中类)': t.category2 || '',
      '品牌 (小类)': t.category3 || '',
      创建人:
        t.creator?.realName ||
        t.creator?.displayName ||
        t.creator?.username ||
        '',
      处理人:
        t.assignee?.realName ||
        t.assignee?.displayName ||
        t.assignee?.username ||
        '',
      参与专家:
        t.participants
          ?.map((p) => p.realName || p.displayName || p.username)
          .join('、') || '',
      外部链接: t.externalLink || '',
      'AI 摘要': t.aiSummary || '',
      创建时间: formatDate(t.createdAt),
      接单时间: formatDate(t.assignedAt),
      关单时间: formatDate(t.closedAt),
      确认时间: formatDate(t.confirmedAt),
      最后更新: formatDate(t.updatedAt),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);

    // 设置列宽
    worksheet['!cols'] = [
      { wch: 18 }, // 工单编号
      { wch: 40 }, // 标题
      { wch: 60 }, // 描述
      { wch: 12 }, // 工单类型
      { wch: 12 }, // 工单状态
      { wch: 18 }, // 服务单号
      { wch: 18 }, // 客户名称
      { wch: 14 }, // 大类
      { wch: 18 }, // 中类
      { wch: 14 }, // 小类
      { wch: 12 }, // 创建人
      { wch: 12 }, // 处理人
      { wch: 30 }, // 参与专家
      { wch: 30 }, // 外部链接
      { wch: 50 }, // AI 摘要
      { wch: 20 }, // 创建时间
      { wch: 20 }, // 接单时间
      { wch: 20 }, // 关单时间
      { wch: 20 }, // 确认时间
      { wch: 20 }, // 最后更新
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '工单数据');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return buffer;
  }
}
