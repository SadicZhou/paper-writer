import { BaseAgent } from "./base.js";

export interface DetectionInput {
  readonly content: string;
  readonly sectionNumber: string;
  readonly language: "zh" | "en";
  readonly mode: "free" | "paid";
  readonly externalProvider?: "gptzero" | "originality" | "custom";
  readonly apiKey?: string;
}

export interface DetectedPassage {
  readonly text: string;
  readonly reason: string;
  readonly category: "transition-word" | "template-pattern" | "repetitive-structure" | "low-vocabulary" | "ai-expression" | "llm-flagged";
  readonly severity: "high" | "medium" | "low";
}

export interface DetectionOutput {
  readonly score: number;
  readonly flaggedPassages: DetectedPassage[];
  readonly metrics: DetectionMetrics;
  readonly recommendations: string[];
}

export interface DetectionMetrics {
  readonly transitionWordDensity: number;
  readonly templatePatternCount: number;
  readonly repetitiveStructureCount: number;
  readonly typeTokenRatio: number;
  readonly aiExpressionCount: number;
  readonly llmScore?: number;
}

// Chinese AI-tell patterns
const ZH_TRANSITION_WORDS = [
  "然而", "因此", "此外", "总而言之", "首先.*其次.*最后",
  "值得注意的是", "不可否认", "不仅.*而且", "一方面.*另一方面",
  "随着.*的发展", "近年来", "众所周知", "毋庸置疑",
  "综上所述", "基于以上分析", "由此可见", "不难看出",
  "具有重要意义", "发挥着重要作用", "成为人们关注的焦点",
  "提供了有力支撑", "奠定了坚实基础",
  // Additional patterns based on common AI writing characteristics
  "与此同时", "从某种角度来说", "不可忽视的是", "必须承认",
  "毋庸置疑的是", "不言而喻", "显而易见", "纵观",
  "从宏观层面来看", "从微观层面来说", "毋庸置疑地",
  "在当今社会", "在信息化时代", "在全球范围内",
  "无时无刻", "越来越受到", "日益增长",
];

const ZH_TEMPLATE_PATTERNS = [
  /不仅\S+而且\S+/g,
  /一方面\S+另一方面\S+/g,
  /首先\S+其次\S+最后\S+/g,
  /随着\S+的发展/g,
  /在\S+背景下/g,
  /通过\S+可以看出/g,
  /综上所述\S+/g,
  /为\S+提供了/g,
  // Additional template patterns
  /在\S+的推动下/g,
  /基于\S+的分析/g,
  /从\S+的角度来看/g,
  /对\S+进行了\S+/g,
  /实现了\S+的\S+/g,
  /推动了\S+的发展/g,
  /提升了\S+的水平/g,
  /促进了\S+的进步/g,
  /使得\S+得以\S+/g,
  /从而\S+了\S+/g,
  /进而\S+推动/g,
  /以此\S+实现/g,
];

const ZH_AI_EXPRESSIONS = [
  "具有重要意义", "发挥着重要作用", "成为人们关注的焦点",
  "提供了有力支撑", "奠定了坚实基础", "实现了全面提升",
  "呈现出良好态势", "面临新的机遇与挑战", "成为当今社会",
  "产生了深远影响", "引起了广泛关注", "进入了一个新的阶段",
  // Additional AI-typical expressions
  "不可忽视的是", "值得关注的是", "引起了人们的重视",
  "扮演着至关重要的角色", "起到了不可或缺的作用",
  "带来了新的发展契机", "展现出广阔的应用前景",
  "迎来了前所未有的机遇", "呈现出蓬勃发展的势头",
  "有力地推动了", "极大地促进了", "显著提升了",
  "为后续研究奠定了", "为相关工作提供了参考",
  "具有重要的理论意义和现实意义", "具有较高的应用价值",
  "达到了预期效果", "取得了令人瞩目的成就",
  "实现了跨越式发展", "树立了新的标杆",
  "在某种程度上", "从某种意义上说",
];

// English AI-tell patterns
const EN_TRANSITION_WORDS = [
  "However", "Therefore", "Furthermore", "In conclusion",
  "Firstly.*Secondly.*Finally", "It is worth noting that",
  "It is undeniable that", "Not only.*but also",
  "On one hand.*on the other hand", "With the development of",
  "In recent years", "It is widely acknowledged",
  "There is no doubt that", "In summary",
  "Based on the above analysis", "It can be seen that",
  "Plays an important role", "Has become a focus of attention",
];

