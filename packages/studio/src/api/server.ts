import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  StateManager,
  PaperRunner,
  WordExporter,
  createLLMClient,
  chatCompletion,
  createLogger,
  loadProjectConfig,
  loadSecrets,
  saveSecrets,
  listModelsForService,
  isApiKeyOptionalForEndpoint,
  getAllEndpoints,
  probeModelsFromUpstream,
  fetchWithProxy,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServiceModelsBaseUrl,
  resolveServiceModel,
  derivePaperIdFromTitle,
  GLOBAL_ENV_PATH,
  type AgentContext,
  type PaperConfig,
  type ProjectConfig,
  type LogSink,
  type LogEntry,
  type ResolvedModel,
  type LLMConfigCliOverrides,
  OutlineAgent,
} from "@actalk/inkos-core";
import { access, mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isSafeBookId } from "./safety.js";
import { ApiError } from "./errors.js";

// --- Utility helpers ---

const NON_TEXT_MODEL_ID_PARTS = [
  "image", "embedding", "embed", "rerank", "tts", "speech", "audio", "moderation",
] as const;

function isTextChatModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return false;
  return !NON_TEXT_MODEL_ID_PARTS.some((part) => normalized.includes(part));
}

/**
 * 仅用于 Studio 配置页提示「密钥已保存」，不返回完整 key。
 * @author zjh
 * @date 2026-05-12
 */
function maskApiKeyForPreview(apiKey: string): string {
  const t = apiKey.trim();
  if (!t) return "";
  if (t.length <= 8) return "********";
  return `${t.slice(0, 4)}...${t.slice(-4)}`;
}

function filterTextChatModels<T extends { readonly id: string }>(models: ReadonlyArray<T>): T[] {
  return models.filter((model) => isTextChatModelId(model.id));
}

function nonTextModelMessage(modelId: string): string {
  return `模型 ${modelId} 不适合文本聊天/写作。请在模型选择器中改用文本模型，例如 gemini-2.5-flash、gemini-2.5-pro 或对应服务的 chat 模型。`;
}

