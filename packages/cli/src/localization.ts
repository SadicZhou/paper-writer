import type { PaperConfig } from "@actalk/inkos-core";

export type CliLanguage = "zh" | "en";

function t(language: CliLanguage, messages: { zh: string; en: string }): string {
  return language === "en" ? messages.en : messages.zh;
}

export function resolveCliLanguage(language?: string): CliLanguage {
  return language === "en" ? "en" : "zh";
}

export const formatCliPaper = {
  paperCreated(lang: CliLanguage, id: string): string {
    return t(lang, { zh: `已创建论文：${id}`, en: `Paper created: ${id}` });
  },
  paperLocation(lang: CliLanguage, id: string): string {
    return t(lang, { zh: `  位置：papers/${id}/`, en: `  Location: papers/${id}/` });
  },
  paperDeleted(lang: CliLanguage, id: string): string {
    return t(lang, { zh: `已删除论文：${id}`, en: `Paper deleted: ${id}` });
  },
  nextSteps(lang: CliLanguage, id: string): string {
    return t(lang, {
      zh: `下一步：inkos paper brainstorm ${id}`,
      en: `Next: inkos paper brainstorm ${id}`,
    });
  },
  noPapers(lang: CliLanguage): string {
    return t(lang, {
      zh: "暂无论文。运行 inkos paper create 创建一篇。",
      en: "No papers found. Run 'inkos paper create' to create one.",
    });
  },
  paperListHeader(lang: CliLanguage, count: number): string {
    return t(lang, {
      zh: `论文 (${count} 篇)：`,
      en: `Papers (${count}):`,
    });
  },
  paperListItem(lang: CliLanguage, id: string, title: string, stage: string, words: number, sections: number): string {
    return lang === "en"
      ? `  ${id} — "${title}" | ${stage} | ${words} words | ${sections} sections`
      : `  ${id} — "${title}" | ${stage} | ${words} 字 | ${sections} 节`;
  },
  paperInfo(lang: CliLanguage, config: PaperConfig): string {
    return lang === "en"
      ? `Paper: ${config.title} (${config.id})\n  Major: ${config.major} | Degree: ${config.degreeLevel} | Language: ${config.language}`
      : `论文：${config.title} (${config.id})\n  专业：${config.major} | 学位：${config.degreeLevel} | 语言：${config.language}`;
  },
  stageLabel(lang: CliLanguage, stage: string): string {
    const labels: Record<string, { zh: string; en: string }> = {
      idle: { zh: "空闲", en: "idle" },
      brainstorm: { zh: "选题构思", en: "brainstorm" },
      "literature-search": { zh: "文献检索", en: "literature search" },
      outline: { zh: "大纲生成", en: "outline" },
      writing: { zh: "正文撰写", en: "writing" },
      polish: { zh: "润色降重", en: "polishing" },
      "format-export": { zh: "格式导出", en: "export" },
    };
    const label = labels[stage];
    return label ? t(lang, label) : stage;
  },
  stageStarting(lang: CliLanguage, stage: string): string {
    return t(lang, {
      zh: `开始阶段：${formatCliPaper.stageLabel(lang, stage)}...`,
      en: `Starting stage: ${formatCliPaper.stageLabel(lang, stage)}...`,
    });
  },
  stageComplete(lang: CliLanguage, stage: string): string {
    return t(lang, {
      zh: `阶段完成：${formatCliPaper.stageLabel(lang, stage)}`,
      en: `Stage complete: ${formatCliPaper.stageLabel(lang, stage)}`,
    });
  },
  stageFailed(lang: CliLanguage, stage: string, error: string): string {
    return t(lang, {
      zh: `阶段失败 [${formatCliPaper.stageLabel(lang, stage)}]: ${error}`,
      en: `Stage failed [${formatCliPaper.stageLabel(lang, stage)}]: ${error}`,
    });
  },
  sectionCount(lang: CliLanguage, count: number): string {
    return t(lang, { zh: `章节：${count}`, en: `Sections: ${count}` });
  },
  refCount(lang: CliLanguage, count: number): string {
    return t(lang, { zh: `参考文献：${count}`, en: `References: ${count}` });
  },
  exportComplete(lang: CliLanguage, path: string): string {
    return t(lang, { zh: `导出完成：${path}`, en: `Export complete: ${path}` });
  },
};
