import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  StateManager,
  PaperRunner,
  WordExporter,
  createLLMClient,
  derivePaperIdFromTitle,
  type AgentContext,
  type PaperRunnerOptions,
  type PaperConfig,
  type Reference,
} from "@actalk/inkos-core";
import { Paper } from "../entities/paper.entity.js";
import { UserService } from "../user/user.service.js";
import { DbStorageService } from "./db-storage.service.js";

/**
 * PaperService — 论文业务逻辑层
 *
 * 职责：
 * 1. 论文 CRUD（MySQL 唯一数据源）
 * 2. 流水线调度（选题、文献、大纲、写作、润色）
 * 3. 章节/大纲/参考文献/创新点管理
 * 4. Word 导出
 *
 * 数据策略：
 * - 读写：MySQL 为唯一数据源
 * - 流水线：PaperRunner 写文件系统，完成后自动同步到 MySQL
 * - 导出：从 MySQL 读取数据，传给 WordExporter
 *
 * @author zjh
 * @date 2026-06-02
 */
@Injectable()
export class PaperService {
  /** 项目根目录，用于流水线文件系统操作 */
  private projectRoot: string;

  constructor(
    @InjectRepository(Paper)
    private paperRepo: Repository<Paper>,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private db: DbStorageService,
  ) {
    this.projectRoot = process.env.INKOS_PROJECT_ROOT ?? process.cwd();
  }

  // ── CRUD ──

