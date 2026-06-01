import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  TableOfContents,
  PageBreak,
  AlignmentType,
  TabStopPosition,
  TabStopType,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  Table,
  Bookmark,
  InternalHyperlink,
  type ISectionOptions,
} from "docx";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaperSectionState } from "../models/paper-state.js";
import { CitationFormatter } from "../agents/citation-formatter.js";
import type { CitationFormat, FormatReferencesOutput } from "../agents/citation-formatter.js";
import type { Reference } from "../models/paper.js";
import type { SectionNode } from "../models/paper-outline.js";
import { MarkdownToDocx, type MarkdownToDocxOptions } from "./markdown-to-docx.js";

export interface ExportInput {
  readonly paperId: string;
  readonly title: string;
  readonly author?: string;
  readonly major?: string;
  readonly advisor?: string;
  readonly date?: string;
  readonly language: "zh" | "en";
  readonly citationFormat: CitationFormat;
  readonly abstractZh?: string;
  readonly abstractEn?: string;
  readonly keywordsZh?: string[];
  readonly keywordsEn?: string[];
  readonly sections: PaperSectionState[];
  readonly outline: SectionNode[];
  readonly references: Reference[];
  readonly acknowledgment?: string;
  readonly appendix?: string;
  readonly outputDir: string;
}

export interface ExportOutput {
  readonly filePath: string;
  readonly fileName: string;
  readonly totalPages: number;
}

export class WordExporter {
  private citationFormatter = new CitationFormatter();
  private markdownConverter = new MarkdownToDocx();

  async export(input: ExportInput): Promise<ExportOutput> {
    const citationResult = this.citationFormatter.format({
      references: input.references,
      format: input.citationFormat,
      language: input.language,
    });

    const children = await this.buildDocument(input, citationResult);

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: input.language === "zh" ? "宋体" : "Times New Roman",
              size: 24, // 12pt
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch
                bottom: 1440,
                left: 1800, // 1.25 inch
                right: 1800,
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: input.title,
                      font: input.language === "zh" ? "宋体" : "Times New Roman",
                      size: 18, // 9pt
                      italics: true,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      font: input.language === "zh" ? "宋体" : "Times New Roman",
                      size: 18,
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const safeTitle = input.title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 40);
    const fileName = `${safeTitle}.docx`;
    const filePath = join(input.outputDir, fileName);

    await writeFile(filePath, buffer);

