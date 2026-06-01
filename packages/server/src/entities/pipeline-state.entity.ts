import {
  Entity, PrimaryColumn, Column, UpdateDateColumn, ManyToOne, JoinColumn,
} from "typeorm";
import type { Paper } from "./paper.entity.js";

@Entity("pipeline_states")
export class PipelineStateEntity {
  @PrimaryColumn({ length: 64 })
  paperId!: string;

  @ManyToOne("Paper", { onDelete: "CASCADE" })
  @JoinColumn({ name: "paperId" })
  paper!: Paper;

  @Column({ length: 32, default: "idle" })
  currentStage!: string;

  @Column({ type: "text", nullable: true })
  completedStagesJson?: string;

  @Column({ length: 32, default: "idle" })
  status!: string;

  @Column({ type: "text", nullable: true })
  error?: string;

  @Column({ type: "int", default: 0 })
  totalSections!: number;

  @Column({ type: "int", default: 0 })
  completedSections!: number;

  @Column({ type: "longtext", nullable: true })
  eventsJson?: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