  /**
   * 获取指定用户的论文列表
   * @param userId - 用户 UUID
   * @returns 论文列表
   */
  async listPapers(userId: string) {
    const dbPapers = await this.paperRepo.find({ where: { userId } });

    // 批量加载流水线状态，补充章节/阶段信息
    const pipelineStates = await this.db.loadAllPipelineStates();
    const stateMap = new Map(pipelineStates.map((s) => [s.paperId, s]));

    return dbPapers.map((p) => {
      const ps = stateMap.get(p.id);
      return {
        id: p.id,
        title: p.title,
        major: p.major ?? "",
        degreeLevel: p.degreeLevel ?? "undergraduate",
        totalSections: ps?.totalSections ?? 0,
        completedSections: ps?.completedSections ?? 0,
        totalWords: p.currentWordCount ?? 0,
        pipelineStage: ps?.currentStage ?? p.status ?? "idle",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  /**
   * 创建新论文
   * 同时写入 MySQL 和文件系统（供流水线使用）
   * @param userId - 创建者 UUID
   * @param dto - 论文配置
   * @returns 创建的论文配置对象
   */
  async createPaper(userId: string, dto: {
    title: string; major: string; degreeLevel?: string; proposalText?: string;
    references?: Array<Record<string, unknown>>; targetWordCount?: number;
    citationFormat?: string; language?: string;
  }) {
    const paperId = derivePaperIdFromTitle(dto.title.trim());
    const now = new Date().toISOString();

    // 写入文件系统（供 PaperRunner 流水线使用）
    const state = new StateManager(this.projectRoot);
    const paperConfig: PaperConfig = {
      id: paperId,
      title: dto.title.trim(),
      major: dto.major.trim(),
      degreeLevel: (dto.degreeLevel as PaperConfig["degreeLevel"]) ?? "undergraduate",
      proposalText: dto.proposalText ?? "",
      references: (dto.references ?? []).map((r, i) => ({
        id: (r.id as string) ?? `ref-${i + 1}`,
        type: (r.type as PaperConfig["references"][0]["type"]) ?? "other",
        title: (r.title as string) ?? "",
        authors: (r.authors as string[]) ?? [],
        year: (r.year as number) ?? new Date().getFullYear(),
        journal: r.journal as string | undefined,
        volume: r.volume as string | undefined,
        issue: r.issue as string | undefined,
        pages: r.pages as string | undefined,
        doi: r.doi as string | undefined,
        url: r.url as string | undefined,
        rawCitation: (r.rawCitation as string) ?? (r.title as string) ?? "",
      })),
      targetWordCount: dto.targetWordCount ?? 20000,
      citationFormat: (dto.citationFormat as PaperConfig["citationFormat"]) ?? "gb7714",
      language: (dto.language === "en" ? "en" : "zh") as "zh" | "en",
      createdAt: now,
      updatedAt: now,
    };
    await state.createPaper(paperConfig);

    // 写入 MySQL（主存储）
    const paper = this.paperRepo.create({
      id: paperId, userId, title: dto.title.trim(),
      major: dto.major.trim(), degreeLevel: dto.degreeLevel,
      language: dto.language === "en" ? "en" : "zh",
      targetWordCount: dto.targetWordCount ?? 20000,
      citationFormat: dto.citationFormat ?? "gb7714",
      proposalText: dto.proposalText,
    });
    await this.paperRepo.save(paper);
    await this.userService.incrementPapersCreated(userId);

    this.eventEmitter.emit("paper:created", { paperId, userId, title: dto.title.trim() });
    return paperConfig;
  }

  /**
   * 获取单篇论文详情
   * @param paperId - 论文 ID
   * @throws NotFoundException - 论文不存在时抛出 404
   */
  async getPaper(paperId: string) {
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException(`Paper "${paperId}" not found`);
    return {
      id: paper.id,
      title: paper.title,
      major: paper.major,
      degreeLevel: paper.degreeLevel,
      language: paper.language,
      status: paper.status,
      currentWordCount: paper.currentWordCount,
      targetWordCount: paper.targetWordCount,
      citationFormat: paper.citationFormat,
      proposalText: paper.proposalText,
      createdAt: paper.createdAt,
      updatedAt: paper.updatedAt,
    };
  }

  /**
   * 删除论文
   * 同时删除 MySQL 和文件系统中的数据
   * @param userId - 操作者 UUID（用于权限校验）
   * @param paperId - 论文 ID
   */
  async deletePaper(userId: string, paperId: string) {
    // 删除 MySQL 数据
    await Promise.all([
      this.paperRepo.delete({ id: paperId, userId }),
      this.db.deleteAll(paperId),
    ]);
    // 删除文件系统（供流水线使用的目录）
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await rm(join(this.projectRoot, "papers", paperId), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }

  /**
   * 更新论文元数据
   * @param paperId - 论文 ID
   * @param dto - 要更新的字段
   */
  async updatePaper(paperId: string, dto: Record<string, unknown>) {
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException(`Paper "${paperId}" not found`);
    if (typeof dto.title === "string") paper.title = dto.title;
    if (typeof dto.major === "string") paper.major = dto.major;
    if (typeof dto.degreeLevel === "string") paper.degreeLevel = dto.degreeLevel as any;
    if (typeof dto.language === "string") paper.language = dto.language as any;
    if (typeof dto.targetWordCount === "number") paper.targetWordCount = dto.targetWordCount;
    if (typeof dto.citationFormat === "string") paper.citationFormat = dto.citationFormat;
    if (typeof dto.proposalText === "string") paper.proposalText = dto.proposalText;
    await this.paperRepo.save(paper);
    return paper;
  }

  // ── Pipeline ──

  /**
   * 获取流水线状态
   * @param paperId - 论文 ID
   * @returns 流水线状态对象
   */
  async getPipelineStatus(paperId: string) {
    return this.db.loadPipelineState(paperId) ?? { stage: "idle" };
  }

  /**
   * 重置流水线状态
   * 清空 MySQL 和文件系统中的流水线数据
   * @param paperId - 论文 ID
   */
  async resetPipeline(paperId: string) {
    // 清空 MySQL
    await this.db.savePipelineState(paperId, { status: "idle", currentStage: "idle", completedStages: [], events: [] });
    // 清空文件系统（PaperRunner 写入的文件）
    const { unlink, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const base = join(this.projectRoot, "papers", paperId);
    const sectionsDir = join(base, "state", "sections");
    try { const files = await readdir(sectionsDir); await Promise.all(files.map(f => unlink(join(sectionsDir, f)))); } catch { /* */ }
    try { await unlink(join(base, "state", "outline.json")); } catch { /* */ }
    try { await unlink(join(base, "state", "innovation_points.json")); } catch { /* */ }
    try { await unlink(join(base, "state", "references.json")); } catch { /* */ }
    try { await unlink(join(base, "runtime", "pipeline_state.json")); } catch { /* */ }
    this.eventEmitter.emit("paper:reset", { paperId });
    return { ok: true, paperId };
  }

  /**
   * 启动完整流水线（选题 → 文献 → 大纲 → 写作 → 润色）
   * 异步执行，通过 SSE 事件通知进度
   */
  async runPipeline(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.run(options).then(
      () => this.eventEmitter.emit("paper:pipeline-done", { paperId, userId }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, userId, error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId };
  }

  /** 仅运行选题构思阶段 */
  async runBrainstorm(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runBrainstormOnly(options).then(
      (result) => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "brainstorm", result }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "brainstorm", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "brainstorm" };
  }

  /** 仅运行文献检索阶段 */
  async runLiteratureSearch(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runLiteratureSearchOnly(options).then(
      () => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "literature-search" }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "literature-search", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "literature-search" };
  }

  /** 仅运行大纲生成阶段 */
  async runOutline(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runOutlineOnly(options).then(
      () => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "outline" }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "outline", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "outline" };
  }

  /** 仅运行正文撰写阶段，完成后自动同步到 MySQL */
  async runWriting(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runWritingOnly(options).then(
      async () => {
        await this.syncSectionsFromFilesystem(paperId);
        this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "writing" });
      },
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "writing", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "writing" };
  }

  /** 仅运行润色降重阶段，完成后自动同步到 MySQL */
  async runPolish(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runPolishOnly(options).then(
      async () => {
        await this.syncSectionsFromFilesystem(paperId);
        this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "polish" });
      },
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "polish", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "polish" };
  }

