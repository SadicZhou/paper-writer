import { describe, expect, it } from "vitest";
import { pickMessage } from "./use-paper-pipeline-progress";

describe("pickMessage (paper SSE payload)", () => {
  it("reads message string", () => {
    expect(pickMessage({ message: "  ok  " })).toBe("ok");
  });

  it("falls back to error string", () => {
    expect(pickMessage({ error: "boom" })).toBe("boom");
  });

  it("returns empty for null or empty payload", () => {
    expect(pickMessage(null)).toBe("");
    expect(pickMessage({})).toBe("");
  });
});
