import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { User } from './user.entity';
import { Message } from './message.entity';

export enum TicketStatus {
  PENDING = 'pending', // 待接单
  IN_PROGRESS = 'in_progress', // 服务中
  CLOSING = 'closing', // 待确认关单
  CLOSED = 'closed', // 已关单
}

export enum TicketType {
  SOFTWARE = 'software', // 软件问题
  HARDWARE = 'hardware', // 硬件问题
  NETWORK = 'network', // 网络问题
  SECURITY = 'security', // 安全问题
  DATABASE = 'database', // 数据库问题
  OTHER = 'other', // 其他
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  ticketNo: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'enum', enum: TicketType, default: TicketType.OTHER })
  type: TicketType;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.PENDING })
  status: TicketStatus;

  @Column({ length: 100, nullable: true })
  serviceNo: string;

  @Column({ length: 100, nullable: true })
  customerName: string;

  @Column({ length: 255, nullable: true })
  externalLink: string;

  @Column({ nullable: true })
  creatorId: number;

  @ManyToOne(() => User, (user) => user.createdTickets)
  @JoinColumn({ name: 'creatorId' })
  creator: User;

  @Column({ nullable: true })
  assigneeId: number;

  @ManyToOne(() => User, (user) => user.assignedTickets)
  @JoinColumn({ name: 'assigneeId' })
  assignee: User;

  @OneToMany(() => Message, (message) => message.ticket)
  messages: Message[];

  @ManyToMany(() => User, (user) => user.participatedTickets, { cascade: true })
  @JoinTable({
    name: 'ticket_participants',
    joinColumn: { name: 'ticketId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'userId', referencedColumnName: 'id' },
  })
  participants: User[];

  @Column({ length: 50, nullable: true })
  category1: string; // 支持类型

  @Column({ length: 50, nullable: true })
  category2: string; // 技术方向

  @Column({ length: 50, nullable: true })
  category3: string; // 品牌

  @Column({ nullable: true })
  assignedAt: Date;

  @Column({ nullable: true })
  closedAt: Date;

  @Column({ nullable: true })
  confirmedAt: Date;

  @Column({ type: 'text', nullable: true })
  aiSummary: string;

  @Column({ default: false })
  isRoomLocked: boolean;

  @Column({ default: false })
  isExternalLinkDisabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
