import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import type { User } from "./user.entity.js";

@Entity("usage_records")
export class UsageRecord {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ length: 36 })
  userId!: string;

  @Column({ nullable: true, length: 64 })
  paperId?: string;

  @Column({ length: 64 })
  agentName!: string;

  @Column({ length: 64 })
  modelName!: string;

  @Column({ length: 64 })
  provider!: string;

  @Column({ type: "int", default: 0 })
  promptTokens!: number;

  @Column({ type: "int", default: 0 })
  completionTokens!: number;

  @Column({ type: "int", default: 0 })
  totalTokens!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
