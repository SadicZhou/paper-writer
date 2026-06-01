import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PaperConfig, Reference } from "../models/paper.js";
import { PaperConfigSchema, ReferenceSchema } from "../models/paper.js";
import type { PaperOutline, SectionNode } from "../models/paper-outline.js";
import { PaperOutlineSchema } from "../models/paper-outline.js";
import type { PaperSectionState, PipelineState, PaperProjectSummary, InnovationPoint, CitationMap, AIDetectionLog } from "../models/paper-state.js";
import { PaperSectionStateSchema, PipelineStateSchema, InnovationPointSchema, CitationMapSchema, AIDetectionLogSchema } from "../models/paper-state.js";

function countLeafSections(sections: SectionNode[]): number {
  let count = 0;
  for (const s of sections) {
    if (s.children.length === 0) {
      count++;
    } else {
      count += countLeafSections(s.children);
    }
  }
  return count;
}

export class StateManager {
  constructor(private readonly projectRoot: string) {}

  // ── Path helpers ────────────────────────────────────────

  private papersDir(): string {
    return join(this.projectRoot, "papers");
  }

  private paperDir(paperId: string): string {
    return join(this.papersDir(), paperId);
  }

  private stateDir(paperId: string): string {
    return join(this.paperDir(paperId), "state");
  }

  private runtimeDir(paperId: string): string {
    return join(this.paperDir(paperId), "runtime");
  }

  private exportsDir(paperId: string): string {
    return join(this.paperDir(paperId), "exports");
  }

  private sectionsDir(paperId: string): string {
    return join(this.stateDir(paperId), "sections");
  }

  // ── Initialization ──────────────────────────────────────

  async ensurePaperDirectories(paperId: string): Promise<void> {
    await mkdir(this.papersDir(), { recursive: true });
    await mkdir(this.paperDir(paperId), { recursive: true });
    await mkdir(this.stateDir(paperId), { recursive: true });
    await mkdir(this.runtimeDir(paperId), { recursive: true });
    await mkdir(this.exportsDir(paperId), { recursive: true });
    await mkdir(this.sectionsDir(paperId), { recursive: true });
  }

  // ── Paper CRUD ──────────────────────────────────────────

  async createPaper(config: PaperConfig): Promise<void> {
    await this.ensurePaperDirectories(config.id);
    await this.savePaperConfig(config);
    await this.savePipelineState(config.id, {
      paperId: config.id,
      currentStage: "idle",
      status: "idle",
      completedStages: [],
      totalSections: 0,
      completedSections: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      events: [],
    });
  }

