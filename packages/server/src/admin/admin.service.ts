import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, MoreThanOrEqual } from "typeorm";
import bcrypt from "bcryptjs";
import { User } from "../entities/user.entity.js";
import { UsageRecord } from "../entities/usage-record.entity.js";
import { Paper } from "../entities/paper.entity.js";
import { StateManager } from "@actalk/inkos-core";

@Injectable()
export class AdminService {
  private projectRoot = process.env.INKOS_PROJECT_ROOT ?? process.cwd();

  private async loadAllFilePapers() {
    try {
      const state = new StateManager(this.projectRoot);
      return await state.listPapers();
    } catch { return []; }
  }

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UsageRecord) private usageRepo: Repository<UsageRecord>,
    @InjectRepository(Paper) private paperRepo: Repository<Paper>,
  ) {}

  // ── User management ──

  async listUsers(page = 1, limit = 20) {
    const [users, total] = await this.userRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: "DESC" },
      select: ["id", "username", "displayName", "email", "role", "isActive", "maxPapers", "maxTokens", "tokensUsed", "papersCreated", "expiresAt", "createdAt", "updatedAt"],
    });
    return { users, total, page, limit };
  }

  async createUser(dto: { username: string; password: string; role?: string; displayName?: string; email?: string; maxPapers?: number; maxTokens?: number; expiresAt?: string }) {
    const existing = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existing) throw new ConflictException("Username already exists");

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      passwordHash,
      role: (dto.role as "admin" | "user") ?? "user",
      displayName: dto.displayName,
      email: dto.email,
      maxPapers: dto.maxPapers ?? 10,
      maxTokens: dto.maxTokens ?? 5000000,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
    await this.userRepo.save(user);
    return { id: user.id, username: user.username, role: user.role };
  }

  async updateUser(id: string, dto: { role?: string; isActive?: boolean; maxPapers?: number; maxTokens?: number; expiresAt?: string | null; displayName?: string }) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    if (dto.role !== undefined) user.role = dto.role as "admin" | "user";
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.maxPapers !== undefined) user.maxPapers = dto.maxPapers;
    if (dto.maxTokens !== undefined) user.maxTokens = dto.maxTokens;
    if (dto.expiresAt !== undefined) user.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined as any;
    if (dto.displayName !== undefined) user.displayName = dto.displayName;

    await this.userRepo.save(user);
    return { id: user.id, username: user.username, role: user.role };
  }

  async getUserUsage(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId }, select: ["id", "username", "tokensUsed", "maxTokens", "papersCreated", "maxPapers"] });
    if (!user) throw new NotFoundException("User not found");

    const records = await this.usageRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 50,
    });

    return { user, recentRecords: records };
  }

  // ── Dashboard stats ──

  async getStats() {
    const totalUsers = await this.userRepo.count();
    const activeUsers = await this.userRepo.count({ where: { isActive: true } });
    const dbPapers = await this.paperRepo.count();
    const filePapers = await this.loadAllFilePapers();
    const totalPapers = Math.max(dbPapers, filePapers.length);

    const { totalTokens } = await this.usageRepo
      .createQueryBuilder("u")
      .select("COALESCE(SUM(u.totalTokens), 0)", "totalTokens")
      .getRawOne<{ totalTokens: string }>()
      .then((r) => ({ totalTokens: parseInt(r?.totalTokens ?? "0", 10) }));

    // Papers created today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const papersToday = await this.paperRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } });

    return [{ totalUsers, activeUsers, totalPapers, papersToday, totalTokens }];
  }

  // ── All papers ──

  async listAllPapers(page = 1, limit = 20) {
    const [dbPapers, dbTotal] = await this.paperRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: "DESC" },
      relations: ["user"],
    });

    // 合并文件系统中的论文（旧数据可能不在 MySQL 中）
    const filePapers = await this.loadAllFilePapers();
    const dbIds = new Set(dbPapers.map((p) => p.id));
    const orphanPapers = filePapers.filter((fp) => !dbIds.has(fp.id));

    const merged = [
      ...orphanPapers.map((fp) => ({
        id: fp.id, title: fp.title, major: fp.major, degreeLevel: fp.degreeLevel,
        language: (fp as any).language ?? "zh", status: "draft" as const,
        currentWordCount: (fp as any).currentWordCount ?? 0,
        username: "unknown", userId: "",
        createdAt: (fp as any).createdAt ?? new Date().toISOString(),
        updatedAt: (fp as any).updatedAt ?? new Date().toISOString(),
      })),
      ...dbPapers.map((p) => ({
        id: p.id, title: p.title, major: p.major, degreeLevel: p.degreeLevel,
        language: p.language, status: p.status, currentWordCount: p.currentWordCount,
        username: p.user?.username, userId: p.userId,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      })),
    ];

    return {
      papers: merged.slice(0, limit),
      total: dbTotal + orphanPapers.length,
      page, limit,
    };
  }

  // ── Usage trends ──

  async getUsageTrends(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const records = await this.usageRepo.find({
      where: { createdAt: MoreThanOrEqual(since) },
      order: { createdAt: "DESC" },
    });

    // Aggregate by agent
    const byAgent: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }> = {};
    for (const r of records) {
      if (!byAgent[r.agentName]) byAgent[r.agentName] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
      byAgent[r.agentName].promptTokens += r.promptTokens;
      byAgent[r.agentName].completionTokens += r.completionTokens;
      byAgent[r.agentName].totalTokens += r.totalTokens;
      byAgent[r.agentName].calls += 1;
    }

    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalCalls = records.length;

    return { days, byAgent, totalTokens, totalCalls };
  }
}