  /** 运行全章节 AI 检测 */
  async runDetection(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    return runner.runDetectionAll(options);
  }

  /** 运行全章节 AI 降重 */
  async runReduction(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    return runner.runReduceAll(options);
  }

  /**
   * 重新生成指定章节
   * 完成后自动从文件系统同步到 MySQL
   */
  async regenerateSection(paperId: string, sectionNum: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    const state = new StateManager(this.projectRoot);
    runner.regenerateSection(paperId, sectionNum, state).then(
      async (result) => {
        try {
          const section = await state.loadSection(paperId, sectionNum);
          if (section) {
            await this.db.saveSection(paperId, {
              sectionNumber: sectionNum,
              title: (section as any).title,
              content: (section as any).content,
              wordCount: (section as any).wordCount ?? 0,
              status: (section as any).status ?? "drafted",
              aiDetectionScore: (section as any).aiDetectionScore,
            });
          }
        } catch { /* DB sync is best-effort */ }
        this.eventEmitter.emit("paper:stage-complete", { paperId, stage: `write-section-${sectionNum}`, result });
      },
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: `write-section-${sectionNum}`, error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: `write-section-${sectionNum}` };
  }

  // ── Sections ──

  /** 获取论文章节列表（从 MySQL） */
  async listSections(paperId: string) {
    return this.db.listSections(paperId);
  }

  /** 获取单个章节内容（从 MySQL） */
  async getSection(paperId: string, num: string) {
    const section = await this.db.loadSection(paperId, num);
    if (!section) throw new NotFoundException(`Section ${num} not found in paper "${paperId}"`);
    return section;
  }

  /** 保存章节内容（仅写入 MySQL） */
  async saveSection(paperId: string, num: string, body: { content: string }) {
    await this.db.saveSection(paperId, {
      sectionNumber: num,
      content: body.content,
      wordCount: body.content.length,
      status: "drafted",
    });
    return { ok: true };
  }

  // ── Outline ──

  /** 获取论文大纲（从 MySQL） */
  async getOutline(paperId: string) {
    return this.db.loadOutline(paperId) ?? { title: "", sections: [] };
  }

  /** 保存论文大纲（仅写入 MySQL） */
  async saveOutline(paperId: string, outline: any) {
    await this.db.saveOutline(paperId, outline.title || "", outline.sections || outline);
    return { ok: true };
  }

  // ── References ──

  /** 获取参考文献列表（从 MySQL） */
  async listReferences(paperId: string) {
    return this.db.loadReferences(paperId);
  }

  /** 添加参考文献（仅写入 MySQL） */
  async addReference(paperId: string, ref: Reference) {
    const refs = await this.listReferences(paperId);
    refs.push(ref as any);
    await this.db.saveReferences(paperId, refs);
    return ref;
  }

  /** 更新参考文献（仅写入 MySQL） */
  async updateReference(paperId: string, refId: string, ref: Reference) {
    const refs = await this.listReferences(paperId);
    const idx = refs.findIndex((r: any) => r.id === refId);
    if (idx === -1) throw new NotFoundException(`Reference "${refId}" not found`);
    refs[idx] = ref as any;
    await this.db.saveReferences(paperId, refs);
    return ref;
  }

  /** 删除参考文献（仅从 MySQL 删除） */
  async deleteReference(paperId: string, refId: string) {
    const refs = await this.listReferences(paperId);
    const filtered = refs.filter((r: any) => r.id !== refId);
    await this.db.saveReferences(paperId, filtered);
    return { ok: true };
  }

