import { BaseAgent } from "./base.js";
import { MermaidRenderer } from "../pipeline/mermaid-renderer.js";

export interface DiagramVerifyInput {
  readonly content: string;
  readonly sectionNumber: string;
  readonly sectionTitle: string;
  readonly language: "zh" | "en";
  /** "syntax" = programmatic render check only; "full" = +LLM semantic review */
  readonly mode: "syntax" | "full";
}

export interface DiagramInfo {
  readonly figureNumber: string;
  readonly caption: string;
  readonly mermaidCode: string;
  syntaxValid: boolean;
  syntaxError?: string;
  semanticIssues?: string[];
  recommendation: "keep" | "fix" | "regenerate";
}

export interface DiagramVerifyOutput {
  readonly diagrams: DiagramInfo[];
  readonly allValid: boolean;
  readonly issues: string[];
}

const FIGURE_MERMAID_RE =
  /^\*{0,2}【(图)\s*(\d+(?:[.-]\d+)*)\s*([^】]*)】\*{0,2}$/;

export class DiagramVerifier extends BaseAgent {
  private mermaidRenderer = new MermaidRenderer();

  get name(): string {
    return "diagram-verifier";
  }

  async verify(input: DiagramVerifyInput): Promise<DiagramVerifyOutput> {
    const diagrams = this.extractDiagrams(input.content);
    const issues: string[] = [];

    if (diagrams.length === 0) {
      return { diagrams: [], allValid: true, issues: [] };
    }

    // Phase 1: Programmatic syntax/render check for each diagram
    for (const d of diagrams) {
      // Check for HTML tags and problematic characters in node labels — mermaid.ink rejects them
      const labelIssue = this.checkLabelSanity(d.mermaidCode);
      if (labelIssue) {
        d.syntaxValid = false;
        d.syntaxError = labelIssue;
        d.recommendation = "fix";
        issues.push(
          `${input.sectionNumber} 图${d.figureNumber} (${d.caption}): ${labelIssue}`,
        );
        continue;
      }

      try {
        await this.mermaidRenderer.render(d.mermaidCode);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        d.syntaxValid = false;
        const msg = e?.message ?? String(e);
        d.syntaxError = msg;
        d.recommendation = "fix";
        const snippet = d.mermaidCode.replace(/\n/g, " ").slice(0, 100);
        issues.push(
          `${input.sectionNumber} 图${d.figureNumber} (${d.caption}): Mermaid 渲染失败 — ${msg} — 代码片段: ${snippet}${d.mermaidCode.length > 100 ? "..." : ""}`,
        );
      }
    }

    // Phase 2: LLM semantic review (full mode only)
    if (input.mode === "full") {
      const semanticIssues = await this.semanticReview(input, diagrams);
      for (const si of semanticIssues) {
        const target = diagrams.find((d) => d.figureNumber === si.figureNumber);
        if (target) {
          target.semanticIssues = si.issues;
          if (target.recommendation === "keep" && si.issues.length > 0) {
            target.recommendation = "fix";
          }
        }
        issues.push(...si.issues.map((iss) => `${input.sectionNumber} 图${si.figureNumber}: ${iss}`));
      }
    }

    const allValid = diagrams.every((d) => d.syntaxValid && (d.semanticIssues?.length ?? 0) === 0);

    return { diagrams, allValid, issues };
  }

