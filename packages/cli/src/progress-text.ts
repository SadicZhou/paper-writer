import { type CliLanguage } from "./localization.js";

export { type CliLanguage };

// Paper-specific progress text helpers (placeholder for future progress bar support)
export function formatPaperStageProgress(
  language: CliLanguage,
  stage: string,
  current: number,
  total: number,
): string {
  return language === "en"
    ? `[${current}/${total}] Running ${stage}...`
    : `[${current}/${total}] 正在执行 ${stage}...`;
}
