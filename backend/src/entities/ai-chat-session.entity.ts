import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { AiChatMessage } from './ai-chat-message.entity';

@Entity('ai_chat_sessions')
export class AiChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'varchar', length: 200, default: '新对话' })
  title: string;

  /** Comma-separated list of linked Codex task IDs */
  @Column({ type: 'text', nullable: true })
  linkedTaskIds: string;

  @OneToMany(() => AiChatMessage, (msg) => msg.session, { cascade: true })
  messages: AiChatMessage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
