import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import type { User } from "./user.entity.js";

@Entity("papers")
export class Paper {
  @PrimaryColumn({ length: 64 })
  id!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ length: 36 })
  userId!: string;

  @Column({ length: 512 })
  title!: string;

  @Column({ nullable: true, length: 128 })
  major?: string;

  @Column({ nullable: true, length: 32 })
  degreeLevel?: string;

  @Column({ length: 8, default: "zh" })
  language!: string;

  @Column({ default: 0 })
  currentWordCount!: number;

  @Column({ length: 32, default: "draft" })
  status!: string;

  /** 目标字数 */
  @Column({ default: 20000 })
  targetWordCount!: number;

  /** 引用格式（gb7714, apa, mla 等） */
  @Column({ length: 32, default: "gb7714" })
  citationFormat!: string;

  /** 开题报告文本 */
  @Column({ type: "text", nullable: true })
  proposalText?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
