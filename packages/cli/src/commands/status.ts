import { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { findProjectRoot, log, logError } from "../utils.js";
import { resolveCliLanguage, formatCliPaper } from "../localization.js";

export const statusCommand = new Command("status")
  .description("Show project status")
  .argument("[paper-id]", "Paper ID (optional, shows all if omitted)")
  .option("--json", "Output JSON")
  .action(async (paperIdArg: string | undefined, opts) => {
    const root = findProjectRoot();
    const state = new StateManager(root);
    const lang = resolveCliLanguage();

    try {
      const papers = await state.listPapers();

      if (opts.json) {
        log(JSON.stringify({ project: root, papers }, null, 2));
        return;
      }

      log(`Paper Writer 项目：${root}`);
      log(`Papers: ${papers.length}`);
      log("");

      for (const p of papers) {
        const stageLabel = formatCliPaper.stageLabel(lang, p.pipelineStage);
        log(`  ${p.title} (${p.id})`);
        log(`    Stage: ${stageLabel} | Sections: ${p.totalSections} | Words: ${p.totalWords.toLocaleString()}`);
        log(`    Completed: ${p.completedSections}/${p.totalSections} | AI Score: ${p.aiDetectionScore?.toFixed(2) ?? "N/A"}`);
        log("");
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to get status: ${e}`);
      }
      process.exit(1);
    }
  });
