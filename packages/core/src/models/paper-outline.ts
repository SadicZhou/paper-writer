import { z } from "zod";

export const SectionTypeSchema = z.enum([
  "abstract-cn",
  "abstract-en",
  "keywords",
  "introduction",
  "literature-review",
  "methodology",
  "results",
  "discussion",
  "conclusion",
  "acknowledgment",
  "references",
  "appendix",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const SectionStatusSchema = z.enum([
  "planned",
  "writing",
  "drafted",
  "auditing",
  "polishing",
  "approved",
]);
export type SectionStatus = z.infer<typeof SectionStatusSchema>;

export const ArgumentClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  evidence: z.string().default(""),
  supportingRefs: z.array(z.string()).default([]),
  counterArgument: z.string().optional(),
});
export type ArgumentClaim = z.infer<typeof ArgumentClaimSchema>;

export interface SectionNode {
  id: string;
  number: string;
  title: string;
  type: SectionType;
  wordCount: number;
  status: SectionStatus;
  parentId?: string;
  children: SectionNode[];
  argumentPlan: ArgumentClaim[];
  plannedRefs: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SectionNodeSchema: z.ZodType<SectionNode, any, any> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    number: z.string().min(1),
    title: z.string().min(1),
    type: SectionTypeSchema,
    wordCount: z.number().int().min(0),
    status: SectionStatusSchema,
    parentId: z.string().optional(),
    children: z.array(SectionNodeSchema),
    argumentPlan: z.array(ArgumentClaimSchema),
    plannedRefs: z.array(z.string()),
  }),
);

export const PaperOutlineSchema = z.object({
  paperId: z.string().min(1),
  title: z.string().min(1),
  sections: z.array(SectionNodeSchema),
  totalWordCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaperOutline = z.infer<typeof PaperOutlineSchema>;
