import { Command } from "commander";
import { join } from "node:path";
import {
  StateManager,
  PaperRunner,
  WordExporter,
  WordImporter,
  createLLMClient,
  type AgentContext,
  type PaperRunnerOptions,
} from "@actalk/inkos-core";
import { findProjectRoot, loadConfig, log, logError } from "../utils.js";
import { resolveCliLanguage, formatCliPaper } from "../localization.js";

function buildAgentContext(
  root: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): AgentContext {
  return {
    client: createLLMClient({
      provider: "openai",
      service: "custom",
      configSource: "env",
      baseUrl,
      apiKey,
      model,
      apiFormat: "chat",
      stream: true,
      temperature: 0.7,
      thinkingBudget: 0,
    }),
    model,
    projectRoot: root,
  };
}

export const paperCommand = new Command("paper")
  .description("Manage academic papers");

// ── paper create ──

paperCommand
  .command("create")
  .description("Create a new paper project")
  .requiredOption("--title <title>", "Paper title")
  .requiredOption("--major <major>", "Major / field of study")
  .option("--degree <level>", "Degree level: undergraduate, master, doctor", "undergraduate")
  .option("--proposal <text>", "Proposal / opening report text")
  .option("--language <zh|en>", "Writing language", "zh")
  .option("--citation-format <format>", "Citation format: gb7714, apa, mla, chicago", "gb7714")
  .option("--target-words <n>", "Target word count", "20000")
  .action(async (opts) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const { derivePaperIdFromTitle } = await import("@actalk/inkos-core");
    const paperId = derivePaperIdFromTitle(opts.title);
    const lang = resolveCliLanguage(opts.language);

    try {
      await state.createPaper({
        id: paperId,
        title: opts.title,
        major: opts.major,
        degreeLevel: opts.degree,
        proposalText: opts.proposal ?? "",
        references: [],
        targetWordCount: parseInt(opts.targetWords, 10),
        citationFormat: opts.citationFormat,
        language: opts.language as "zh" | "en",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      log(formatCliPaper.paperCreated(lang, paperId));
      log(formatCliPaper.paperLocation(lang, paperId));
      log("");
      log(formatCliPaper.nextSteps(lang, paperId));
    } catch (e) {
      logError(`Failed to create paper: ${e}`);
      process.exit(1);
    }
  });

// ── paper list ──

paperCommand
  .command("list")
  .description("List all papers")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const lang = resolveCliLanguage();

    try {
      const papers = await state.listPapers();
      if (opts.json) {
        log(JSON.stringify(papers, null, 2));
        return;
      }
      if (papers.length === 0) {
        log(formatCliPaper.noPapers(lang));
        return;
      }
      log(formatCliPaper.paperListHeader(lang, papers.length));
      for (const p of papers) {
        const stageLabel = formatCliPaper.stageLabel(lang, p.pipelineStage);
        log(formatCliPaper.paperListItem(lang, p.id, p.title, stageLabel, p.totalWords, p.totalSections));
      }
    } catch (e) {
      logError(`Failed to list papers: ${e}`);
      process.exit(1);
    }
  });

// ── paper info ──

paperCommand
  .command("info")
  .description("Show paper details")
  .argument("<paper-id>", "Paper ID")
  .option("--json", "Output as JSON")
  .action(async (paperId: string, opts) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const lang = resolveCliLanguage();

    try {
      const config = await state.loadPaperConfig(paperId);
      const pipeline = await state.loadPipelineState(paperId).catch(() => null);
      const sections = await state.listSections(paperId).catch(() => []);
      const refs = await state.loadReferences(paperId).catch(() => []);

      if (opts.json) {
        log(JSON.stringify({ config, pipeline, sectionCount: sections.length, referenceCount: refs.length }, null, 2));
        return;
      }

      log(formatCliPaper.paperInfo(lang, config));
      log(`  ${formatCliPaper.stageLabel(lang, pipeline?.currentStage ?? "idle")}`);
      log(`  ${formatCliPaper.sectionCount(lang, sections.length)}`);
      log(`  ${formatCliPaper.refCount(lang, refs.length)}`);
    } catch (e) {
      logError(`Failed to read paper: ${e}`);
      process.exit(1);
    }
  });

// ── paper pipeline stages ──

async function runPipelineStage(
  paperId: string,
  stage: string,
  runner: PaperRunner,
  options: PaperRunnerOptions,
  fn: (opts: PaperRunnerOptions) => Promise<unknown>,
): Promise<void> {
  const lang = resolveCliLanguage();
  log(formatCliPaper.stageStarting(lang, stage));
  try {
    const result = await fn(options);
    log(formatCliPaper.stageComplete(lang, stage));
    if (result && typeof result === "object") {
      log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    logError(formatCliPaper.stageFailed(lang, stage, String(e)));
    process.exit(1);
  }
}

paperCommand
  .command("brainstorm")
  .description("Run topic brainstorming (Stage 1)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    await runPipelineStage(paperId, "brainstorm", runner, options, (o) => runner.runBrainstormOnly(o));
  });

