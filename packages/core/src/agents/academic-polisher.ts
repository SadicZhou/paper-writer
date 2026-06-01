import { BaseAgent } from "./base.js";

export interface PolishInput {
  readonly content: string;
  readonly sectionNumber: string;
  readonly sectionTitle: string;
  readonly language: "zh" | "en";
  readonly polishScope: "grammar" | "style" | "full";
}

export interface PolishOutput {
  readonly polishedContent: string;
  readonly changesSummary: string;
  readonly readabilityScore: number;
}

export class AcademicPolisher extends BaseAgent {
  get name(): string {
    return "academic-polisher";
  }

  async polish(input: PolishInput): Promise<PolishOutput> {
    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? this.chineseSystemPrompt(input.polishScope)
      : this.englishSystemPrompt(input.polishScope);

    const userMessage = isZh
      ? `章节: ${input.sectionNumber} ${input.sectionTitle}\n\n原文:\n${input.content}\n\n请直接输出改写后的完整正文，不要任何解释说明。`
      : `Section: ${input.sectionNumber} ${input.sectionTitle}\n\nOriginal:\n${input.content}\n\nOutput ONLY the revised text directly — no explanations, no change notes.`;

    const resp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: input.polishScope === "grammar" ? 0.2 : 0.7, maxTokens: Math.min(input.content.length * 2, 16000) });

    const { content: polishedContent, summary } = this.parsePolishOutput(
      resp.content,
      isZh,
    );

    const readabilityScore = this.estimateReadability(polishedContent, isZh);

    return {
      polishedContent: polishedContent || input.content,
      changesSummary: summary,
      readabilityScore,
    };
  }

  private parsePolishOutput(raw: string, isZh: boolean): { content: string; summary: string } {
    const trimmed = raw.trim();

    // Strip markdown code fences if present
    let cleaned = trimmed.replace(/^```[\w]*\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    // Check for the legacy marker
    const marker = isZh ? "## 润色后正文" : "## Polished Text";
    const idx = cleaned.indexOf(marker);

    if (idx >= 0) {
      return {
        summary: cleaned.slice(0, idx).trim(),
        content: cleaned.slice(idx + marker.length).trim(),
      };
    }

    // No marker found — the model should have output the revised text directly.
    // Strip any potential summary/explanation prefix (lines starting with #, >, -)
    const lines = cleaned.split("\n");
    let contentStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip lines that look like explanations (headers, bullet points at the top)
      if (
        line.startsWith("## 修改") ||
        line.startsWith("## 改写") ||
        line.startsWith("## Changes") ||
        line.startsWith("修改说明") ||
        line.startsWith("改写说明") ||
        (line.startsWith("-") && i < 3)
      ) {
        contentStart = i + 1;
      } else if (line.length > 0) {
        break;
      }
    }

    const content = lines.slice(contentStart).join("\n").trim() || cleaned;

    return {
      summary: isZh ? "改写完成" : "Revision complete",
      content,
    };
  }

  private estimateReadability(content: string, isZh: boolean): number {
    // Simple readability heuristic
    const sentences = content.split(isZh ? /[。！？；]/ : /[.!?;]/).filter((s) => s.trim().length > 0);
    if (sentences.length === 0) return 0;

    const avgSentenceLength = isZh
      ? sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length
      : sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;

    // Ideal academic sentence length: zh 30-60 chars, en 15-25 words
    const idealMin = isZh ? 25 : 12;
    const idealMax = isZh ? 65 : 28;

    if (avgSentenceLength >= idealMin && avgSentenceLength <= idealMax) {
      return 0.8 + Math.random() * 0.15;
    } else if (avgSentenceLength < idealMin) {
      return 0.5 + (avgSentenceLength / idealMin) * 0.3;
    } else {
      return 0.5 + (idealMax / avgSentenceLength) * 0.3;
    }
  }

  private chineseSystemPrompt(scope: "grammar" | "style" | "full"): string {
    const base = `你是本科论文AIGC降重改写专属智能体，严格遵守以下规则对论文内容进行改写：

## 绝对禁止
- 不输出任何思考过程、推理步骤、分析说明
- 不输出"修改说明""改写思路""润色要点"等额外内容
- 只输出改写后的最终正文

## 核心原则
1. **专业内容不动**: 完全保留原有专业知识点、研究背景、技术架构、核心术语（Spring Boot、MySQL、B/S、MyBatis等）和事实数据
2. **不增不减**: 不添加新观点、不删减原有要点，只做句式重构和语序调换
3. **不改标题**: 不改动任何标题（#、##、###）、引用标记 [n]、图表标注
4. **字数相近**: 保持字数在原文±10%范围内

## 降AIGC改写策略
1. **句式打乱重组**: 打破规整模板句式，长句拆短句、短句合并，句式长短交错，模仿真人写作节奏
2. **倒装改写**: 把"随着XX发展，出现了XX"改成"如今XX快速普及，XX领域也迎来改造需求"，不总用"随着/基于/通过"开头
3. **替换模板化连词和套话**:
   - "综上所述"→"综合来看"，"由此可见"→"从实际应用角度来说"
   - "然而"→"不过"/"但"，"因此"→"所以"/"因而"，"此外"→"另外"/"同时"
   - "具有重要意义"→"在实际应用中有较大价值"，"发挥着重要作用"→"在实际场景中起到了关键作用"
   - 删除所有AI模板化套话，替换为自然朴素的叙述
4. **模仿本科生口吻**: 用普通工科生论文写作语气，不生硬、不排比、不刻意书面化，像学生在写课程论文而非教授写期刊论文
5. **适度真人语气**: 适当加入"在实际调研过程中发现""结合日常使用场景来看""从项目实践角度出发"等表述
6. **段落拆分**: 长段落拆成2-3个短段落，段落长度参差不齐，保持自然书写感
7. **避免过分工整**: 行文不要过于逻辑完美流畅，保留真人写作的自然松散感，不排比、不三段式
8. **同义改写不用高级词汇**: 用普通工科生常用表达，变"学术腔"为"说明文腔"，专业术语绝对不动`;

    const grammarOnly = `
## 当前范围：仅修正语法
- 修正错别字和语法错误
- 修正标点符号
- 不改变句式和表达风格
- 不改变任何词汇选择`;

    const styleOnly = `
## 当前范围：仅降AIGC风格（不改语法和结构）
- 句式打乱重组、长短句交错
- 替换模板化套话和连词
- 模仿本科生自然写作语气、加入适度真人表述
- 保留真人写作松散感
- 不改变内容结构、不修改标题`;

    const full = `
## 当前范围：全面降AIGC改写
- 句式重构 + 段落拆分 + 语序调整
- 模板套话替换 + 本科生语气自然化
- 长短句交错 + 同义改写（专业术语不动）
- 保留真人写作自然松散感
- 保持段落感，不格式化输出`;

    const scopeSection = scope === "grammar" ? grammarOnly : scope === "style" ? styleOnly : full;

    return `${base}${scopeSection}

## 输出格式
直接输出改写后的正文，不要解释、不要分点、不要"修改说明"、不要"润色后正文"标题。
保持原文的标题结构（#、##、### 等）完全不变。
段落格式和原文保持一致，保持Markdown格式完整。`;
  }

  private englishSystemPrompt(scope: "grammar" | "style" | "full"): string {
    const base = `You are an academic text revision expert. Improve academic text quality without changing content or citations.

## Forbidden
- Do NOT output any thinking process, reasoning, or analysis
- Do NOT output change notes, summaries, or explanations
- Output ONLY the revised final text directly

## Key Rules
- Do NOT alter citation markers [n], figure/table markers, data, or conclusions
- Do NOT alter section headings (#, ##, ###)
- Preserve original meaning, keep similar word count (+/-10%)`;

    const grammarOnly = `
## Current Scope: Grammar & Typos Only
- Fix typos, grammar errors, punctuation
- Do NOT change sentence patterns, vocabulary, or style`;

    const styleOnly = `
## Current Scope: Academic Style Only
- Vary sentence structures (split long, combine short)
- Diversify transitions (reduce "However"/"Therefore"/"Furthermore")
- Improve academic register naturally
- Do NOT change content structure or headings`;

    const full = `
## Current Scope: Full Revision
- Sentence restructuring + paragraph reorganization
- Transition diversification + style naturalization
- Redundancy removal + vocabulary variation
- Preserve all section headings and structure`;

    const scopeSection = scope === "grammar" ? grammarOnly : scope === "style" ? styleOnly : full;

    return `${base}${scopeSection}

## Output Format
Output ONLY the revised text directly — no explanations, no "Polished Text" heading, no change notes.`;
}
}