    return {
      filePath,
      fileName,
      totalPages: Math.ceil(children.length / 3), // rough estimate
    };
  }

  private async buildDocument(
    input: ExportInput,
    citationResult: FormatReferencesOutput,
  ): Promise<(Paragraph | Table | TableOfContents)[]> {
    const children: (Paragraph | Table | TableOfContents)[] = [];

    // Cover page
    this.addCoverPage(children, input);
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // Chinese Abstract
    if (input.abstractZh) {
      this.addAbstract(children, input.abstractZh, input.keywordsZh ?? [], true);
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // English Abstract
    if (input.abstractEn) {
      this.addAbstract(children, input.abstractEn, input.keywordsEn ?? [], false);
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Table of Contents
    this.addTableOfContents(children, input.language);
    children.push(new Paragraph({ children: [new PageBreak()] }));

    // Body sections
    await this.addBodySections(children, input);

    // References
    children.push(new Paragraph({ children: [new PageBreak()] }));
    this.addReferences(children, citationResult, input.language);

    // Acknowledgment
    if (input.acknowledgment) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      await this.addAcknowledgment(children, input.acknowledgment, input.language);
    }

    // Appendix
    if (input.appendix) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      await this.addAppendix(children, input.appendix, input.language);
    }

    return children;
  }

  private addCoverPage(
    children: (Paragraph | Table | TableOfContents)[],
    input: ExportInput,
  ): void {
    const isZh = input.language === "zh";

    for (let i = 0; i < 8; i++) {
      children.push(new Paragraph({ spacing: { after: 400 } }));
    }

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.TITLE,
        spacing: { after: 600 },
        children: [
          new TextRun({
            text: input.title,
            font: isZh ? "黑体" : "Times New Roman",
            size: 44, // 22pt
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    children.push(new Paragraph({ spacing: { after: 400 } }));

    const infoLines: string[] = [];
    if (input.author) {
      infoLines.push(isZh ? `作者: ${input.author}` : `Author: ${input.author}`);
    }
    if (input.major) {
      infoLines.push(isZh ? `专业: ${input.major}` : `Major: ${input.major}`);
    }
    if (input.advisor) {
      infoLines.push(isZh ? `导师: ${input.advisor}` : `Advisor: ${input.advisor}`);
    }
    infoLines.push(
      isZh ? `日期: ${input.date ?? new Date().toLocaleDateString("zh-CN")}` : `Date: ${input.date ?? new Date().toISOString().slice(0, 10)}`,
    );

    for (const line of infoLines) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: line,
              font: isZh ? "宋体" : "Times New Roman",
              size: 28, // 14pt
            }),
          ],
        }),
      );
    }
  }

  private addAbstract(
    children: (Paragraph | Table | TableOfContents)[],
    abstract: string,
    keywords: string[],
    isZh: boolean,
  ): void {
    const title = isZh ? "摘  要" : "Abstract";

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: title,
            font: isZh ? "黑体" : "Times New Roman",
            size: 32, // 16pt
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    // Abstract body
    children.push(
      new Paragraph({
        spacing: { after: 200, line: 360 },
        children: [
          new TextRun({
            text: abstract,
            font: isZh ? "宋体" : "Times New Roman",
            size: 24, // 12pt
          }),
        ],
      }),
    );

    // Keywords
    const kwLabel = isZh ? "关键词: " : "Keywords: ";
    children.push(
      new Paragraph({
        spacing: { before: 200 },
        children: [
          new TextRun({
            text: kwLabel + keywords.join("; "),
            font: isZh ? "宋体" : "Times New Roman",
            size: 24,
            bold: isZh ? false : true,
          }),
        ],
      }),
    );
  }

  private addTableOfContents(
    children: (Paragraph | Table | TableOfContents)[],
    language: "zh" | "en",
  ): void {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: language === "zh" ? "目  录" : "Table of Contents",
            font: language === "zh" ? "黑体" : "Times New Roman",
            size: 32,
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    children.push(
      new TableOfContents("Table of Contents", {
        hyperlink: true,
        headingStyleRange: "1-3",
      }),
    );
  }

  private async addBodySections(
    children: (Paragraph | Table | TableOfContents)[],
    input: ExportInput,
  ): Promise<void> {
    const isZh = input.language === "zh";
    const bodyFont = isZh ? "宋体" : "Times New Roman";
    const headingFont = isZh ? "黑体" : "Times New Roman";

    // Export all sections. Parent sections (e.g. "3") may contain chapter
    // overviews with figures/tables that must not be lost.
    const sectionsToExport = [...input.sections].sort((a, b) => {
      const aParts = a.sectionNumber.split(".").map(Number);
      const bParts = b.sectionNumber.split(".").map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] ?? 0;
        const bVal = bParts[i] ?? 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });

    // Normalize heading depth: shift so the shallowest leaf depth becomes level 1
    const minDepth = sectionsToExport.reduce(
      (min, s) => Math.min(min, s.sectionNumber.split(".").length),
      Infinity,
    );

    const mdOptions: MarkdownToDocxOptions = {
      font: bodyFont,
      size: 24,
      lineSpacing: 360,
      firstLineIndent: 480,
      headingFont,
      headingColor: "000000",
      skipFirstHeading: true,
    };

    for (const section of sectionsToExport) {
      const depth = section.sectionNumber.split(".").length - (minDepth - 1);
      const headingLevel =
        depth <= 1
          ? HeadingLevel.HEADING_1
          : depth === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      const headingSize = headingLevel === HeadingLevel.HEADING_1 ? 32 : headingLevel === HeadingLevel.HEADING_2 ? 28 : 24;

      children.push(
        new Paragraph({
          heading: headingLevel,
          spacing: { before: 300, after: 200 },
          children: [
            new TextRun({
              text: `${section.sectionNumber} ${section.title}`,
              font: headingFont,
              size: headingSize,
              bold: true,
              color: "000000",
            }),
          ],
        }),
      );

      if (section.content.trim()) {
        const blocks = await this.markdownConverter.convertAsync(section.content, mdOptions);
        children.push(...blocks);
      }
    }
  }

  private addReferences(
    children: (Paragraph | Table | TableOfContents)[],
    citationResult: FormatReferencesOutput,
    language: "zh" | "en",
  ): void {
    const isZh = language === "zh";

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: isZh ? "参考文献" : "References",
            font: isZh ? "黑体" : "Times New Roman",
            size: 32,
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    for (let i = 0; i < citationResult.formattedReferences.length; i++) {
      const refText = citationResult.formattedReferences[i]!;
      const refNumMatch = refText.match(/^\[(\d+)\]/);
      const refNum = refNumMatch ? refNumMatch[1] : String(i + 1);

      children.push(
        new Paragraph({
          spacing: { after: 80, line: 300 },
          indent: { left: 480, hanging: 480 },
          children: [
            new Bookmark({
              id: `ref-${refNum}`,
              children: [
                new TextRun({
                  text: refText,
                  font: isZh ? "宋体" : "Times New Roman",
                  size: 21, // 10.5pt
                }),
              ],
            }),
          ],
        }),
      );
    }
  }

  private async addAcknowledgment(
    children: (Paragraph | Table | TableOfContents)[],
    content: string,
    language: "zh" | "en",
  ): Promise<void> {
    const isZh = language === "zh";

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: isZh ? "致  谢" : "Acknowledgments",
            font: isZh ? "黑体" : "Times New Roman",
            size: 32,
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    if (content.trim()) {
      const mdOptions: MarkdownToDocxOptions = {
        font: isZh ? "宋体" : "Times New Roman",
        size: 24,
        lineSpacing: 360,
        firstLineIndent: 480,
        headingFont: isZh ? "黑体" : "Times New Roman",
        headingColor: "000000",
        skipFirstHeading: false,
      };
      const blocks = await this.markdownConverter.convertAsync(content, mdOptions);
      children.push(...blocks);
    }
  }

  private async addAppendix(
    children: (Paragraph | Table | TableOfContents)[],
    content: string,
    language: "zh" | "en",
  ): Promise<void> {
    const isZh = language === "zh";

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: isZh ? "附  录" : "Appendix",
            font: isZh ? "黑体" : "Times New Roman",
            size: 32,
            bold: true,
            color: "000000",
          }),
        ],
      }),
    );

    if (content.trim()) {
      const mdOptions: MarkdownToDocxOptions = {
        font: isZh ? "宋体" : "Times New Roman",
        size: 24,
        lineSpacing: 360,
        firstLineIndent: 480,
        headingFont: isZh ? "黑体" : "Times New Roman",
        headingColor: "000000",
        skipFirstHeading: false,
      };
      const blocks = await this.markdownConverter.convertAsync(content, mdOptions);
      children.push(...blocks);
    }
  }
}
