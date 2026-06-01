import { BaseAgent } from "./base.js";
import type { DetectedPassage } from "./ai-detection-auditor.js";

export interface ReductionInput {
  readonly content: string;
  readonly sectionNumber: string;
  readonly detectionScore: number;
  readonly flaggedPassages: DetectedPassage[];
  readonly language: "zh" | "en";
  readonly innovationPoints: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  readonly maxIterations?: number;
}

export interface ReductionOutput {
  readonly revisedContent: string;
  readonly newScore: number;
  readonly changesMade: string[];
  readonly iterationCount: number;
}

export class AIReductionReviser extends BaseAgent {
  get name(): string {
    return "ai-reduction-reviser";
  }

  async revise(input: ReductionInput): Promise<ReductionOutput> {
    const isZh = input.language === "zh";
    const maxIterations = input.maxIterations ?? 3;
    let currentContent = input.content;
    let currentScore = input.detectionScore;
    const allChanges: string[] = [];
    let iteration = 0;

    const systemPrompt = isZh
      ? this.chineseSystemPrompt()
      : this.englishSystemPrompt();

    while (iteration < maxIterations && currentScore > 0.35) {
      iteration++;

      const userMessage = this.buildRevisionMessage(
        currentContent,
        input.flaggedPassages,
        currentScore,
        input.innovationPoints,
        isZh,
      );

      const resp = await this.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ], { temperature: 0.7, maxTokens: Math.min(currentContent.length * 2, 16000) });

      const parsed = this.parseRevisionResponse(resp.content, isZh);
      currentContent = parsed.content;
      allChanges.push(...parsed.changes);

