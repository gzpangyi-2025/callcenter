import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('knowledge_docs')
@Index('IDX_KNOWLEDGE_FULLTEXT', ['title', 'content', 'tags'], { fulltext: true, parser: 'ngram' })
export class KnowledgeDoc {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true })
  ticketId: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  tags: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  severity: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  analysisImgUrl: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  flowImgUrl: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  generatedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 20, default: 'ai_doc' })
  docType: string;
}
