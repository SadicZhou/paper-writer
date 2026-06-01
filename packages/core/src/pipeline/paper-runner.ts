import type { AgentContext } from "../agents/base.js";
import { TopicBrainstormer } from "../agents/topic-brainstormer.js";
import type { BrainstormOutput, ExtractInnovationsInput } from "../agents/topic-brainstormer.js";
import { LiteratureSearcher } from "../agents/literature-searcher.js";
import type { LiteratureSearchOutput } from "../agents/literature-searcher.js";
import { OutlineBuilder } from "../agents/outline-builder.js";
import type { OutlineBuildOutput } from "../agents/outline-builder.js";
import { SectionWriter } from "../agents/section-writer.js";
import type { SectionWriteOutput } from "../agents/section-writer.js";
import { AIDetectionAuditor } from "../agents/ai-detection-auditor.js";
import type { DetectionOutput } from "../agents/ai-detection-auditor.js";
import { AIReductionReviser } from "../agents/ai-reduction-reviser.js";
import { AcademicPolisher } from "../agents/academic-polisher.js";
import { DiagramVerifier } from "../agents/diagram-verifier.js";
import type { DiagramVerifyOutput } from "../agents/diagram-verifier.js";
import { CitationFormatter } from "../agents/citation-formatter.js";
import type { PaperConfig, Reference } from "../models/paper.js";
import type { SectionNode } from "../models/paper-outline.js";
import type { InnovationPoint, PaperSectionState, PipelineState, PipelineEventEntry, PipelineStage } from "../models/paper-state.js";
import type { Logger } from "../utils/logger.js";
import { StateManager } from "../state/manager.js";

export type PipelineEventType =
  | "stage-start"
  | "stage-progress"
  | "stage-complete"
  | "stage-error"
  | "section-writing"
  | "section-diagram-verify"
  | "section-detection"
  | "section-polishing"
  | "pipeline-done";

export interface PipelineEvent {
  readonly type: PipelineEventType;
  readonly stage?: PipelineStage;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export type PipelineEventCallback = (event: PipelineEvent) => void;

export interface PaperRunnerOptions {
  readonly paperId: string;
  readonly context: AgentContext;
  readonly stateManager: StateManager;
  readonly onEvent?: PipelineEventCallback;
  readonly aiDetectionMode?: "free" | "paid";
  readonly aiDetectionProvider?: "gptzero" | "originality" | "custom";
  readonly aiDetectionApiKey?: string;
  readonly targetAIScore?: number;
  readonly maxAIReductionIterations?: number;
  readonly resumeFromStage?: PipelineStage;
}

interface RunnerState {
  innovationPoints: InnovationPoint[];
  references: Reference[];
  outline: SectionNode[];
  sections: Map<string, PaperSectionState>;
  literatureReviewDraft: string;
  currentStage: PipelineStage;
  completedStages: PipelineStage[];
  events: PipelineEventEntry[];
}

export class PaperRunner {
  private ctx: AgentContext;

  constructor(ctx: AgentContext) {
    this.ctx = ctx;
  }

  private get brainstormer(): TopicBrainstormer { return new TopicBrainstormer(this.ctx); }
  private get searcher(): LiteratureSearcher { return new LiteratureSearcher(this.ctx); }
  private get outliner(): OutlineBuilder { return new OutlineBuilder(this.ctx); }
  private get writer(): SectionWriter { return new SectionWriter(this.ctx); }
  private get auditor(): AIDetectionAuditor { return new AIDetectionAuditor(this.ctx); }
  private get reviser(): AIReductionReviser { return new AIReductionReviser(this.ctx); }
  private get polisher(): AcademicPolisher { return new AcademicPolisher(this.ctx); }
  private get diagramVerifier(): DiagramVerifier { return new DiagramVerifier(this.ctx); }
  private get citationFormatter(): CitationFormatter { return new CitationFormatter(); }

  async run(options: PaperRunnerOptions): Promise<void> {
    const { paperId, stateManager, onEvent, resumeFromStage } = options;

    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, resumeFromStage);

    const collectEvent = (event: PipelineEvent) => {
      state.events.push({
        timestamp: new Date().toISOString(),
        type: event.type,
        stage: event.stage,
        message: event.message ?? "",
      });
      // Cap at 300 entries
      if (state.events.length > 300) state.events = state.events.slice(-300);
    };
    const emit = (event: PipelineEvent) => {
      collectEvent(event);
      onEvent?.(event);
    };

    // Mark pipeline as running
    state.events = [];
    await this.saveState(paperId, stateManager, state, config, "running");

