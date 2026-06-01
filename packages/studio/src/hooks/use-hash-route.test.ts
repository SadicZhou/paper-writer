import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "./use-hash-route";

describe("hash route", () => {
  describe("parseHash", () => {
    it("parses empty hash as dashboard", () => {
      expect(parseHash("")).toEqual({ page: "dashboard" });
    });

    it("parses #/ as dashboard", () => {
      expect(parseHash("#/")).toEqual({ page: "dashboard" });
    });

    it("parses bare paper hash as paper-generate (default landing)", () => {
      expect(parseHash("#/paper/my-paper")).toEqual({ page: "paper-generate", paperId: "my-paper" });
    });

    it("decodes encoded paperId for generate landing", () => {
      expect(parseHash("#/paper/%E4%B9%9D%E9%BE%99")).toEqual({ page: "paper-generate", paperId: "九龙" });
    });

    it("parses paper workspace route", () => {
      expect(parseHash("#/paper/my-paper/workspace")).toEqual({ page: "paper-workspace", paperId: "my-paper" });
    });

    it("parses paper generate explicit route", () => {
      expect(parseHash("#/paper/my-paper/generate")).toEqual({ page: "paper-generate", paperId: "my-paper" });
    });

    it("parses paper/new as paper-create", () => {
      expect(parseHash("#/paper/new")).toEqual({ page: "paper-create" });
    });

    it("parses paper-section route", () => {
      expect(parseHash("#/paper/my-paper/section/1.1")).toEqual({
        page: "paper-section",
        paperId: "my-paper",
        sectionNumber: "1.1",
      });
    });

    it("parses paper sub-pages", () => {
      expect(parseHash("#/paper/my-paper/literature")).toEqual({ page: "paper-literature", paperId: "my-paper" });
      expect(parseHash("#/paper/my-paper/detection")).toEqual({ page: "paper-detection", paperId: "my-paper" });
      expect(parseHash("#/paper/my-paper/export")).toEqual({ page: "paper-export", paperId: "my-paper" });
    });

    it("parses config as services (redirect)", () => {
      expect(parseHash("#/config")).toEqual({ page: "services" });
    });

    it("parses services", () => {
      expect(parseHash("#/services")).toEqual({ page: "services" });
    });

    it("parses service-detail", () => {
      expect(parseHash("#/services/openai")).toEqual({ page: "service-detail", serviceId: "openai" });
    });

    it("parses logs and doctor", () => {
      expect(parseHash("#/logs")).toEqual({ page: "logs" });
      expect(parseHash("#/doctor")).toEqual({ page: "doctor" });
    });

    it("falls back to dashboard for unknown hash", () => {
      expect(parseHash("#/unknown/route")).toEqual({ page: "dashboard" });
    });
  });

  describe("routeToHash", () => {
    it("dashboard -> #/", () => {
      expect(routeToHash({ page: "dashboard" })).toBe("#/");
    });

    it("paper-generate -> hash", () => {
      expect(routeToHash({ page: "paper-generate", paperId: "paper-1" })).toBe("#/paper/paper-1/generate");
    });

    it("paper-workspace -> hash", () => {
      expect(routeToHash({ page: "paper-workspace", paperId: "paper-1" })).toBe("#/paper/paper-1/workspace");
    });

    it("encodes Chinese paperId in generate route", () => {
      const hash = routeToHash({ page: "paper-generate", paperId: "人工智能论文" });
      expect(hash).toContain("#/paper/");
      expect(hash).toContain("/generate");
      expect(decodeURIComponent(hash)).toContain("人工智能论文");
    });

    it("paper-create -> #/paper/new", () => {
      expect(routeToHash({ page: "paper-create" })).toBe("#/paper/new");
    });

    it("services -> #/services", () => {
      expect(routeToHash({ page: "services" })).toBe("#/services");
    });

    it("service-detail -> #/services/{id}", () => {
      expect(routeToHash({ page: "service-detail", serviceId: "openai" })).toBe("#/services/openai");
    });

    it("logs and doctor produce hash routes", () => {
      expect(routeToHash({ page: "logs" })).toBe("#/logs");
      expect(routeToHash({ page: "doctor" })).toBe("#/doctor");
    });
  });
});
