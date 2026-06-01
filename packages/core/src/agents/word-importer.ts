import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { Reference } from "../models/paper.js";

export interface WordAnnotation {
  readonly id: string;
  readonly type: "comment" | "tracked-change" | "highlight";
  readonly author: string;
  readonly timestamp: string;
  readonly targetText: string;
  readonly commentText: string;
  readonly changeType?: "insertion" | "deletion" | "format-change";
  readonly resolved: boolean;
}

export interface ImportedSection {
  readonly title: string;
  readonly content: string;
  readonly annotations: WordAnnotation[];
}

export interface ImportedDocument {
  readonly fileName: string;
  readonly sections: ImportedSection[];
  readonly metadata: {
    readonly author: string;
    readonly createdAt: string;
    readonly revisionCount: number;
  };
}

export interface ImportInput {
  readonly filePath: string;
  readonly language: "zh" | "en";
}

export interface ImportOutput {
  readonly document: ImportedDocument;
  readonly extractedReferences: Reference[];
  readonly summary: string;
}

/**
 * Parses .docx files to extract text, comments, and tracked changes.
 * .docx is a ZIP archive containing XML files per the Open XML standard.
 * No LLM calls — pure XML + ZIP parsing.
 */
export class WordImporter {
  private xmlParser: XMLParser;

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      isArray: (name) =>
        ["w:p", "w:r", "w:t", "w:comment", "w:ins", "w:del", "w:rPr"].includes(name),
    });
  }

  async importDocument(input: ImportInput): Promise<ImportOutput> {
    const zip = new AdmZip(input.filePath);
    const entries = zip.getEntries();

    const documentXml = entries.find(
      (e: AdmZip.IZipEntry) => e.entryName === "word/document.xml",
    );
    const commentsXml = entries.find(
      (e: AdmZip.IZipEntry) => e.entryName === "word/comments.xml",
    );

    if (!documentXml) {
      throw new Error("Invalid .docx: word/document.xml not found");
    }

    const documentData = this.xmlParser.parse(documentXml.getData().toString("utf-8"));
    const commentsData = commentsXml
      ? this.xmlParser.parse(commentsXml.getData().toString("utf-8"))
      : null;

    const comments = this.extractComments(commentsData);
    const textContent = this.extractText(documentData);
    const annotations = this.extractAnnotations(documentData, comments);
    const sections = this.splitIntoSections(textContent, annotations);

    const metadata = {
      author: this.extractMetaAuthor(documentData),
      createdAt: new Date().toISOString(),
      revisionCount: annotations.filter((a) => a.type === "tracked-change").length,
    };

    return {
      document: {
        fileName: input.filePath.split("/").pop()?.split("\\").pop() ?? "document.docx",
        sections,
        metadata,
      },
      extractedReferences: [],
      summary: input.language === "zh"
        ? `导入完成: ${sections.length} 个章节, ${annotations.length} 个批注/修订`
        : `Import complete: ${sections.length} sections, ${annotations.length} annotations/revisions`,
    };
  }

  private extractText(documentData: unknown): string {
    const body = this.getPath(documentData, ["w:document", "w:body"]);
    if (!body) return "";

    const paragraphs: string[] = [];
    const paraList = (body as Record<string, unknown>)["w:p"] as Array<Record<string, unknown>> | undefined;

    if (!paraList) return "";

    for (const para of paraList) {
      const runs = para["w:r"] as Array<Record<string, unknown>> | undefined;
      if (!runs) {
        paragraphs.push("");
        continue;
      }

      const paraText = runs
        .map((run) => {
          const textEls = run["w:t"] as Array<Record<string, unknown>> | undefined;
          if (!textEls) return "";
          return textEls
            .map((t) => (t["#text"] as string) ?? "")
            .join("");
        })
        .join("");

      paragraphs.push(paraText);
    }

    return paragraphs.join("\n");
  }

  private extractComments(commentsData: unknown): Map<string, WordAnnotation> {
    const result = new Map<string, WordAnnotation>();
    if (!commentsData) return result;

    const commentList = this.getPath(commentsData, ["w:comments", "w:comment"]);
    if (!commentList) return result;

    const comments = Array.isArray(commentList)
      ? commentList
      : [commentList];

    for (const c of comments) {
      const comment = c as Record<string, unknown>;
      const id = String(comment["@_w:id"] ?? "");
      if (!id) continue;

      const textParts: string[] = [];
      const paraList = comment["w:p"] as Array<Record<string, unknown>> | undefined;
      if (paraList) {
        for (const p of paraList) {
          const runs = p["w:r"] as Array<Record<string, unknown>> | undefined;
          if (runs) {
            for (const r of runs) {
              const textEls = r["w:t"] as Array<Record<string, unknown>> | undefined;
              if (textEls) {
                for (const t of textEls) {
                  if (t["#text"]) textParts.push(String(t["#text"]));
                }
              }
            }
          }
        }
      }

      result.set(id, {
        id,
        type: "comment",
        author: String(comment["@_w:author"] ?? "Unknown"),
        timestamp: String(comment["@_w:date"] ?? ""),
        targetText: "",
        commentText: textParts.join(""),
        resolved: false,
      });
    }

    return result;
  }

  private extractAnnotations(
    documentData: unknown,
    comments: Map<string, WordAnnotation>,
  ): WordAnnotation[] {
    const annotations: WordAnnotation[] = [];
    const body = this.getPath(documentData, ["w:document", "w:body"]);
    if (!body) return annotations;

    const paraList = (body as Record<string, unknown>)["w:p"] as Array<Record<string, unknown>> | undefined;
    if (!paraList) return annotations;

    let annotationIdx = 0;

    for (const para of paraList) {
      const runs = para["w:r"] as Array<Record<string, unknown>> | undefined;
      if (!runs) continue;

      for (const run of runs) {
        // Tracked changes: insertions
        const insList = run["w:ins"] as Array<Record<string, unknown>> | undefined;
        if (insList) {
          for (const ins of insList) {
            const text = this.extractTextFromElement(ins);
            if (text.trim()) {
              annotations.push({
                id: `tc-${annotationIdx++}`,
                type: "tracked-change",
                author: String((ins as Record<string, unknown>)["@_w:author"] ?? "Unknown"),
                timestamp: String((ins as Record<string, unknown>)["@_w:date"] ?? ""),
                targetText: text.trim(),
                commentText: text.trim(),
                changeType: "insertion",
                resolved: false,
              });
            }
          }
        }

        // Tracked changes: deletions
        const delList = run["w:del"] as Array<Record<string, unknown>> | undefined;
        if (delList) {
          for (const del of delList) {
            const text = this.extractTextFromElement(del);
            if (text.trim()) {
              annotations.push({
                id: `tc-${annotationIdx++}`,
                type: "tracked-change",
                author: String((del as Record<string, unknown>)["@_w:author"] ?? "Unknown"),
                timestamp: String((del as Record<string, unknown>)["@_w:date"] ?? ""),
                targetText: text.trim(),
                commentText: `[删除] ${text.trim()}`,
                changeType: "deletion",
                resolved: false,
              });
            }
          }
        }

        // Comment references
        const commentRef = run["w:commentReference"] as Record<string, unknown> | undefined;
        if (commentRef) {
          const commentId = String(commentRef["@_w:id"] ?? "");
          const comment = comments.get(commentId);
          if (comment) {
            // Find surrounding text
            const textEls = run["w:t"] as Array<Record<string, unknown>> | undefined;
            const contextText = textEls
              ? textEls.map((t) => String(t["#text"] ?? "")).join("")
              : "";
            annotations.push({
              ...comment,
              targetText: contextText,
            });
          }
        }
      }
    }

    return annotations;
  }

  private extractTextFromElement(el: unknown): string {
    const element = el as Record<string, unknown>;
    const runs = element["w:r"] as Array<Record<string, unknown>> | undefined;
    if (!runs) return "";

    return runs
      .map((run) => {
        const textEls = run["w:t"] as Array<Record<string, unknown>> | undefined;
        if (!textEls) return "";
        return textEls.map((t) => String(t["#text"] ?? "")).join("");
      })
      .join("");
  }

  private splitIntoSections(
    text: string,
    annotations: WordAnnotation[],
  ): ImportedSection[] {
    // Split text by heading-like patterns
    const headingRegex = /^(?:第[一二三四五六七八九十\d]+章|第[一二三四五六七八九十\d]+节|\d+[\.\s]+|[A-Z][A-Za-z\s]+$|引言|绪论|摘要|前言|结论|致谢|参考文献|附录)/m;
    const lines = text.split("\n");
    const sections: ImportedSection[] = [];
    let currentTitle = "正文";
    let currentLines: string[] = [];
    let sectionAnnotations: WordAnnotation[] = [];

    for (const line of lines) {
      if (headingRegex.test(line.trim()) && currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentLines.join("\n").trim(),
          annotations: [...sectionAnnotations],
        });
        currentTitle = line.trim();
        currentLines = [];
        sectionAnnotations = [];
      } else if (headingRegex.test(line.trim())) {
        currentTitle = line.trim();
      } else {
        currentLines.push(line);
        // Map annotations that might belong to this line
        for (const ann of annotations) {
          if (line.includes(ann.targetText) && !sectionAnnotations.includes(ann)) {
            sectionAnnotations.push(ann);
          }
        }
      }
    }

    // Don't forget the last section
    if (currentLines.length > 0 || currentTitle !== "正文") {
      sections.push({
        title: currentTitle,
        content: currentLines.join("\n").trim(),
        annotations: [...sectionAnnotations],
      });
    }

    // If no sections found, return whole text as one section
    if (sections.length === 0 && text.trim()) {
      sections.push({
        title: "正文",
        content: text.trim(),
        annotations: [...annotations],
      });
    }

    return sections;
  }

  private extractMetaAuthor(documentData: unknown): string {
    const coreProps = documentData as Record<string, unknown>;
    // Try to find author from document properties
    const creator = this.getPath(coreProps, ["w:document", "@_w:creator"]);
    return String(creator ?? "Unknown");
  }

  private getPath(obj: unknown, path: string[]): unknown {
    let current: unknown = obj;
    for (const key of path) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
}