    try {
      if (this.shouldRunStage(state.currentStage, "brainstorm")) {
        if (config.title.trim().length > 0) {
          // Title is pre-set by user: skip topic generation, extract innovations from proposal
          emit({ type: "stage-start", stage: "brainstorm", message: "Skipping topic generation — using pre-set title" });
          try {
            state.innovationPoints = await this.brainstormer.extractInnovationsForTopic({
              topic: config.title,
              major: config.major,
              degreeLevel: config.degreeLevel,
              proposalText: config.proposalText,
              language: config.language,
            });
          } catch {
            // Extraction failed — proceed with empty innovations
            state.innovationPoints = [];
          }
          this.markCompleted(state, "brainstorm");
          state.currentStage = "literature-search";
          emit({
            type: "stage-complete",
            stage: "brainstorm",
            message: `Brainstorm skipped — using pre-set title: ${config.title}`,
            data: { topic: config.title, innovationCount: state.innovationPoints.length },
          });
          await this.saveState(paperId, stateManager, state, config);
        } else {
          await this.runBrainstorm(config, state, emit, options);
          this.markCompleted(state, "brainstorm");
          await this.saveState(paperId, stateManager, state, config);
        }
      }
      if (this.shouldRunStage(state.currentStage, "literature-search")) {
        await this.runLiteratureSearch(config, state, emit, options);
        this.markCompleted(state, "literature-search");
        await this.saveState(paperId, stateManager, state, config);
      }
      if (this.shouldRunStage(state.currentStage, "outline")) {
        await this.runOutlineBuild(config, state, emit, options);
        this.markCompleted(state, "outline");
        await this.saveState(paperId, stateManager, state, config);
      }
      if (this.shouldRunStage(state.currentStage, "writing")) {
        await this.runSectionWriting(config, state, emit, options);
        this.markCompleted(state, "writing");
        await this.saveState(paperId, stateManager, state, config);
      }
      if (this.shouldRunStage(state.currentStage, "polish")) {
        await this.runPolishAndReduce(config, state, emit, options);
        this.markCompleted(state, "polish");
        await this.saveState(paperId, stateManager, state, config);
      }
      if (this.shouldRunStage(state.currentStage, "format-export")) {
        await this.runExport(paperId, config, state, emit, options);
        this.markCompleted(state, "format-export");
        await this.saveState(paperId, stateManager, state, config);
      }

      emit({ type: "pipeline-done", message: "Pipeline complete", data: { paperId } });
      await this.saveState(paperId, stateManager, state, config, "completed");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      emit({
        type: "stage-error",
        stage: state.currentStage,
        message: errorMessage,
        data: { paperId },
      });
      // Persist error so the UI can show it and retry can pick up
      try {
        await stateManager.savePipelineState(paperId, {
          paperId,
          status: "error",
          currentStage: state.currentStage,
          completedStages: state.completedStages,
          totalSections: state.outline.length,
          completedSections: state.sections.size,
          startedAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          error: errorMessage,
          events: state.events,
        });
      } catch { /* best effort */ }
      throw err;
    }
  }

