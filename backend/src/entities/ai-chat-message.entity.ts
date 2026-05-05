import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { AiChatSession } from './ai-chat-session.entity';

@Entity('ai_chat_messages')
export class AiChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  sessionId: string;

  @Column({ type: 'enum', enum: ['user', 'assistant', 'system'], default: 'user' })
  role: 'user' | 'assistant' | 'system';

  @Column({ type: 'text' })
  content: string;

  /**
   * Structured metadata (JSON) — may contain:
   * - intent: 'chat' | 'create_task' | 'modify_task'
   * - taskId: linked Codex task ID
   * - taskType: template type used
   */
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @ManyToOne(() => AiChatSession, (s) => s.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: AiChatSession;

  @CreateDateColumn()
  createdAt: Date;
}
