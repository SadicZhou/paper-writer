import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  TableBorders,
  BorderStyle,
  ShadingType,
  WidthType,
  InternalHyperlink,
  HeightRule,
  ImageRun,
} from "docx";
import { MermaidRenderer, type MermaidRenderResult } from "./mermaid-renderer.js";

export interface MarkdownToDocxOptions {
  readonly font: string;
  readonly size: number;
  readonly lineSpacing: number;
  readonly firstLineIndent: number;
  readonly headingFont: string;
  readonly headingColor: string;
  readonly skipFirstHeading?: boolean;
}

interface CodePlaceholder {
  type: "code";
  language: string;
  code: string;
}

interface DisplayMathPlaceholder {
  type: "display-math";
  formula: string;
}

type Placeholder = CodePlaceholder | DisplayMathPlaceholder;

interface TableBlock {
  type: "table";
  header: string[];
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
}

interface HeadingBlock {
  type: "heading";
  level: 2 | 3 | 4;
  text: string;
}

interface ParagraphBlock {
  type: "paragraph";
  lines: string[];
}

type Block = HeadingBlock | TableBlock | ParagraphBlock | Placeholder;

// Regex patterns
const HEADING_RE = /^(#{2,4})\s+(.+)$/;
const TABLE_LINE_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|([-: ]+\|)+\s*$/;
const INLINE_MATH_RE = /\\\(([\s\S]*?)\\\)|\$([^$\n]+?)\$/;
const BOLD_RE = /\*\*(.+?)\*\*/;
const ITALIC_RE = /\*(.+?)\*/;
const CITATION_RE = /^\[(\d+(?:[,，\-]\d+)*)\]$/;
// Match both half-width [N] and full-width 【N】 citation formats
const CITATION_GLOBAL_RE = /[\[【](\d+(?:[,，\-]\d+)*)[\]】]/g;
// Figure/table placeholder: 【图X-XX 标题】 or 【表X-XX 标题】, optionally bold-wrapped
const FIGURE_PLACEHOLDER_RE = /^\*{0,2}【([图表])\s*(\d+(?:[.-]\d+)*)\s*(.*)】\*{0,2}$/;
const BOLD_STRIP_RE = /^\*\*(.*)\*\*$/;

export class MarkdownToDocx {
  private placeholderMap = new Map<string, Placeholder>();
  private placeholderCounter = 0;
  private mermaidRenderer = new MermaidRenderer();

  convert(content: string, options: MarkdownToDocxOptions): (Paragraph | Table)[] {
    this.placeholderMap.clear();
    this.placeholderCounter = 0;

    // 1. Extract fenced regions (code blocks, display math) into placeholders
    const processed = this.normalizeFigurePlaceholderGaps(this.extractFencedRegions(content));

    // 2. Split by double newlines into blocks
    const rawBlocks = processed.split(/\n\s*\n/).filter((b) => b.trim() !== "");

    // 3. Classify and convert each block (index-based for figure+mermaid peeking)
    const output: (Paragraph | Table)[] = [];
    let isFirst = true;

    for (let bi = 0; bi < rawBlocks.length; bi++) {
      const trimmed = rawBlocks[bi]!.trim();

      // Check for placeholder
      const placeholder = this.placeholderMap.get(trimmed);
      if (placeholder) {
        if (placeholder.type === "code") {
          // If code block is preceded by a figure placeholder, skip — handled by figure
          if (bi > 0 && FIGURE_PLACEHOLDER_RE.test(rawBlocks[bi - 1]!.trim())) {
            isFirst = false;
            continue;
          }
          output.push(this.convertCodeBlock(placeholder, options));
        } else {
          output.push(this.convertDisplayMath(placeholder, options));
        }
        isFirst = false;
        continue;
      }

      // Check for heading
      const headingMatch = trimmed.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1]!.length as 2 | 3 | 4;
        const text = headingMatch[2]!.trim();

        if (isFirst && options.skipFirstHeading && level === 2) {
          isFirst = false;
          continue;
        }

        output.push(this.convertHeading(level, text, options));
        isFirst = false;
        continue;
      }

      // Scan for embedded tables within the block (caption may share block with table rows)
      const lines = trimmed.split("\n");
      let lineIdx = 0;
      let paraLines: string[] = [];

      const flushParagraph = () => {
        if (paraLines.length > 0) {
          output.push(this.convertParagraph(paraLines.join(""), options));
          paraLines = [];
        }
      };

      while (lineIdx < lines.length) {
        const line = lines[lineIdx]!;
        // Check for figure/table placeholder: 【图X 标题】 or 【表X 标题】
        const figMatch = line.match(FIGURE_PLACEHOLDER_RE);
        if (figMatch) {
          flushParagraph();
          const figType = figMatch[1]! === "图" ? "图" : "表";
          const figNum = figMatch[2]!;
          const figTitle = figMatch[3]!.trim();
          const label = figType === "图" ? `图${figNum}` : `表${figNum}`;
          const caption = figTitle ? `${label} ${figTitle}` : label;
          if (figType === "表") {
            output.push(this.convertCaptionParagraph(caption, options));
          } else {
            output.push(...this.convertFigurePlaceholder(caption, options));
          }
          lineIdx++;
          isFirst = false;
          continue;
        }

        const tableStart = this.findTableStart(lines, lineIdx);
        if (tableStart >= 0) {
          flushParagraph();
          const tableEnd = this.findTableEnd(lines, tableStart);
          const tableLines = lines.slice(tableStart, tableEnd);
          if (this.isTableBlock(tableLines)) {
            output.push(this.convertTable(this.parseTable(tableLines), options));
          }
          lineIdx = tableEnd;
          isFirst = false;
        } else {
          paraLines.push(lines[lineIdx]!);
          lineIdx++;
        }
      }
      flushParagraph();
      isFirst = false;
    }

    return output;
  }

  async convertAsync(content: string, options: MarkdownToDocxOptions): Promise<(Paragraph | Table)[]> {
    this.placeholderMap.clear();
    this.placeholderCounter = 0;

    const processed = this.normalizeFigurePlaceholderGaps(this.extractFencedRegions(content));
    const rawBlocks = processed.split(/\n\s*\n/).filter((b) => b.trim() !== "");

    const output: (Paragraph | Table)[] = [];
    let isFirst = true;

    for (let bi = 0; bi < rawBlocks.length; bi++) {
      const trimmed = rawBlocks[bi]!.trim();

      const placeholder = this.placeholderMap.get(trimmed);
      if (placeholder) {
        if (placeholder.type === "code") {
          if (bi > 0 && FIGURE_PLACEHOLDER_RE.test(rawBlocks[bi - 1]!.trim())) {
            isFirst = false;
            continue;
          }
          output.push(this.convertCodeBlock(placeholder, options));
        } else {
          output.push(this.convertDisplayMath(placeholder, options));
        }
        isFirst = false;
        continue;
      }

      const headingMatch = trimmed.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1]!.length as 2 | 3 | 4;
        const text = headingMatch[2]!.trim();
        if (isFirst && options.skipFirstHeading && level === 2) {
          isFirst = false;
          continue;
        }
        output.push(this.convertHeading(level, text, options));
        isFirst = false;
        continue;
      }

      const lines = trimmed.split("\n");
      let lineIdx = 0;
      let paraLines: string[] = [];

      const flushParagraph = () => {
        if (paraLines.length > 0) {
          output.push(this.convertParagraph(paraLines.join(""), options));
          paraLines = [];
        }
      };

      while (lineIdx < lines.length) {
        const line = lines[lineIdx]!;
        const figMatch = line.match(FIGURE_PLACEHOLDER_RE);
        if (figMatch) {
          flushParagraph();
          const figType = figMatch[1]! === "图" ? "图" : "表";
          const figNum = figMatch[2]!;
          const figTitle = figMatch[3]!.trim();
          const label = figType === "图" ? `图${figNum}` : `表${figNum}`;
          const caption = figTitle ? `${label} ${figTitle}` : label;

          const nextBlock = bi + 1 < rawBlocks.length ? rawBlocks[bi + 1]!.trim() : "";
          const nextPlaceholder = this.placeholderMap.get(nextBlock);
          const hasMermaid =
            nextPlaceholder?.type === "code" && nextPlaceholder.language === "mermaid";

          if (hasMermaid && figType === "图") {
            try {
              const rendered = await this.mermaidRenderer.render(nextPlaceholder.code);
              output.push(
                ...this.convertFigureImage(rendered, caption, options),
              );
            } catch (e: unknown) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.error(`[markdown-to-docx] Mermaid render failed for ${caption}: ${errMsg}`);
              output.push(...this.convertFigurePlaceholder(caption, options));
              output.push(...this.convertFigurePlaceholder(caption, options));
            }
            // mermaid block consumed by placeholder check at top of next iteration
          } else if (figType === "表") {
            output.push(this.convertCaptionParagraph(caption, options));
          } else {
            output.push(...this.convertFigurePlaceholder(caption, options));
          }
          lineIdx++;
          isFirst = false;
          continue;
        }

        const tableStart = this.findTableStart(lines, lineIdx);
        if (tableStart >= 0) {
          flushParagraph();
          const tableEnd = this.findTableEnd(lines, tableStart);
          const tableLines = lines.slice(tableStart, tableEnd);
          if (this.isTableBlock(tableLines)) {
            output.push(this.convertTable(this.parseTable(tableLines), options));
          }
          lineIdx = tableEnd;
          isFirst = false;
        } else {
          paraLines.push(lines[lineIdx]!);
          lineIdx++;
        }
      }
      flushParagraph();
      isFirst = false;
    }

    return output;
  }

  private convertFigureImage(
    rendered: MermaidRenderResult,
    caption: string,
    options: MarkdownToDocxOptions,
  ): (Paragraph | Table)[] {
    // docx library treats transformation width/height as 96-DPI pixels.
    // Target height: 22.5 cm = 850 px. Max width fits A4 with 1.25" margins.
    const targetHeightPx = 850;
    const maxWidthPx = 554;
    const scale = Math.min(targetHeightPx / rendered.height, maxWidthPx / rendered.width);
    const imgHeight = Math.round(rendered.height * scale);
    const imgWidth = Math.round(rendered.width * scale);

    const imagePara = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 0 },
      children: [
        new ImageRun({
          data: rendered.buffer,
          transformation: { width: imgWidth, height: imgHeight },
          type: rendered.format,
        }),
      ],
    });

    const captionPara = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 200 },
      children: [
        new TextRun({
          text: caption,
          font: options.font,
          size: 20,
          bold: true,
        }),
      ],
    });

    return [imagePara, captionPara];
  }

  // ---- Pre-processing: normalize figure+mermaid gaps ----

  /**
   * Ensure 【图X 标题】 and its mermaid placeholder are separated by \n\n so they
   * land in consecutive split blocks. Fixes Bug A where a single \n merges them.
   */
  private normalizeFigurePlaceholderGaps(processed: string): string {
    return processed.replace(
      /(【[图表][^】]*】)\n(__MD_PLACEHOLDER_\d+__)/g,
      "$1\n\n$2",
    );
  }

  // ---- Fenced region extraction ----

  private extractFencedRegions(content: string): string {
    // Extract fenced code blocks: ```lang\n...\n```
    let result = content;
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const placeholder = this.makePlaceholder({ type: "code", language: lang as string, code: code as string });
      return placeholder;
    });

    // Extract display math: $$...$$ (multiline)
    result = result.replace(/\$\$\s*\n([\s\S]*?)\n\s*\$\$/g, (_match, formula) => {
      const placeholder = this.makePlaceholder({ type: "display-math", formula: (formula as string).trim() });
      return placeholder;
    });

    // Extract display math: $$...$$ (single line)
    result = result.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
      const placeholder = this.makePlaceholder({ type: "display-math", formula: (formula as string).trim() });
      return placeholder;
    });

    // Extract display math: \[...\]
    result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula) => {
      const placeholder = this.makePlaceholder({ type: "display-math", formula: (formula as string).trim() });
      return placeholder;
    });

    return result;
  }

  private makePlaceholder(p: Placeholder): string {
    const id = `__MD_PLACEHOLDER_${this.placeholderCounter++}__`;
    this.placeholderMap.set(id, p);
    return id;
  }

  // ---- Block converters ----

  private convertHeading(level: 2 | 3 | 4, text: string, options: MarkdownToDocxOptions): Paragraph {
    const headingLevel =
      level === 2 ? HeadingLevel.HEADING_2 : level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
    const size = level === 2 ? 28 : level === 3 ? 26 : 24;

    return new Paragraph({
      heading: headingLevel,
      spacing: { before: 300, after: 200 },
      children: [
        new TextRun({
          text,
          font: options.headingFont,
          size,
          bold: true,
          color: options.headingColor,
        }),
      ],
    });
  }

  // ---- Table parsing ----

  /** Find the start of a table sequence within lines, starting from `startIdx`. */
  private findTableStart(lines: string[], startIdx: number): number {
    for (let i = startIdx; i < lines.length - 1; i++) {
      const line = lines[i]!;
      const next = lines[i + 1]!;
      if (TABLE_LINE_RE.test(line) && TABLE_SEP_RE.test(next)) {
        return i;
      }
    }
    return -1;
  }

  /** Find the end of a table sequence (index after last data row). */
  private findTableEnd(lines: string[], tableStart: number): number {
    // tableStart points to header row; header+1 is separator; header+2+ are data rows
    let i = tableStart + 2; // skip header and separator
    while (i < lines.length && TABLE_LINE_RE.test(lines[i]!)) {
      i++;
    }
    return i;
  }

  private isTableBlock(lines: string[]): boolean {
    if (lines.length < 2) return false;
    // All lines must match table row pattern or separator pattern
    const allTableish = lines.every((l) => TABLE_LINE_RE.test(l) || TABLE_SEP_RE.test(l));
    if (!allTableish) return false;
    // Must have at least one separator row
    const hasSeparator = lines.some((l) => TABLE_SEP_RE.test(l));
    return hasSeparator;
  }

  private parseTable(lines: string[]): TableBlock {
    const rows: string[][] = [];
    let header: string[] = [];
    const alignments: ("left" | "center" | "right")[] = [];
    let headerSet = false;

    for (const line of lines) {
      if (TABLE_SEP_RE.test(line)) {
        // Parse alignment from separator
        const cells = this.splitTableRow(line);
        for (const cell of cells) {
          const t = cell.trim();
          if (t.startsWith(":") && t.endsWith(":")) alignments.push("center");
          else if (t.endsWith(":")) alignments.push("right");
          else alignments.push("left");
        }
        continue;
      }

      const cells = this.splitTableRow(line).map((c) => c.trim());
      if (!headerSet) {
        header = cells;
        headerSet = true;
      } else {
        rows.push(cells);
      }
    }

    return { type: "table", header, alignments, rows };
  }

  private splitTableRow(line: string): string[] {
    const match = line.match(TABLE_LINE_RE);
    if (!match) return [];
    return match[1]!.split("|").map((c) => c.trim());
  }

  private convertTable(block: TableBlock, options: MarkdownToDocxOptions): Table {
    const colCount = block.header.length;
    const colWidth = Math.floor(9000 / colCount); // Distribute available width

    const headerRow = new TableRow({
      tableHeader: true,
      children: block.header.map(
        (cell) =>
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: "D9D9D9" },
            width: { size: colWidth, type: WidthType.DXA },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  new TextRun({
                    text: cell,
                    font: options.font,
                    size: options.size,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
      ),
    });

    const dataRows = block.rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cell, ci) =>
              new TableCell({
                width: { size: colWidth, type: WidthType.DXA },
                children: [
                  new Paragraph({
                    spacing: { after: 40 },
                    children: this.parseInlineRuns(cell, options),
                  }),
                ],
              }),
          ),
        }),
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 1 },
        left: { style: BorderStyle.SINGLE, size: 1 },
        right: { style: BorderStyle.SINGLE, size: 1 },
        insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
        insideVertical: { style: BorderStyle.SINGLE, size: 1 },
      },
    });
  }

  // ---- Code and Math blocks ----

  private convertCodeBlock(placeholder: CodePlaceholder, options: MarkdownToDocxOptions): Paragraph {
    return new Paragraph({
      spacing: { after: 120, line: 300 },
      indent: { firstLine: 0 },
      shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
      children: [
        new TextRun({
          text: placeholder.code,
          font: "Consolas",
          size: 20, // 10pt for code
        }),
      ],
    });
  }

  private convertDisplayMath(placeholder: DisplayMathPlaceholder, options: MarkdownToDocxOptions): Paragraph {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 120 },
      indent: { firstLine: 0 },
      children: [
        new TextRun({
          text: placeholder.formula,
          font: "Cambria Math",
          size: options.size,
          italics: true,
        }),
      ],
    });
  }

  // ---- Figure/Table placeholders ----

  private convertFigurePlaceholder(
    caption: string,
    options: MarkdownToDocxOptions,
  ): (Paragraph | Table)[] {
    const isZh = options.font === "宋体";
    const placeholderText = isZh ? "【此处插入图片】" : "[Insert image here]";

    // Caption paragraph (centered, bold)
    const captionPara = new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 },
      children: [
        new TextRun({
          text: caption,
          font: options.font,
          size: options.size,
          bold: true,
        }),
      ],
    });

    // Placeholder box (single-cell table with borders)
    const placeholderBox = new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      rows: [
        new TableRow({
          height: { value: 2000, rule: HeightRule.ATLEAST },
          children: [
            new TableCell({
              width: { size: 100, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
              verticalAlign: "center" as never,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: placeholderText,
                      font: options.font,
                      size: 20,
                      color: "999999",
                      italics: true,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
      borders: {
        top: { style: BorderStyle.DASHED, size: 1, color: "999999" },
        bottom: { style: BorderStyle.DASHED, size: 1, color: "999999" },
        left: { style: BorderStyle.DASHED, size: 1, color: "999999" },
        right: { style: BorderStyle.DASHED, size: 1, color: "999999" },
      },
    });

    return [captionPara, placeholderBox];
  }

  private convertCaptionParagraph(
    caption: string,
    options: MarkdownToDocxOptions,
  ): Paragraph {
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({
          text: caption,
          font: options.font,
          size: options.size,
          bold: true,
        }),
      ],
    });
  }

  // ---- Paragraph and inline parsing ----

  private convertParagraph(text: string, options: MarkdownToDocxOptions): Paragraph {
    return new Paragraph({
      spacing: { after: 120, line: options.lineSpacing },
      indent: { firstLine: options.firstLineIndent },
      children: this.parseInlineRuns(text, options),
    });
  }

  /**
   * Parse inline formatting within a single logical paragraph.
   * Returns TextRun and InternalHyperlink children for the paragraph.
   */
  private parseInlineRuns(
    text: string,
    options: MarkdownToDocxOptions,
  ): (TextRun | InternalHyperlink)[] {
    const runs: (TextRun | InternalHyperlink)[] = [];
    let pos = 0;

    while (pos < text.length) {
      // 1. Try inline math: \(...\) or $...$
      const mathMatch = text.slice(pos).match(INLINE_MATH_RE);
      if (mathMatch && mathMatch.index !== undefined && mathMatch.index >= 0) {
        // Flush plain text before the match
        if (mathMatch.index > 0) {
          this.pushPlainRuns(runs, text.slice(pos, pos + mathMatch.index), options);
        }
        const inner = (mathMatch[1] ?? mathMatch[2])!.trim();
        runs.push(
          new TextRun({
            text: inner,
            font: "Cambria Math",
            size: options.size,
            italics: true,
          }),
        );
        pos += mathMatch.index + mathMatch[0].length;
        continue;
      }

      // 2. Try bold: **text**
      const boldMatch = text.slice(pos).match(BOLD_RE);
      if (boldMatch && boldMatch.index !== undefined && boldMatch.index >= 0) {
        if (boldMatch.index > 0) {
          this.pushPlainRuns(runs, text.slice(pos, pos + boldMatch.index), options);
        }
        runs.push(
          new TextRun({
            text: boldMatch[1]!,
            font: options.font,
            size: options.size,
            bold: true,
          }),
        );
        pos += boldMatch.index + boldMatch[0].length;
        continue;
      }

      // 3. Try italic: *text* (but not ** which is bold)
      const italicMatch = text.slice(pos).match(ITALIC_RE);
      if (italicMatch && italicMatch.index !== undefined && italicMatch.index >= 0) {
        if (italicMatch.index > 0) {
          this.pushPlainRuns(runs, text.slice(pos, pos + italicMatch.index), options);
        }
        runs.push(
          new TextRun({
            text: italicMatch[1]!,
            font: options.font,
            size: options.size,
            italics: true,
          }),
        );
        pos += italicMatch.index + italicMatch[0].length;
        continue;
      }

      // 4. Plain text — consume until next special character
      // Citations are handled inline by pushPlainRuns, not as standalone blocks
      const remaining = text.slice(pos);
      const nextSpecial = remaining.search(/\\\(|\$|\*\*?/);
      if (nextSpecial === -1) {
        this.pushPlainRuns(runs, remaining, options);
        break;
      }
      if (nextSpecial > 0) {
        this.pushPlainRuns(runs, remaining.slice(0, nextSpecial), options);
        pos += nextSpecial;
      } else {
        // Special char at position 0 but no pattern matched — consume it as plain
        runs.push(this.makeBodyTextRun(remaining[0]!, options));
        pos += 1;
      }
    }

    return runs;
  }

  /**
   * Push plain text as TextRun(s), splitting on citation patterns [N] or [N,M] or [N-M]
   * that appear mid-text (not as standalone citation groups).
   */
  private pushPlainRuns(
    runs: (TextRun | InternalHyperlink)[],
    text: string,
    options: MarkdownToDocxOptions,
  ): void {
    if (!text) return;

    // Split plain text by citation patterns found within
    let lastEnd = 0;
    const re = new RegExp(CITATION_GLOBAL_RE.source, "g");
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      // Flush text before this match
      if (m.index > lastEnd) {
        runs.push(this.makeBodyTextRun(text.slice(lastEnd, m.index), options));
      }
      // Add citation hyperlinks
      const nums = this.expandCitationNumbers(m[1]!);
      for (const num of nums) {
        runs.push(
          new InternalHyperlink({
            anchor: `ref-${num}`,
            children: [
              new TextRun({
                text: `[${num}]`,
                style: "Hyperlink",
                font: options.font,
                size: options.size,
              }),
            ],
          }),
        );
      }
      lastEnd = m.index + m[0].length;
    }

    // Flush remaining text
    if (lastEnd < text.length) {
      runs.push(this.makeBodyTextRun(text.slice(lastEnd), options));
    }
  }

  private makeBodyTextRun(text: string, options: MarkdownToDocxOptions): TextRun {
    return new TextRun({
      text,
      font: options.font,
      size: options.size,
    });
  }

  /**
   * Expand "1,2,5-7" into ["1","2","5","6","7"].
   */
  private expandCitationNumbers(spec: string): string[] {
    const nums: string[] = [];
    const parts = spec.split(/[,，]/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes("-")) {
        const [startStr, endStr] = trimmed.split("-");
        const start = parseInt(startStr!, 10);
        const end = parseInt(endStr!, 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
          for (let i = start; i <= end; i++) {
            nums.push(String(i));
          }
        }
      } else {
        nums.push(trimmed);
      }
    }
    return nums;
  }
}
