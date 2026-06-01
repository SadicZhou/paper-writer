import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import type { Paper } from "./paper.entity.js";

@Entity("paper_references")
export class PaperReferenceEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("Paper", { onDelete: "CASCADE" })
  @JoinColumn({ name: "paperId" })
  paper!: Paper;

  @Column({ length: 64 })
  paperId!: string;

  @Column({ length: 256 })
  refId!: string;

  @Column({ length: 32 })
  type!: string; // journal, book, conference, thesis, other

  @Column({ length: 1024 })
  title!: string;

  @Column({ type: "text", nullable: true })
  authorsJson?: string;

  @Column({ type: "int", nullable: true })
  year?: number;

  @Column({ length: 512, nullable: true })
  journal?: string;

  @Column({ length: 128, nullable: true })
  volume?: string;

  @Column({ length: 128, nullable: true })
  issue?: string;

  @Column({ length: 128, nullable: true })
  pages?: string;

  @Column({ length: 256, nullable: true })
  doi?: string;

  @Column({ length: 1024, nullable: true })
  url?: string;

  @Column({ type: "text" })
  rawCitation!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