  /** Run only the brainstorm stage. */
  async runBrainstormOnly(options: PaperRunnerOptions): Promise<BrainstormOutput> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, "brainstorm");
    const emit = (event: PipelineEvent) => onEvent?.(event);
    const result = await this.runBrainstorm(config, state, emit, options);
    await this.saveState(paperId, stateManager, state, config);
    return result;
  }

  /** Run only the literature search stage. */
  async runLiteratureSearchOnly(options: PaperRunnerOptions): Promise<void> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, "literature-search");
    const emit = (event: PipelineEvent) => onEvent?.(event);
    await this.runLiteratureSearch(config, state, emit, options);
    await this.saveState(paperId, stateManager, state, config);
  }

  /** Run only the outline stage. */
  async runOutlineOnly(options: PaperRunnerOptions): Promise<void> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, "outline");
    const emit = (event: PipelineEvent) => onEvent?.(event);
    await this.runOutlineBuild(config, state, emit, options);
    await this.saveState(paperId, stateManager, state, config);
  }

  /** Run only the writing stage. */
  async runWritingOnly(options: PaperRunnerOptions): Promise<void> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, "writing");
    const emit = (event: PipelineEvent) => onEvent?.(event);
    await this.runSectionWriting(config, state, emit, options);
    await this.saveState(paperId, stateManager, state, config);
  }

  /** Run only the polish & reduce stage. */
  async runPolishOnly(options: PaperRunnerOptions): Promise<void> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config, "polish");
    const emit = (event: PipelineEvent) => onEvent?.(event);
    await this.runPolishAndReduce(config, state, emit, options);
    await this.saveState(paperId, stateManager, state, config);
  }

  /** Run detection on all sections, returning per-section scores. */
  async runDetectionAll(options: PaperRunnerOptions): Promise<Record<string, number>> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config);
    const emit = (event: PipelineEvent) => onEvent?.(event);
    const scores: Record<string, number> = {};

    for (const [sectionNum, sectionState] of state.sections) {
      emit({ type: "section-detection", message: `Detecting section ${sectionNum}...`, data: { sectionNumber: sectionNum } });
      const detResult = await this.auditor.audit({
        content: sectionState.content,
        sectionNumber: sectionNum,
        language: config.language,
        mode: options.aiDetectionMode ?? "free",
        externalProvider: options.aiDetectionProvider,
        apiKey: options.aiDetectionApiKey,
      });
      scores[sectionNum] = detResult.score;
      const updated = { ...sectionState, aiDetectionScore: detResult.score, lastModified: new Date().toISOString() };
      state.sections.set(sectionNum, updated);
      await stateManager.saveSection(paperId, updated);
    }
    return scores;
  }

  /** Run AI reduction on all sections. */
  async runReduceAll(options: PaperRunnerOptions): Promise<Record<string, number>> {
    const { paperId, stateManager, onEvent } = options;
    const config = await stateManager.loadPaperConfig(paperId);
    const state = await this.loadOrCreateState(paperId, stateManager, config);
    const emit = (event: PipelineEvent) => onEvent?.(event);
    const scores: Record<string, number> = {};
    const targetScore = options.targetAIScore ?? 0.35;

    for (const [sectionNum, sectionState] of state.sections) {
      const currentScore = sectionState.aiDetectionScore ?? 0.5;
      if (currentScore <= targetScore) {
        scores[sectionNum] = currentScore;
        continue;
      }
      emit({ type: "section-polishing", message: `Reducing AI traces in section ${sectionNum}...`, data: { sectionNumber: sectionNum } });
      const reductionResult = await this.reviser.revise({
        content: sectionState.content,
        sectionNumber: sectionNum,
        detectionScore: currentScore,
        flaggedPassages: [],
        language: config.language,
        innovationPoints: state.innovationPoints,
        maxIterations: options.maxAIReductionIterations ?? 3,
      });
      scores[sectionNum] = reductionResult.newScore;
      const updated: PaperSectionState = {
        ...sectionState,
        content: reductionResult.revisedContent,
        aiDetectionScore: reductionResult.newScore,
        lastModified: new Date().toISOString(),
      };
      state.sections.set(sectionNum, updated);
      await stateManager.saveSection(paperId, updated);
    }
    return scores;
  }

  /** Regenerate a single section. */
  async regenerateSection(paperId: string, sectionNumber: string, stateManager: StateManager): Promise<SectionWriteOutput> {
    const config = await stateManager.loadPaperConfig(paperId);
    const outline = await stateManager.loadOutline(paperId);
    const flat = this.flattenSections(outline.sections);
    const sectionNode = flat.find((s) => s.number === sectionNumber);
    if (!sectionNode) throw new Error(`Section ${sectionNumber} not found in outline`);

    const innovationPoints = await stateManager.loadInnovationPoints(paperId).catch(() => [] as InnovationPoint[]);
    const references = await stateManager.loadReferences(paperId);

    const previousIdx = flat.findIndex((s) => s.number === sectionNumber) - 1;
    let prevSummary: string | undefined;
    if (previousIdx >= 0) {
      try {
        const prevSection = await stateManager.loadSection(paperId, flat[previousIdx].number);
        prevSummary = this.generateSectionSummary(prevSection.content, config.language);
      } catch { /* no previous content */ }
    }

    const result = await this.writer.writeSection({
      section: sectionNode,
      topic: config.title,
      major: config.major,
      innovationPoints,
      references: references as Reference[],
      previousSectionSummary: prevSummary,
      language: config.language,
    });

    const sectionState: PaperSectionState = {
      sectionNumber,
      title: sectionNode.title,
      content: result.content,
      wordCount: result.wordCount,
      status: "drafted",
      citations: result.citations,
      aiDetectionLog: [],
      lastModified: new Date().toISOString(),
    };
    await stateManager.saveSection(paperId, sectionState);
    return result;
  }

  // Stage 1
  private async runBrainstorm(
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    _options: PaperRunnerOptions,
  ): Promise<BrainstormOutput> {
    emit({ type: "stage-start", stage: "brainstorm", message: "Starting topic brainstorming..." });

    const result: BrainstormOutput = await this.brainstormer.brainstorm({
      major: config.major,
      degreeLevel: config.degreeLevel,
      proposalText: config.proposalText,
      language: config.language,
    });

    if (result.topics.length > 0) {
      const recommended = result.topics.find((t) => t.title === result.recommendedTopic) ?? result.topics[0];
      state.innovationPoints = recommended.innovationPoints.map((p) => ({
        ...p,
        novelty: "medium" as const,
        supportingRefs: [] as string[],
        elaboratedInSection: [] as string[],
      }));
    }

    emit({
      type: "stage-complete",
      stage: "brainstorm",
      message: `Brainstorming complete — recommended: ${result.recommendedTopic}`,
      data: { recommendedTopic: result.recommendedTopic, topicCount: result.topics.length },
    });

    state.currentStage = "literature-search";
    return result;
  }

  // Stage 2
  private async runLiteratureSearch(
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    options: PaperRunnerOptions,
  ): Promise<void> {
    emit({ type: "stage-start", stage: "literature-search", message: "Searching literature..." });

    const keywords = [
      config.title,
      ...state.innovationPoints.map((p) => p.description.slice(0, 50)),
    ];

    const searchResult: LiteratureSearchOutput = await this.searcher.search({
      topic: config.title,
      keywords,
      innovationPoints: state.innovationPoints.map((p) => p.description),
      existingRefs: config.references as Reference[],
      language: config.language,
    });

    state.references = [...config.references as Reference[], ...searchResult.references];
    state.literatureReviewDraft = searchResult.reviewDraft;

    // Save references
    await options.stateManager.saveReferences(config.id, state.references);

    emit({
      type: "stage-complete",
      stage: "literature-search",
      message: `Literature search complete — ${searchResult.references.length} new references found`,
      data: { newRefCount: searchResult.references.length, totalRefCount: state.references.length },
    });

    state.currentStage = "outline";
  }

  // Stage 3
  private async runOutlineBuild(
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    _options: PaperRunnerOptions,
  ): Promise<void> {
    emit({ type: "stage-start", stage: "outline", message: "Building paper outline..." });

    const result: OutlineBuildOutput = await this.outliner.buildOutline({
      topic: config.title,
      major: config.major,
      degreeLevel: config.degreeLevel,
      proposalText: config.proposalText,
      innovationPoints: state.innovationPoints,
      referenceCount: state.references.length,
      targetWordCount: config.targetWordCount,
      language: config.language,
    });

    state.outline = this.normalizeSectionWordCounts(result.sections, config.targetWordCount);

    emit({
      type: "stage-complete",
      stage: "outline",
      message: `Outline built — ${state.outline.length} top-level sections (target: ${config.targetWordCount} words)`,
      data: { sectionCount: state.outline.length, rationale: result.structureRationale },
    });

    state.currentStage = "writing";
  }

  // Stage 4
  private async runSectionWriting(
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    options: PaperRunnerOptions,
  ): Promise<void> {
    const sections = this.flattenSections(state.outline);
    // Only write leaf sections — parent sections are structural containers
    const contentSections = sections.filter(
      (s) =>
        !["abstract-cn", "abstract-en", "keywords", "acknowledgment", "references", "appendix"].includes(s.type) &&
        s.children.length === 0,
    );

    emit({
      type: "stage-start",
      stage: "writing",
      message: `Writing ${contentSections.length} sections...`,
    });

    let previousSummary: string | undefined;

    for (let i = 0; i < contentSections.length; i++) {
      const section = contentSections[i];

      // Skip sections that already have content (e.g. when resuming from interrupted writing)
      const existingSection = state.sections.get(section.number);
      if (existingSection && existingSection.content && existingSection.content.trim().length > 0) {
        previousSummary = this.generateSectionSummary(existingSection.content, config.language);
        emit({
          type: "stage-progress",
          stage: "writing",
          message: `Section ${section.number} complete (${i + 1}/${contentSections.length})`,
          data: { sectionNumber: section.number, sectionTitle: section.title, index: i, total: contentSections.length },
        });
        continue;
      }

      emit({
        type: "section-writing",
        message: `Writing section ${section.number} ${section.title}...`,
        data: { sectionNumber: section.number, sectionTitle: section.title, index: i, total: contentSections.length },
      });

      // Write section
      const writeResult: SectionWriteOutput = await this.writer.writeSection({
        section,
        topic: config.title,
        major: config.major,
        innovationPoints: state.innovationPoints,
        references: state.references as Reference[],
        previousSectionSummary: previousSummary,
        language: config.language,
      });

      // Normalize content length to target word count
      const normalized = this.normalizeSectionContent(
        writeResult.content,
        section.wordCount,
        config.language,
      );
      let content = normalized.content;
      if (normalized.wordCount !== writeResult.wordCount) {
        emit({
          type: "section-writing",
          message: `Section ${section.number} length normalized: ${writeResult.wordCount} → ${normalized.wordCount} words (target: ${section.wordCount})`,
          data: { sectionNumber: section.number, originalCount: writeResult.wordCount, normalizedCount: normalized.wordCount, targetCount: section.wordCount },
        });
      }

      // Diagram verification (syntax-only during writing; full mode in polish)
      const verifyResult = await this.verifyDiagramsWithRetry(
        section,
        config,
        state,
        previousSummary,
        content,
        emit,
        options,
      );
      content = verifyResult.content;

      let detectionScore: number | undefined;

      // AI Detection audit
      const detResult: DetectionOutput = await this.auditor.audit({
        content,
        sectionNumber: section.number,
        language: config.language,
        mode: options.aiDetectionMode ?? "free",
        externalProvider: options.aiDetectionProvider,
        apiKey: options.aiDetectionApiKey,
      });

      detectionScore = detResult.score;

      emit({
        type: "section-detection",
        message: `Section ${section.number} AI score: ${detectionScore}`,
        data: { sectionNumber: section.number, score: detectionScore, metrics: detResult.metrics as unknown as Record<string, unknown> },
      });

      // AI Reduction if needed
      const targetScore = options.targetAIScore ?? 0.35;
      if (detectionScore > targetScore) {
        const reductionResult = await this.reviser.revise({
          content,
          sectionNumber: section.number,
          detectionScore,
          flaggedPassages: detResult.flaggedPassages,
          language: config.language,
          innovationPoints: state.innovationPoints,
          maxIterations: options.maxAIReductionIterations ?? 3,
        });

        content = reductionResult.revisedContent;
        detectionScore = reductionResult.newScore;

        emit({
          type: "section-polishing",
          message: `Section ${section.number} after reduction — AI score: ${detectionScore} (${reductionResult.iterationCount} iterations)`,
          data: { sectionNumber: section.number, newScore: detectionScore, iterations: reductionResult.iterationCount },
        });
      }

      // Save section
      const sectionState: PaperSectionState = {
        sectionNumber: section.number,
        title: section.title,
        content,
        wordCount: normalized.wordCount,
        status: "drafted",
        aiDetectionScore: detectionScore,
        aiDetectionLog: [
          {
            sectionNumber: section.number,
            timestamp: new Date().toISOString(),
            score: detectionScore ?? 0,
            provider: options.aiDetectionMode === "paid" ? (options.aiDetectionProvider ?? "gptzero") : "llm-self",
            flaggedPassages: detResult.flaggedPassages.map((p) => ({
              text: p.text,
              reason: p.reason,
            })),
            action: detectionScore && detectionScore > (options.targetAIScore ?? 0.35) ? "rewrite" : "detect",
            attempt: 1,
          },
        ],
        citations: writeResult.citations,
        lastModified: new Date().toISOString(),
      };

      state.sections.set(section.number, sectionState);
      await options.stateManager.saveSection(config.id, sectionState);

      // Generate summary for context continuity
      previousSummary = this.generateSectionSummary(content, config.language);

      emit({
        type: "stage-progress",
        stage: "writing",
        message: `Section ${section.number} complete (${i + 1}/${contentSections.length})`,
        data: { completed: i + 1, total: contentSections.length },
      });
    }

    emit({ type: "stage-complete", stage: "writing", message: "All sections written" });
    state.currentStage = "polish";
  }

  /**
   * Verify diagrams in section content and retry writing with correction
   * instructions if diagrams fail syntax/render check. Max 2 correction attempts.
   */
  private async verifyDiagramsWithRetry(
    section: SectionNode,
    config: PaperConfig,
    state: RunnerState,
    previousSummary: string | undefined,
    initialContent: string,
    emit: PipelineEventCallback,
    options: PaperRunnerOptions,
  ): Promise<{ content: string; verifyResult: DiagramVerifyOutput }> {
    let content = initialContent;
    let verifyResult: DiagramVerifyOutput = { diagrams: [], allValid: true, issues: [] };

    for (let attempt = 0; attempt < 2; attempt++) {
      verifyResult = await this.diagramVerifier.verify({
        content,
        sectionNumber: section.number,
        sectionTitle: section.title,
        language: config.language,
        mode: "syntax", // syntax-only during writing; "full" semantic review could be added later
      });

      if (verifyResult.allValid) break;

      emit({
        type: "section-diagram-verify",
        message: `Section ${section.number} diagram issues (attempt ${attempt + 1}/2): ${verifyResult.issues.join("; ")}`,
        data: { sectionNumber: section.number, issues: verifyResult.issues, attempt: attempt + 1 },
      });

      // Build correction instructions for the writer
      const isZh = config.language === "zh";
      const failedDiagrams = verifyResult.diagrams.filter((d) => !d.syntaxValid);
      const syntaxErrors = failedDiagrams
        .map((d) => `图${d.figureNumber}: ${d.syntaxError ?? "渲染失败"}`)
        .join("\n");
      const semanticErrors = verifyResult.diagrams
        .filter((d) => (d.semanticIssues?.length ?? 0) > 0)
        .map((d) => `图${d.figureNumber}: ${(d.semanticIssues ?? []).join("; ")}`)
        .join("\n");

      const correctionInstructions = isZh
        ? `上一版图表存在以下问题，请修正后重新生成完整章节：\n${syntaxErrors}\n${semanticErrors}\n\n修正要求：\n1. 确保【图X 标题】行与 \x60\x60\x60mermaid 代码块之间用空行分隔\n2. 【图X 标题】不要加粗（不要用 ** 包裹）\n3. Mermaid 语法必须正确，实体关系图使用 graph TD 或 flowchart LR（禁止 erDiagram）\n4. **禁止在节点标签中使用 HTML 标签**（如 <br>, <br/>, <div>, <span>）。如需换行，请在引号内使用 \\n 或将内容拆分到多个节点\n5. **禁止在节点标签中使用英文圆括号 ()**（mermaid.ink 对括号返回 HTTP 400）。请改用中文全角括号（）或直接省略括号\n6. 节点标签中避免特殊字符：尖括号 <>、& 符号、未转义引号。用逗号、空格或中文全角符号替代\n7. 禁止使用弯引号 ""''（Unicode 智能引号），mermaid 代码中所有引号必须为直引号 ""''（ASCII）\n8. 禁止在节点标签中使用 @ 符号（mermaid.ink 返回 HTTP 400），改用 "at" 或直接省略`
        : `Previous diagrams had issues. Fix and regenerate the complete section:\n${syntaxErrors}\n${semanticErrors}\n\nFix requirements:\n1. Ensure a blank line between [Figure X: title] and \x60\x60\x60mermaid blocks\n2. Do not wrap figure labels in **\n3. Mermaid syntax must be correct; for entity-relationship diagrams use graph TD or flowchart LR (erDiagram is forbidden)\n4. **No HTML tags in node labels** (e.g. <br>, <br/>, <div>, <span>). Use \\n inside quotes or split content across nodes\n5. **No round brackets (parentheses) in node labels** — mermaid.ink returns HTTP 400. Omit them or use square brackets instead\n6. Avoid special characters in node labels: angle brackets <>, &, unescaped quotes. Use commas, spaces, or split into separate nodes\n7. Never use smart/curly quotes ""'' (Unicode) — all quotes in mermaid code must be straight ASCII quotes\n8. Never use @ symbol in node labels — mermaid.ink returns HTTP 400. Use \"at\" instead or omit it`;

      const rewriteResult = await this.writer.writeSection({
        section: { ...section, wordCount: Math.floor(section.wordCount * 0.7) }, // tighter for retry
        topic: config.title,
        major: config.major,
        innovationPoints: state.innovationPoints,
        references: state.references as Reference[],
        previousSectionSummary: previousSummary,
        language: config.language,
        correctionInstructions,
      });
      content = rewriteResult.content;
    }

    return { content, verifyResult };
  }

  // Stage 5
  private async runPolishAndReduce(
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    options: PaperRunnerOptions,
  ): Promise<void> {
    emit({ type: "stage-start", stage: "polish", message: "Polishing and reducing AI detection..." });

    let globalAIScore = 0;
    let sectionCount = 0;

    for (const [sectionNum, sectionState] of state.sections) {
      emit({
        type: "section-polishing",
        message: `Polishing section ${sectionNum}...`,
        data: { sectionNumber: sectionNum },
      });

      // Polish
      const polishResult = await this.polisher.polish({
        content: sectionState.content,
        sectionNumber: sectionNum,
        sectionTitle: sectionState.title,
        language: config.language,
        polishScope: "full",
      });

      let polishedContent = polishResult.polishedContent;

      // Re-audit polished content
      const detResult = await this.auditor.audit({
        content: polishedContent,
        sectionNumber: sectionNum,
        language: config.language,
        mode: options.aiDetectionMode ?? "free",
        externalProvider: options.aiDetectionProvider,
        apiKey: options.aiDetectionApiKey,
      });

      globalAIScore += detResult.score;
      sectionCount++;

      // Reduce if still too high
      const targetScore = options.targetAIScore ?? 0.35;
      if (detResult.score > targetScore) {
        const reductionResult = await this.reviser.revise({
          content: polishedContent,
          sectionNumber: sectionNum,
          detectionScore: detResult.score,
          flaggedPassages: detResult.flaggedPassages,
          language: config.language,
          innovationPoints: state.innovationPoints,
          maxIterations: options.maxAIReductionIterations ?? 2,
        });

        polishedContent = reductionResult.revisedContent;
        globalAIScore = globalAIScore - detResult.score + reductionResult.newScore;
      }

      // Update section
      const updatedSection: PaperSectionState = {
        ...sectionState,
        content: polishedContent,
        status: "polishing",
        aiDetectionScore: detResult.score,
        lastModified: new Date().toISOString(),
      };

      state.sections.set(sectionNum, updatedSection);
      await options.stateManager.saveSection(config.id, updatedSection);
    }

    const avgScore = sectionCount > 0 ? Math.round((globalAIScore / sectionCount) * 100) / 100 : 0;

    emit({
      type: "stage-complete",
      stage: "polish",
      message: `Polish complete — average AI score: ${avgScore}`,
      data: { averageAIScore: avgScore, sectionsProcessed: sectionCount },
    });

    state.currentStage = "format-export";
  }

  // Stage 6
  private async runExport(
    paperId: string,
    config: PaperConfig,
    state: RunnerState,
    emit: PipelineEventCallback,
    options: PaperRunnerOptions,
  ): Promise<void> {
    emit({ type: "stage-start", stage: "format-export", message: "Formatting citations and preparing export..." });

    // Format citations
    const citationResult = this.citationFormatter.format({
      references: state.references as Reference[],
      format: config.citationFormat,
      language: config.language,
    });

    // Build citation map from reference index to section context
    const citationMap: Record<string, { citedInSections: string[]; context: string }> = {};
    for (let i = 0; i < citationResult.formattedReferences.length; i++) {
      citationMap[String(i + 1)] = {
        citedInSections: [],
        context: citationResult.formattedReferences[i],
      };
    }
    await options.stateManager.saveCitationMap(paperId, citationMap);

    emit({
      type: "stage-complete",
      stage: "format-export",
      message: "Citations formatted — ready for .docx export",
      data: { refCount: citationResult.formattedReferences.length, format: config.citationFormat },
    });
  }

  // Helpers

  private shouldRunStage(current: PipelineStage, target: PipelineStage): boolean {
    const stageOrder: PipelineStage[] = ["idle", "brainstorm", "literature-search", "outline", "writing", "polish", "format-export"];
    const currentIdx = stageOrder.indexOf(current);
    const targetIdx = stageOrder.indexOf(target);
    return currentIdx <= targetIdx;
  }

  private markCompleted(state: RunnerState, stage: PipelineStage): void {
    if (!state.completedStages.includes(stage)) {
      state.completedStages = [...state.completedStages, stage];
    }
  }

  private flattenSections(sections: SectionNode[]): SectionNode[] {
    const result: SectionNode[] = [];
    const walk = (nodes: SectionNode[]) => {
      for (const node of nodes) {
        result.push(node);
        if (node.children.length > 0) walk(node.children);
      }
    };
    walk(sections);
    return result;
  }

  private generateSectionSummary(content: string, language: "zh" | "en"): string {
    const maxLen = language === "zh" ? 200 : 100;
    const truncated = content.slice(0, maxLen);
    return truncated + (content.length > maxLen ? "..." : "");
  }

  private async loadOrCreateState(
    paperId: string,
    stateManager: StateManager,
    config: PaperConfig,
    resumeFromStage?: PipelineStage,
  ): Promise<RunnerState> {
    const hasPreSetTitle = config.title.trim().length > 0;
    const state: RunnerState = {
      innovationPoints: [],
      references: [],
      outline: [],
      sections: new Map(),
      literatureReviewDraft: "",
      currentStage: resumeFromStage ?? (hasPreSetTitle ? "literature-search" : "brainstorm"),
      completedStages: hasPreSetTitle ? ["brainstorm"] : [],
      events: [],
    };

    // Load persisted pipeline state FIRST — it is the authoritative source for
    // currentStage / completedStages when resuming (no explicit resumeFromStage).
    let persistedStage: PipelineStage | undefined;
    let persistedCompleted: PipelineStage[] | undefined;
    try {
      const pState = await stateManager.loadPipelineState(paperId);
      if (pState.events && pState.events.length > 0) {
        state.events = [...pState.events];
      }
      if (!resumeFromStage && pState.currentStage && pState.currentStage !== "idle") {
        persistedStage = pState.currentStage;
        persistedCompleted = pState.completedStages;
      }
    } catch { /* not saved yet */ }

    try {
      const points = await stateManager.loadInnovationPoints(paperId);
      if (points) state.innovationPoints = points;
    } catch { /* not saved yet */ }

    try {
      const refs = await stateManager.loadReferences(paperId);
      if (refs.length > 0) state.references = refs;
    } catch { /* not saved yet */ }

    try {
      const outline = await stateManager.loadOutline(paperId);
      if (outline.sections.length > 0) {
        state.outline = outline.sections;
      }
    } catch { /* not saved yet */ }

    try {
      const sections = await stateManager.listSections(paperId);
      for (const s of sections) {
        state.sections.set(s.sectionNumber, s);
      }
    } catch { /* not saved yet */ }

    // Determine currentStage / completedStages:
    // 1. Explicit resumeFromStage wins (already set above).
    // 2. Persisted pipeline_state.json wins — it records exactly where the pipeline stopped.
    // 3. Fall back to best-guess inference from saved artifacts.
    if (!resumeFromStage && persistedStage) {
      state.currentStage = persistedStage as PipelineStage;
      if (persistedCompleted && persistedCompleted.length > 0) {
        state.completedStages = [...persistedCompleted];
      }
    } else if (!resumeFromStage) {
      // No persisted state — infer from artifacts
      if (state.outline.length > 0) {
        state.currentStage = "writing";
        state.completedStages = ["brainstorm", "literature-search", "outline"];
      } else if (state.references.length > 0) {
        state.completedStages = ["brainstorm", "literature-search"];
        if (state.currentStage === "brainstorm" || state.currentStage === "literature-search") {
          state.currentStage = "outline";
        }
      } else if (state.innovationPoints.length > 0) {
        state.completedStages = ["brainstorm"];
        if (state.currentStage === "brainstorm") state.currentStage = "literature-search";
      }
      // If we have sections, writing was at least partially done
      if (state.sections.size > 0 && state.completedStages.length < 4) {
        state.completedStages = ["brainstorm", "literature-search", "outline"];
        state.currentStage = "writing";
      }
    }

    return state;
  }

  /** Scale per-section word counts so leaf sum equals targetWordCount exactly. */
  private normalizeSectionWordCounts(sections: SectionNode[], targetWordCount: number): SectionNode[] {
    const leaves: SectionNode[] = [];
    const collectLeaves = (nodes: SectionNode[]) => {
      for (const n of nodes) {
        if (n.children.length === 0) {
          leaves.push(n);
        } else {
          collectLeaves(n.children);
        }
      }
    };
    collectLeaves(sections);

    if (leaves.length === 0) return sections;

    let total = leaves.reduce((s, l) => s + l.wordCount, 0);
    if (total === 0) {
      // Equal distribution
      const perLeaf = Math.floor(targetWordCount / leaves.length);
      for (const l of leaves) l.wordCount = perLeaf;
      total = perLeaf * leaves.length;
    }

    const factor = targetWordCount / total;
    const scaled = leaves.map((l) => ({
      node: l,
      raw: l.wordCount * factor,
    }));

    // Largest remainder method to hit exact target
    let assigned = 0;
    for (const s of scaled) {
      s.node.wordCount = Math.floor(s.raw);
      assigned += s.node.wordCount;
    }
    const remainder = scaled.map((s, i) => ({ i, rem: s.raw - s.node.wordCount }));
    remainder.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < targetWordCount - assigned; i++) {
      scaled[remainder[i].i].node.wordCount++;
    }

    // Update parent word counts bottom-up
    const updateParents = (nodes: SectionNode[]): number => {
      let sum = 0;
      for (const n of nodes) {
        if (n.children.length > 0) {
          n.wordCount = updateParents(n.children);
        }
        sum += n.wordCount;
      }
      return sum;
    };
    updateParents(sections);

    return sections;
  }

  /** Truncate over-length content at a sentence boundary. */
  private normalizeSectionContent(
    content: string,
    targetWordCount: number,
    language: "zh" | "en",
  ): { content: string; wordCount: number } {
    const isZh = language === "zh";
    const currentCount = isZh ? content.length : content.split(/\s+/).filter(Boolean).length;

    // Within acceptable range — keep as-is
    if (currentCount >= targetWordCount * 0.95 && currentCount <= targetWordCount * 1.2) {
      return { content, wordCount: currentCount };
    }

    // Too short — keep as-is, can't pad meaningfully
    if (currentCount < targetWordCount * 0.8) {
      return { content, wordCount: currentCount };
    }

    // Too long — truncate at sentence boundary near target
    if (isZh) {
      const targetLen = Math.round(targetWordCount * 1.05);
      if (content.length <= targetLen) return { content, wordCount: currentCount };
      // Find last sentence-ending punctuation before target
      const sentEnds = /[。！？；]/g;
      let lastGood = targetLen;
      let m: RegExpExecArray | null;
      while ((m = sentEnds.exec(content)) !== null) {
        if (m.index <= targetLen) lastGood = m.index + 1;
        else break;
      }
      const truncated = content.slice(0, lastGood).trimEnd();
      return { content: truncated, wordCount: truncated.length };
    } else {
      const targetWords = Math.round(targetWordCount * 1.05);
      const words = content.split(/\s+/).filter(Boolean);
      if (words.length <= targetWords) return { content, wordCount: currentCount };
      const truncated = words.slice(0, targetWords).join(" ");
      // Try to end at the last complete sentence
      const sentMatch = truncated.match(/^(.*[.!?])\s+[A-Z]/);
      if (sentMatch) {
        return { content: sentMatch[1], wordCount: sentMatch[1].split(/\s+/).filter(Boolean).length };
      }
      return { content: truncated, wordCount: targetWords };
    }
  }

  private async saveState(
    paperId: string,
    stateManager: StateManager,
    state: RunnerState,
    config: PaperConfig,
    status: PipelineState["status"] = "running",
  ): Promise<void> {
    try {
      await stateManager.saveInnovationPoints(paperId, state.innovationPoints);
    } catch { /* best effort */ }

    try {
      if (state.outline.length > 0) {
        await stateManager.saveOutline(paperId, {
          paperId,
          title: config.title,
          sections: state.outline,
          totalWordCount: state.outline.reduce((sum, s) => sum + s.wordCount, 0),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch { /* best effort */ }

    try {
      await stateManager.savePipelineState(paperId, {
        paperId,
        status,
        currentStage: state.currentStage,
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        completedStages: state.completedStages,
        totalSections: state.outline.length,
        completedSections: state.sections.size,
        events: state.events,
      });
    } catch { /* best effort */ }
  }
}
