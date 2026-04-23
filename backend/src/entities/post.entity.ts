import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { BbsSection } from './bbs-section.entity';

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: 'longtext' })
  content: string;

  // 使用 JSON 类型存储标签数组，如 ["前端", "坑点", "分享"]
  @Column({ type: 'json', nullable: true })
  tags: string[];

  @Column({ default: 0 })
  viewCount: number;

  @Column({ default: false })
  isPinned: boolean;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ name: 'sectionId', nullable: true })
  sectionId: number;

  @ManyToOne(() => BbsSection, { nullable: true })
  @JoinColumn({ name: 'sectionId' })
  section: BbsSection;

  @Column({ name: 'authorId' })
  authorId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'authorId' })
  author: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastCommentAt: Date;
}

