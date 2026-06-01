import { z } from "zod";

export const DegreeLevelSchema = z.enum(["undergraduate", "master", "doctor"]);
export type DegreeLevel = z.infer<typeof DegreeLevelSchema>;

export const CitationFormatSchema = z.enum(["gb7714", "apa", "mla", "chicago"]);
export type CitationFormat = z.infer<typeof CitationFormatSchema>;

export const ReferenceTypeSchema = z.enum([
  "journal",
  "book",
  "conference",
  "thesis",
  "other",
]);
export type ReferenceType = z.infer<typeof ReferenceTypeSchema>;

export const ReferenceSchema = z.object({
  id: z.string().min(1),
  type: ReferenceTypeSchema,
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).default([]),
  year: z.number().int().min(1900).max(2100),
  journal: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().url().optional(),
  rawCitation: z.string().min(1),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const PaperConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  major: z.string().min(1),
  degreeLevel: DegreeLevelSchema,
  proposalText: z.string().default(""),
  references: z.array(ReferenceSchema).default([]),
  targetWordCount: z.number().int().min(1000).default(20000),
  citationFormat: CitationFormatSchema.default("gb7714"),
  language: z.enum(["zh", "en"]).default("zh"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaperConfig = z.infer<typeof PaperConfigSchema>;

export function derivePaperIdFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