function normalizePaperId(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "INVALID_PAPER_ID", `${fieldName} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (!isSafeBookId(trimmed)) {
    throw new ApiError(400, "INVALID_PAPER_ID", `Invalid ${fieldName}: "${trimmed}"`);
  }
  return trimmed;
}

// --- Event bus for SSE ---

type EventHandler = (event: string, data: unknown) => void;
const subscribers = new Set<EventHandler>();

function broadcast(event: string, data: unknown): void {
  for (const handler of subscribers) {
    handler(event, data);
  }
}

// --- Service config types ---

interface ServiceConfigEntry {
  service: string;
  name?: string;
  baseUrl?: string;
  temperature?: number;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  note?: string;
  website?: string;
  protocol?: "chat" | "responses" | "anthropic-messages";
  authField?: string;
  modelMain?: string;
  modelHaiku?: string;
  modelSonnet?: string;
  modelOpus?: string;
}

type LLMConfigSource = "env" | "studio";

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface EnvConfigStatus {
  project: EnvConfigSummary;
  global: EnvConfigSummary;
  effectiveSource: "project" | "global" | null;
  runtimeUsesEnv: false;
}

interface ServiceProbeResult {
  ok: boolean;
  models: Array<{ id: string; name: string }>;
  selectedModel?: string;
  apiFormat?: "chat" | "responses";
  stream?: boolean;
  baseUrl?: string;
  modelsSource?: "api" | "fallback";
  error?: string;
}

// --- Session storage types ---

interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  timestamp: number;
}

interface SessionRecord {
  sessionId: string;
  bookId: string | null;
  title: string | null;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
}

interface SessionSummary {
  sessionId: string;
  bookId: string | null;
  title: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

// Model list cache
const modelListCache = new Map<string, { models: Array<{ id: string; name: string }>; at: number }>();

// --- Service config helpers ---

function isCustomServiceId(serviceId: string): boolean {
  return serviceId === "custom" || serviceId.startsWith("custom:");
}

function serviceConfigKey(entry: ServiceConfigEntry): string {
  return entry.service === "custom" ? `custom:${entry.name ?? "Custom"}` : entry.service;
}

function normalizeServiceEntry(serviceId: string, value: Record<string, unknown>): ServiceConfigEntry {
  if (serviceId.startsWith("custom:")) {
    return {
      service: "custom",
      name: decodeURIComponent(serviceId.slice("custom:".length)),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...(typeof value.note === "string" ? { note: value.note } : {}),
      ...(typeof value.website === "string" ? { website: value.website } : {}),
      ...(value.protocol === "chat" || value.protocol === "responses" || value.protocol === "anthropic-messages"
        ? { protocol: value.protocol }
        : {}),
      ...(typeof value.authField === "string" ? { authField: value.authField } : {}),
      ...(typeof value.modelMain === "string" ? { modelMain: value.modelMain } : {}),
      ...(typeof value.modelHaiku === "string" ? { modelHaiku: value.modelHaiku } : {}),
      ...(typeof value.modelSonnet === "string" ? { modelSonnet: value.modelSonnet } : {}),
      ...(typeof value.modelOpus === "string" ? { modelOpus: value.modelOpus } : {}),
    };
  }
  if (serviceId === "custom") {
    return {
      service: "custom",
      ...(typeof value.name === "string" && value.name.length > 0 ? { name: value.name } : {}),
      ...(typeof value.baseUrl === "string" && value.baseUrl.length > 0 ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
      ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
      ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
      ...(typeof value.note === "string" ? { note: value.note } : {}),
      ...(typeof value.website === "string" ? { website: value.website } : {}),
      ...(value.protocol === "chat" || value.protocol === "responses" || value.protocol === "anthropic-messages"
        ? { protocol: value.protocol }
        : {}),
      ...(typeof value.authField === "string" ? { authField: value.authField } : {}),
      ...(typeof value.modelMain === "string" ? { modelMain: value.modelMain } : {}),
      ...(typeof value.modelHaiku === "string" ? { modelHaiku: value.modelHaiku } : {}),
      ...(typeof value.modelSonnet === "string" ? { modelSonnet: value.modelSonnet } : {}),
      ...(typeof value.modelOpus === "string" ? { modelOpus: value.modelOpus } : {}),
    };
  }
  return {
    service: serviceId,
    ...(typeof value.temperature === "number" ? { temperature: value.temperature } : {}),
    ...(value.apiFormat === "chat" || value.apiFormat === "responses" ? { apiFormat: value.apiFormat } : {}),
    ...(typeof value.stream === "boolean" ? { stream: value.stream } : {}),
    ...(typeof value.note === "string" ? { note: value.note } : {}),
    ...(typeof value.website === "string" ? { website: value.website } : {}),
    ...(value.protocol === "chat" || value.protocol === "responses" || value.protocol === "anthropic-messages"
      ? { protocol: value.protocol }
      : {}),
    ...(typeof value.authField === "string" ? { authField: value.authField } : {}),
    ...(typeof value.modelMain === "string" ? { modelMain: value.modelMain } : {}),
    ...(typeof value.modelHaiku === "string" ? { modelHaiku: value.modelHaiku } : {}),
    ...(typeof value.modelSonnet === "string" ? { modelSonnet: value.modelSonnet } : {}),
    ...(typeof value.modelOpus === "string" ? { modelOpus: value.modelOpus } : {}),
  };
}

function normalizeServiceConfig(raw: unknown): ServiceConfigEntry[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        service: typeof entry.service === "string" && entry.service.length > 0 ? entry.service : "custom",
        ...(typeof entry.name === "string" && entry.name.length > 0 ? { name: entry.name } : {}),
        ...(typeof entry.baseUrl === "string" && entry.baseUrl.length > 0 ? { baseUrl: entry.baseUrl } : {}),
        ...(typeof entry.temperature === "number" ? { temperature: entry.temperature } : {}),
        ...(entry.apiFormat === "chat" || entry.apiFormat === "responses" ? { apiFormat: entry.apiFormat } : {}),
        ...(typeof entry.stream === "boolean" ? { stream: entry.stream } : {}),
        ...(typeof entry.note === "string" ? { note: entry.note } : {}),
        ...(typeof entry.website === "string" ? { website: entry.website } : {}),
        ...(entry.protocol === "chat" || entry.protocol === "responses" || entry.protocol === "anthropic-messages"
          ? { protocol: entry.protocol }
          : {}),
        ...(typeof entry.authField === "string" ? { authField: entry.authField } : {}),
        ...(typeof entry.modelMain === "string" ? { modelMain: entry.modelMain } : {}),
        ...(typeof entry.modelHaiku === "string" ? { modelHaiku: entry.modelHaiku } : {}),
        ...(typeof entry.modelSonnet === "string" ? { modelSonnet: entry.modelSonnet } : {}),
        ...(typeof entry.modelOpus === "string" ? { modelOpus: entry.modelOpus } : {}),
      }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === "object")
      .map(([serviceId, value]) => normalizeServiceEntry(serviceId, value as Record<string, unknown>));
  }
  return [];
}

function mergeServiceConfig(existing: ServiceConfigEntry[], updates: ServiceConfigEntry[]): ServiceConfigEntry[] {
  const merged = new Map(existing.map((entry) => [serviceConfigKey(entry), entry]));
  for (const update of updates) {
    merged.set(serviceConfigKey(update), update);
  }
  return [...merged.values()];
}

async function loadRawConfig(root: string): Promise<Record<string, unknown>> {
  const configPath = join(root, "inkos.json");
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function saveRawConfig(root: string, config: Record<string, unknown>): Promise<void> {
  await writeFile(join(root, "inkos.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readEnvConfigSummary(path: string): Promise<EnvConfigSummary> {
  try {
    const raw = await readFile(path, "utf-8");
    const values = new Map<string, string>();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      values.set(key, value.trim());
    }
    const provider = values.get("INKOS_LLM_PROVIDER") ?? null;
    const baseUrl = values.get("INKOS_LLM_BASE_URL") ?? null;
    const model = values.get("INKOS_LLM_MODEL") ?? null;
    const apiKey = values.get("INKOS_LLM_API_KEY") ?? "";
    const detected = Boolean(provider || baseUrl || model || apiKey);
    return { detected, provider, baseUrl, model, hasApiKey: apiKey.length > 0 };
  } catch {
    return { detected: false, provider: null, baseUrl: null, model: null, hasApiKey: false };
  }
}

async function readEnvConfigStatus(root: string): Promise<EnvConfigStatus> {
  const project = await readEnvConfigSummary(join(root, ".env"));
  const global = await readEnvConfigSummary(GLOBAL_ENV_PATH);
  return {
    project,
    global,
    effectiveSource: project.detected ? "project" : global.detected ? "global" : null,
    runtimeUsesEnv: false,
  };
}

function formatServiceProbeError(args: {
  readonly service: string;
  readonly label?: string;
  readonly baseUrl: string;
  readonly model?: string;
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly error: string;
}): string {
  const rawDetail = args.error.replace(/\n\s*\(baseUrl:[\s\S]*?\)$/m, "").trim();
  const upstreamDetail = rawDetail.includes("上游详情：") ? rawDetail : "";
  const context = [
    `服务商：${args.label ?? args.service}`,
    `测试模型：${args.model ?? "未确定"}`,
    `协议：${args.apiFormat === "responses" ? "Responses" : "Chat / Completions"}${typeof args.stream === "boolean" ? `，${args.stream ? "流式" : "非流式"}` : ""}`,
    `Base URL：${args.baseUrl}`,
  ].join("\n");

  if (args.service === "google") {
    return [
      "Google Gemini 测试连接失败。",
      context,
      "",
      "请优先检查：",
      "1. API Key 是否来自 Google AI Studio 的 Gemini API key，而不是 OAuth、Vertex AI 或其它 Google 服务凭据。",
      "2. 该 key 所属项目是否已启用 Gemini API，并且没有被限制到其它 API、来源或服务。",
      "3. 当前地区/账号是否允许访问 Gemini API。",
      "4. 如果 key 曾经泄露，请在 AI Studio 重新生成后再保存。",
      upstreamDetail ? `\n上游返回：${upstreamDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  if (args.service === "moonshot" || args.service === "kimiCodingPlan" || args.service === "kimicode") {
    return [
      `${args.label ?? args.service} 测试连接失败。`,
      context,
      "",
      "请优先检查模型是否可用，以及 kimi-k2.x 这类模型是否需要 temperature=1。",
      rawDetail ? `\n上游返回：${rawDetail}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    `${args.label ?? args.service} 测试连接失败。`,
    context,
    "",
    "请检查 API Key、模型可用性、账号额度，以及协议类型是否匹配该服务商。",
    rawDetail ? `\n上游返回：${rawDetail}` : "",
  ].filter(Boolean).join("\n");
}

async function fetchModelsFromServiceBaseUrl(
  serviceId: string,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<{ models: Array<{ id: string; name: string }>; error?: string; authFailed?: boolean }> {
  const endpoint = isCustomServiceId(serviceId)
    ? undefined
    : getAllEndpoints().find((ep) => ep.id === serviceId);
  const modelsBaseUrl = isCustomServiceId(serviceId)
    ? baseUrl
    : endpoint?.modelsBaseUrl ?? (endpoint ? baseUrl : resolveServiceModelsBaseUrl(serviceId) ?? baseUrl);
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        models: [],
        error: `服务商返回 ${res.status}: ${body.slice(0, 200)}`,
        authFailed: res.status === 401 || res.status === 403,
      };
    }
    const json = await res.json() as { data?: Array<{ id: string }> };
    return { models: (json.data ?? []).map((m) => ({ id: m.id, name: m.id })) };
  } catch (error) {
    return { models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function buildProbePlans(
  preferredApiFormat: "chat" | "responses" | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: "chat" | "responses"; stream: boolean }> {
  const candidates: Array<{ apiFormat: "chat" | "responses"; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: "chat" | "responses", stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiFormat, stream });
  };
  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    push(preferredApiFormat, !(preferredStream ?? false));
  }
  const alternate = preferredApiFormat === "responses" ? "chat" : "responses";
  push(alternate, false);
  push(alternate, true);
  push("chat", false);
  push("chat", true);
  push("responses", false);
  push("responses", true);
  return candidates;
}

function buildModelCandidates(args: {
  preferredModel?: string;
  configModel?: string;
  envModel?: string | null;
  discoveredModels: Array<{ id: string; name: string }>;
  includeGenericFallbacks?: boolean;
}): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value.trim().length === 0) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };
  push(args.preferredModel);
  push(args.configModel);
  push(args.envModel ?? undefined);
  for (const model of args.discoveredModels) push(model.id);
  if (args.includeGenericFallbacks === false) return candidates;
  push("gpt-5.4");
  push("gpt-4o");
  push("claude-sonnet-4-6");
  push("MiniMax-M2.7");
  push("kimi-k2.5");
  return candidates;
}

async function probeServiceCapabilities(args: {
  root: string;
  service: string;
  apiKey: string;
  baseUrl: string;
  protocol?: "chat" | "responses" | "anthropic-messages";
  preferredApiFormat?: "chat" | "responses";
  preferredStream?: boolean;
  preferredModel?: string;
  proxyUrl?: string;
}): Promise<ServiceProbeResult> {
  const rawConfig = await loadRawConfig(args.root).catch(() => ({} as Record<string, unknown>));
  const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
  const envConfig = await readEnvConfigStatus(args.root);
  const envModel = envConfig.effectiveSource === "project"
    ? envConfig.project.model
    : envConfig.effectiveSource === "global"
      ? envConfig.global.model
      : null;

  const baseService = isCustomServiceId(args.service) ? "custom" : args.service;
  const modelsResponse = await fetchModelsFromServiceBaseUrl(baseService, args.baseUrl, args.apiKey, args.proxyUrl);
  if (modelsResponse.authFailed) {
    return { ok: false, models: [], error: modelsResponse.error ?? "API Key 无效或无权访问模型列表。" };
  }
  const discoveredModels = modelsResponse.models;
  const endpoint = getAllEndpoints().find((ep) => ep.id === baseService);
  const preset = resolveServicePreset(baseService);
  const discoveredFirstModel =
    discoveredModels.find((model) => isTextChatModelId(model.id))?.id
    ?? discoveredModels[0]?.id;
  const serviceFirstModel =
    discoveredFirstModel
    ?? endpoint?.checkModel
    ?? preset?.knownModels?.[0]
    ?? endpoint?.models.find((model) => model.enabled !== false)?.id;
  const useDynamicLocalModels = baseService === "ollama";
  const useEndpointCheckModel = !useDynamicLocalModels
    && !isCustomServiceId(args.service)
    && discoveredModels.length === 0
    && Boolean(endpoint?.checkModel);
  const configService = typeof llm.service === "string" ? llm.service : undefined;
  const configModel = !useEndpointCheckModel && configService === args.service
    ? typeof llm.defaultModel === "string"
      ? llm.defaultModel
      : typeof llm.model === "string" ? llm.model : undefined
    : undefined;
  const useCustomFallbacks = isCustomServiceId(args.service);
  const useAnthropicMessagesProtocol = args.protocol === "anthropic-messages" || args.baseUrl.includes("/anthropic");
  const providerFamily = useAnthropicMessagesProtocol
    ? "anthropic"
    : (resolveServiceProviderFamily(baseService) ?? "openai");
  const modelCandidates = buildModelCandidates({
    preferredModel: args.preferredModel ?? serviceFirstModel,
    configModel,
    envModel: useCustomFallbacks ? envModel : undefined,
    discoveredModels: useEndpointCheckModel ? [] : discoveredModels,
    includeGenericFallbacks: useCustomFallbacks,
  });

  if (modelCandidates.length === 0) {
    return { ok: false, models: [], error: "无法自动确定模型，请先填写可用模型或提供支持 /models 的服务端点。" };
  }

  let lastError = modelsResponse.error ?? "自动探测失败";

  for (const model of modelCandidates) {
    for (const plan of buildProbePlans(args.preferredApiFormat, args.preferredStream)) {
      const client = createLLMClient({
        provider: providerFamily,
        service: baseService,
        configSource: "studio",
        baseUrl: args.baseUrl,
        apiKey: args.apiKey.trim(),
        model,
        temperature: 0.7,
        thinkingBudget: 0,
        proxyUrl: args.proxyUrl,
        apiFormat: plan.apiFormat,
        stream: plan.stream,
      } as ProjectConfig["llm"]);

      try {
        await chatCompletion(client, model, [{ role: "user", content: "ping" }], { maxTokens: 2048 });
        const models = discoveredModels.length > 0
          ? discoveredModels
          : endpoint?.models
            .filter((m) => m.enabled !== false)
            .filter((m) => isTextChatModelId(m.id))
            .map((m) => ({ id: m.id, name: m.id }))
            ?? preset?.knownModels?.map((id) => ({ id, name: id }))
            ?? [{ id: model, name: model }];
        return {
          ok: true,
          models,
          selectedModel: model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          baseUrl: args.baseUrl,
          modelsSource: discoveredModels.length > 0 ? "api" : "fallback",
        };
      } catch (error) {
        lastError = formatServiceProbeError({
          service: baseService,
          label: endpoint?.label ?? preset?.label,
          baseUrl: args.baseUrl,
          model,
          apiFormat: plan.apiFormat,
          stream: plan.stream,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { ok: false, models: discoveredModels, error: lastError };
}

// --- Server factory ---

export function createStudioServer(initialConfig: ProjectConfig, root: string) {
  const app = new Hono();
  const state = new StateManager(root);
  let cachedConfig = initialConfig;

  // Reset stale "running" pipeline states on server startup
  (async () => {
    try {
      const papers = await state.listPapers();
      for (const p of papers) {
        try {
          const ps = await state.loadPipelineState(p.id);
          if (ps.status === "running") {
            await state.savePipelineState(p.id, { ...ps, status: "error", error: "Server restarted — pipeline interrupted" });
          }
        } catch { /* no pipeline state for this paper */ }
      }
    } catch { /* paper listing failed */ }
  })();

  app.use("/*", cors());

  // Structured error handler
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LLM API key not set") || message.includes("INKOS_LLM_API_KEY not set")) {
      return c.json({ error: { code: "LLM_CONFIG_ERROR", message } }, 400);
    }
    console.error("[studio] Unexpected server error", error);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } }, 500);
  });

  // Paper ID validation middleware
  app.use("/api/v1/papers/:id/*", async (c, next) => {
    const paperId = c.req.param("id");
    if (!isSafeBookId(paperId)) {
      throw new ApiError(400, "INVALID_PAPER_ID", `Invalid paper ID: "${paperId}"`);
    }
    await next();
  });
  app.use("/api/v1/papers/:id", async (c, next) => {
    const paperId = c.req.param("id");
    if (!isSafeBookId(paperId)) {
      throw new ApiError(400, "INVALID_PAPER_ID", `Invalid paper ID: "${paperId}"`);
    }
    await next();
  });

  // Logger sinks
  const sseSink: LogSink = {
    write(entry: LogEntry): void {
      broadcast("log", { level: entry.level, tag: entry.tag, message: entry.message });
    },
  };

  const consoleSink: LogSink = {
    write(entry: LogEntry): void {
      const prefix = `[${entry.tag}]`;
      if (entry.level === "warn") console.warn(prefix, entry.message);
      else if (entry.level === "error") console.error(prefix, entry.message);
      else console.log(prefix, entry.message);
    },
  };

  async function loadCurrentProjectConfig(
    options?: { readonly requireApiKey?: boolean; readonly cli?: LLMConfigCliOverrides },
  ): Promise<ProjectConfig> {
    const freshConfig = await loadProjectConfig(root, { ...options, consumer: "studio" });
    if (!options?.cli) {
      cachedConfig = freshConfig;
    }
    return freshConfig;
  }

  // --- Session helpers ---

  const sessionsDir = join(root, ".inkos", "sessions");

  async function ensureSessionsDir(): Promise<void> {
    await mkdir(sessionsDir, { recursive: true });
  }

  function sessionPath(sessionId: string): string {
    return join(sessionsDir, `${sessionId}.json`);
  }

  async function loadSession(sessionId: string): Promise<SessionRecord | null> {
    try {
      const raw = await readFile(sessionPath(sessionId), "utf-8");
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  async function saveSession(record: SessionRecord): Promise<void> {
    await ensureSessionsDir();
    await writeFile(sessionPath(record.sessionId), JSON.stringify(record, null, 2), "utf-8");
  }

  async function listSessions(bookId?: string | null): Promise<SessionSummary[]> {
    await ensureSessionsDir();
    try {
      const files = await readdir(sessionsDir);
      const summaries: SessionSummary[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(sessionsDir, file), "utf-8");
          const record = JSON.parse(raw) as SessionRecord;
          if (bookId !== undefined && bookId !== null) {
            if (record.bookId !== bookId) continue;
          }
          summaries.push({
            sessionId: record.sessionId,
            bookId: record.bookId,
            title: record.title,
            messageCount: record.messages.length,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
        } catch { /* skip corrupt files */ }
      }
      summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      return summaries;
    } catch {
      return [];
    }
  }

  async function deleteSessionFile(sessionId: string): Promise<void> {
    try {
      await unlink(sessionPath(sessionId));
    } catch { /* ignore */ }
  }

  // ===========================================================================
  // PAPER ENDPOINTS
  // ===========================================================================

  // --- Paper CRUD ---

  app.get("/api/v1/papers", async (c) => {
    const papers = await state.listPapers();
    return c.json({ papers });
  });

  app.post("/api/v1/papers", async (c) => {
    const body = await c.req.json<{
      title: string;
      major: string;
      degreeLevel?: string;
      proposalText?: string;
      references?: Array<Record<string, unknown>>;
      targetWordCount?: number;
      citationFormat?: string;
      language?: string;
    }>();

    if (!body.title?.trim()) {
      throw new ApiError(400, "INVALID_INPUT", "Title is required");
    }
    if (!body.major?.trim()) {
      throw new ApiError(400, "INVALID_INPUT", "Major is required");
    }

    const paperId = derivePaperIdFromTitle(body.title.trim());
    const now = new Date().toISOString();

    const paperConfig: PaperConfig = {
      id: paperId,
      title: body.title.trim(),
      major: body.major.trim(),
      degreeLevel: (body.degreeLevel as PaperConfig["degreeLevel"]) ?? "undergraduate",
      proposalText: body.proposalText ?? "",
      references: (body.references ?? []).map((r, i) => ({
        id: r.id as string ?? `ref-${i + 1}`,
        type: (r.type as PaperConfig["references"][0]["type"]) ?? "other",
        title: (r.title as string) ?? "",
        authors: (r.authors as string[]) ?? [],
        year: (r.year as number) ?? new Date().getFullYear(),
        journal: r.journal as string | undefined,
        volume: r.volume as string | undefined,
        issue: r.issue as string | undefined,
        pages: r.pages as string | undefined,
        doi: r.doi as string | undefined,
        url: r.url as string | undefined,
        rawCitation: (r.rawCitation as string) ?? (r.title as string) ?? "",
      })),
      targetWordCount: body.targetWordCount ?? 20000,
      citationFormat: (body.citationFormat as PaperConfig["citationFormat"]) ?? "gb7714",
      language: (body.language === "en" ? "en" : "zh") as "zh" | "en",
      createdAt: now,
      updatedAt: now,
    };

    await state.createPaper(paperConfig);
    broadcast("paper:created", { paperId, title: paperConfig.title });
    return c.json(paperConfig, 201);
  });

  app.get("/api/v1/papers/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const paper = await state.loadPaperConfig(id);
      return c.json(paper);
    } catch {
      return c.json({ error: `Paper "${id}" not found` }, 404);
    }
  });

  app.delete("/api/v1/papers/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await state.deletePaper(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: `Paper "${id}" not found` }, 404);
    }
  });

  app.post("/api/v1/papers/:id/delete", async (c) => {
    const id = c.req.param("id");
    try {
      await state.deletePaper(id);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: `Paper "${id}" not found` }, 404);
    }
  });

  // --- Paper pipeline ---

  app.get("/api/v1/papers/:id/pipeline/status", async (c) => {
    const id = c.req.param("id");
    try {
      const pipelineState = await state.loadPipelineState(id);
      return c.json(pipelineState);
    } catch {
      return c.json({ stage: "idle" });
    }
  });

  function buildAgentContext(config: ProjectConfig, paperId: string): AgentContext {
    return {
      client: createLLMClient(config.llm),
      model: config.llm.model,
      projectRoot: root,
    };
  }

  function buildRunnerOptions(
    paperId: string,
    config: ProjectConfig,
    overrides?: Partial<{ onEvent: (event: import("@actalk/inkos-core").PipelineEvent) => void }>,
  ): import("@actalk/inkos-core").PaperRunnerOptions {
    return {
      paperId,
      context: buildAgentContext(config, paperId),
      stateManager: state,
      aiDetectionMode: (config.aiDetectionMode as "free" | "paid") ?? "free",
      onEvent: overrides?.onEvent,
    };
  }

  app.post("/api/v1/papers/:id/pipeline/start", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => {
        broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message, data: event.data });
      },
    });

    runner.run(options).then(
      () => broadcast("paper:pipeline-done", { paperId: id }),
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id });
  });

  app.post("/api/v1/papers/:id/pipeline/reset", async (c) => {
    const id = c.req.param("id");
    try {
      // Clear saved sections (state/sections/)
      const sectionsDir = join(root, "papers", id, "state", "sections");
      try {
        const files = await readdir(sectionsDir);
        await Promise.all(files.map((f) => unlink(join(sectionsDir, f))));
      } catch { /* no sections yet */ }

      // Clear outline (state/outline.json)
      try { await unlink(join(root, "papers", id, "state", "outline.json")); } catch { /* no outline */ }

      // Clear innovation points (state/innovation_points.json)
      try { await unlink(join(root, "papers", id, "state", "innovation_points.json")); } catch { /* no innovations */ }

      // Clear references (state/references.json)
      try { await unlink(join(root, "papers", id, "state", "references.json")); } catch { /* no refs */ }

      // Clear pipeline state (runtime/pipeline_state.json)
      try { await unlink(join(root, "papers", id, "runtime", "pipeline_state.json")); } catch { /* no pipeline state */ }

      broadcast("paper:reset", { paperId: id });
      return c.json({ ok: true, paperId: id });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/pipeline/brainstorm", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message }),
    });

    runner.runBrainstormOnly(options).then(
      (result) => broadcast("paper:stage-complete", { paperId: id, stage: "brainstorm", result }),
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, stage: "brainstorm", error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, stage: "brainstorm" });
  });

  app.post("/api/v1/papers/:id/pipeline/search-literature", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message }),
    });

    runner.runLiteratureSearchOnly(options).then(
      () => {
        broadcast("paper:stage-complete", { paperId: id, stage: "literature-search" });
        broadcast("literature:updated", { paperId: id });
      },
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, stage: "literature-search", error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, stage: "literature-search" });
  });

  app.post("/api/v1/papers/:id/pipeline/outline", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message }),
    });

    runner.runOutlineOnly(options).then(
      () => broadcast("paper:stage-complete", { paperId: id, stage: "outline" }),
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, stage: "outline", error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, stage: "outline" });
  });

  // Direct outline generation via OutlineAgent (synchronous, returns outline)
  app.post("/api/v1/papers/:id/generate-outline", async (c) => {
    const id = c.req.param("id");
    try {
      const paper = await state.loadPaperConfig(id);
      const config = await loadCurrentProjectConfig();
      const agentCtx = buildAgentContext(config, id);

      const innovationPoints = await state.loadInnovationPoints(id).catch(() => []);
      const references = await state.loadReferences(id).catch(() => []);

      const agent = new OutlineAgent(agentCtx);
      broadcast("paper:stage-start", { paperId: id, stage: "outline", message: "正在生成大纲…" });

      const result = await agent.generate({
        topic: paper.title,
        major: paper.major,
        degreeLevel: paper.degreeLevel,
        proposalText: paper.proposalText,
        targetWordCount: paper.targetWordCount,
        language: paper.language,
        innovationPoints: innovationPoints.length > 0 ? innovationPoints : undefined,
        referenceCount: references.length || undefined,
      });

      const now = new Date().toISOString();
      await state.saveOutline(id, {
        paperId: id,
        title: paper.title,
        sections: result.sections,
        totalWordCount: result.sections.reduce((sum, s) => sum + (s.wordCount ?? 0), 0),
        createdAt: now,
        updatedAt: now,
      });
      broadcast("paper:stage-complete", {
        paperId: id,
        stage: "outline",
        message: `大纲生成完成 — ${result.sections.length} 个章节`,
        data: { sectionCount: result.sections.length },
      });

      return c.json({
        sections: result.sections,
        structureRationale: result.structureRationale,
      });
    } catch (e) {
      broadcast("paper:stage-error", {
        paperId: id,
        stage: "outline",
        error: e instanceof Error ? e.message : String(e),
      });
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/pipeline/write", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message, data: event.data }),
    });

    runner.runWritingOnly(options).then(
      () => broadcast("paper:stage-complete", { paperId: id, stage: "writing" }),
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, stage: "writing", error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, stage: "writing" });
  });

  app.post("/api/v1/papers/:id/pipeline/polish", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config, {
      onEvent: (event) => broadcast(`paper:${event.type}`, { paperId: id, stage: event.stage, message: event.message }),
    });

    runner.runPolishOnly(options).then(
      () => broadcast("paper:stage-complete", { paperId: id, stage: "polish" }),
      (e: unknown) => broadcast("paper:stage-error", { paperId: id, stage: "polish", error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, stage: "polish" });
  });

  app.post("/api/v1/papers/:id/pipeline/export", async (c) => {
    const id = c.req.param("id");
    try {
      const paper = await state.loadPaperConfig(id);
      const sections = await state.listSections(id);
      const outline = await state.loadOutline(id).catch(() => []);
      const references = await state.loadReferences(id);
      const exporter = new WordExporter();
      const result = await exporter.export({
        paperId: id,
        title: paper.title,
        major: paper.major,
        language: paper.language,
        citationFormat: paper.citationFormat,
        sections,
        outline: outline as never,
        references,
        outputDir: join(root, "papers", id, "exports"),
      });
      broadcast("paper:stage-complete", { paperId: id, stage: "format-export", result });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Paper sections ---

  app.get("/api/v1/papers/:id/sections", async (c) => {
    const id = c.req.param("id");
    try {
      const sections = await state.listSections(id);
      return c.json({ sections });
    } catch {
      return c.json({ sections: [] });
    }
  });

  app.get("/api/v1/papers/:id/sections/:num", async (c) => {
    const id = c.req.param("id");
    const num = c.req.param("num");
    try {
      const section = await state.loadSection(id, num);
      return c.json(section);
    } catch {
      return c.json({ error: "Section not found" }, 404);
    }
  });

  app.put("/api/v1/papers/:id/sections/:num", async (c) => {
    const id = c.req.param("id");
    const num = c.req.param("num");
    const body = await c.req.json<{ content: string }>();
    try {
      await state.saveSection(id, {
        sectionNumber: num,
        title: "",
        content: body.content ?? "",
        wordCount: (body.content ?? "").length,
        status: "drafted",
        aiDetectionLog: [],
        citations: [],
        lastModified: new Date().toISOString(),
      });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/sections/:num/regenerate", async (c) => {
    const id = c.req.param("id");
    const num = c.req.param("num");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));

    runner.regenerateSection(id, num, state).then(
      (result) => broadcast("section:regenerated", { paperId: id, sectionNumber: num, result }),
      (e: unknown) => broadcast("section:error", { paperId: id, sectionNumber: num, error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id, sectionNumber: num });
  });

  // --- Paper detection ---

  app.post("/api/v1/papers/:id/detect/:section", async (c) => {
    const id = c.req.param("id");
    const sectionNum = c.req.param("section");
    const config = await loadCurrentProjectConfig();

    try {
      const section = await state.loadSection(id, sectionNum);
      const { AIDetectionAuditor } = await import("@actalk/inkos-core");
      const auditor = new AIDetectionAuditor({
        client: createLLMClient(config.llm),
        model: config.llm.model,
        projectRoot: root,
      });
      const result = await auditor.audit({
        content: section.content,
        sectionNumber: sectionNum,
        language: "zh",
        mode: (config.aiDetectionMode === "off" ? "free" : config.aiDetectionMode) as "free" | "paid",
      });
      broadcast("section:detection", { paperId: id, sectionNumber: sectionNum, score: result.score });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/detect-all", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config);

    runner.runDetectionAll(options).then(
      (result) => broadcast("paper:detection-complete", { paperId: id, result }),
      (e: unknown) => broadcast("paper:detection-error", { paperId: id, error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id });
  });

  app.post("/api/v1/papers/:id/reduce-ai/:section", async (c) => {
    const id = c.req.param("id");
    const sectionNum = c.req.param("section");
    const config = await loadCurrentProjectConfig();

    try {
      const section = await state.loadSection(id, sectionNum);
      const { AIReductionReviser } = await import("@actalk/inkos-core");
      const reviser = new AIReductionReviser({
        client: createLLMClient(config.llm),
        model: config.llm.model,
        projectRoot: root,
      });
      const innovations = await state.loadInnovationPoints(id).catch(() => []);
      const result = await reviser.revise({
        content: section.content,
        sectionNumber: sectionNum,
        detectionScore: section.aiDetectionScore ?? 0.5,
        flaggedPassages: [],
        language: "zh",
        innovationPoints: innovations.map((p) => ({ id: p.id, description: p.description })),
        maxIterations: 3,
      });
      broadcast("section:reduction", { paperId: id, sectionNumber: sectionNum, score: result.newScore });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/reduce-ai-all", async (c) => {
    const id = c.req.param("id");
    const config = await loadCurrentProjectConfig();

    const runner = new PaperRunner(buildAgentContext(config, id));
    const options = buildRunnerOptions(id, config);

    runner.runReduceAll(options).then(
      (result) => broadcast("paper:reduction-complete", { paperId: id, result }),
      (e: unknown) => broadcast("paper:reduction-error", { paperId: id, error: e instanceof Error ? e.message : String(e) }),
    );

    return c.json({ status: "started", paperId: id });
  });

  app.get("/api/v1/papers/:id/detection-stats", async (c) => {
    const id = c.req.param("id");
    try {
      const stats = await state.loadAIDetectionLog(id);
      return c.json({ stats });
    } catch {
      return c.json({ stats: [] });
    }
  });

  // --- Paper references (literature) ---

  app.get("/api/v1/papers/:id/references", async (c) => {
    const id = c.req.param("id");
    try {
      const refs = await state.loadReferences(id);
      return c.json({ references: refs });
    } catch {
      return c.json({ references: [] });
    }
  });

  app.post("/api/v1/papers/:id/references", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>();
    try {
      const existing = await state.loadReferences(id);
      const typeVal = (body.type as string) ?? "other";
      const refType: "journal" | "book" | "conference" | "thesis" | "other" =
        ["journal", "book", "conference", "thesis", "other"].includes(typeVal)
          ? (typeVal as "journal" | "book" | "conference" | "thesis" | "other")
          : "other";
      const newRef = {
        id: `ref-${Date.now()}`,
        type: refType,
        title: (body.title as string) ?? "",
        authors: (body.authors as string[]) ?? [],
        year: (body.year as number) ?? new Date().getFullYear(),
        journal: body.journal as string | undefined,
        volume: body.volume as string | undefined,
        issue: body.issue as string | undefined,
        pages: body.pages as string | undefined,
        doi: body.doi as string | undefined,
        url: body.url as string | undefined,
        rawCitation: (body.rawCitation as string) ?? (body.title as string) ?? "",
      };
      await state.saveReferences(id, [...existing, newRef]);
      return c.json(newRef, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.put("/api/v1/papers/:id/references/:refId", async (c) => {
    const id = c.req.param("id");
    const refId = c.req.param("refId");
    const body = await c.req.json<Record<string, unknown>>();
    try {
      const existing = await state.loadReferences(id);
      const updated = existing.map((r) =>
        r.id === refId ? { ...r, ...body, id: refId } : r,
      );
      await state.saveReferences(id, updated);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.delete("/api/v1/papers/:id/references/:refId", async (c) => {
    const id = c.req.param("id");
    const refId = c.req.param("refId");
    try {
      const existing = await state.loadReferences(id);
      await state.saveReferences(id, existing.filter((r) => r.id !== refId));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Paper outline ---

  app.get("/api/v1/papers/:id/outline", async (c) => {
    const id = c.req.param("id");
    try {
      const outline = await state.loadOutline(id);
      return c.json(outline);
    } catch {
      return c.json({ error: "Outline not found" }, 404);
    }
  });

  app.put("/api/v1/papers/:id/outline", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<Record<string, unknown>>();
    try {
      await state.saveOutline(id, body as never);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Paper export ---

  app.post("/api/v1/papers/:id/export/:format", async (c) => {
    const id = c.req.param("id");
    const format = c.req.param("format");
    try {
      const paper = await state.loadPaperConfig(id);
      const sections = await state.listSections(id);
      const outline = await state.loadOutline(id).catch(() => []);
      const references = await state.loadReferences(id);
      const exporter = new WordExporter();
      const result = await exporter.export({
        paperId: id,
        title: paper.title,
        major: paper.major,
        language: paper.language,
        citationFormat: paper.citationFormat,
        sections,
        outline: outline as never,
        references,
        outputDir: join(root, "papers", id, "exports"),
      });
      if (format === "docx") {
        const buf = await readFile(result.filePath);
        const meta = Buffer.from(
          JSON.stringify({ filePath: result.filePath, fileName: result.fileName, totalPages: result.totalPages }),
          "utf-8",
        ).toString("base64");
        const safeName = /^[\w.\- ()\u4e00-\u9fff]+\.docx$/i.test(result.fileName)
          ? result.fileName
          : `${paper.title.replace(/[^\w\u4e00-\u9fff\-]+/g, "_").slice(0, 80) || "paper"}.docx`;
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="paper.docx"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
            "X-Inkos-Export-Meta": meta,
            "Cache-Control": "no-store",
          },
        });
      }
      return c.json({ format, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.patch("/api/v1/papers/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      proposalText?: string;
      title?: string;
      major?: string;
      degreeLevel?: PaperConfig["degreeLevel"];
      targetWordCount?: number;
      citationFormat?: PaperConfig["citationFormat"];
      language?: "zh" | "en";
    }>();
    try {
      const paper = await state.loadPaperConfig(id);
      const now = new Date().toISOString();
      const next: PaperConfig = {
        ...paper,
        ...(typeof body.proposalText === "string" ? { proposalText: body.proposalText } : {}),
        ...(typeof body.title === "string" && body.title.trim() ? { title: body.title.trim() } : {}),
        ...(typeof body.major === "string" && body.major.trim() ? { major: body.major.trim() } : {}),
        ...(typeof body.targetWordCount === "number" && body.targetWordCount >= 1000
          ? { targetWordCount: body.targetWordCount }
          : {}),
        ...(body.citationFormat === "gb7714" || body.citationFormat === "apa" || body.citationFormat === "mla" || body.citationFormat === "chicago"
          ? { citationFormat: body.citationFormat }
          : {}),
        ...(body.language === "zh" || body.language === "en" ? { language: body.language } : {}),
        ...(body.degreeLevel === "undergraduate" || body.degreeLevel === "master" || body.degreeLevel === "doctor"
          ? { degreeLevel: body.degreeLevel }
          : {}),
        updatedAt: now,
      };
      await state.savePaperConfig(next);
      return c.json(next);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/v1/papers/:id/proposal-from-docx", async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new ApiError(400, "INVALID_INPUT", "Word file is required");
    }
    const MAX_PROPOSAL = 80_000;
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const tmpDir = join(root, ".inkos", "tmp");
      await mkdir(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, `proposal-${taskId}-${file.name}`);
      await writeFile(tmpPath, new Uint8Array(await file.arrayBuffer()));
      const { WordImporter } = await import("@actalk/inkos-core");
      const importer = new WordImporter();
      const paper = await state.loadPaperConfig(id);
      const result = await importer.importDocument({ filePath: tmpPath, language: paper.language });
      await unlink(tmpPath).catch(() => {});
      const chunks = result.document.sections.map((s) => [s.title, s.content].filter(Boolean).join("\n\n"));
      let merged = chunks.join("\n\n").trim();
      if (merged.length > MAX_PROPOSAL) {
        merged = `${merged.slice(0, MAX_PROPOSAL)}\n\n…（已截断至 ${MAX_PROPOSAL} 字）`;
      }
      const now = new Date().toISOString();
      const next: PaperConfig = { ...paper, proposalText: merged, updatedAt: now };
      await state.savePaperConfig(next);
      return c.json({ ok: true, paper: next, summary: result.summary, taskId });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/v1/papers/:id/export/preview", async (c) => {
    const id = c.req.param("id");
    try {
      const paper = await state.loadPaperConfig(id);
      const outline = await state.loadOutline(id).catch(() => null);
      return c.json({ paper, outline });
    } catch {
      return c.json({ error: "Paper not found" }, 404);
    }
  });

  // --- Paper innovations ---

  app.get("/api/v1/papers/:id/innovations", async (c) => {
    const id = c.req.param("id");
    try {
      const points = await state.loadInnovationPoints(id);
      return c.json({ innovations: points });
    } catch {
      return c.json({ innovations: [] });
    }
  });

  app.put("/api/v1/papers/:id/innovations/:pointId", async (c) => {
    const id = c.req.param("id");
    const pointId = c.req.param("pointId");
    const body = await c.req.json<Record<string, unknown>>();
    try {
      const points = await state.loadInnovationPoints(id);
      const updated = points.map((p) =>
        p.id === pointId ? { ...p, ...body, id: pointId } : p,
      );
      await state.saveInnovationPoints(id, updated);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Paper word import ---

  app.post("/api/v1/papers/:id/import-word", async (c) => {
    const id = c.req.param("id");
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      throw new ApiError(400, "INVALID_INPUT", "Word file is required");
    }

    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    broadcast("word:import-progress", { paperId: id, taskId, fileName: file.name, percent: 0 });

    try {
      // Save uploaded file to temp location for WordImporter to read
      const tmpDir = join(root, ".inkos", "tmp");
      await mkdir(tmpDir, { recursive: true });
      const tmpPath = join(tmpDir, `import-${taskId}-${file.name}`);
      await writeFile(tmpPath, new Uint8Array(await file.arrayBuffer()));

      const { WordImporter } = await import("@actalk/inkos-core");
      const importer = new WordImporter();
      const paper = await state.loadPaperConfig(id);
      const result = await importer.importDocument({ filePath: tmpPath, language: paper.language });

      // Clean up temp file
      await unlink(tmpPath).catch(() => {});
      broadcast("word:import-progress", { paperId: id, taskId, fileName: file.name, percent: 100 });
      broadcast("word:import-complete", { paperId: id, taskId, result });
      return c.json({ taskId, ...result });
    } catch (e) {
      broadcast("word:import-error", { paperId: id, taskId, error: e instanceof Error ? e.message : String(e) });
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // ===========================================================================
  // SSE EVENTS
  // ===========================================================================

  app.get("/api/v1/events", (c) => {
    return streamSSE(c, async (stream) => {
      const handler: EventHandler = (event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      subscribers.add(handler);

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "{}" });
      }, 15000);

      stream.onAbort(() => {
        clearInterval(keepAlive);
        subscribers.delete(handler);
      });

      // Wait indefinitely
      await new Promise(() => {});
    });
  });

  // ===========================================================================
  // SERVICES ENDPOINTS
  // ===========================================================================

  app.get("/api/v1/services", async (c) => {
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    const env = await readEnvConfigStatus(root);
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const rawServices = normalizeServiceConfig(llm.services);
    const secrets = await loadSecrets(root);
    const secretKeys = Object.keys(secrets.services);
    const projectHasSecrets = secretKeys.length > 0;

    const serviceConfigs = rawServices.length > 0
      ? rawServices
      : getAllEndpoints().map((ep) => {
          const hasApiKey = Boolean(secrets.services[ep.id]) || isApiKeyOptionalForEndpoint({ provider: ep.id, baseUrl: ep.baseUrl });
          return {
            service: ep.id,
            name: ep.label ?? ep.id,
            baseUrl: ep.baseUrl,
            models: ep.models.filter((m) => m.enabled !== false).map((m) => m.id),
            hasApiKey,
          };
        });

    return c.json({
      services: serviceConfigs.map((entry) => ({
        ...entry,
        hasApiKey: Boolean(secrets.services[entry.service]) || isApiKeyOptionalForEndpoint({ provider: entry.service }),
      })),
      env,
    });
  });

  app.get("/api/v1/services/config", async (c) => {
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const services = normalizeServiceConfig(llm.services);
    const service = typeof llm.service === "string" && llm.service.length > 0 ? llm.service : null;
    const defaultModel = typeof llm.defaultModel === "string" && llm.defaultModel.length > 0
      ? llm.defaultModel
      : typeof llm.model === "string" && llm.model.length > 0 ? llm.model : null;
    return c.json({ service, defaultModel, services });
  });

  app.put("/api/v1/services/config", async (c) => {
    const body = await c.req.json<{ service?: string; defaultModel?: string; services?: ServiceConfigEntry[] }>();
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    const llm = (rawConfig.llm as Record<string, unknown> | undefined) ?? {};
    const existing = normalizeServiceConfig(llm.services);
    const updated = body.services ? mergeServiceConfig(existing, body.services) : existing;

    const nextLlm: Record<string, unknown> = { ...llm, services: updated };
    if (body.service) nextLlm.service = body.service;
    if (body.defaultModel) nextLlm.defaultModel = body.defaultModel;

    await saveRawConfig(root, {
      ...rawConfig,
      llm: nextLlm,
    });

    modelListCache.clear();
    const service = body.service ?? (typeof llm.service === "string" && llm.service.length > 0 ? llm.service : null);
    const defaultModel = body.defaultModel ?? (typeof llm.defaultModel === "string" && llm.defaultModel.length > 0
      ? llm.defaultModel
      : typeof llm.model === "string" && llm.model.length > 0 ? llm.model : null);
    return c.json({ service, defaultModel, services: updated });
  });

  app.post("/api/v1/services/:service/test", async (c) => {
    const serviceId = c.req.param("service");
    const endpoint = isCustomServiceId(serviceId)
      ? undefined
      : getAllEndpoints().find((ep) => ep.id === serviceId);
    const body = await c.req.json<{
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      protocol?: "chat" | "responses" | "anthropic-messages";
      apiFormat?: "chat" | "responses";
      stream?: boolean;
      proxyUrl?: string;
    }>();

    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    const deepseekClaudeCompat = serviceId === "deepseek" ? "https://api.deepseek.com/anthropic" : undefined;
    const baseUrl = body.baseUrl?.trim() || deepseekClaudeCompat || endpoint?.baseUrl || currentConfig.llm.baseUrl;
    const apiKey = body.apiKey?.trim() || currentConfig.llm.apiKey;
    const model = body.model?.trim()
      || endpoint?.checkModel
      || endpoint?.models.find((m) => m.enabled !== false)?.id
      || currentConfig.llm.model;

    const probe = await probeServiceCapabilities({
      root,
      service: serviceId,
      apiKey,
      baseUrl,
      protocol: body.protocol,
      preferredApiFormat: body.protocol === "anthropic-messages"
        ? "chat"
        : (body.apiFormat ?? currentConfig.llm.apiFormat),
      preferredStream: body.stream ?? currentConfig.llm.stream,
      preferredModel: model,
      proxyUrl: body.proxyUrl ?? currentConfig.llm.proxyUrl,
    });

    return c.json(probe);
  });

  app.put("/api/v1/services/:service/secret", async (c) => {
    const serviceId = c.req.param("service");
    const body = await c.req.json<{ apiKey: string }>();
    const secrets = await loadSecrets(root);
    secrets.services[serviceId] = { apiKey: body.apiKey };
    await saveSecrets(root, secrets);
    modelListCache.delete(serviceId);
    return c.json({ ok: true });
  });

  app.get("/api/v1/services/:service/secret", async (c) => {
    const serviceId = c.req.param("service");
    const secrets = await loadSecrets(root);
    const raw = secrets.services[serviceId]?.apiKey;
    const hasKey = Boolean(raw && raw.trim().length > 0);
    return c.json({
      hasKey,
      apiKey: hasKey ? String(raw) : "",
      keyPreview: hasKey ? maskApiKeyForPreview(String(raw)) : null,
    });
  });

  app.get("/api/v1/services/models", async (c) => {
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    const models = await listModelsForService(currentConfig.llm.service);
    return c.json({ models: models.map((m) => ({ id: m.id, name: m.id })) });
  });

  app.get("/api/v1/services/models/custom", async (c) => {
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    const secrets = await loadSecrets(root);
    const apiKey = secrets.services[currentConfig.llm.service]?.apiKey ?? currentConfig.llm.apiKey;

    if (!apiKey) {
      return c.json({ models: [], error: "No API key configured" });
    }

    const cacheKey = `custom:${currentConfig.llm.service}:${currentConfig.llm.baseUrl}`;
    const cached = modelListCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < 300_000) {
      return c.json({ models: cached.models, cached: true });
    }

    const result = await fetchModelsFromServiceBaseUrl(
      currentConfig.llm.service,
      currentConfig.llm.baseUrl,
      apiKey,
      currentConfig.llm.proxyUrl,
    );

    if (result.models.length > 0) {
      modelListCache.set(cacheKey, { models: result.models, at: Date.now() });
    }

    return c.json({ models: result.models, error: result.error });
  });

  app.get("/api/v1/services/:service/models", async (c) => {
    const serviceId = c.req.param("service");
    const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
    const secrets = await loadSecrets(root);
    const apiKey = secrets.services[serviceId]?.apiKey ?? currentConfig.llm.apiKey;
    const endpoint = isCustomServiceId(serviceId)
      ? undefined
      : getAllEndpoints().find((ep) => ep.id === serviceId);

    const cached = modelListCache.get(serviceId);
    if (cached && (Date.now() - cached.at) < 300_000) {
      return c.json({ models: cached.models, cached: true });
    }

    const endpointBase = endpoint?.baseUrl ?? currentConfig.llm.baseUrl;
    const result = await fetchModelsFromServiceBaseUrl(serviceId, endpointBase, apiKey, currentConfig.llm.proxyUrl);

    if (result.models.length > 0) {
      modelListCache.set(serviceId, { models: result.models, at: Date.now() });
    }

    return c.json({ models: result.models, error: result.error });
  });

  // ===========================================================================
  // PROJECT ENDPOINTS
  // ===========================================================================

  app.get("/api/v1/project", async (c) => {
    const config = await loadCurrentProjectConfig({ requireApiKey: false });
    return c.json(config);
  });

  app.put("/api/v1/project", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));

    const updated = { ...rawConfig };
    if (body.llm) updated.llm = { ...(rawConfig.llm as Record<string, unknown> ?? {}), ...(body.llm as Record<string, unknown>) };
    if (body.notify !== undefined) updated.notify = body.notify;
    if (body.detection !== undefined) updated.detection = body.detection;
    if (body.aiDetectionMode !== undefined) updated.aiDetectionMode = body.aiDetectionMode;
    if (body.language !== undefined) updated.language = body.language;
    if (body.modelOverrides !== undefined) updated.modelOverrides = body.modelOverrides;
    if (body.qualityGates !== undefined) updated.qualityGates = body.qualityGates;

    await saveRawConfig(root, updated);
    cachedConfig = await loadProjectConfig(root, { consumer: "studio" });
    modelListCache.clear();
    broadcast("project:updated", {});
    return c.json({ ok: true });
  });

  app.get("/api/v1/project/model-overrides", async (c) => {
    const config = await loadCurrentProjectConfig({ requireApiKey: false });
    return c.json({ modelOverrides: config.modelOverrides ?? {} });
  });

  app.put("/api/v1/project/model-overrides", async (c) => {
    const body = await c.req.json<{ modelOverrides: Record<string, unknown> }>();
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    await saveRawConfig(root, { ...rawConfig, modelOverrides: body.modelOverrides });
    cachedConfig = await loadProjectConfig(root, { consumer: "studio" });
    return c.json({ ok: true });
  });

  app.get("/api/v1/project/notify", async (c) => {
    const config = await loadCurrentProjectConfig({ requireApiKey: false });
    return c.json({ notify: config.notify ?? [] });
  });

  app.put("/api/v1/project/notify", async (c) => {
    const body = await c.req.json<{ notify: unknown[] }>();
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    await saveRawConfig(root, { ...rawConfig, notify: body.notify });
    cachedConfig = await loadProjectConfig(root, { consumer: "studio" });
    return c.json({ ok: true });
  });

  app.post("/api/v1/project/language", async (c) => {
    const body = await c.req.json<{ language: string }>();
    const rawConfig = await loadRawConfig(root).catch(() => ({} as Record<string, unknown>));
    await saveRawConfig(root, { ...rawConfig, language: body.language });
    cachedConfig = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });
    return c.json({ ok: true });
  });

  // ===========================================================================
  // SESSIONS ENDPOINTS
  // ===========================================================================

  app.get("/api/v1/sessions", async (c) => {
    const bookId = c.req.query("bookId");
    const queryBookId = bookId === "null" ? null : bookId ?? undefined;
    const sessions = await listSessions(queryBookId);
    return c.json({ sessions });
  });

  app.get("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const record = await loadSession(sessionId);
    if (!record) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({
      session: {
        sessionId: record.sessionId,
        bookId: record.bookId,
        title: record.title,
        messages: record.messages,
      },
    });
  });

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json<{ bookId?: string | null; sessionId?: string }>();
    const sessionId = body.sessionId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const existing = await loadSession(sessionId);
    if (existing) {
      return c.json({
        session: {
          sessionId: existing.sessionId,
          bookId: existing.bookId,
          title: existing.title,
          messages: existing.messages,
        },
      });
    }

    const record: SessionRecord = {
      sessionId,
      bookId: body.bookId ?? null,
      title: null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveSession(record);

    return c.json({
      session: {
        sessionId: record.sessionId,
        bookId: record.bookId,
        title: record.title,
        messages: record.messages,
      },
    });
  });

  app.put("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ title?: string; bookId?: string | null }>();
    const record = await loadSession(sessionId);
    if (!record) {
      return c.json({ error: "Session not found" }, 404);
    }

    if (body.title !== undefined) record.title = body.title;
    if (body.bookId !== undefined) record.bookId = body.bookId;
    record.updatedAt = Date.now();
    await saveSession(record);

    return c.json({ ok: true });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    await deleteSessionFile(sessionId);
    return c.json({ ok: true });
  });

  // ===========================================================================
  // AGENT ENDPOINT (streaming chat)
  // ===========================================================================

  app.post("/api/v1/agent", async (c) => {
    const body = await c.req.json<{
      instruction: string;
      activeBookId?: string;
      sessionId?: string;
      model?: string;
      service?: string;
    }>();

    if (!body.instruction?.trim()) {
      throw new ApiError(400, "INVALID_INPUT", "Instruction is required");
    }

    const config = await loadCurrentProjectConfig({
      cli:
        body.service?.trim() || body.model?.trim()
          ? {
              ...(body.service?.trim() ? { service: body.service.trim() } : {}),
              ...(body.model?.trim() ? { model: body.model.trim() } : {}),
            }
          : undefined,
    });
    const model = body.model || config.llm.model;
    const sessionId = body.sessionId;

    // Load session for context
    let sessionRecord: SessionRecord | null = null;
    if (sessionId) {
      sessionRecord = await loadSession(sessionId);
    }

    // Build messages from history
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
    if (body.activeBookId?.trim()) {
      messages.push({
        role: "system",
        content: [
          "你是 Paper Writer 的论文写作助手，当前已绑定一篇具体论文（有 paperId）。",
          "禁止输出长篇「如何写论文」「心态建设」「文件夹怎么整理」等通识写作课内容；不要替代用户做泛泛励志或方法论指导。",
          "用户要的是可执行的学术产出：应围绕该论文的标题、开题、章节修改、文献格式、导出 Word 等具体问题作答；若用户说「开始写论文」「生成论文」「跑流水线」，用一两句话说明应使用界面上的「论文生成」一键任务（全量流水线），不要编造已自动完成的进度。",
          "回答尽量简洁、可执行；需要长文时只输出与论文正文/结构直接相关的内容。",
        ].join("\n"),
      });
    }
    if (sessionRecord) {
      for (const msg of sessionRecord.messages.slice(-20)) {
        messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }
    }
    messages.push({ role: "user", content: body.instruction.trim() });

    // Check model suitability
    if (!isTextChatModelId(model)) {
      return c.json({ error: nonTextModelMessage(model) }, 400);
    }

    const client = createLLMClient(config.llm);

    try {
      const streamTs = Date.now();
      let responseText = "";

      const result = await chatCompletion(
        client,
        model,
        messages,
        {
          maxTokens: 8192,
          onTextDelta: (chunk: string) => {
            responseText += chunk;
            if (sessionId) {
              broadcast("draft:delta", { sessionId, text: chunk, timestamp: streamTs });
            }
          },
          onStreamProgress: (progress) => {
            if (sessionId) {
              broadcast("llm:progress", {
                sessionId,
                status: progress.status,
                elapsedMs: progress.elapsedMs,
                totalChars: progress.totalChars,
                chineseChars: progress.chineseChars,
              });
            }
          },
        },
      );

      // Save to session
      if (sessionId && responseText) {
        if (!sessionRecord) {
          sessionRecord = {
            sessionId,
            bookId: body.activeBookId ?? null,
            title: null,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }
        sessionRecord.messages.push({ role: "user", content: body.instruction.trim(), timestamp: Date.now() });
        sessionRecord.messages.push({ role: "assistant", content: responseText, timestamp: Date.now() });
        sessionRecord.updatedAt = Date.now();

        // Auto-generate title from first exchange
        if (!sessionRecord.title && sessionRecord.messages.filter((m) => m.role === "user").length === 1) {
          sessionRecord.title = body.instruction.trim().slice(0, 50);
          broadcast("session:title", { sessionId, title: sessionRecord.title });
        }

        await saveSession(sessionRecord);
      }

      return c.json({
        response: responseText,
        details: { draftRaw: responseText },
        session: sessionRecord ? {
          sessionId: sessionRecord.sessionId,
          bookId: sessionRecord.bookId,
          title: sessionRecord.title,
        } : undefined,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return c.json({ error: errorMessage }, 500);
    }
  });

  // ===========================================================================
  // LOGS ENDPOINT
  // ===========================================================================

  app.get("/api/v1/logs", async (c) => {
    const logsDir = join(root, ".inkos", "logs");
    try {
      const files = await readdir(logsDir);
      const logFiles = files
        .filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"))
        .sort()
        .reverse()
        .slice(0, 10);

      const entries: Array<{ file: string; lines: string[] }> = [];
      for (const file of logFiles) {
        try {
          const content = await readFile(join(logsDir, file), "utf-8");
          entries.push({
            file,
            lines: content.split("\n").filter(Boolean).slice(-50),
          });
        } catch { /* skip */ }
      }
      return c.json({ logs: entries });
    } catch {
      return c.json({ logs: [] });
    }
  });

  // ===========================================================================
  // DOCTOR ENDPOINT (health check)
  // ===========================================================================

  app.get("/api/v1/papers/:id/runtime-status", async (c) => {
    const paperId = c.req.param("id");
    const state = new StateManager(root);
    try {
      const pipeline = await state.loadPipelineState(paperId);
      return c.json({ stage: pipeline.currentStage, completedSections: pipeline.completedSections, totalSections: pipeline.totalSections, write: null });
    } catch {
      return c.json({ stage: "idle", completedSections: 0, totalSections: 0, write: null });
    }
  });

  app.get("/api/v1/doctor", async (c) => {
    const { existsSync } = await import("node:fs");

    const checks = {
      inkosJson: existsSync(join(root, "inkos.json")),
      projectEnv: existsSync(join(root, ".env")),
      globalEnv: existsSync(GLOBAL_ENV_PATH),
      papersDir: existsSync(join(root, "papers")),
      llmConnected: false,
      paperCount: 0,
    };

    try {
      const papers = await state.listPapers();
      checks.paperCount = papers.length;
    } catch { /* ignore */ }

    try {
      const currentConfig = await loadCurrentProjectConfig({ requireApiKey: false });
      const service = currentConfig.llm.service ?? currentConfig.llm.provider;
      const probe = await probeServiceCapabilities({
        root,
        service,
        apiKey: currentConfig.llm.apiKey,
        baseUrl: currentConfig.llm.baseUrl,
        preferredApiFormat: currentConfig.llm.apiFormat,
        preferredStream: currentConfig.llm.stream,
        preferredModel: currentConfig.llm.model,
        proxyUrl: currentConfig.llm.proxyUrl,
      });
      checks.llmConnected = probe.ok;
    } catch { /* ignore */ }

    return c.json(checks);
  });

  return app;
}

// --- Standalone runner ---

export async function startStudioServer(
  root: string,
  port = 4567,
  options?: { readonly staticDir?: string },
): Promise<void> {
  const config = await loadProjectConfig(root, { consumer: "studio", requireApiKey: false });
  const app = createStudioServer(config, root);

  // Serve frontend static files
  if (options?.staticDir) {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { existsSync } = await import("node:fs");

    app.get("/assets/*", async (c) => {
      const filePath = joinPath(options.staticDir!, c.req.path);
      try {
        const content = await readFileFs(filePath);
        const ext = filePath.split(".").pop() ?? "";
        const contentTypes: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
          json: "application/json",
        };
        return new Response(content, {
          headers: { "Content-Type": contentTypes[ext] ?? "application/octet-stream" },
        });
      } catch {
        return c.notFound();
      }
    });

    // SPA fallback
    const indexPath = joinPath(options.staticDir!, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = await readFileFs(indexPath, "utf-8");
      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/v1/")) return c.notFound();
        return c.html(indexHtml);
      });
    }
  }

  console.log(`Paper Writer Studio running on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