  private extractDiagrams(content: string): DiagramInfo[] {
    const diagrams: DiagramInfo[] = [];
    // Find all 【图X 标题】 + mermaid pairs
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i]!.match(FIGURE_MERMAID_RE);
      if (!match) continue;
      const figNum = match[2]!;
      const caption = match[3]!.trim();
      // Look for mermaid code block in the following lines
      if (i + 1 < lines.length && lines[i + 1]!.trim() === "```mermaid") {
        const codeLines: string[] = [];
        let j = i + 2;
        while (j < lines.length && lines[j]!.trim() !== "```") {
          codeLines.push(lines[j]!);
          j++;
        }
        if (codeLines.length > 0) {
          diagrams.push({
            figureNumber: figNum,
            caption: caption ? `图${figNum} ${caption}` : `图${figNum}`,
            mermaidCode: codeLines.join("\n"),
            syntaxValid: true,
            recommendation: "keep",
          });
        }
        i = j; // skip past code block
      }
    }
    return diagrams;
  }

  private checkLabelSanity(mermaidCode: string): string | null {
    // 1. Detect HTML tags in node labels — mermaid.ink rejects them
    const htmlTagRe = /<\s*(br|div|span|a|img|p|b|i|u|font|center|h[1-6])\b[^>]*\/?\s*>/gi;
    const matches = mermaidCode.match(htmlTagRe);
    if (matches && matches.length > 0) {
      return `Mermaid 节点标签包含 HTML 标签 ${matches.join(", ")}，mermaid.ink 无法渲染。请改用纯文本、逗号或空格分隔。`;
    }

    // 2. Detect parentheses inside node labels — mermaid.ink returns HTTP 400
    const parensInLabelRe = /\[([^\]]*[()][^\]]*)\]/g;
    let pm;
    while ((pm = parensInLabelRe.exec(mermaidCode)) !== null) {
      const label = pm[1]!;
      return `Mermaid 节点标签包含英文圆括号: "[${label.slice(0, 60)}]"。mermaid.ink 对括号返回 HTTP 400。请改用中文全角括号（）或直接省略括号。`;
    }

    // 3. Detect @ anywhere — mermaid.ink returns HTTP 400 for any @ in the diagram
    const atIdx = mermaidCode.indexOf("@");
    if (atIdx >= 0) {
      const ctx = mermaidCode.slice(Math.max(0, atIdx - 15), atIdx + 16);
      return `Mermaid 代码包含 @ 符号（位置: "${ctx}"）。mermaid.ink 对 @ 返回 HTTP 400。请改为 "at" 或直接移除。`;
    }

    // 4. Detect smart/curly quotes — mermaid.ink only accepts straight ASCII quotes
    const smartQuoteRe = /[“”‘’]/g;
    const sqMatch = smartQuoteRe.exec(mermaidCode);
    if (sqMatch) {
      return `Mermaid 代码包含弯引号 ${sqMatch[0]}（Unicode 智能引号），mermaid.ink 无法解析。请改用直引号 " 或 '（ASCII）。`;
    }

    // 4. Detect unescaped angle brackets (e.g. <type> inside labels)
    const unescapedAngleRe = /\[([^\]]*<[^>]*>[^\]]*)\]/g;
    let um;
    while ((um = unescapedAngleRe.exec(mermaidCode)) !== null) {
      if (/<[a-zA-Z/]/.test(um[1]!)) continue; // already caught by htmlTagRe
      return `Mermaid 节点标签疑似包含未转义的尖括号: "${um[1]!.slice(0, 60)}"。请移除或用逗号、空格替换。`;
    }

    return null;
  }

  private async semanticReview(
    input: DiagramVerifyInput,
    diagrams: DiagramInfo[],
  ): Promise<Array<{ figureNumber: string; issues: string[] }>> {
    const validDiagrams = diagrams.filter((d) => d.syntaxValid);
    if (validDiagrams.length === 0) return [];

    const isZh = input.language === "zh";

    const diagramSummary = validDiagrams
      .map((d) => `## 图${d.figureNumber} ${d.caption}\n\`\`\`mermaid\n${d.mermaidCode}\n\`\`\``)
      .join("\n\n");

    const systemPrompt = isZh
      ? `你是学术论文图表审阅专家。检查每个图表的 Mermaid 代码：
1. 图表内容是否与章节主题相关
2. 节点/实体名称是否与正文中的术语一致
3. 图表逻辑是否正确（数据流方向、实体关系等）
4. 图表是否有明显的语法或逻辑错误
5. 节点标签中是否包含 HTML 标签（如 <br>, <br/>, <div>, <span>）或英文圆括号 () 或未转义的尖括号（< > & "）— 这些会导致 mermaid.ink 渲染失败

对每个图表输出 JSON 格式：
\`\`\`json
[{"figureNumber": "1", "issues": ["问题描述1", "问题描述2"]}]
\`\`\`
如果图表没有语义问题，issues 为空数组。`
      : `You are an academic paper diagram reviewer. Check each Mermaid diagram:
1. Is the diagram content relevant to the section topic?
2. Are node/entity names consistent with terms in the body text?
3. Is the diagram logic correct (data flow direction, entity relationships, etc.)?
4. Are there any obvious syntax or logic errors?
5. Do node labels contain HTML tags (e.g. <br>, <br/>, <div>, <span>), round brackets (parentheses), or unescaped angle brackets (< > & ")? — these will cause mermaid.ink rendering failures

Output JSON format for each diagram:
\`\`\`json
[{"figureNumber": "1", "issues": ["issue description 1", "issue description 2"]}]
\`\`\`
If a diagram has no issues, use an empty issues array.`;

    const userMessage = isZh
      ? `## 章节\n${input.sectionNumber} ${input.sectionTitle}\n\n## 正文摘要\n${input.content.slice(0, 1000)}\n\n## 图表代码\n${diagramSummary}\n\n请用 JSON 数组格式返回审阅结果。`
      : `## Section\n${input.sectionNumber} ${input.sectionTitle}\n\n## Body Summary\n${input.content.slice(0, 1000)}\n\n## Diagrams\n${diagramSummary}\n\nReturn results as a JSON array.`;

    try {
      const resp = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        { temperature: 0.3, maxTokens: 2048 },
      );

      // Parse JSON from response
      const jsonMatch = resp.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          figureNumber: string;
          issues: string[];
        }>;
        return parsed;
      }
      return [];
    } catch {
      return [];
    }
  }
}
