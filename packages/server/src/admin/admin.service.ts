import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThanOrEqual } from "typeorm";
import bcrypt from "bcryptjs";
import { User } from "../entities/user.entity.js";
import { UsageRecord } from "../entities/usage-record.entity.js";
import { Paper } from "../entities/paper.entity.js";

/**
 * AdminService — 管理后台业务逻辑层
 *
 * 职责：
 * 1. 用户管理（CRUD、配额调整）
 * 2. 系统统计（用户数、论文数、Token 用量）
 * 3. 全局论文列表（跨用户）
 * 4. 使用趋势分析
 *
 * 数据策略：MySQL 为唯一数据源
 *
 * @author zjh
 * @date 2026-06-02
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UsageRecord) private usageRepo: Repository<UsageRecord>,
    @InjectRepository(Paper) private paperRepo: Repository<Paper>,
  ) {}

  // ── User management ──

  /**
   * 分页查询用户列表
   * @param page - 页码（从 1 开始）
   * @param limit - 每页数量
   * @returns 用户列表、总数、分页信息
   */
  async listUsers(page = 1, limit = 20) {
    const [users, total] = await this.userRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: "DESC" },
      select: ["id", "username", "displayName", "email", "role", "isActive", "maxPapers", "maxTokens", "tokensUsed", "papersCreated", "expiresAt", "createdAt", "updatedAt"],
    });
    return { users, total, page, limit };
  }

  /**
   * 创建新用户
   * @param dto - 用户信息（用户名、密码、角色等）
   * @throws ConflictException - 用户名已存在时抛出 409
   */
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

  /**
   * 更新用户信息
   * @param id - 用户 UUID
   * @param dto - 要更新的字段（角色、状态、配额等）
   * @throws NotFoundException - 用户不存在时抛出 404
   */
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

  /**
   * 获取用户使用情况
   * @param userId - 用户 UUID
   * @returns 用户配额信息和最近使用记录
   */
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

  /**
   * 获取系统统计数据
   * @returns 用户总数、活跃用户数、论文总数、今日新增论文、Token 总用量
   */
  async getStats() {
    const totalUsers = await this.userRepo.count();
    const activeUsers = await this.userRepo.count({ where: { isActive: true } });
    const totalPapers = await this.paperRepo.count();

    const { totalTokens } = await this.usageRepo
      .createQueryBuilder("u")
      .select("COALESCE(SUM(u.totalTokens), 0)", "totalTokens")
      .getRawOne<{ totalTokens: string }>()
      .then((r) => ({ totalTokens: parseInt(r?.totalTokens ?? "0", 10) }));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const papersToday = await this.paperRepo.count({ where: { createdAt: MoreThanOrEqual(todayStart) } });

    return [{ totalUsers, activeUsers, totalPapers, papersToday, totalTokens }];
  }

  // ── All papers ──

  /**
   * 获取全局论文列表（跨用户）
   * @param page - 页码
   * @param limit - 每页数量
   * @returns 论文列表、总数、分页信息
   */
  async listAllPapers(page = 1, limit = 20) {
    const [dbPapers, total] = await this.paperRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: "DESC" },
      relations: ["user"],
    });

    const papers = dbPapers.map((p) => ({
      id: p.id,
      title: p.title,
      major: p.major,
      degreeLevel: p.degreeLevel,
      language: p.language,
      status: p.status,
      currentWordCount: p.currentWordCount,
      username: p.user?.username ?? "unknown",
      userId: p.userId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return { papers, total, page, limit };
  }

  // ── Usage trends ──

  /**
   * 获取 Token 使用趋势
   * @param days - 统计天数（默认 30 天）
   * @returns 按 Agent 分组的 Token 用量、总 Token 数、总调用次数
   */
  async getUsageTrends(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const records = await this.usageRepo.find({
      where: { createdAt: MoreThanOrEqual(since) },
      order: { createdAt: "DESC" },
    });

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
