import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketCategory } from '../../entities/ticket-category.entity';
import * as XLSX from 'xlsx';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(TicketCategory)
    private readonly categoryRepository: Repository<TicketCategory>,
  ) {}

  /**
   * 从 Excel Buffer 导入分类数据（清空旧数据后全量写入）
   */
  async importFromExcel(buffer: Buffer): Promise<{ imported: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // 跳过表头，解析数据行
    const categories: Partial<TicketCategory>[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      categories.push({
        level1: String(row[0] || '').trim(),
        level2: String(row[1] || '').trim(),
        level3: String(row[2] || '').trim(),
      });
    }

    // 清空旧数据
    await this.categoryRepository.clear();

    // 批量写入
    if (categories.length > 0) {
      await this.categoryRepository.save(
        categories.map(c => this.categoryRepository.create(c)),
      );
    }

    return { imported: categories.length };
  }

  /**
   * 获取全部扁平记录
   */
  async findAll(): Promise<TicketCategory[]> {
    return this.categoryRepository.find({ order: { level1: 'ASC', level2: 'ASC', level3: 'ASC' } });
  }

  /**
   * 构建三级联动树形结构
   */
  async getTree(): Promise<any[]> {
    const all = await this.findAll();
    const treeMap: Record<string, Record<string, Set<string>>> = {};

    for (const item of all) {
      if (!treeMap[item.level1]) treeMap[item.level1] = {};
      if (!treeMap[item.level1][item.level2]) treeMap[item.level1][item.level2] = new Set();
      if (item.level3) treeMap[item.level1][item.level2].add(item.level3);
    }

    const tree: any[] = [];
    for (const [l1, l2Map] of Object.entries(treeMap).sort()) {
      const children: any[] = [];
      for (const [l2, l3Set] of Object.entries(l2Map).sort()) {
        const l3Children = [...l3Set].sort().map(l3 => ({ label: l3, value: l3 }));
        children.push({
          label: l2,
          value: l2,
          children: l3Children.length > 0 ? l3Children : undefined,
        });
      }
      tree.push({ label: l1, value: l1, children });
    }

    return tree;
  }
}