paperCommand
  .command("search")
  .description("Run literature search (Stage 2)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    await runPipelineStage(paperId, "literature-search", runner, options, (o) => runner.runLiteratureSearchOnly(o));
  });

paperCommand
  .command("outline")
  .description("Generate paper outline (Stage 3)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    await runPipelineStage(paperId, "outline", runner, options, (o) => runner.runOutlineOnly(o));
  });

paperCommand
  .command("write")
  .description("Write paper sections (Stage 4)")
  .argument("<paper-id>", "Paper ID")
  .option("--section <num>", "Write a specific section only")
  .action(async (paperId: string, opts: { section?: string }) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };

    if (opts.section) {
      await runPipelineStage(paperId, `write-section-${opts.section}`, runner, options, () =>
        runner.regenerateSection(paperId, opts.section!, state),
      );
    } else {
      await runPipelineStage(paperId, "writing", runner, options, (o) => runner.runWritingOnly(o));
    }
  });

paperCommand
  .command("polish")
  .description("Polish and reduce AI traces (Stage 5)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    await runPipelineStage(paperId, "polish", runner, options, (o) => runner.runPolishOnly(o));
  });

paperCommand
  .command("detect")
  .description("Run AI detection on paper (all sections)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    const lang = resolveCliLanguage();
    log(formatCliPaper.stageStarting(lang, "detection"));
    try {
      const result = await runner.runDetectionAll(options);
      log(JSON.stringify(result, null, 2));
      log(formatCliPaper.stageComplete(lang, "detection"));
    } catch (e) {
      logError(formatCliPaper.stageFailed(lang, "detection", String(e)));
      process.exit(1);
    }
  });

paperCommand
  .command("reduce")
  .description("Run AI reduction on paper (all sections)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const config = await loadConfig();
    const ctx = buildAgentContext(root, config.llm.apiKey, config.llm.model, config.llm.baseUrl);
    const runner = new PaperRunner(ctx);
    const state = new StateManager(root);
    const options: PaperRunnerOptions = { paperId, context: ctx, stateManager: state, aiDetectionMode: "free" };
    const lang = resolveCliLanguage();
    log(formatCliPaper.stageStarting(lang, "ai-reduction"));
    try {
      const result = await runner.runReduceAll(options);
      log(JSON.stringify(result, null, 2));
      log(formatCliPaper.stageComplete(lang, "ai-reduction"));
    } catch (e) {
      logError(formatCliPaper.stageFailed(lang, "ai-reduction", String(e)));
      process.exit(1);
    }
  });

paperCommand
  .command("export")
  .description("Export paper to Word document (Stage 6)")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const lang = resolveCliLanguage();

    try {
      const paper = await state.loadPaperConfig(paperId);
      const sections = await state.listSections(paperId);
      const outline = await state.loadOutline(paperId).catch(() => []);
      const references = await state.loadReferences(paperId);

      const exporter = new WordExporter();
      const result = await exporter.export({
        paperId,
        title: paper.title,
        major: paper.major,
        language: paper.language,
        citationFormat: paper.citationFormat,
        sections,
        outline: outline as never,
        references,
        outputDir: join(root, "papers", paperId, "exports"),
      });
      log(formatCliPaper.exportComplete(lang, result.filePath));
    } catch (e) {
      logError(`Export failed: ${e}`);
      process.exit(1);
    }
  });

// ── paper import-word ──

paperCommand
  .command("import-word")
  .description("Import a Word document with annotations")
  .argument("<file>", "Path to .docx file")
  .option("--paper-id <id>", "Target paper ID (creates new if omitted)")
  .action(async (filePath: string, opts: { paperId?: string }) => {
    const root = findProjectRoot();
    const lang = resolveCliLanguage();

    try {
      const importer = new WordImporter();
      const result = await importer.importDocument({
        filePath,
        language: lang,
      });
      log(JSON.stringify(result, null, 2));
    } catch (e) {
      logError(`Import failed: ${e}`);
      process.exit(1);
    }
  });

// ── paper delete ──

paperCommand
  .command("delete")
  .description("Delete a paper")
  .argument("<paper-id>", "Paper ID")
  .action(async (paperId: string) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const lang = resolveCliLanguage();

    try {
      await state.deletePaper(paperId);
      log(formatCliPaper.paperDeleted(lang, paperId));
    } catch (e) {
      logError(`Failed to delete paper: ${e}`);
      process.exit(1);
    }
  });
