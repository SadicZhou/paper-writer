import { z } from "zod";

export const WordAnnotationTypeSchema = z.enum([
  "comment",
  "tracked-change",
  "highlight",
]);
export type WordAnnotationType = z.infer<typeof WordAnnotationTypeSchema>;

export const TrackedChangeTypeSchema = z.enum([
  "insertion",
  "deletion",
  "format-change",
]);

export const WordAnnotationSchema = z.object({
  id: z.string().min(1),
  type: WordAnnotationTypeSchema,
  author: z.string().default(""),
  timestamp: z.string().default(""),
  targetText: z.string(),
  commentText: z.string().default(""),
  changeType: TrackedChangeTypeSchema.optional(),
  resolved: z.boolean().default(false),
});
export type WordAnnotation = z.infer<typeof WordAnnotationSchema>;

export const ImportedSectionSchema = z.object({
  title: z.string().default(""),
  content: z.string(),
  annotations: z.array(WordAnnotationSchema).default([]),
});

export const ImportedDocumentMetadataSchema = z.object({
  author: z.string().default(""),
  createdAt: z.string().default(""),
  revisionCount: z.number().int().min(0).default(0),
});

export const ImportedDocumentSchema = z.object({
  fileName: z.string().min(1),
  sections: z.array(ImportedSectionSchema),
  metadata: ImportedDocumentMetadataSchema.default({
    author: "",
    createdAt: "",
    revisionCount: 0,
  }),
});
export type ImportedDocument = z.infer<typeof ImportedDocumentSchema>;

export const SectionRevisionSchema = z.object({
  sectionNumber: z.string().min(1),
  originalContent: z.string(),
  revisedContent: z.string(),
  appliedAnnotations: z.array(z.string()),
  summary: z.string(),
});
export type SectionRevision = z.infer<typeof SectionRevisionSchema>;