const EN_TEMPLATE_PATTERNS = [
  /Not only\s+\S+\s+but also\s+\S+/gi,
  /On\s+one\s+hand\S+on\s+the\s+other\s+hand/gi,
  /Firstly\S+Secondly\S+Finally/gi,
  /With\s+the\s+development\s+of/gi,
  /In\s+the\s+context\s+of/gi,
  /It\s+can\s+be\s+seen\s+that/gi,
  /Plays?\s+an?\s+important\s+role\s+in/gi,
];

const EN_AI_EXPRESSIONS = [
  "plays a crucial role", "has become increasingly important",
  "has attracted considerable attention", "provides valuable insights",
  "in today's rapidly changing world", "a paradigm shift",
  "a double-edged sword", "it is important to note that",
  "further research is needed", "paves the way for",
];

export class AIDetectionAuditor extends BaseAgent {
  get name(): string {
    return "ai-detection-auditor";
  }

  async audit(input: DetectionInput): Promise<DetectionOutput> {
    const isZh = input.language === "zh";
    const metrics = this.runRegexDetection(input.content, isZh);
    let llmScore: number | undefined;
    let llmPassages: DetectedPassage[] = [];

    if (input.mode === "paid" && input.externalProvider && input.apiKey) {
      const externalResult = await this.runExternalDetection(input);
      llmScore = externalResult.score;
      llmPassages = externalResult.passages;
    } else {
      const selfResult = await this.runLLMSelfCheck(input.content, isZh);
      llmScore = selfResult.score;
      llmPassages = selfResult.passages;
    }

    const allPassages = [...this.buildRegexPassages(input.content, isZh), ...llmPassages];
    const combinedScore = this.combineScore(metrics, llmScore);

    const recommendations = this.buildRecommendations(metrics, combinedScore, isZh);

    return {
      score: combinedScore,
      flaggedPassages: allPassages,
      metrics: { ...metrics, llmScore },
      recommendations,
    };
  }

  private runRegexDetection(content: string, isZh: boolean): DetectionMetrics {
    const transitionWords = isZh ? ZH_TRANSITION_WORDS : EN_TRANSITION_WORDS;
    const templatePatterns = isZh ? ZH_TEMPLATE_PATTERNS : EN_TEMPLATE_PATTERNS;
    const aiExpressions = isZh ? ZH_AI_EXPRESSIONS : EN_AI_EXPRESSIONS;

    let transitionWordCount = 0;
    for (const word of transitionWords) {
      const regex = new RegExp(word, isZh ? "g" : "gi");
      const matches = content.match(regex);
      if (matches) transitionWordCount += matches.length;
    }

    let templatePatternCount = 0;
    for (const pattern of templatePatterns) {
      const matches = content.match(pattern);
      if (matches) templatePatternCount += matches.length;
    }

    let aiExpressionCount = 0;
    for (const expr of aiExpressions) {
      const regex = new RegExp(expr, isZh ? "g" : "gi");
      const matches = content.match(regex);
      if (matches) aiExpressionCount += matches.length;
    }

    const wordCount = isZh ? content.length : content.split(/\s+/).length;
    const transitionWordDensity = wordCount > 0 ? transitionWordCount / Math.max(wordCount, 100) : 0;

    const sentences = content.split(isZh ? /[。！？；\n]/ : /[.!?;\n]/).filter((s) => s.trim().length > 0);
    const typeTokenRatio = this.calculateTTR(sentences.join(" "), isZh);

    const repetitiveStructureCount = this.countRepetitiveStructures(sentences, isZh);

    return {
      transitionWordDensity: Math.round(transitionWordDensity * 1000) / 1000,
      templatePatternCount,
      repetitiveStructureCount,
      typeTokenRatio: Math.round(typeTokenRatio * 1000) / 1000,
      aiExpressionCount,
    };
  }

