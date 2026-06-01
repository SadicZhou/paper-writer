import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import type { User } from "./user.entity.js";

@Entity("service_configs")
export class ServiceConfig {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("User", { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ length: 36 })
  userId!: string;

  @Column({ length: 64 })
  service!: string;

  @Column({ nullable: true, length: 128 })
  name?: string;

  @Column({ nullable: true, length: 512 })
  baseUrl?: string;

  @Column({ nullable: true, type: "text" })
  apiKey?: string;

  @Column({ nullable: true, length: 128 })
  modelMain?: string;

  @Column({ nullable: true, length: 128 })
  modelHaiku?: string;

  @Column({ nullable: true, length: 128 })
  modelSonnet?: string;

  @Column({ nullable: true, length: 128 })
  modelOpus?: string;

  @Column({ type: "float", nullable: true })
  temperature?: number;

  @Column({ nullable: true, length: 32 })
  protocol?: string;

  @Column({ default: true })
  stream!: boolean;

  @Column({ default: false })
  isDefault!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
