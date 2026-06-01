import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  StateManager,
  PaperRunner,
  WordExporter,
  createLLMClient,
  type AgentContext,
  type PaperRunnerOptions,
  type PaperConfig,
  type Reference,
} from "@actalk/inkos-core";
import { Paper } from "../entities/paper.entity.js";
import { UserService } from "../user/user.service.js";
import { DbStorageService } from "./db-storage.service.js";

@Injectable()
export class PaperService {
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

  async listPapers(userId: string) {
    const [dbPapers, state] = [await this.paperRepo.find({ where: { userId } }), new StateManager(this.projectRoot)];
    const filePapers = await state.listPapers().catch(() => []);
    // Merge DB metadata with file-based paper records
    return filePapers.map((fp) => {
      const db = dbPapers.find((p) => p.id === fp.id);
      return { ...fp, status: db?.status ?? "draft", currentWordCount: db?.currentWordCount ?? 0 };
    });
  }

  async createPaper(userId: string, dto: {
    title: string; major: string; degreeLevel?: string; proposalText?: string;
    references?: Array<Record<string, unknown>>; targetWordCount?: number;
    citationFormat?: string; language?: string;
  }) {
    const { derivePaperIdFromTitle } = await import("@actalk/inkos-core");
    const paperId = derivePaperIdFromTitle(dto.title.trim());
    const now = new Date().toISOString();

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

    // Track in DB
    const paper = this.paperRepo.create({
      id: paperId, userId, title: dto.title.trim(),
      major: dto.major.trim(), degreeLevel: dto.degreeLevel,
      language: dto.language === "en" ? "en" : "zh",
    });
    await this.paperRepo.save(paper);
    await this.userService.incrementPapersCreated(userId);

    this.eventEmitter.emit("paper:created", { paperId, userId, title: dto.title.trim() });
    return paperConfig;
  }

  async getPaper(paperId: string) {
    const state = new StateManager(this.projectRoot);
    const paper = await state.loadPaperConfig(paperId).catch(() => null);
    if (!paper) throw new NotFoundException(`Paper "${paperId}" not found`);
    return paper;
  }

  async deletePaper(userId: string, paperId: string) {
    const state = new StateManager(this.projectRoot);
    await state.deletePaper(paperId).catch(() => { throw new NotFoundException(`Paper "${paperId}" not found`); });
    await Promise.all([
      this.paperRepo.delete({ id: paperId, userId }),
      this.db.deleteAll(paperId),
    ]);
    return { ok: true };
  }

  async updatePaper(paperId: string, dto: Record<string, unknown>) {
    const state = new StateManager(this.projectRoot);
    const paper = await state.loadPaperConfig(paperId).catch(() => null);
    if (!paper) throw new NotFoundException(`Paper "${paperId}" not found`);
    const updates: Record<string, unknown> = {};
    if (typeof dto.title === "string") updates.title = dto.title;
    if (typeof dto.major === "string") updates.major = dto.major;
    if (typeof dto.degreeLevel === "string") updates.degreeLevel = dto.degreeLevel;
    if (typeof dto.proposalText === "string") updates.proposalText = dto.proposalText;
    if (typeof dto.targetWordCount === "number") updates.targetWordCount = dto.targetWordCount;
    if (typeof dto.citationFormat === "string") updates.citationFormat = dto.citationFormat;
    if (typeof dto.language === "string") updates.language = dto.language;
    const updated = { ...paper, ...updates, id: paperId, updatedAt: new Date().toISOString() } as PaperConfig;
    await state.savePaperConfig(updated);
    return updated;
  }

  // ── Pipeline ──

  async getPipelineStatus(paperId: string) {
    const state = new StateManager(this.projectRoot);
    return state.loadPipelineState(paperId).catch(() => ({ stage: "idle" }));
  }

  async resetPipeline(paperId: string) {
    // Clear DB
    await this.db.savePipelineState(paperId, { status: "idle", currentStage: "idle", completedStages: [], events: [] });
    // Clear filesystem
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

  async runPipeline(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.run(options).then(
      () => this.eventEmitter.emit("paper:pipeline-done", { paperId, userId }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, userId, error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId };
  }

  async runBrainstorm(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runBrainstormOnly(options).then(
      (result) => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "brainstorm", result }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "brainstorm", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "brainstorm" };
  }

  async runLiteratureSearch(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runLiteratureSearchOnly(options).then(
      () => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "literature-search" }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "literature-search", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "literature-search" };
  }

  async runOutline(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    runner.runOutlineOnly(options).then(
      () => this.eventEmitter.emit("paper:stage-complete", { paperId, stage: "outline" }),
      (e: unknown) => this.eventEmitter.emit("paper:stage-error", { paperId, stage: "outline", error: e instanceof Error ? e.message : String(e) }),
    );
    return { status: "started", paperId, stage: "outline" };
  }

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

  async runDetection(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    const result = await runner.runDetectionAll(options);
    return result;
  }

  async runReduction(paperId: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    const result = await runner.runReduceAll(options);
    return result;
  }

