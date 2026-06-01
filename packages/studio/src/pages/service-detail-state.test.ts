import { describe, expect, it, vi } from "vitest";
import {
  matchServiceConfigEntryForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
} from "./service-detail-state";

describe("rehydrateServiceConnectionStatus", () => {
  it("loads saved key without probing models when no full key returned", async () => {
    const fetchJsonImpl = vi.fn(async (path: string) => {
      if (path === "/services/openai/secret") {
        return { hasKey: true, keyPreview: "sk-l...-key" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await rehydrateServiceConnectionStatus({
      effectiveServiceId: "openai",
      shouldVerify: true,
      isCustom: false,
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(fetchJsonImpl).toHaveBeenCalledTimes(1);
    expect(fetchJsonImpl).toHaveBeenCalledWith("/services/openai/secret");
    expect(result).toMatchObject({
      apiKey: "",
      hasSavedKey: true,
      keyPreview: "sk-l...-key",
      detectedModel: "",
      detectedConfig: null,
      status: { state: "idle" },
    });
  });

  it("auto-probes and returns models when server has a full saved key", async () => {
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      if (path === "/services/openai/secret") {
        return { hasKey: true, apiKey: "sk-full-key-123", keyPreview: "sk-f...-123" };
      }
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
          selectedModel: "gpt-4o",
          detected: { apiFormat: "chat", stream: true },
        };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await rehydrateServiceConnectionStatus({
      effectiveServiceId: "openai",
      shouldVerify: true,
      isCustom: false,
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(fetchJsonImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      apiKey: "sk-full-key-123",
      hasSavedKey: true,
      keyPreview: "sk-f...-123",
      detectedModel: "gpt-4o",
      detectedConfig: { apiFormat: "chat", stream: true },
      status: { state: "connected", models: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] },
    });
  });

  it("returns key for editing when probe fails", async () => {
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      if (path === "/services/openai/secret") {
        return { hasKey: true, apiKey: "sk-expired", keyPreview: "sk-e...red" };
      }
      if (path === "/services/openai/test") {
        return { ok: false, error: "invalid key" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await rehydrateServiceConnectionStatus({
      effectiveServiceId: "openai",
      shouldVerify: true,
      isCustom: false,
      baseUrl: "",
      apiFormat: "chat",
      stream: true,
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(result).toMatchObject({
      apiKey: "sk-expired",
      hasSavedKey: true,
      keyPreview: "sk-e...red",
      detectedModel: "",
      detectedConfig: null,
      status: { state: "idle" },
    });
  });
});

describe("matchServiceConfigEntryForDetail", () => {
  const entries = [
    { service: "moonshot", temperature: 0.5 },
    { service: "custom", name: "内网GPT", baseUrl: "https://llm.internal.corp/v1" },
    { service: "custom", name: "本地Ollama", baseUrl: "http://localhost:11434/v1" },
  ];

  it("matches concrete custom services without treating bare custom as an existing config", () => {
    expect(matchServiceConfigEntryForDetail(entries, "custom")).toBeUndefined();
    expect(matchServiceConfigEntryForDetail(entries, "custom:内网GPT")).toEqual(entries[1]);
  });

  it("matches non-custom services by service id", () => {
    expect(matchServiceConfigEntryForDetail(entries, "moonshot")).toEqual(entries[0]);
  });
});

describe("saveServiceConfig", () => {
  it("validates the upstream service before persisting secrets/config", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-5.5" }],
          selectedModel: "gpt-5.5",
          detected: { apiFormat: "chat", stream: true },
        };
      }
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-live",
      baseUrl: "",
      apiFormat: "chat",
      protocol: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      note: "",
      website: "",
      authField: "",
      modelMain: "",
      modelHaiku: "",
      modelSonnet: "",
      modelOpus: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    expect(calls).toEqual([
      "/services/openai/test",
      "/services/openai/secret",
      "/services/config",
    ]);
    expect(bodies).toEqual([
      { apiKey: "sk-live", apiFormat: "chat", stream: true },
      { apiKey: "sk-live" },
      {
        service: "openai",
        defaultModel: "gpt-5.5",
        services: [
          {
            service: "openai",
            temperature: 0.7,
            baseUrl: "",
            apiFormat: "chat",
            protocol: "chat",
            stream: true,
            note: "",
            website: "",
            authField: "",
            modelMain: "",
            modelHaiku: "",
            modelSonnet: "",
            modelOpus: "",
          },
        ],
      },
    ]);
    expect(result).toEqual({
      detectedModel: "gpt-5.5",
      detectedConfig: { apiFormat: "chat", stream: true },
      status: { state: "connected", models: [{ id: "gpt-5.5" }] },
    });
  });

  it("persists defaultModel from 主模型 when probe omits selectedModel", async () => {
    const bodies: unknown[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (path === "/services/openai/test") {
        return {
          ok: true,
          models: [{ id: "gpt-4o-mini" }],
          detected: { apiFormat: "chat", stream: true },
        };
      }
      if (path === "/services/openai/secret") return { ok: true };
      if (path === "/services/config") return { ok: true };
      throw new Error(`unexpected path: ${path}`);
    });

    await saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-live",
      baseUrl: "",
      apiFormat: "chat",
      protocol: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      note: "",
      website: "",
      authField: "",
      modelMain: "gpt-4o-mini",
      modelHaiku: "",
      modelSonnet: "",
      modelOpus: "",
      fetchJsonImpl: fetchJsonImpl as never,
    });

    const configBody = bodies.find(
      (b) => typeof b === "object" && b !== null && "services" in (b as object),
    ) as { defaultModel?: string } | undefined;
    expect(configBody?.defaultModel).toBe("gpt-4o-mini");
  });

  it("does not persist secrets/config when validation fails", async () => {
    const calls: string[] = [];
    const fetchJsonImpl = vi.fn(async (path: string, init?: { body?: string }) => {
      calls.push(path);
      if (path === "/services/openai/test") {
        expect(init?.body ? JSON.parse(init.body) : null).toEqual({
          apiKey: "sk-bad",
          apiFormat: "chat",
          stream: true,
        });
        return { ok: false, error: "invalid key" };
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await expect(saveServiceConfig({
      effectiveServiceId: "openai",
      serviceId: "openai",
      isCustom: false,
      resolvedCustomName: "",
      apiKey: "sk-bad",
      baseUrl: "",
      apiFormat: "chat",
      protocol: "chat",
      stream: true,
      temperature: "0.7",
      detectedModel: "",
      note: "",
      website: "",
      authField: "",
      modelMain: "",
      modelHaiku: "",
      modelSonnet: "",
      modelOpus: "",
      fetchJsonImpl: fetchJsonImpl as never,
    })).resolves.toEqual({
      detectedModel: "",
      detectedConfig: null,
      status: { state: "error", message: "invalid key" },
    });

    expect(calls).toEqual(["/services/openai/test"]);
  });
});
