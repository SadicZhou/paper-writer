import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import type { Paper } from "./paper.entity.js";

@Entity("paper_sections")
export class PaperSectionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("Paper", { onDelete: "CASCADE" })
  @JoinColumn({ name: "paperId" })
  paper!: Paper;

  @Column({ length: 64 })
  paperId!: string;

  @Column({ length: 16 })
  sectionNumber!: string;

  @Column({ length: 512, nullable: true })
  title?: string;

  @Column({ type: "mediumtext", nullable: true })
  content?: string;

  @Column({ type: "int", default: 0 })
  wordCount!: number;

  @Column({ length: 32, default: "draft" })
  status!: string;

  @Column({ type: "float", nullable: true })
  aiDetectionScore?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
