/**
 * 论文选题头脑风暴 Agent
 * 基于专业方向、学位层次与开题报告，通过 LLM 两阶段对话（发散→收敛）生成候选选题；
 * 也支持在标题已定时单独挖掘创新点。
 * @author zjh
 */
import { BaseAgent } from "./base.js";
import type { InnovationPoint } from "../models/paper-state.js";
import { InnovationPointSchema } from "../models/paper-state.js";
import { z } from "zod";

/** 选题头脑风暴的输入参数 */
export interface BrainstormInput {
  /** 专业方向，如「计算机科学」 */
  readonly major: string;
  /** 学位层次：本科 / 硕士 / 博士 */
  readonly degreeLevel: "undergraduate" | "master" | "doctor";
  /** 开题报告或研究素材全文 */
  readonly proposalText: string;
  /** 输出语言：中文或英文 */
  readonly language: "zh" | "en";
}

/** 选题头脑风暴的结构化输出 */
export interface BrainstormOutput {
  /** 3–5 个候选选题，每个含创新点、可行性分析与文献方向 */
  readonly topics: ReadonlyArray<{
    readonly title: string;
    readonly innovationPoints: InnovationPoint[];
    readonly feasibility: string;
    readonly referenceDirections: string[];
  }>;
  /** 推荐采用的选题标题（须与 topics 中某一项 title 一致） */
  readonly recommendedTopic: string;
  /** 推荐理由说明 */
  readonly reasoning: string;
}

/** LLM 收敛阶段返回 JSON 的 Zod 校验 schema */
const TopicsResponseSchema = z.object({  topics: z.array(z.object({
    title: z.string().min(1),
    innovationPoints: z.array(InnovationPointSchema),
    feasibility: z.string(),
    referenceDirections: z.array(z.string()),
  })),
  recommendedTopic: z.string(),
  reasoning: z.string(),
});

/** 固定标题下挖掘创新点的输入参数（不进行选题头脑风暴） */
export interface ExtractInnovationsInput {
  /** 已确定的论文标题 */
  readonly topic: string;
  readonly major: string;
  readonly degreeLevel: "undergraduate" | "master" | "doctor";
  readonly proposalText: string;
  readonly language: "zh" | "en";
}

/** 创新点提取结果 JSON 的 Zod 校验 schema */
const InnovationsExtractionSchema = z.object({
  innovationPoints: z.array(InnovationPointSchema),
});

/**
 * 论文选题与创新点挖掘 Agent
 * 继承 BaseAgent，通过 chat() 调用 LLM；支持中英文双语 prompt。
 */
export class TopicBrainstormer extends BaseAgent {
  /** Agent 标识名，用于日志与 pipeline 路由 */
  get name(): string {
    return "topic-brainstormer";
  }