  async regenerateSection(paperId: string, sectionNum: string, userId: string) {
    const { runner, options } = await this.buildRunner(paperId, userId);
    const state = new StateManager(this.projectRoot);
    runner.regenerateSection(paperId, sectionNum, state).then(
      async (result) => {
        // Sync regenerated section from filesystem to MySQL
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

  async listSections(paperId: string) {
    // MySQL first
    const dbSections = await this.db.listSections(paperId);
    if (dbSections.length > 0) return dbSections;
    // Filesystem fallback
    const state = new StateManager(this.projectRoot);
    return state.listSections(paperId);
  }

  async getSection(paperId: string, num: string) {
    // MySQL first
    let section = await this.db.loadSection(paperId, num);
    if (section) return section;
    // Filesystem fallback
    const state = new StateManager(this.projectRoot);
    section = await state.loadSection(paperId, num).catch(() => null) as any;
    if (!section) throw new NotFoundException(`Section ${num} not found in paper "${paperId}"`);
    return section;
  }

  async saveSection(paperId: string, num: string, body: { content: string }) {
    // MySQL
    await this.db.saveSection(paperId, {
      sectionNumber: num,
      content: body.content,
      wordCount: body.content.length,
      status: "drafted",
    });
    // Filesystem (backward compat)
    try {
      const state = new StateManager(this.projectRoot);
      const existing = await state.loadSection(paperId, num).catch(() => null);
      const section = existing
        ? { ...existing, content: body.content, wordCount: body.content.length }
        : { sectionNumber: num, title: `Section ${num}`, content: body.content, wordCount: body.content.length, status: "drafted" as const };
      await state.saveSection(paperId, section as any);
    } catch { /* filesystem write failed, DB is primary */ }
    return { ok: true };
  }

  // ── Outline ──

  async getOutline(paperId: string) {
    const dbOutline = await this.db.loadOutline(paperId);
    if (dbOutline) return dbOutline;
    const state = new StateManager(this.projectRoot);
    return state.loadOutline(paperId).catch(() => []);
  }

  async saveOutline(paperId: string, outline: any) {
    await this.db.saveOutline(paperId, outline.title || "", outline.sections || outline);
    try {
      const state = new StateManager(this.projectRoot);
      await state.saveOutline(paperId, outline as never);
    } catch { /* */ }
    return { ok: true };
  }

  // ── References ──

  async listReferences(paperId: string) {
    const dbRefs = await this.db.loadReferences(paperId);
    if (dbRefs.length > 0) return dbRefs;
    const state = new StateManager(this.projectRoot);
    return state.loadReferences(paperId).catch(() => [] as Reference[]);
  }

  async addReference(paperId: string, ref: Reference) {
    const refs = await this.listReferences(paperId);
    refs.push(ref as any);
    await this.db.saveReferences(paperId, refs);
    try { const state = new StateManager(this.projectRoot); await state.saveReferences(paperId, refs as any); } catch { /* */ }
    return ref;
  }

  async updateReference(paperId: string, refId: string, ref: Reference) {
    const refs = await this.listReferences(paperId);
    const idx = refs.findIndex((r: any) => r.id === refId);
    if (idx === -1) throw new NotFoundException(`Reference "${refId}" not found`);
    refs[idx] = ref as any;
    await this.db.saveReferences(paperId, refs);
    try { const state = new StateManager(this.projectRoot); await state.saveReferences(paperId, refs as any); } catch { /* */ }
    return ref;
  }

  async deleteReference(paperId: string, refId: string) {
    const refs = await this.listReferences(paperId);
    const filtered = refs.filter((r: any) => r.id !== refId);
    await this.db.saveReferences(paperId, filtered);
    try { const state = new StateManager(this.projectRoot); await state.saveReferences(paperId, filtered as any); } catch { /* */ }
    return { ok: true };
  }

  // ── Detection Stats ──

  async getDetectionStats(paperId: string) {
    const state = new StateManager(this.projectRoot);
    return state.loadAIDetectionLog(paperId).catch(() => []);
  }

  // ── Innovations ──

  async getInnovations(paperId: string) {
    const dbInnovs = await this.db.loadInnovations(paperId);
    if (dbInnovs.length > 0) return dbInnovs;
    const state = new StateManager(this.projectRoot);
    return state.loadInnovationPoints(paperId).catch(() => []);
  }

  async updateInnovation(paperId: string, pointId: string, data: Record<string, unknown>) {
    const points = await this.getInnovations(paperId);
    const idx = points.findIndex((p: any) => p.id === pointId);
    if (idx === -1) throw new NotFoundException(`Innovation point "${pointId}" not found`);
    points[idx] = { ...points[idx], ...data };
    await this.db.saveInnovations(paperId, points);
    try { const state = new StateManager(this.projectRoot); await state.saveInnovationPoints(paperId, points as any); } catch { /* */ }
    return points[idx];
  }

  // ── Export ──

  async exportPaper(paperId: string, format: string) {
    const state = new StateManager(this.projectRoot);
    const paper = await state.loadPaperConfig(paperId);
    const sections = await state.listSections(paperId);
    const outline = await state.loadOutline(paperId).catch(() => []);
    const references = await state.loadReferences(paperId);

    const exporter = new WordExporter();
    const { join } = await import("node:path");
    const result = await exporter.export({
      paperId,
      title: paper.title,
      major: paper.major,
      language: paper.language,
      citationFormat: paper.citationFormat,
      sections,
      outline: outline as never,
      references,
      outputDir: join(this.projectRoot, "papers", paperId, "exports"),
    });
    return { filePath: result.filePath };
  }

  // ── Runtime status ──

  async getRuntimeStatus(paperId: string) {
    const dbState = await this.db.loadPipelineState(paperId);
    if (dbState) return dbState;
    const state = new StateManager(this.projectRoot);
    return state.loadPipelineState(paperId).catch(() => ({ status: "idle" }));
  }

  // ── Internal helpers ──

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

  private async loadLLMConfig() {
    const { loadProjectConfig } = await import("@actalk/inkos-core");
    return loadProjectConfig(this.projectRoot, { consumer: "studio" });
  }
}
