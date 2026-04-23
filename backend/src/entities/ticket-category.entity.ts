import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('ticket_categories')
export class TicketCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  level1: string; // 支持类型

  @Column({ length: 50 })
  level2: string; // 技术方向

  @Column({ length: 50 })
  level3: string; // 品牌
}
