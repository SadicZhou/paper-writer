import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PaperSectionEntity } from "../entities/paper-section.entity.js";
import { PaperOutlineEntity } from "../entities/paper-outline.entity.js";
import { PaperReferenceEntity } from "../entities/paper-reference.entity.js";
import { PaperInnovationEntity } from "../entities/paper-innovation.entity.js";
import { PipelineStateEntity } from "../entities/pipeline-state.entity.js";

@Injectable()
export class DbStorageService {
  constructor(
    @InjectRepository(PaperSectionEntity) private sectionRepo: Repository<PaperSectionEntity>,
    @InjectRepository(PaperOutlineEntity) private outlineRepo: Repository<PaperOutlineEntity>,
    @InjectRepository(PaperReferenceEntity) private refRepo: Repository<PaperReferenceEntity>,
    @InjectRepository(PaperInnovationEntity) private innovRepo: Repository<PaperInnovationEntity>,
    @InjectRepository(PipelineStateEntity) private pipelineRepo: Repository<PipelineStateEntity>,
  ) {}

  // ── Sections ──

  async saveSection(paperId: string, section: { sectionNumber: string; title?: string; content?: string; wordCount?: number; status?: string; aiDetectionScore?: number }) {
    const existing = await this.sectionRepo.findOne({ where: { paperId, sectionNumber: section.sectionNumber } });
    if (existing) {
      Object.assign(existing, section);
      await this.sectionRepo.save(existing);
    } else {
      await this.sectionRepo.save(this.sectionRepo.create({ paperId, ...section }));
    }
  }

  async loadSection(paperId: string, number: string) {
    return this.sectionRepo.findOne({ where: { paperId, sectionNumber: number } });
  }

  async listSections(paperId: string) {
    return this.sectionRepo.find({ where: { paperId }, order: { sectionNumber: "ASC" } });
  }

  // ── Outline ──

  async saveOutline(paperId: string, title: string, sections: unknown) {
    const existing = await this.outlineRepo.findOne({ where: { paperId } });
    const sectionsJson = JSON.stringify(sections);
    if (existing) {
      existing.title = title;
      existing.sectionsJson = sectionsJson;
      await this.outlineRepo.save(existing);
    } else {
      await this.outlineRepo.save(this.outlineRepo.create({ paperId, title, sectionsJson }));
    }
  }

  async loadOutline(paperId: string) {
    const row = await this.outlineRepo.findOne({ where: { paperId } });
    if (!row) return null;
    return { paperId, title: row.title, sections: JSON.parse(row.sectionsJson) };
  }

  // ── References ──

  async saveReferences(paperId: string, refs: any[]) {
    await this.refRepo.delete({ paperId });
    if (refs.length === 0) return;
    const rows = refs.map((r) => this.refRepo.create({
      paperId,
      refId: r.id ?? String(Math.random()),
      type: r.type ?? "other",
      title: r.title ?? "",
      authorsJson: r.authors ? JSON.stringify(r.authors) : undefined,
      year: r.year,
      journal: r.journal,
      volume: r.volume,
      issue: r.issue,
      pages: r.pages,
      doi: r.doi,
      url: r.url,
      rawCitation: r.rawCitation ?? r.title ?? "",
    }));
    await this.refRepo.save(rows);
  }

  async loadReferences(paperId: string) {
    const rows = await this.refRepo.find({ where: { paperId } });
    return rows.map((r) => ({
      id: r.refId,
      type: r.type,
      title: r.title,
      authors: r.authorsJson ? JSON.parse(r.authorsJson) : [],
      year: r.year,
      journal: r.journal,
      volume: r.volume,
      issue: r.issue,
      pages: r.pages,
      doi: r.doi,
      url: r.url,
      rawCitation: r.rawCitation,
    }));
  }

  // ── Innovations ──

  async saveInnovations(paperId: string, points: any[]) {
    await this.innovRepo.delete({ paperId });
    if (points.length === 0) return;
    const rows = points.map((p) => this.innovRepo.create({
      paperId,
      pointId: p.id ?? String(Math.random()),
      title: p.title ?? "",
      content: p.content,
      status: p.status ?? "planned",
    }));
    await this.innovRepo.save(rows);
  }

  async loadInnovations(paperId: string) {
    const rows = await this.innovRepo.find({ where: { paperId } });
    return rows.map((r) => ({ id: r.pointId, title: r.title, content: r.content, status: r.status }));
  }

  // ── Pipeline State ──

  async savePipelineState(paperId: string, state: any) {
    const existing = await this.pipelineRepo.findOne({ where: { paperId } });
    const row: Partial<PipelineStateEntity> = {
      paperId,
      currentStage: state.currentStage ?? state.stage ?? "idle",
      completedStagesJson: state.completedStages ? JSON.stringify(state.completedStages) : undefined,
      status: state.status ?? "idle",
      error: state.error,
      totalSections: state.totalSections ?? 0,
      completedSections: state.completedSections ?? 0,
      eventsJson: state.events ? JSON.stringify(state.events) : undefined,
    };
    if (existing) {
      await this.pipelineRepo.update({ paperId }, row);
    } else {
      await this.pipelineRepo.save(this.pipelineRepo.create(row));
    }
  }

  async loadPipelineState(paperId: string) {
    const row = await this.pipelineRepo.findOne({ where: { paperId } });
    if (!row) return null;
    return {
      currentStage: row.currentStage,
      completedStages: row.completedStagesJson ? JSON.parse(row.completedStagesJson) : [],
      status: row.status,
      error: row.error,
      totalSections: row.totalSections,
      completedSections: row.completedSections,
      events: row.eventsJson ? JSON.parse(row.eventsJson) : [],
    };
  }

  // ── Bulk delete ──

  async deleteAll(paperId: string) {
    await Promise.all([
      this.sectionRepo.delete({ paperId }),
      this.outlineRepo.delete({ paperId }),
      this.refRepo.delete({ paperId }),
      this.innovRepo.delete({ paperId }),
      this.pipelineRepo.delete({ paperId }),
    ]);
  }
}
