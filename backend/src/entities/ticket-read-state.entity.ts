import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

@Entity('ticket_read_states')
@Unique(['userId', 'ticketId'])
export class TicketReadState {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index()
  userId: number;

  @Column()
  @Index()
  ticketId: number;

  @Column({ nullable: true })
  lastReadMessageId: number;

  @Column({ type: 'timestamp', nullable: true })
  lastReadAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