  // ── Detection Stats ──

  /** 获取 AI 检测统计（暂从文件系统读取，后续可迁移到 MySQL） */
  async getDetectionStats(paperId: string) {
    const state = new StateManager(this.projectRoot);
    return state.loadAIDetectionLog(paperId).catch(() => []);
  }

  // ── Innovations ──

  /** 获取创新点列表（从 MySQL） */
  async getInnovations(paperId: string) {
    return this.db.loadInnovations(paperId);
  }

  /** 更新创新点（仅写入 MySQL） */
  async updateInnovation(paperId: string, pointId: string, data: Record<string, unknown>) {
    const points = await this.getInnovations(paperId);
    const idx = points.findIndex((p: any) => p.id === pointId);
    if (idx === -1) throw new NotFoundException(`Innovation point "${pointId}" not found`);
    points[idx] = { ...points[idx], ...data };
    await this.db.saveInnovations(paperId, points);
    return points[idx];
  }

  // ── Export ──

  /**
   * 导出论文为 Word 文档
   * 从 MySQL 读取数据，传给 WordExporter
   * @param paperId - 论文 ID
   * @param format - 导出格式（目前支持 docx）
   * @returns 导出文件路径
   */
  async exportPaper(paperId: string, format: string) {
    // 从 MySQL 读取论文数据
    const paper = await this.paperRepo.findOne({ where: { id: paperId } });
    if (!paper) throw new NotFoundException(`Paper "${paperId}" not found`);

    const sections = await this.db.listSections(paperId);
    const outlineData = await this.db.loadOutline(paperId);
    const dbRefs = await this.db.loadReferences(paperId);

    // 转换参考文献类型以匹配 WordExporter 期望
    const references = dbRefs.map((r) => ({
      ...r,
      type: (r.type as Reference["type"]) ?? "other",
    }));

    const exporter = new WordExporter();
    const { join } = await import("node:path");
    const result = await exporter.export({
      paperId,
      title: paper.title,
      major: paper.major,
      language: paper.language as "zh" | "en",
      citationFormat: ((paper as any).citationFormat ?? "gb7714") as PaperConfig["citationFormat"],
      sections: sections as any,
      outline: (outlineData?.sections ?? []) as never,
      references: references as any,
      outputDir: join(this.projectRoot, "papers", paperId, "exports"),
    });
    return { filePath: result.filePath };
  }

  // ── Runtime status ──

  /** 获取运行时流水线状态（从 MySQL） */
  async getRuntimeStatus(paperId: string) {
    return this.db.loadPipelineState(paperId) ?? { status: "idle" };
  }

  // ── Internal helpers ──

  /**
   * 从文件系统同步章节到 MySQL
   * 流水线完成后调用，确保 MySQL 中有最新的章节数据
   * PaperRunner 写文件系统，此方法将结果同步到 MySQL
   */
  private async syncSectionsFromFilesystem(paperId: string) {
    try {
      const state = new StateManager(this.projectRoot);
      const sections = await state.listSections(paperId);
      for (const s of sections) {
        await this.db.saveSection(paperId, {
          sectionNumber: (s as any).sectionNumber ?? "",
          title: (s as any).title,
          content: (s as any).content,
          wordCount: (s as any).wordCount ?? 0,
          status: (s as any).status ?? "drafted",
          aiDetectionScore: (s as any).aiDetectionScore,
        });
      }
    } catch { /* best-effort */ }
  }

  /**
   * 构建 PaperRunner 实例
   * PaperRunner 需要 StateManager 来写文件系统
   */
  private async buildRunner(paperId: string, _userId: string) {
    const config = await this.loadLLMConfig();
    const ctx: AgentContext = {
      client: createLLMClient(config.llm),
      model: config.llm.model,
      projectRoot: this.projectRoot,
    };
    const state = new StateManager(this.projectRoot);
    const runner = new PaperRunner(ctx);

    const options: PaperRunnerOptions = {
      paperId,
      context: ctx,
      stateManager: state,
      aiDetectionMode: "free",
      onEvent: (event) => {
        this.eventEmitter.emit(`paper:${event.type}`, {
          paperId, stage: event.stage, message: event.message, data: event.data,
        });
      },
    };

    return { runner, options };
  }

  /**
   * 加载 LLM 配置
   */
  private async loadLLMConfig() {
    const { loadProjectConfig } = await import("@actalk/inkos-core");
    return loadProjectConfig(this.projectRoot, { consumer: "studio" });
  }
}