  async savePaperConfig(config: PaperConfig): Promise<void> {
    await writeFile(
      join(this.paperDir(config.id), "paper.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  async loadPaperConfig(paperId: string): Promise<PaperConfig> {
    const raw = await readFile(join(this.paperDir(paperId), "paper.json"), "utf-8");
    return PaperConfigSchema.parse(JSON.parse(raw));
  }

  async deletePaper(paperId: string): Promise<void> {
    await rm(this.paperDir(paperId), { recursive: true, force: true });
  }

  async listPapers(): Promise<PaperProjectSummary[]> {
    try {
      const entries = await readdir(this.papersDir(), { withFileTypes: true });
      const paperIds = entries.filter((e: { isDirectory(): boolean }) => e.isDirectory()).map((e: { name: string }) => e.name);
      const summaries: PaperProjectSummary[] = [];
      for (const id of paperIds) {
        try {
          const config = await this.loadPaperConfig(id);
          const pipeline = await this.loadPipelineState(id).catch(() => null);
          const sections = await this.listSections(id).catch(() => []);
          const outline = await this.loadOutline(id).catch(() => null);
          const detectionStats = await this.loadAIDetectionLog(id).catch(() => []);
          const latestScore = detectionStats
            .filter((d) => d.action === "detect")
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]?.score;

          // Total sections: max of outline leaf count and actual saved sections
          const outlineTotal = outline
            ? countLeafSections(outline.sections)
            : 0;
          const totalSections = Math.max(outlineTotal, sections.length);

          // Completed: sections with content (drafted, polishing, or approved)
          const completedSections = sections.filter(
            (s) => s.status === "approved" || s.status === "drafted" || s.status === "polishing",
          ).length;

          summaries.push({
            id,
            title: config.title,
            major: config.major,
            degreeLevel: config.degreeLevel,
            totalSections,
            completedSections,
            totalWords: sections.reduce((sum, s) => sum + s.wordCount, 0),
            aiDetectionScore: latestScore,
            pipelineStage: pipeline?.currentStage ?? "idle",
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          });
        } catch {
          // Skip broken paper directories
        }
      }
      return summaries.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  // ── Section management ──────────────────────────────────

  async saveSection(paperId: string, section: PaperSectionState): Promise<void> {
    const path = join(this.sectionsDir(paperId), `${section.sectionNumber}.json`);
    await writeFile(path, JSON.stringify(section, null, 2), "utf-8");
  }

  async loadSection(paperId: string, number: string): Promise<PaperSectionState> {
    const path = join(this.sectionsDir(paperId), `${number}.json`);
    const raw = await readFile(path, "utf-8");
    return PaperSectionStateSchema.parse(JSON.parse(raw));
  }

  async listSections(paperId: string): Promise<PaperSectionState[]> {
    try {
      const files = await readdir(this.sectionsDir(paperId));
      const jsonFiles = files.filter((f: string) => f.endsWith(".json"));
      const sections: PaperSectionState[] = [];
      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(this.sectionsDir(paperId), file), "utf-8");
          sections.push(PaperSectionStateSchema.parse(JSON.parse(raw)));
        } catch {
          // Skip broken section files
        }
      }
      return sections.sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber));
    } catch {
      return [];
    }
  }

  async deleteSection(paperId: string, number: string): Promise<void> {
    const path = join(this.sectionsDir(paperId), `${number}.json`);
    await rm(path, { force: true });
  }

  // ── Outline management ──────────────────────────────────

  async saveOutline(paperId: string, outline: PaperOutline): Promise<void> {
    const path = join(this.stateDir(paperId), "outline.json");
    await writeFile(path, JSON.stringify(outline, null, 2), "utf-8");
  }

  async loadOutline(paperId: string): Promise<PaperOutline> {
    const path = join(this.stateDir(paperId), "outline.json");
    const raw = await readFile(path, "utf-8");
    return PaperOutlineSchema.parse(JSON.parse(raw));
  }

  // ── References management ───────────────────────────────

  async saveReferences(paperId: string, refs: Reference[]): Promise<void> {
    const path = join(this.stateDir(paperId), "references.json");
    const validated = refs.map((r) => ReferenceSchema.parse(r));
    await writeFile(path, JSON.stringify(validated, null, 2), "utf-8");
  }

  async loadReferences(paperId: string): Promise<Reference[]> {
    try {
      const path = join(this.stateDir(paperId), "references.json");
      const raw = await readFile(path, "utf-8");
      return z.array(ReferenceSchema).parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  // ── Innovation points ───────────────────────────────────

  async saveInnovationPoints(paperId: string, points: InnovationPoint[]): Promise<void> {
    const path = join(this.stateDir(paperId), "innovation_points.json");
    await writeFile(path, JSON.stringify(points, null, 2), "utf-8");
  }

  async loadInnovationPoints(paperId: string): Promise<InnovationPoint[]> {
    try {
      const path = join(this.stateDir(paperId), "innovation_points.json");
      const raw = await readFile(path, "utf-8");
      return z.array(InnovationPointSchema).parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  // ── Citation map ────────────────────────────────────────

  async saveCitationMap(paperId: string, map: CitationMap): Promise<void> {
    const path = join(this.stateDir(paperId), "citation_map.json");
    await writeFile(path, JSON.stringify(map, null, 2), "utf-8");
  }

  async loadCitationMap(paperId: string): Promise<CitationMap> {
    try {
      const path = join(this.stateDir(paperId), "citation_map.json");
      const raw = await readFile(path, "utf-8");
      return CitationMapSchema.parse(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  // ── AI detection log ────────────────────────────────────

  async saveAIDetectionLog(paperId: string, logs: AIDetectionLog[]): Promise<void> {
    const path = join(this.stateDir(paperId), "ai_detection_log.json");
    await writeFile(path, JSON.stringify(logs, null, 2), "utf-8");
  }

  async loadAIDetectionLog(paperId: string): Promise<AIDetectionLog[]> {
    try {
      const path = join(this.stateDir(paperId), "ai_detection_log.json");
      const raw = await readFile(path, "utf-8");
      return z.array(AIDetectionLogSchema).parse(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  async appendAIDetectionLog(paperId: string, entry: AIDetectionLog): Promise<void> {
    const logs = await this.loadAIDetectionLog(paperId);
    logs.push(entry);
    await this.saveAIDetectionLog(paperId, logs);
  }

  // ── Pipeline state ──────────────────────────────────────

  async savePipelineState(paperId: string, state: PipelineState): Promise<void> {
    const path = join(this.runtimeDir(paperId), "pipeline_state.json");
    await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
  }

  async loadPipelineState(paperId: string): Promise<PipelineState> {
    const path = join(this.runtimeDir(paperId), "pipeline_state.json");
    const raw = await readFile(path, "utf-8");
    return PipelineStateSchema.parse(JSON.parse(raw));
  }
}
