import { z } from "zod";

export const AIDetectionLogSchema = z.object({
  sectionNumber: z.string().min(1),
  timestamp: z.string().datetime(),
  score: z.number().min(0).max(1),
  provider: z.enum(["llm-self", "gptzero", "originality", "custom"]),
  flaggedPassages: z
    .array(
      z.object({
        text: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  action: z.enum(["detect", "rewrite"]),
  attempt: z.number().int().min(1).default(1),
});
export type AIDetectionLog = z.infer<typeof AIDetectionLogSchema>;

export const InnovationPointSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  novelty: z.enum(["high", "medium", "low"]),
  supportingRefs: z.array(z.string()).default([]),
  elaboratedInSection: z.array(z.string()).default([]),
});
export type InnovationPoint = z.infer<typeof InnovationPointSchema>;

export const CitationMapEntrySchema = z.object({
  citedInSections: z.array(z.string()),
  context: z.string().default(""),
});

export const CitationMapSchema = z.record(z.string(), CitationMapEntrySchema);
export type CitationMap = z.infer<typeof CitationMapSchema>;

export const DetectedPassageSchema = z.object({
  text: z.string(),
  reason: z.string(),
});

export const PaperSectionStateSchema = z.object({
  sectionNumber: z.string().min(1),
  title: z.string().min(1),
  content: z.string().default(""),
  wordCount: z.number().int().min(0).default(0),
  status: z
    .enum(["planned", "writing", "drafted", "auditing", "polishing", "approved"])
    .default("planned"),
  aiDetectionScore: z.number().min(0).max(1).optional(),
  aiDetectionLog: z.array(AIDetectionLogSchema).default([]),
  citations: z.array(z.string()).default([]),
  lastModified: z.string().datetime(),
});
export type PaperSectionState = z.infer<typeof PaperSectionStateSchema>;

export const PipelineStageSchema = z.enum([
  "idle",
  "brainstorm",
  "literature-search",
  "outline",
  "writing",
  "polish",
  "format-export",
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const PipelineStatusSchema = z.enum(["idle", "running", "completed", "error"]);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const PipelineEventEntrySchema = z.object({
  timestamp: z.string().datetime(),
  type: z.string().min(1),
  stage: PipelineStageSchema.optional(),
  message: z.string().default(""),
});
export type PipelineEventEntry = z.infer<typeof PipelineEventEntrySchema>;

export const PipelineStateSchema = z.object({
  paperId: z.string().min(1),
  currentStage: PipelineStageSchema,
  status: PipelineStatusSchema.default("idle"),
  completedStages: z.array(PipelineStageSchema).default([]),
  currentSectionNumber: z.string().optional(),
  totalSections: z.number().int().min(0).default(0),
  completedSections: z.number().int().min(0).default(0),
  startedAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
  error: z.string().optional(),
  events: z.array(PipelineEventEntrySchema).default([]),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const PaperProjectSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  major: z.string().min(1),
  degreeLevel: z.enum(["undergraduate", "master", "doctor"]),
  totalSections: z.number().int().min(0).default(0),
  completedSections: z.number().int().min(0).default(0),
  totalWords: z.number().int().min(0).default(0),
  aiDetectionScore: z.number().min(0).max(1).optional(),
  pipelineStage: PipelineStageSchema.default("idle"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaperProjectSummary = z.infer<typeof PaperProjectSummarySchema>;
