import type { Reference } from "../models/paper.js";

export type CitationFormat = "gb7714" | "apa" | "mla" | "chicago";

export interface FormatReferencesInput {
  readonly references: Reference[];
  readonly format: CitationFormat;
  readonly language: "zh" | "en";
}

export interface FormatReferencesOutput {
  readonly formattedReferences: string[];
  readonly bibliography: string;
}

/**
 * Pure rule-engine citation formatter. No LLM calls.
 * Converts structured Reference objects to formatted citation strings
 * following GB/T 7714, APA 7th, MLA 9th, or Chicago (author-date) standards.
 */
export class CitationFormatter {
  format(input: FormatReferencesInput): FormatReferencesOutput {
    const formatted = input.references.map((ref, i) => {
      const label = `[${i + 1}]`;
      const citation = this.formatReference(ref, input.format);
      return `${label} ${citation}`;
    });

    const bibliography = formatted.join("\n\n");

    return { formattedReferences: formatted, bibliography };
  }

  private formatReference(ref: Reference, format: CitationFormat): string {
    switch (format) {
      case "gb7714":
        return this.formatGB7714(ref);
      case "apa":
        return this.formatAPA(ref);
      case "mla":
        return this.formatMLA(ref);
      case "chicago":
        return this.formatChicago(ref);
    }
  }

  // GB/T 7714-2015
  private formatGB7714(ref: Reference): string {
    const authors = this.formatAuthorsGB7714(ref.authors);
    const title = ref.title;
    const year = String(ref.year);

    switch (ref.type) {
      case "journal":
        return `${authors}. ${title}[J]. ${ref.journal ?? ""}, ${year}${ref.volume ? `, ${ref.volume}${ref.issue ? `(${ref.issue})` : ""}` : ""}${ref.pages ? `: ${ref.pages}` : ""}.`;
      case "book":
        return `${authors}. ${title}[M]. ${ref.journal ?? ""}, ${year}.`;
      case "conference":
        return `${authors}. ${title}[C]. ${ref.journal ?? ""}, ${year}.`;
      case "thesis":
        return `${authors}. ${title}[D]. ${ref.journal ?? ""}, ${year}.`;
      case "other":
      default:
        return `${authors}. ${title}[Z]. ${year}.`;
    }
  }

  private formatAuthorsGB7714(authors: string[]): string {
    if (authors.length === 0) return "[佚名]";
    if (authors.length <= 3) return authors.join(", ");
    return `${authors.slice(0, 3).join(", ")}, 等`;
  }

  // APA 7th Edition
  private formatAPA(ref: Reference): string {
    const authors = this.formatAuthorsAPA(ref.authors);
    const year = `(${ref.year})`;
    const title = this.sentenceCase(ref.title);

    switch (ref.type) {
      case "journal": {
        const journal = ref.journal ? `*${ref.journal}*` : "";
        const volume = ref.volume ? `*${ref.volume}*` : "";
        const issue = ref.issue ? `(${ref.issue})` : "";
        const pages = ref.pages ? `, ${ref.pages}` : "";
        return `${authors} ${year}. ${title}. ${journal}${volume ? `, ${volume}` : ""}${issue}${pages}.${ref.doi ? ` https://doi.org/${ref.doi}` : ""}`;
      }
      case "book":
        return `${authors} ${year}. ${this.italicize(ref.title)}. ${ref.journal ?? ""}.`;
      case "conference":
        return `${authors} ${year}. ${title}. In ${ref.journal ?? "Proceedings"}.`;
      case "thesis":
        return `${authors} ${year}. ${this.italicize(ref.title)} [${ref.type === "thesis" ? "Doctoral dissertation" : "Master's thesis"}]. ${ref.journal ?? ""}.`;
      case "other":
      default:
        return `${authors} ${year}. ${title}. ${ref.journal ?? ""}`;
    }
  }

  private formatAuthorsAPA(authors: string[]): string {
    if (authors.length === 0) return "Anonymous.";
    if (authors.length === 1) return `${authors[0]}.`;
    if (authors.length === 2) return `${authors[0]}, & ${authors[1]}.`;
    if (authors.length <= 7) {
      return authors.slice(0, -1).join(", ") + `, & ${authors[authors.length - 1]}.`;
    }
    return authors.slice(0, 6).join(", ") + `, ... ${authors[authors.length - 1]}.`;
  }

  // MLA 9th Edition
  private formatMLA(ref: Reference): string {
    const authors = this.formatAuthorsMLA(ref.authors);
    const title = `"${ref.title}."`;
    const year = String(ref.year);

    switch (ref.type) {
      case "journal": {
        const journal = ref.journal ? `*${ref.journal}*` : "";
        const volIssue = [ref.volume, ref.issue].filter(Boolean).join(", no. ");
        const pages = ref.pages ? `pp. ${ref.pages}` : "";
        return `${authors}${title} ${journal}${volIssue ? `, vol. ${volIssue}` : ""}, ${year}${pages ? `, ${pages}` : ""}.`;
      }
      case "book":
        return `${authors}*${ref.title}*. ${ref.journal ?? ""}, ${year}.`;
      case "conference":
        return `${authors}${title} *${ref.journal ?? "Conference Proceedings"}*, ${year}.`;
      case "thesis":
        return `${authors}${title} ${ref.journal ?? ""}, ${year}. ${ref.type === "thesis" ? "Doctoral dissertation" : "Master's thesis"}.`;
      case "other":
      default:
        return `${authors}${title} ${ref.journal ?? ""}, ${year}.`;
    }
  }

  private formatAuthorsMLA(authors: string[]): string {
    if (authors.length === 0) return "Anonymous. ";
    if (authors.length === 1) return `${authors[0]}. `;
    if (authors.length === 2) return `${authors[0]}, and ${authors[1]}. `;
    return `${authors[0]}, et al. `;
  }

  // Chicago (Author-Date)
  private formatChicago(ref: Reference): string {
    const authors = this.formatAuthorsChicago(ref.authors);
    const year = String(ref.year);
    const title = ref.title;

    switch (ref.type) {
      case "journal": {
        const journal = ref.journal ?? "";
        const volume = ref.volume ?? "";
        const issue = ref.issue ? `, no. ${ref.issue}` : "";
        const pages = ref.pages ? `: ${ref.pages}` : "";
        return `${authors} ${year}. "${title}." ${journal} ${volume}${issue}${pages}.`;
      }
      case "book":
        return `${authors} ${year}. *${ref.title}*. ${ref.journal ?? ""}.`;
      case "conference":
        return `${authors} ${year}. "${title}." In *${ref.journal ?? "Proceedings"}*.`;
      case "thesis":
        return `${authors} ${year}. "${title}." ${ref.type === "thesis" ? "PhD diss." : "Master's thesis"}, ${ref.journal ?? ""}.`;
      case "other":
      default:
        return `${authors} ${year}. "${title}." ${ref.journal ?? ""}.`;
    }
  }

  private formatAuthorsChicago(authors: string[]): string {
    if (authors.length === 0) return "Anonymous.";
    if (authors.length === 1) return `${authors[0]}.`;
    if (authors.length === 2) return `${authors[0]}, and ${authors[1]}.`;
    if (authors.length <= 3) return authors.join(", ") + ".";
    return `${authors.slice(0, 3).join(", ")}, et al.`;
  }

  // Helpers
  private sentenceCase(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  private italicize(text: string): string {
    return `*${text}*`;
  }
}
