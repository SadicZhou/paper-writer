import { BaseAgent } from "./base.js";
import type { Reference } from "../models/paper.js";
import { ReferenceSchema } from "../models/paper.js";
import { z } from "zod";

export interface LiteratureSearchInput {
  readonly topic: string;
  readonly keywords: string[];
  readonly innovationPoints: string[];
  readonly existingRefs: Reference[];
  readonly language: "zh" | "en";
}

export interface LiteratureSearchOutput {
  readonly references: Reference[];
  readonly reviewDraft: string;
  readonly searchQueries: string[];
}

const StructuredRefsSchema = z.object({
  references: z.array(ReferenceSchema),
  reviewDraft: z.string(),
});

export class LiteratureSearcher extends BaseAgent {
  get name(): string {
    return "literature-searcher";
  }

  async search(input: LiteratureSearchInput): Promise<LiteratureSearchOutput> {
    const isZh = input.language === "zh";
    const allResults: Reference[] = [...input.existingRefs];
    const searchQueries: string[] = [];

    // Phase 1: Web search for each keyword group
    const keywordGroups = this.groupKeywords(input.keywords, 3);
    for (const group of keywordGroups) {
      const query = isZh
        ? `${input.topic} ${group.join(" ")} 学术论文 文献`
        : `${input.topic} ${group.join(" ")} scholarly paper reference`;

      searchQueries.push(query);

      try {
        const resp = await this.chatWithSearch([
          {
            role: "user",
            content: isZh
              ? `搜索关于"${query}"的学术文献信息。请列出找到的文献标题、作者、年份、期刊/来源。最多 10 条。`
              : `Search for scholarly literature about "${query}". List paper titles, authors, year, journal/source. Max 10 items.`,
          },
        ], { temperature: 0.2 });

        // Extract references using LLM from search results
        const extracted = await this.extractReferences(resp.content, input.language);
        for (const ref of extracted) {
          if (!allResults.some((r) => r.title === ref.title)) {
            allResults.push(ref);
          }
        }
      } catch {
        // Search failed, continue with next group
      }
    }

    // Phase 2: Generate literature review draft
    const reviewDraft = await this.generateReview(
      input.topic,
      input.innovationPoints,
      allResults,
      input.language,
    );

    return { references: allResults, reviewDraft, searchQueries };
  }

  private groupKeywords(keywords: string[], groupSize: number): string[][] {
    const groups: string[][] = [];
    for (let i = 0; i < keywords.length; i += groupSize) {
      groups.push(keywords.slice(i, i + groupSize));
    }
    if (groups.length === 0) groups.push([""]);
    return groups;
  }

  private async extractReferences(raw: string, lang: "zh" | "en"): Promise<Reference[]> {
    const resp = await this.chat([
      { role: "system", content: lang === "zh"
        ? "从文本中提取学术参考文献，输出 JSON 数组。每条包含: id, type(journal/book/conference/thesis/other), title, authors[], year, journal, doi(可选), rawCitation。id 用标题的英文小写连字符形式。"
        : "Extract scholarly references from text. Output JSON array. Each: id, type(journal/book/conference/thesis/other), title, authors[], year, journal, doi(optional), rawCitation. id = lowercase-hyphenated title."
      },
      { role: "user", content: raw.slice(0, 6000) },
    ], { temperature: 0.1 });

    try {
      const json = this.extractJson(resp.content);
      return z.array(ReferenceSchema).parse(json);
    } catch {
      return [];
    }
  }

  private async generateReview(
    topic: string,
    innovations: string[],
    refs: Reference[],
    lang: "zh" | "en",
  ): Promise<string> {
    const refListText = refs.slice(0, 30).map((r, i) =>
      `[${i + 1}] ${r.authors.join(", ")}. ${r.title}. ${r.journal ?? ""}, ${r.year}.`
    ).join("\n");

    const resp = await this.chat([
      { role: "system", content: lang === "zh"
        ? `你是一位学术文献综述专家。基于提供的文献列表撰写文献综述草稿。按主题组织，指出研究空白，关联创新点。引用处标注 [n]。输出 Markdown。`
        : `You are an academic literature review expert. Write a literature review draft based on provided references. Organize by theme, identify research gaps, connect to innovation points. Cite as [n]. Output Markdown.`
      },
      { role: "user", content: lang === "zh"
        ? `## 研究课题\n${topic}\n\n## 创新点\n${innovations.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n## 文献列表\n${refListText}\n\n请撰写文献综述草稿（1500-3000 字）。`
        : `## Research Topic\n${topic}\n\n## Innovation Points\n${innovations.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\n## References\n${refListText}\n\nWrite a literature review draft (800-1500 words).`
      },
    ], { temperature: 0.4 });

    return resp.content;
  }

  private extractJson(raw: string): unknown {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  }
}
