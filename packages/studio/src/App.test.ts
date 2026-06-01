import { describe, expect, it } from "vitest";
import { deriveActivePaperId } from "./App";

describe("deriveActivePaperId", () => {
  it("returns the current paper across paper-centered routes", () => {
    expect(deriveActivePaperId({ page: "paper-generate", paperId: "alpha" })).toBe("alpha");
    expect(deriveActivePaperId({ page: "paper-workspace", paperId: "omega" })).toBe("omega");
    expect(deriveActivePaperId({ page: "paper-section", paperId: "beta", sectionNumber: "1.1" })).toBe("beta");
    expect(deriveActivePaperId({ page: "paper-literature", paperId: "gamma" })).toBe("gamma");
    expect(deriveActivePaperId({ page: "paper-detection", paperId: "delta" })).toBe("delta");
    expect(deriveActivePaperId({ page: "paper-export", paperId: "epsilon" })).toBe("epsilon");
  });

  it("returns undefined for non-paper routes", () => {
    expect(deriveActivePaperId({ page: "dashboard" })).toBeUndefined();
    expect(deriveActivePaperId({ page: "services" })).toBeUndefined();
    expect(deriveActivePaperId({ page: "logs" })).toBeUndefined();
  });
});
