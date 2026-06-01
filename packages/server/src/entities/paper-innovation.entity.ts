import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import type { Paper } from "./paper.entity.js";

@Entity("paper_innovations")
export class PaperInnovationEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("Paper", { onDelete: "CASCADE" })
  @JoinColumn({ name: "paperId" })
  paper!: Paper;

  @Column({ length: 64 })
  paperId!: string;

  @Column({ length: 64 })
  pointId!: string;

  @Column({ length: 512 })
  title!: string;

  @Column({ type: "text", nullable: true })
  content?: string;

  @Column({ length: 32, default: "planned" })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
