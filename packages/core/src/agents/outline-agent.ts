import { BaseAgent } from "./base.js";
import type { SectionNode } from "../models/paper-outline.js";
import { SectionNodeSchema } from "../models/paper-outline.js";
import { z } from "zod";

export interface OutlineAgentInput {
  readonly topic: string;
  readonly major: string;
  readonly degreeLevel: "undergraduate" | "master" | "doctor";
  readonly proposalText: string;
  readonly targetWordCount: number;
  readonly language: "zh" | "en";
  /** Optional: already-identified innovation points to structure around */
  readonly innovationPoints?: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
  }>;
  /** Optional: reference count hint */
  readonly referenceCount?: number;
}

export interface OutlineAgentOutput {
  readonly sections: SectionNode[];
  readonly structureRationale: string;
}

export class OutlineAgent extends BaseAgent {
  get name(): string {
    return "outline-agent";
  }

  async generate(input: OutlineAgentInput): Promise<OutlineAgentOutput> {
    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? this.chineseSystemPrompt(input)
      : this.englishSystemPrompt(input);

    const userMessage = isZh
      ? this.chineseUserMessage(input)
      : this.englishUserMessage(input);

    const formatHint = isZh
      ? this.chineseFormatHint(input)
      : this.englishFormatHint(input);

    const resp = await this.chat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
        { role: "user", content: formatHint },
      ],
      { temperature: 0.3 },
    );

    return this.parseOutput(resp.content, input.language);
  }

  private parseOutput(raw: string, language: "zh" | "en"): OutlineAgentOutput {
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

    // Try 3: Entire cleaned string as JSON
    if (!sections) {
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
      throw new Error(
        language === "zh"
          ? `大纲解析失败：未找到有效的 JSON 章节数组。原始输出前 500 字符: ${raw.slice(0, 500)}`
          : `Failed to parse outline: no valid JSON sections block found. Raw output first 500 chars: ${raw.slice(0, 500)}`,
      );
    }

    const validated = z.array(SectionNodeSchema).parse(sections);

    // Extract rationale (text surrounding the JSON)
    const jsonStr = JSON.stringify(sections);
    const jsonIdx = cleaned.indexOf(jsonStr.substring(0, 50));
    const rationale =
      jsonIdx > 0
        ? cleaned.slice(0, jsonIdx).trim()
        : raw
            .replace(/```json\s*/gi, "")
            .replace(/```\s*/g, "")
            .replace(/[\s\S]*?\}(?=\s*$)/, "")
            .trim();

    return {
      sections: validated,
      structureRationale: rationale || (language === "zh" ? "大纲已生成。" : "Outline generated."),
    };
  }

  private chineseSystemPrompt(input: OutlineAgentInput): string {
    const degreeLabel = { undergraduate: "本科", master: "硕士", doctor: "博士" }[
      input.degreeLevel
    ];
    const chapterHint = this.chapterHint(input.degreeLevel);

    return `你是一位学术论文结构设计专家。根据研究课题、专业方向和学位要求，设计一份完整的${degreeLabel}论文大纲。

## 论文结构要求
${chapterHint}

## 目标字数
全文约 ${input.targetWordCount.toLocaleString()} 字。请合理分配各章节字数，确保重点章节（研究方法、结果分析）占比充分。

## 标准章节类型
- abstract-cn: 中文摘要
- abstract-en: 英文摘要
- introduction: 绪论（研究背景、目的与意义、国内外研究现状、研究内容与方法、创新点、论文结构）
- literature-review: 文献综述 / 相关理论与技术基础
- methodology: 研究方法 / 系统设计
- results: 研究结果 / 系统实现与测试
- discussion: 讨论与分析
- conclusion: 结论与展望
- acknowledgment: 致谢
- references: 参考文献

## 输出要求
1. 先写一段结构设计思路（说明各章为什么这样安排、重点在哪些章节）
2. 然后输出完整的 JSON 对象（包含 "sections" 键），每个 section 必须包含所有必填字段
3. 每个叶子节点（小节）需要包含 argumentPlan（论证计划），说明该节要证明的论点、使用的证据和支撑文献
4. 每个叶子节点需要包含 plannedRefs（计划引用文献的 ID 列表）
5. 章节编号使用标准学术编号：1, 1.1, 1.2, 2, 2.1, ...`;
  }

  private chapterHint(degreeLevel: "undergraduate" | "master" | "doctor"): string {
    switch (degreeLevel) {
      case "undergraduate":
        return "- 本科论文：5-6 章\n- 典型结构：绪论 → 理论基础 → 系统设计 → 实现与测试 → 结论\n- 每章含 2-4 节";
      case "master":
        return "- 硕士论文：6-8 章\n- 典型结构：绪论 → 文献综述 → 理论基础 → 方法/设计 → 实验/实现 → 结果分析 → 结论\n- 每章含 2-4 节，研究深度和广度高于本科";
      case "doctor":
        return "- 博士论文：8-12 章\n- 典型结构：绪论 → 文献综述（多章） → 理论基础 → 研究方法 → 实验设计（多章） → 结果分析（多章） → 综合讨论 → 结论\n- 每章含 3-5 节，需要显著的理论深度和创新性";
    }
  }

  private chineseUserMessage(input: OutlineAgentInput): string {
    const parts: string[] = [
      `## 论文题目\n${input.topic}`,
      `## 专业方向\n${input.major}`,
      `## 学位层次\n${({ undergraduate: "本科", master: "硕士", doctor: "博士" })[input.degreeLevel]}`,
      `## 目标字数\n${input.targetWordCount.toLocaleString()} 字`,
    ];

    if (input.innovationPoints && input.innovationPoints.length > 0) {
      parts.push(
        `## 创新点\n${input.innovationPoints
          .map((p, i) => `${i + 1}. ${p.description}`)
          .join("\n")}`,
      );
    }

    if (input.referenceCount) {
      parts.push(`## 参考文献数量\n约 ${input.referenceCount} 篇`);
    }

    parts.push(
      `## 开题报告 / 研究构想\n${input.proposalText.slice(0, 3000)}`,
    );

    parts.push("请设计论文大纲。");

    return parts.join("\n\n");
  }

  private chineseFormatHint(input: OutlineAgentInput): string {
    const wordTotal = input.targetWordCount;
    const chapterCount =
      input.degreeLevel === "doctor" ? 8 : input.degreeLevel === "master" ? 6 : 5;
    const perChapter = Math.round(wordTotal / chapterCount);

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
      "wordCount": ${Math.round(perChapter * 0.8)},
      "status": "planned",
      "children": [
        {
          "id": "intro-bg",
          "number": "1.1",
          "title": "研究背景",
          "type": "introduction",
          "wordCount": ${Math.round(perChapter * 0.25)},
          "status": "planned",
          "parentId": "intro",
          "children": [],
          "argumentPlan": [
            {
              "id": "arg1",
              "claim": "论点的具体表述",
              "evidence": "支撑该论点的证据或数据来源",
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
- 叶子节点（末尾小节）必须包含 argumentPlan 和 plannedRefs
- 父级章节的 argumentPlan 和 plannedRefs 可为空数组`;
  }

  private englishSystemPrompt(input: OutlineAgentInput): string {
    const degreeLabel = { undergraduate: "Undergraduate", master: "Master", doctor: "Doctor" }[
      input.degreeLevel
    ];
    const chapterHint = this.englishChapterHint(input.degreeLevel);

    return `You are an academic paper structure design expert. Design a complete ${degreeLabel} thesis outline based on the research topic, major, and degree requirements.

## Structure Requirements
${chapterHint}

## Target Word Count
~${input.targetWordCount.toLocaleString()} words. Allocate words reasonably across chapters, ensuring core chapters (methodology, results) have sufficient weight.

## Standard Section Types
- abstract-cn/en, keywords
- introduction (background, significance, literature review, methods, innovation, structure)
- literature-review (theoretical foundations)
- methodology (research design / system design)
- results (implementation and testing)
- discussion (analysis and implications)
- conclusion (summary and outlook)
- acknowledgment, references

## Output
1. First write structure rationale (why this arrangement, which chapters are key)
2. Then output a complete JSON object with a "sections" key containing the section array
3. Leaf sections (subsections) must include argumentPlan and plannedRefs
4. Use standard academic numbering: 1, 1.1, 1.2, 2, 2.1, ...`;
  }

  private englishChapterHint(degreeLevel: "undergraduate" | "master" | "doctor"): string {
    switch (degreeLevel) {
      case "undergraduate":
        return "- Undergraduate: 5-6 chapters\n- Typical: Introduction → Theory → Design → Implementation & Testing → Conclusion\n- 2-4 sections per chapter";
      case "master":
        return "- Master: 6-8 chapters\n- Typical: Introduction → Literature Review → Theory → Methods/Design → Experiments/Implementation → Results Analysis → Conclusion\n- 2-4 sections per chapter, greater depth than undergraduate";
      case "doctor":
        return "- Doctor: 8-12 chapters\n- Typical: Introduction → Literature Review (multi-chapter) → Theory → Methods → Experiments (multi-chapter) → Results (multi-chapter) → Discussion → Conclusion\n- 3-5 sections per chapter, significant theoretical depth required";
    }
  }

  private englishUserMessage(input: OutlineAgentInput): string {
    const parts: string[] = [
      `## Research Topic\n${input.topic}`,
      `## Major\n${input.major}`,
      `## Degree Level\n${({ undergraduate: "Undergraduate", master: "Master", doctor: "Doctor" })[input.degreeLevel]}`,
      `## Target Word Count\n${input.targetWordCount.toLocaleString()}`,
    ];

    if (input.innovationPoints && input.innovationPoints.length > 0) {
      parts.push(
        `## Innovation Points\n${input.innovationPoints
          .map((p, i) => `${i + 1}. ${p.description}`)
          .join("\n")}`,
      );
    }

    if (input.referenceCount) {
      parts.push(`## Reference Count\n~${input.referenceCount}`);
    }

    parts.push(`## Proposal Summary\n${input.proposalText.slice(0, 3000)}`);
    parts.push("Please design the paper outline.");

    return parts.join("\n\n");
  }

  private englishFormatHint(input: OutlineAgentInput): string {
    const wordTotal = input.targetWordCount;
    const chapterCount =
      input.degreeLevel === "doctor" ? 8 : input.degreeLevel === "master" ? 6 : 5;
    const perChapter = Math.round(wordTotal / chapterCount);

    return `## REQUIRED JSON Output Format

Output a JSON object with a "sections" key:

\`\`\`json
{
  "sections": [
    {
      "id": "intro",
      "number": "1",
      "title": "Introduction",
      "type": "introduction",
      "wordCount": ${Math.round(perChapter * 0.8)},
      "status": "planned",
      "children": [
        {
          "id": "intro-bg",
          "number": "1.1",
          "title": "Research Background",
          "type": "introduction",
          "wordCount": ${Math.round(perChapter * 0.25)},
          "status": "planned",
          "parentId": "intro",
          "children": [],
          "argumentPlan": [
            {
              "id": "arg1",
              "claim": "Specific claim statement",
              "evidence": "Evidence or data source supporting the claim",
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
- Leaf sections must include argumentPlan and plannedRefs
- Parent-level chapters can have empty argumentPlan and plannedRefs`;
  }
}
