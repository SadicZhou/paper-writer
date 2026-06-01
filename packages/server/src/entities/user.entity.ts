import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, length: 64 })
  username!: string;

  @Column({ length: 255 })
  passwordHash!: string;

  @Column({ nullable: true, length: 128 })
  displayName?: string;

  @Column({ nullable: true, length: 255 })
  email?: string;

  @Column({ type: "varchar", length: 16, default: "user" })
  role!: "admin" | "user";

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: 10 })
  maxPapers!: number;

  @Column({ type: "bigint", default: 5000000 })
  maxTokens!: number;

  @Column({ type: "bigint", default: 0 })
  tokensUsed!: number;

  @Column({ default: 0 })
  papersCreated!: number;

  @Column({ type: "datetime", nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
