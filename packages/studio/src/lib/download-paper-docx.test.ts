import { describe, expect, it } from "vitest";
import { parseFilenameFromContentDisposition } from "./download-paper-docx";

describe("parseFilenameFromContentDisposition", () => {
  it("prefers RFC 5987 filename*", () => {
    const h = `attachment; filename="paper.docx"; filename*=UTF-8''%E8%AE%BA%E6%96%87.docx`;
    expect(parseFilenameFromContentDisposition(h)).toBe("论文.docx");
  });

  it("falls back to quoted filename", () => {
    expect(parseFilenameFromContentDisposition(`attachment; filename="my-thesis.docx"`)).toBe(
      "my-thesis.docx",
    );
  });

  it("returns null when missing", () => {
    expect(parseFilenameFromContentDisposition(null)).toBeNull();
    expect(parseFilenameFromContentDisposition("inline")).toBeNull();
  });
});
