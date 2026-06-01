import { BaseAgent } from "./base.js";
import type { SectionNode, SectionType } from "../models/paper-outline.js";
import { SectionNodeSchema } from "../models/paper-outline.js";
import { z } from "zod";

export interface OutlineBuildInput {
  readonly topic: string;
  readonly major: string;
  readonly degreeLevel: "undergraduate" | "master" | "doctor";
  readonly proposalText: string;
  readonly innovationPoints: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
  }>;
  readonly referenceCount: number;
  readonly targetWordCount: number;
  readonly language: "zh" | "en";
}

export interface OutlineBuildOutput {
  readonly sections: SectionNode[];
  readonly structureRationale: string;
}

export class OutlineBuilder extends BaseAgent {
  get name(): string {
    return "outline-builder";
  }

  async buildOutline(input: OutlineBuildInput): Promise<OutlineBuildOutput> {
    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? this.chineseSystemPrompt()
      : this.englishSystemPrompt();

    const userMessage = this.buildUserMessage(input);

    const jsonFormatHint = isZh
      ? this.chineseJsonFormatHint()
      : this.englishJsonFormatHint();

    const resp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
      { role: "user", content: jsonFormatHint },
    ], { temperature: 0.3 });

    return this.parseOutlineOutput(resp.content);
  }

  private parseOutlineOutput(raw: string): OutlineBuildOutput {
    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    let sections: unknown;

    // Try 1: {"sections": [...]} object format
    const objMatch = cleaned.match(/\{[\s\S]*"sections"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        if (Array.isArray(parsed.sections)) {
          sections = parsed.sections;
        }
      } catch { /* fall through */ }
    }

    // Try 2: Raw array [...] format
    if (!sections) {
      const arrMatch = cleaned.match(/\[[\s\S]*\{[\s\S]*"id"[\s\S]*"title"[\s\S]*\}[\s\S]*\]/);
      if (arrMatch) {
        try {
          const parsed = JSON.parse(arrMatch[0]);
          if (Array.isArray(parsed)) {
            sections = parsed;
          }
        } catch { /* fall through */ }
      }
    }

    if (!sections) {
      // Try 3: The entire cleaned string as JSON
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed.sections && Array.isArray(parsed.sections)) {
          sections = parsed.sections;
        } else if (Array.isArray(parsed)) {
          sections = parsed;
        }
      } catch { /* fall through */ }
    }

    if (!sections) {
      throw new Error("Failed to parse outline: no valid JSON sections block found. Raw output first 500 chars: " + raw.slice(0, 500));
    }

    const validated = z.array(SectionNodeSchema).parse(sections);

    // Extract rationale (text surrounding the JSON)
    const jsonStr = JSON.stringify(sections);
    const jsonIdx = cleaned.indexOf(jsonStr.substring(0, 50));
    const rationale = jsonIdx > 0
      ? cleaned.slice(0, jsonIdx).trim()
      : raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").replace(/[\s\S]*?\}(?=\s*$)/, "").trim();

    return { sections: validated, structureRationale: rationale || "Structure generated." };
  }

  private chineseJsonFormatHint(): string {
    return `## 必须严格遵守的 JSON 输出格式

请输出一个 JSON 对象，包含 "sections" 键，值为章节数组：

\`\`\`json
{
  "sections": [
    {
      "id": "intro",
      "number": "1",
      "title": "绪论",
      "type": "introduction",
      "wordCount": 3000,
      "status": "planned",
      "children": [
        {
          "id": "intro-bg",
          "number": "1.1",
          "title": "研究背景",
          "type": "introduction",
          "wordCount": 1000,
          "status": "planned",
          "parentId": "intro",
          "children": [],
          "argumentPlan": [
            {
              "id": "arg1",
              "claim": "传统图书管理缺乏个性化推荐能力",
              "evidence": "现有系统功能对比分析",
              "supportingRefs": ["ref-1"],
              "counterArgument": ""
            }
          ],
          "plannedRefs": ["ref-1", "ref-2"]
        }
      ],
      "argumentPlan": [],
      "plannedRefs": []
    }
  ]
}
\`\`\`

注意：
- 必须输出完整的 JSON 对象，包含 "sections" 键
- 每个 section 的所有字段都不能省略
- children 可以是空数组 []
- status 统一使用 "planned"
- 本科论文 5-6 章，每章 2-4 节`;
  }

  private englishJsonFormatHint(): string {
    return `## REQUIRED JSON output format

Output a JSON object with a "sections" key containing the section array:

\`\`\`json
{
  "sections": [
    {
      "id": "intro",
      "number": "1",
      "title": "Introduction",
      "type": "introduction",
      "wordCount": 3000,
      "status": "planned",
      "children": [
        {
          "id": "intro-bg",
          "number": "1.1",
          "title": "Research Background",
          "type": "introduction",
          "wordCount": 1000,
          "status": "planned",
          "parentId": "intro",
          "children": [],
          "argumentPlan": [
            {
              "id": "arg1",
              "claim": "Traditional systems lack personalization",
              "evidence": "Comparative analysis of existing systems",
              "supportingRefs": ["ref-1"],
              "counterArgument": ""
            }
          ],
          "plannedRefs": ["ref-1", "ref-2"]
        }
      ],
      "argumentPlan": [],
      "plannedRefs": []
    }
  ]
}
\`\`\`

Important:
- MUST output a JSON object with "sections" key
- All fields per section are required
- children can be empty array []
- status should be "planned"
- Undergraduate: 5-6 chapters, 2-4 sections each`;
  }

  private buildUserMessage(input: OutlineBuildInput): string {
    const isZh = input.language === "zh";
    const degreeLabels: Record<string, string> = {
      undergraduate: "本科", master: "硕士", doctor: "博士",
    };

    return isZh
      ? this.chineseUserMessage(input, degreeLabels)
      : this.englishUserMessage(input, degreeLabels);
  }

  private chineseSystemPrompt(): string {
    return `你是一位学术论文结构设计专家。根据研究课题、创新点和学位要求，设计论文大纲。

## 论文结构标准
- 本科论文（15000-20000字）：5-6 章
- 硕士论文（30000-50000字）：6-8 章
- 博士论文（80000-150000字）：8-12 章

## 标准章节类型
- abstract-cn: 中文摘要
- abstract-en: 英文摘要
- keywords: 关键词
- introduction: 绪论/引言（研究背景、目的、意义、方法、创新点、论文结构）
- literature-review: 文献综述/理论基础
- methodology: 研究方法/实验设计
- results: 研究结果/数据分析
- discussion: 讨论/分析与建议
- conclusion: 结论与展望
- acknowledgment: 致谢
- references: 参考文献
- appendix: 附录

## 输出要求
先写一段结构设计思路，然后输出完整的 JSON 对象（包含 "sections" 键），每个 section 必须包含所有必填字段。`;
  }

  private chineseUserMessage(
    input: OutlineBuildInput,
    degreeLabels: Record<string, string>,
  ): string {
    return `## 研究课题
${input.topic}

## 专业方向
${input.major}

## 学位层次
${degreeLabels[input.degreeLevel]}

## 目标字数
${input.targetWordCount} 字

## 创新点
${input.innovationPoints.map((p, i) => `${i + 1}. ${p.description}`).join("\n")}

## 文献数量
约 ${input.referenceCount} 篇

## 开题报告摘要
${input.proposalText.slice(0, 2000)}

请设计论文大纲。`;
  }

  private englishSystemPrompt(): string {
    return `You are an academic paper structure design expert. Design a paper outline based on the research topic, innovation points, and degree requirements.

## Standard Section Types
- abstract-cn/en, keywords
- introduction (background, purpose, significance, methods, innovation, structure)
- literature-review (theoretical basis)
- methodology (research design)
- results (data analysis)
- discussion (analysis and implications)
- conclusion (summary and outlook)
- acknowledgment, references, appendix

## Output
First write structure rationale, then output a complete JSON object with a "sections" key containing the section array. All required fields per section MUST be present.`;
  }

  private englishUserMessage(
    input: OutlineBuildInput,
    degreeLabels: Record<string, string>,
  ): string {
    return `## Research Topic
${input.topic}

## Major
${input.major}

## Degree Level
${degreeLabels[input.degreeLevel]}

## Target Word Count
${input.targetWordCount}

## Innovation Points
${input.innovationPoints.map((p, i) => `${i + 1}. ${p.description}`).join("\n")}

## Reference Count
~${input.referenceCount}

## Proposal Summary
${input.proposalText.slice(0, 2000)}

Please design the paper outline.`;
  }
}