      // Re-audit the revised content
      currentScore = await this.quickAudit(currentContent, isZh);
    }

    return {
      revisedContent: currentContent,
      newScore: currentScore,
      changesMade: allChanges,
      iterationCount: iteration,
    };
  }

  private buildRevisionMessage(
    content: string,
    passages: DetectedPassage[],
    score: number,
    innovations: ReadonlyArray<{ readonly id: string; readonly description: string }>,
    isZh: boolean,
  ): string {
    const flaggedText = passages.length > 0
      ? passages.map((p) => `- [${p.severity}] ${p.reason}\n  原文: "${p.text}"`).join("\n")
      : (isZh ? "（无具体标记，整体改写）" : "(No specific flags — revise holistically)");

    const innovationText = innovations.length > 0
      ? innovations.map((p, i) => `${i + 1}. ${p.description}`).join("\n")
      : (isZh ? "（无）" : "(None)");

    return isZh
      ? `当前AI检测分数: ${score}\n\n标记的问题:\n${flaggedText}\n\n论文创新点参考:\n${innovationText}\n\n---\n以下是要改写的原文，请直接输出改写后的完整正文（不要任何解释说明）：\n\n${content.slice(0, 6000)}`
      : `Current AI detection score: ${score}\n\nFlagged issues:\n${flaggedText}\n\nInnovation points for reference:\n${innovationText}\n\n---\nOriginal text to revise. Output ONLY the revised text directly, no explanations:\n\n${content.slice(0, 6000)}`;
  }

  private parseRevisionResponse(
    raw: string,
    _isZh: boolean,
  ): { content: string; changes: string[] } {
    let content = raw.trim();

    // Strip any markdown code fences the model may have wrapped
    content = content.replace(/^```[\w]*\s*\n?/i, "").replace(/\n?```\s*$/i, "");

    // Strip potential "改写后文本" or "Revised Text" headers if model still outputs them
    const headers = ["## 改写后文本", "## Revised Text", "## 修改说明", "## Changes"];
    for (const header of headers) {
      const idx = content.indexOf(header);
      if (idx >= 0) {
        // Take content after the last recognizable header
        const afterHeader = content.slice(idx + header.length).trim();
        if (afterHeader.length > 50) {
          content = afterHeader;
        }
      }
    }

    // Remove "修改说明" / "Changes" sections if present at the start
    const changesIdx = content.indexOf("## 修改说明");
    const changesIdxEn = content.indexOf("## Changes");
    const firstHeader = Math.min(
      changesIdx >= 0 ? changesIdx : Infinity,
      changesIdxEn >= 0 ? changesIdxEn : Infinity,
    );
    if (firstHeader > 0 && firstHeader < Infinity) {
      content = content.slice(0, firstHeader).trim();
    }

    return { content, changes: [] };
  }

  private async quickAudit(content: string, isZh: boolean): Promise<number> {
    const prompt = isZh
      ? `快速评估以下文本的AI痕迹程度（仅输出0-1之间的数字，保留两位小数）:\n\n${content.slice(0, 3000)}`
      : `Quickly assess the AI-generation likelihood of the following text (output only a number between 0-1 with two decimal places):\n\n${content.slice(0, 3000)}`;

    try {
      const resp = await this.chat([
        { role: "user", content: prompt },
      ], { temperature: 0.1, maxTokens: 50 });

      const numMatch = resp.content.match(/([0-9]*\.[0-9]+|[01])/);
      if (numMatch) {
        return Math.min(1, Math.max(0, Number(numMatch[0])));
      }
    } catch {
      // Quick audit failed, return previous score
    }
    return 0.5;
  }

  private chineseSystemPrompt(): string {
    return `你是本科论文AIGC降重改写专属智能体。你的任务是将AI生成的论文文本改写为自然人工写作风格，大幅降低AIGC检测率。

## 绝对禁止
- 不输出任何思考过程、推理步骤、分析说明
- 不输出"修改说明""改写思路""改写策略"等额外内容
- 不输出任何解释性文字
- 只输出改写后的最终正文，直接输出即可

## 核心铁律
1. 完全保留原有专业知识点、研究背景、技术架构、研究内容
2. 不改动任何核心专业术语和事实数据：Spring Boot、MySQL、B/S、MyBatis、Vue、Redis等技术名词原样保留
3. 不修改任何标题（#、##、### 开头的行原样保留不动）
4. 不修改引用标记 [n]、图表标注、表格内容
5. 不添加新观点、不删减原有要点
6. 改写后字数保持在原文±10%范围内

## 降AIGC改写策略

### 句式打乱重组
- 打破AI规整句式，彻底重组句子结构
- 长句（超过20字）拆成2-3个短句
- 过于零碎的短句适当合并
- 句式长短交错，模仿真人写作的自然节奏
- 不要每段都以相同句式开头

### 倒装改写与语序调换
- 把"随着XX发展，出现了XX"改成"如今XX快速普及，XX领域也迎来改造需求"
- 把"在XX背景下"改成"当前XX环境下"
- 不总用"随着/基于/通过/在...下"开头
- 变换段落开头方式，避免连续段落以相同模式开头

### 替换模板化连词和AI套话
- "综上所述"→"综合来看"/"从整体来看"/"总的来看"
- "由此可见"→"从实际应用角度来说"/"可以看出"/"从这点来看"
- "然而"→"不过"/"但"/"但是"/"可是"
- "因此"→"所以"/"因而"/"这样一来"
- "此外"→"另外"/"同时"/"除此之外"
- "具有重要意义"→"在实际应用中有较大价值"/"在实际场景中作用明显"
- "发挥着重要作用"→"在实际场景中起到了关键作用"/"在项目中扮演重要角色"
- "提供了有力支撑"→"为实际工作提供了支撑"/"让系统有了较好的基础"
- "奠定了坚实基础"→"打下了较好的基础"/"为后续开发做好了准备"
- "呈现出良好态势"→"表现出了较好的发展势头"/"取得了不错的进展"
- "成为人们关注的焦点"→"受到了越来越多的关注"/"引起了业界的重视"
- "产生了深远影响"→"带来了较大影响"/"对行业有不小的影响"
- 删除或替换所有AI模板化套话为自然、朴素的叙述

### 模仿本科工科生写作口吻
- 用普通工科生论文常用表达，不过度学术化、不刻意书面化
- 像学生在写课程论文或毕业设计报告，而不是教授在写期刊论文
- 适当加入真人语气表述：
  - "在实际调研过程中发现"
  - "结合日常使用场景来看"
  - "从项目实践角度出发"
  - "在实际开发/测试中观察到"
  - "从用户使用的角度来看"
  - "经过实际对比分析发现"
- 保持朴实直接的表达，不堆砌华丽词藻

### 段落处理
- 长段落（超过8句）拆成2-3个短段落
- 不要一大段到底，也不要段落过于零碎
- 段落长度参差不齐，保持自然书写感
- 段落之间过渡自然，不刻意使用过渡句

### 保留真人写作的自然松散感
- 行文不要过于工整、流畅、完美
- 避免排比句式、三段式结构、模板化过渡
- 保留一点点真人写作的自然松散痕迹
- 逻辑不需要太过顺滑无断点，允许轻微跳跃
- 适当出现轻微口语化、句式长短交错的真人写作文特征
- 适当使用不太精确但自然的表述，替换过于精准的学术定义式表达

### 同义改写规则
- 不使用高级书面词汇，改用普通工科生常用表达
- 专业术语绝对不动，只改修饰语句和描述性文字
- 变"学术腔"为"说明文腔"
- 能用简单词不用复杂词，能用短句不用长句

## 输出格式
直接输出改写后的正文，不要任何解释、不要分点、不要"修改说明"、不要"改写后文本"标题。
保持原文的标题结构（#、##、### 等）完全不变。
段落格式和原文保持一致，保持Markdown格式完整。`;
  }

  private englishSystemPrompt(): string {
    return `You are an academic text revision expert. Rewrite AI-generated academic text to read like natural human writing.

## Forbidden
- Do NOT output any thinking process, reasoning, or analysis
- Do NOT output change notes, summaries, or explanations
- Output ONLY the revised final text directly

## Revision Strategies
1. **Sentence restructuring**: Split long sentences, combine short ones, vary sentence length and rhythm
2. **Transition diversification**: Reduce "However"/"Therefore"/"Furthermore" — use natural logical flow
3. **Paragraph restructuring**: Reorder arguments, merge or split paragraphs, vary paragraph openings
4. **Synonym substitution**: Replace AI-common vocabulary with natural academic synonyms (keep technical terms)
5. **Voice naturalization**: Add personal viewpoint, use specific targeted expressions, avoid vague generalities
6. **Imperfect polish**: Preserve slight natural looseness — do not make the text too perfectly structured

## Key Rules
- Do NOT alter citation markers [n], figure/table markers, data, or conclusions
- Do NOT alter section headings (#, ##, ###)
- Preserve original meaning, keep similar word count (+/-10%)
- Maintain appropriate academic tone without being overly formal

## Output Format
Output ONLY the revised text directly — no explanations, no "Revised Text" heading, no change notes.`;
  }
}
