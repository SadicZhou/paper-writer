import { BaseAgent } from "./base.js";
import type { Reference } from "../models/paper.js";
import type { ArgumentClaim, SectionNode } from "../models/paper-outline.js";

export interface SectionWriteInput {
  readonly section: SectionNode;
  readonly topic: string;
  readonly major: string;
  readonly innovationPoints: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  readonly references: Reference[];
  readonly previousSectionSummary?: string;
  readonly language: "zh" | "en";
  /** If set, these instructions are prepended to prompt for diagram/table corrections */
  readonly correctionInstructions?: string;
}

export interface SectionWriteOutput {
  readonly content: string;
  readonly citations: string[];
  readonly wordCount: number;
}

export class SectionWriter extends BaseAgent {
  get name(): string {
    return "section-writer";
  }

  async writeSection(input: SectionWriteInput): Promise<SectionWriteOutput> {
    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? this.chineseSystemPrompt()
      : this.englishSystemPrompt();

    const userMessage = this.buildUserMessage(input);

    // Chinese: ~1 char/token. English: ~0.75 word/token. Cap strictly.
    const tokenCap = isZh
      ? Math.min(Math.ceil(input.section.wordCount * 1.4), 8192)
      : Math.min(Math.ceil(input.section.wordCount * 2.0), 8192);

    const resp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.6, maxTokens: tokenCap });

    const content = resp.content;
    const citations = this.extractCitations(content);
    const wordCount = isZh ? content.length : content.split(/\s+/).length;

    return { content, citations, wordCount };
  }

  private extractCitations(content: string): string[] {
    // Match citation patterns: [1], [1,2,3], [1-3]
    const citationRegex = /\[([^\]]+)\]/g;
    const refs = new Set<string>();
    let match;
    while ((match = citationRegex.exec(content)) !== null) {
      const parts = match[1].split(",");
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes("-")) {
          const [start, end] = trimmed.split("-").map(Number);
          for (let i = start; i <= end; i++) refs.add(String(i));
        } else {
          refs.add(trimmed);
        }
      }
    }
    return [...refs];
  }

  private buildUserMessage(input: SectionWriteInput): string {
    const isZh = input.language === "zh";
    const sectionNum = input.section.number;
    const sectionTitle = input.section.title;

    // Build reference catalog
    const refCatalog = input.references
      .map((r, i) => `[${i + 1}] ${r.authors.join(", ")}. ${r.title}. ${r.journal ?? ""}, ${r.year}.`)
      .join("\n");

    // Build argument plan
    const argPlan = input.section.argumentPlan.length > 0
      ? input.section.argumentPlan.map((a) =>
          `- 论点: ${a.claim}\n  论据: ${a.evidence}\n  引用: [${a.supportingRefs.join(", ")}]`
        ).join("\n")
      : isZh ? "（根据上下文自行组织论据）" : "(Organize arguments based on context)";

    const prevContext = input.previousSectionSummary
      ? (isZh
        ? `## 前一节摘要\n${input.previousSectionSummary}`
        : `## Previous Section Summary\n${input.previousSectionSummary}`)
      : "";

    const correctionBlock = input.correctionInstructions
      ? (isZh
        ? `## 修正指令（高优先级）\n${input.correctionInstructions}\n\n`
        : `## Correction Instructions (High Priority)\n${input.correctionInstructions}\n\n`)
      : "";

    return isZh
      ? `${correctionBlock}## 论文课题\n${input.topic}\n\n## 当前章节\n${sectionNum} ${sectionTitle}\n\n## 字数限制（严格）\n不得超过 ${input.section.wordCount} 字。请严格控制篇幅，超出将截断。\n\n## 创新点\n${input.innovationPoints.map((p, i) => `${i + 1}. ${p.description}`).join("\n")}\n\n## 论据规划\n${argPlan}\n\n## 参考文献目录\n${refCatalog}\n\n${prevContext}\n\n请撰写「${sectionNum} ${sectionTitle}」的正文。严格遵守字数限制，引用处以 [n] 标注。`
      : `${correctionBlock}## Paper Topic\n${input.topic}\n\n## Current Section\n${sectionNum} ${sectionTitle}\n\n## Target Word Count\n~${input.section.wordCount} words\n\n## Innovation Points\n${input.innovationPoints.map((p, i) => `${i + 1}. ${p.description}`).join("\n")}\n\n## Argument Plan\n${argPlan}\n\n## Reference Catalog\n${refCatalog}\n\n${prevContext}\n\nWrite the content for "${sectionNum} ${sectionTitle}". Follow academic writing standards, cite as [n].`;
  }

  private chineseSystemPrompt(): string {
    return `你是一位学术论文写作专家。你的写作风格：
- 严谨、客观、逻辑清晰
- 避免口语化和情绪化表达
- 使用准确的学术术语
- 论据充分，引用规范（引用处以 [n] 标注参考文献编号）
- 段落结构：论点 → 论据 → 分析 → 小结
- 章节间逻辑连贯，承上启下

## 写作要求
1. **字数限制为第一优先级** — 输出将按最大 token 硬截断，超出部分将丢失。必须将总字符数控制在目标字数以内
2. 每个论点都需要有论据支撑
3. 合理使用图表说明：使用 Mermaid 语法绘制架构图/流程图/实体关系图等。实体关系图请用 graph TD 或 flowchart LR（不要使用 erDiagram，因为渲染引擎对 erDiagram 支持有问题）
4. 引用准确，不要编造不存在的引用
5. 避免口语化表达（如"我觉得""众所周知"等）
6. 使用学术化但非模板化的语言

## 图表格式（重要）
当需要插入图表时，先写 "【图X 标题】" 占位行，紧接着提供 Mermaid 代码块（必须使用此格式）：

\x60\x60\x60mermaid
graph TD
    A[模块A] -->|数据流| B[模块B]
    B --> C[模块C]
\x60\x60\x60

适用于架构图、流程图、时序图、实体关系图等。表格使用标准 Markdown 表格格式，前加 "【表X 标题】" 标注。

**关键格式规则（必须遵守）**：
- 【图X 标题】占位行与 Mermaid 代码块之间必须有一个空行
- 【图X 标题】不要加粗（不要用 ** 包裹），直接写成普通文本
- 实体关系图使用 graph TD 或 flowchart LR，禁止使用 erDiagram
- Mermaid 节点标签中禁止使用 HTML 标签（如 <br>），使用逗号、空格或自然换行分隔
- Mermaid 节点标签中禁止使用英文圆括号 ()（mermaid.ink 会返回 HTTP 400），如需表示补充说明请使用中文全角括号（）或直接省略
- Mermaid 代码中禁止使用弯引号 ""''（Unicode 智能引号），一律使用直引号 ""''（ASCII）。特别是 subgraph 标题必须用直引号
- Mermaid 节点标签中禁止使用 @ 符号（mermaid.ink 返回 HTTP 400），改用 "at" 或直接省略

## 其他格式
- 标题使用 Markdown 标题语法（## 三级标题，### 四级标题）
- 正文段落正常书写
- 引用使用 [n] 格式

输出完整的章节 Markdown 正文，无需 JSON 包裹。`;
  }

  private englishSystemPrompt(): string {
    return `You are an academic paper writing expert. Your writing style:
- Rigorous, objective, logically clear
- Avoid colloquial and emotional expressions
- Use precise academic terminology
- Well-supported arguments with proper citations (use [n] for reference numbers)
- Paragraph structure: Claim → Evidence → Analysis → Summary
- Smooth transitions between sections

## Writing Requirements
1. Adhere to the target word count
2. Every claim must be supported by evidence
3. Use figures/tables where appropriate: draw architecture/flow/entity-relationship diagrams with Mermaid syntax. For entity-relationship diagrams, use graph TD or flowchart LR (do NOT use erDiagram — the rendering engine has issues with it)
4. Cite accurately — do not fabricate references
5. Use academic but non-templated language

## Figure/Table Format (Important)
For figures, write "[Figure X: title]" then immediately provide a Mermaid code block (MUST use this format):

\x60\x60\x60mermaid
graph TD
    A[Module A] -->|data| B[Module B]
    B --> C[Module C]
\x60\x60\x60

Use for architecture diagrams, flowcharts, sequence diagrams, entity-relationship diagrams, etc. For tables, use standard Markdown table format with "[Table X: title]" above.

**Critical formatting rules (MUST follow)**:
- There must be a blank line between the figure placeholder line and the Mermaid code block
- Do NOT bold the figure placeholder line (no ** wrapping), write it as plain text
- For entity-relationship diagrams, use graph TD or flowchart LR — erDiagram is forbidden
- Do NOT use HTML tags (e.g. <br>) in Mermaid node labels — use commas, spaces, or plain text instead
- Do NOT use round brackets (parentheses) in Mermaid node labels — mermaid.ink returns HTTP 400 for them. Use square brackets or omit instead
- Do NOT use smart/curly quotes ""'' (Unicode) in Mermaid code — use straight ASCII quotes only. Subgraph titles especially must use straight quotes
- Do NOT use @ symbol in Mermaid node labels — mermaid.ink returns HTTP 400. Use "at" instead or omit it

## Other Format
- Use Markdown headings (## for H2, ### for H3)
- Normal paragraph text
- Citations as [n]

Output the complete section in Markdown, no JSON wrapper.`;
  }
}