  /**
   * 在论文标题已确定时，仅从开题报告中挖掘创新点（跳过选题头脑风暴）。
   * 单次 LLM 调用，temperature=0.4；解析失败时返回空数组而非抛错。
   * @param input 标题、专业、学位、开题报告与语言
   * @returns 创新点列表，每项含 id、description、novelty
   */
  async extractInnovationsForTopic(input: ExtractInnovationsInput): Promise<InnovationPoint[]> {    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? `你是一位资深学术导师，专攻学术论文创新点挖掘。

## 你的任务
论文标题已确定，你只需要基于用户的开题报告/研究素材，挖掘该标题下的创新点。

## 创新点挖掘维度
1. **方法创新**: 是否采用了新方法/新模型？
2. **视角创新**: 是否从新角度/新理论审视问题？
3. **应用创新**: 是否将已有理论应用于新领域？
4. **数据创新**: 是否利用了新数据源？
5. **交叉创新**: 是否跨学科融合？

## 输出要求
输出严格 JSON，包含 innovationPoints 数组。每个创新点必须有 id、description（中文）、novelty（high/medium/low）。
不要生成新的选题标题——标题已固定。`
      : `You are a senior academic advisor specializing in innovation point mining.

## Your Task
The paper title is already fixed. Extract innovation points from the proposal/research material for this title.

## Innovation Dimensions
1. **Methodological**: New methods/models?
2. **Perspective**: New angles/theories?
3. **Applied**: Existing theory in new domains?
4. **Data-driven**: Novel datasets?
5. **Interdisciplinary**: Cross-field fusion?

## Output
Strict JSON with innovationPoints array. Each point MUST have id, description, novelty (high/medium/low).
Do NOT generate new topic titles — the title is fixed.`;

    const userMessage = isZh
      ? `## 论文标题\n${input.topic}\n\n## 专业方向\n${input.major}\n\n## 学位层次\n${input.degreeLevel === "undergraduate" ? "本科" : input.degreeLevel === "master" ? "硕士" : "博士"}\n\n## 开题报告\n${input.proposalText || "（未提供）"}\n\n请基于以上信息，深入挖掘该论文标题下的创新点。输出严格 JSON：\n\`\`\`json\n{ "innovationPoints": [ { "id": "ip1", "description": "创新点描述", "novelty": "high" } ] }\n\`\`\``
      : `## Paper Title\n${input.topic}\n\n## Major\n${input.major}\n\n## Degree Level\n${{ undergraduate: "Undergraduate", master: "Master's", doctor: "Doctoral" }[input.degreeLevel]}\n\n## Proposal\n${input.proposalText || "(Not provided)"}\n\nExtract innovation points for the fixed title above. Output strict JSON:\n\`\`\`json\n{ "innovationPoints": [ { "id": "ip1", "description": "Innovation point description", "novelty": "high" } ] }\n\`\`\``;

    const resp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.4 });

    try {
      const json = this.extractJson(resp.content);
      const parsed = InnovationsExtractionSchema.parse(json);
      return parsed.innovationPoints;
    } catch (e) {
      if (e instanceof z.ZodError) {
        this.ctx.logger?.error(`[${this.name}] Innovation extraction parse failed: ${e.message}`);
      }
      return [];
    }
  }

  /**
   * 两阶段选题头脑风暴：先发散生成大量想法，再收敛精选 3–5 个可行选题。
   * Phase 1（temperature=0.8）发散；Phase 2（temperature=0.4）收敛并输出严格 JSON。
   * @param input 专业、学位、开题报告与语言
   * @returns 候选选题、推荐选题及推荐理由
   * @throws 收敛阶段 JSON 不符合 schema 时抛出带字段详情的错误
   */
  async brainstorm(input: BrainstormInput): Promise<BrainstormOutput> {    const isZh = input.language === "zh";

    const systemPrompt = isZh
      ? this.chineseSystemPrompt()
      : this.englishSystemPrompt();

    const userMessage = isZh
      ? this.chineseUserMessage(input)
      : this.englishUserMessage(input);

    const jsonFormatHint = isZh
      ? this.chineseJsonFormatHint()
      : this.englishJsonFormatHint();

    // Phase 1: Diverge — generate many ideas
    const divergeResp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ], { temperature: 0.8 });

    // Phase 2: Converge — refine and select best, with exact JSON schema
    const convergeResp = await this.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
      { role: "assistant", content: divergeResp.content },
      { role: "user", content: isZh
        ? `请基于上述头脑风暴结果，精选出 3-5 个最可行的选题。每个选题必须包含：创新点、可行性分析、参考文献方向。\n\n${jsonFormatHint}`
        : `Based on the brainstorming above, select 3-5 most feasible topics. Each topic MUST include: innovation points, feasibility analysis, and reference directions.\n\n${jsonFormatHint}`
      },
    ], { temperature: 0.4 });

    return this.parseOutput(convergeResp.content, isZh);
  }

  /**
   * 从 LLM 原始文本中提取 JSON 并用 TopicsResponseSchema 校验。
   * 校验失败时记录日志并抛出可读错误信息。
   */
  private parseOutput(raw: string, isZh: boolean): BrainstormOutput {    const json = this.extractJson(raw);
    try {
      return TopicsResponseSchema.parse(json);
    } catch (e) {
      if (e instanceof z.ZodError) {
        const missingFields = e.issues.map((i) =>
          `${i.path.join(".")}: ${i.message}`
        ).join("; ");
        const msg = isZh
          ? `[${this.name}] JSON 解析失败，缺少字段: ${missingFields}`
          : `[${this.name}] JSON parse failed, missing fields: ${missingFields}`;
        this.ctx.logger?.error(msg);
        throw new Error(msg);
      }
      throw e;
    }
  }

  /** 剥离 markdown 代码块标记后解析 JSON */
  private extractJson(raw: string): unknown {    const cleaned = raw
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    return JSON.parse(cleaned);
  }

  /** 中文收敛阶段的 JSON 输出格式说明（嵌入 user prompt） */
  private chineseJsonFormatHint(): string {    return `## 必须严格遵守的 JSON 格式（不要省略任何字段）
\`\`\`json
{
  "topics": [
    {
      "title": "选题标题",
      "innovationPoints": [
        {
          "id": "ip1",
          "description": "创新点描述",
          "novelty": "high"
        }
      ],
      "feasibility": "可行性分析（技术可行性、数据可得性、时间可行性等）",
      "referenceDirections": ["可参考文献方向1", "可参考文献方向2"]
    }
  ],
  "recommendedTopic": "推荐的选题标题（必须是 topics 中某一个的 title）",
  "reasoning": "推荐理由"
}
\`\`\`

注意：
- innovationPoints 数组不能为空，每个创新点必须包含 id、description、novelty（值为 high/medium/low）
- feasibility 必须是字符串，不能省略
- referenceDirections 必须是字符串数组，至少提供 1-2 个方向`;
  }

  /** 英文收敛阶段的 JSON 输出格式说明 */
  private englishJsonFormatHint(): string {    return `## REQUIRED JSON format (do not omit any fields)
\`\`\`json
{
  "topics": [
    {
      "title": "Topic title",
      "innovationPoints": [
        {
          "id": "ip1",
          "description": "Innovation point description",
          "novelty": "high"
        }
      ],
      "feasibility": "Feasibility analysis (technical, data availability, timeline, etc.)",
      "referenceDirections": ["Reference direction 1", "Reference direction 2"]
    }
  ],
  "recommendedTopic": "Recommended topic title (must match one of the topics' title)",
  "reasoning": "Reasoning for the recommendation"
}
\`\`\`

Important:
- innovationPoints array must NOT be empty; each point MUST have id, description, novelty (high/medium/low)
- feasibility MUST be a non-empty string
- referenceDirections MUST be an array of strings, at least 1-2 items`;
  }

  /** 中文系统 prompt：角色设定、五维创新挖掘框架与输出要求 */
  private chineseSystemPrompt(): string {    return `你是一位资深学术导师，专攻学术论文选题与创新点挖掘。

## 你的任务
基于学生的专业方向、开题报告和学位层次，进行头脑风暴，挖掘有价值的论文选题和创新点。

## 创新点挖掘维度
1. **方法创新**: 是否可以采用新方法/新模型解决老问题？
2. **视角创新**: 是否可以从新角度/新理论审视已有问题？
3. **应用创新**: 是否可以将已有理论应用于新领域/新场景？
4. **数据创新**: 是否可以利用新数据源/新数据集？
5. **交叉创新**: 是否可以跨学科融合产生新思路？

## 输出要求
最终输出必须是严格的 JSON 格式，包含 topics 数组、recommendedTopic 和 reasoning。
每个 topic 必须包含 title、innovationPoints（数组，每个元素含 id/description/novelty）、feasibility（字符串）、referenceDirections（字符串数组）。`;
  }

  /** 组装中文用户消息：专业、学位、开题报告 */
  private chineseUserMessage(input: BrainstormInput): string {    return `## 专业方向
${input.major}

## 学位层次
${input.degreeLevel === "undergraduate" ? "本科" : input.degreeLevel === "master" ? "硕士" : "博士"}

## 开题报告
${input.proposalText || "（未提供）"}

请基于以上信息进行选题头脑风暴。`;
  }

  /** 英文系统 prompt，结构与中文版对应 */
  private englishSystemPrompt(): string {    return `You are a senior academic advisor specializing in thesis topic selection and innovation point mining.

## Your Task
Based on the student's major, proposal, and degree level, brainstorm valuable paper topics and innovation points.

## Innovation Dimensions
1. **Methodological**: New methods/models for old problems
2. **Perspective**: New angles/theories for existing issues
3. **Applied**: Existing theories applied to new domains
4. **Data-driven**: Novel datasets or data sources
5. **Interdisciplinary**: Cross-field fusion

## Output
Strict JSON format with topics array, recommendedTopic, and reasoning.
Each topic MUST include title, innovationPoints (array with id/description/novelty per item), feasibility (string), referenceDirections (string array).`;
  }

  /** 组装英文用户消息 */
  private englishUserMessage(input: BrainstormInput): string {    const degreeLabels: Record<string, string> = {
      undergraduate: "Undergraduate",
      master: "Master's",
      doctor: "Doctoral",
    };
    return `## Major
${input.major}

## Degree Level
${degreeLabels[input.degreeLevel]}

## Proposal
${input.proposalText || "(Not provided)"}

Please brainstorm paper topics based on the above.`;
  }
}
