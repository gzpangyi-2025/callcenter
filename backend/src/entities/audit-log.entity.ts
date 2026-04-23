import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum AuditType {
  TICKET_STATUS = 'ticket_status',
  USER_LOGIN = 'user_login',
  EXTERNAL_LOGIN = 'external_login',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  type: AuditType;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  username: string | null;

  @Column({ type: 'int', nullable: true })
  targetId: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  targetName: string | null;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  ip: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
