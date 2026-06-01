import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import type { Paper } from "./paper.entity.js";

@Entity("paper_outlines")
export class PaperOutlineEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("Paper", { onDelete: "CASCADE" })
  @JoinColumn({ name: "paperId" })
  paper!: Paper;

  @Column({ length: 64 })
  paperId!: string;

  @Column({ length: 512 })
  title!: string;

  @Column({ type: "longtext" })
  sectionsJson!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
