import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('bbs_tags')
export class BbsTag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50, unique: true })
  name: string;

  @Column({ length: 20, nullable: true })
  color: string;

  @CreateDateColumn()
  createdAt: Date;
}