  private buildRegexPassages(content: string, isZh: boolean): DetectedPassage[] {
    const passages: DetectedPassage[] = [];
    const aiExpressions = isZh ? ZH_AI_EXPRESSIONS : EN_AI_EXPRESSIONS;
    const templatePatterns = isZh ? ZH_TEMPLATE_PATTERNS : EN_TEMPLATE_PATTERNS;

    for (const expr of aiExpressions) {
      const regex = new RegExp(`.{0,30}${expr}.{0,30}`, isZh ? "g" : "gi");
      const matches = content.match(regex);
      if (matches) {
        for (const m of matches) {
          passages.push({
            text: m.trim(),
            reason: isZh ? `AI标志性表达: "${expr}"` : `AI-typical expression: "${expr}"`,
            category: "ai-expression",
            severity: "medium",
          });
        }
      }
    }

    for (const pattern of templatePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        for (const m of matches) {
          passages.push({
            text: m.trim(),
            reason: isZh ? "句式模板化" : "Template sentence pattern",
            category: "template-pattern",
            severity: "high",
          });
        }
      }
    }

    return passages.slice(0, 20);
  }

  private countRepetitiveStructures(sentences: string[], isZh: boolean): number {
    const starts = sentences.map((s) => s.trim().slice(0, isZh ? 4 : 3));
    const freq: Record<string, number> = {};
    for (const start of starts) {
      freq[start] = (freq[start] || 0) + 1;
    }
    return Object.values(freq).filter((c) => c >= 3).length;
  }

  private calculateTTR(text: string, isZh: boolean): number {
    if (!text.trim()) return 1;
    const tokens = isZh
      ? [...text.replace(/\s+/g, "")]
      : text.split(/\s+/);
    const uniqueTokens = new Set(tokens);
    return uniqueTokens.size / tokens.length;
  }

  private combineScore(metrics: DetectionMetrics, llmScore?: number): number {
    const regexScore =
      Math.min(1, metrics.transitionWordDensity * 5) * 0.15 +
      Math.min(1, metrics.templatePatternCount / 10) * 0.20 +
      Math.min(1, metrics.repetitiveStructureCount / 5) * 0.15 +
      (1 - metrics.typeTokenRatio) * 0.20 +
      Math.min(1, metrics.aiExpressionCount / 8) * 0.10;

    if (llmScore !== undefined) {
      return Math.round((regexScore * 0.4 + llmScore * 0.6) * 100) / 100;
    }
    return Math.round(regexScore * 100) / 100;
  }

  private async runLLMSelfCheck(
    content: string,
    isZh: boolean,
  ): Promise<{ score: number; passages: DetectedPassage[] }> {
    const systemPrompt = isZh
      ? `你是一个AI文本检测专家。分析给定的学术文本，判断其AI生成的可能性（0-1分）。

## 检测维度
1. 转接词频率：是否过度使用"然而""因此""此外""总而言之""与此同时"等模板化连词
2. 句式多样性：是否存在大量模板化句式（"不仅...而且...""一方面...另一方面...""随着...的发展""在...背景下"）
3. 段落结构：连续段落是否以相同模式开头，段落是否过于规整
4. 词汇丰富度：是否存在高频重复用词，词汇是否过于书面化、学术化
5. 个性化表达：是否缺乏个人观点和批判性思考，读起来像通用模板
6. 论证深度：论据是否流于表面，缺乏深入分析
7. 句式规整度：句子结构是否过于整齐（长短一致、排列工整），缺少真人写作的松散感
8. 逻辑顺滑度：逻辑是否过于流畅无断点，缺少真人写作中偶尔的跳跃和松散连接
9. 用词书面化程度：是否过度使用高级书面词汇、学术套话，缺少本科生写作的自然朴实感

## 输出格式
严格输出JSON：
{
  "score": 0.0-1.0,
  "analysis": "简要分析",
  "flaggedPassages": [
    {"text": "问题文本", "reason": "原因", "severity": "high|medium|low"}
  ]
}`
      : `You are an AI text detection expert. Analyze the given academic text and assess the likelihood of AI generation (0-1 score).

## Detection Dimensions
1. Transition word frequency: overuse of "However", "Therefore", "Furthermore", etc.
2. Sentence diversity: excessive templated patterns, overly uniform sentence structures
3. Paragraph structure: consecutive paragraphs starting with the same pattern
4. Vocabulary richness: high-frequency repeated words, overly formal/academic word choice
5. Personalized expression: lack of personal viewpoint and critical thinking
6. Argument depth: superficial arguments, lack of deep analysis
7. Structural uniformity: sentences too uniform in length and structure, lacking natural human variation
8. Logical smoothness: logic flows too perfectly without natural breaks or loose connections
9. Academic register excess: overly sophisticated vocabulary that reads unlike typical student writing

## Output Format
Strict JSON:
{
  "score": 0.0-1.0,
  "analysis": "brief analysis",
  "flaggedPassages": [
    {"text": "problematic text", "reason": "reason", "severity": "high|medium|low"}
  ]
}`;

    const resp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: content.slice(0, 8000) },
    ], { temperature: 0.1 });

    try {
      const json = this.extractJson(resp.content);
      return {
        score: Number(json.score) || 0.5,
        passages: ((json.flaggedPassages as Array<Record<string, unknown>>) || []).map((p) => ({
          text: String(p.text || ""),
          reason: String(p.reason || ""),
          category: "llm-flagged" as const,
          severity: (p.severity as "high" | "medium" | "low") || "medium",
        })),
      };
    } catch {
      return { score: 0.5, passages: [] };
    }
  }

  private async runExternalDetection(
    input: DetectionInput,
  ): Promise<{ score: number; passages: DetectedPassage[] }> {
    // Placeholder for external API integration (GPTZero, Originality.ai)
    // These would make HTTP calls with the provided apiKey
    if (input.externalProvider === "gptzero") {
      return this.mockGptZeroDetection(input.content);
    }
    if (input.externalProvider === "originality") {
      return this.mockOriginalityDetection(input.content);
    }
    // Fallback to LLM self-check
    return this.runLLMSelfCheck(input.content, input.language === "zh");
  }

  private async mockGptZeroDetection(
    _content: string,
  ): Promise<{ score: number; passages: DetectedPassage[] }> {
    // TODO: Integrate GPTZero API
    // POST https://api.gptzero.me/v2/predict/text
    // Headers: { "x-api-key": apiKey, "Content-Type": "application/json" }
    // Body: { document: content }
    return { score: 0.5, passages: [] };
  }

  private async mockOriginalityDetection(
    _content: string,
  ): Promise<{ score: number; passages: DetectedPassage[] }> {
    // TODO: Integrate Originality.ai API
    // POST https://api.originality.ai/api/v2/scan/ai
    return { score: 0.5, passages: [] };
  }

  private buildRecommendations(
    metrics: DetectionMetrics,
    score: number,
    isZh: boolean,
  ): string[] {
    const recs: string[] = [];

    if (isZh) {
      if (metrics.transitionWordDensity > 0.05) {
        recs.push("转接词密度过高，建议减少「然而」「因此」「此外」等词的使用，改用更自然的过渡方式");
      }
      if (metrics.templatePatternCount > 3) {
        recs.push("检测到多个模板化句式，建议变换表达方式，增加句式多样性");
      }
      if (metrics.repetitiveStructureCount > 2) {
        recs.push("连续段落结构重复，建议调整段落开头方式，避免相同模式");
      }
      if (metrics.typeTokenRatio < 0.6) {
        recs.push("词汇丰富度偏低，建议使用同义替换增加词汇多样性");
      }
      if (metrics.aiExpressionCount > 2) {
        recs.push("存在AI标志性表达，建议替换为更具个性化的学术语言");
      }
      if (score > 0.5) {
        recs.push("整体AI痕迹偏高，建议进行系统性降重改写");
      }
    } else {
      if (metrics.transitionWordDensity > 0.05) {
        recs.push("Transition word density too high — reduce 'However', 'Therefore', 'Furthermore', etc.");
      }
      if (metrics.templatePatternCount > 3) {
        recs.push("Multiple template patterns detected — vary sentence structures");
      }
      if (metrics.repetitiveStructureCount > 2) {
        recs.push("Repetitive paragraph openings — adjust opening patterns");
      }
      if (metrics.typeTokenRatio < 0.6) {
        recs.push("Low vocabulary richness — use synonyms and vary word choice");
      }
      if (metrics.aiExpressionCount > 2) {
        recs.push("AI-typical expressions present — replace with more personalized academic language");
      }
      if (score > 0.5) {
        recs.push("Overall AI score high — systematic revision recommended");
      }
    }

    return recs;
  }

  private extractJson(raw: string): Record<string, unknown> {
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  }
}
