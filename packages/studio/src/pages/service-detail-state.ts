import { fetchJson } from "../hooks/use-api";

export interface ServiceDetailModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ServiceDetailDetectedConfig {
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly baseUrl?: string;
  readonly modelsSource?: "api" | "fallback";
}

export type ServiceDetailProtocol = "chat" | "responses" | "anthropic-messages";

export type ServiceDetailConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "connected"; models: ServiceDetailModelInfo[] }
  | { state: "error"; message: string }
  | { state: "saving" }
  | { state: "saved" };

type JsonFetcher = typeof fetchJson;

interface ServiceProbeResponse {
  readonly ok: boolean;
  readonly models?: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
  readonly error?: string;
}

export async function probeServiceForDetail(
  serviceId: string,
  body: {
    readonly apiKey: string;
    readonly apiFormat: "chat" | "responses";
    readonly protocol?: ServiceDetailProtocol;
    readonly stream: boolean;
    readonly baseUrl?: string;
  },
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<ServiceProbeResponse> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  return await fetchJsonImpl<ServiceProbeResponse>(
    `/services/${encodeURIComponent(serviceId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function rehydrateServiceConnectionStatus(args: {
  readonly effectiveServiceId: string;
  readonly shouldVerify: boolean;
  readonly isCustom: boolean;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly apiKey: string;
  readonly hasSavedKey: boolean;
  readonly keyPreview: string | null;
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const secret = await fetchJsonImpl<{
    readonly hasKey?: boolean;
    readonly apiKey?: string;
    readonly keyPreview?: string | null;
  }>(
    `/services/${encodeURIComponent(args.effectiveServiceId)}/secret`,
  );
  const hasSavedKey = Boolean(secret.hasKey);
  const keyPreview = typeof secret.keyPreview === "string" ? secret.keyPreview : null;
  const serverKey = typeof secret.apiKey === "string" ? secret.apiKey : "";

  // If server has a saved key, auto-probe to load models
  if (hasSavedKey && serverKey) {
    try {
      const probe = await probeServiceForDetail(args.effectiveServiceId, {
        apiKey: serverKey,
        apiFormat: args.apiFormat,
        stream: args.stream,
        ...(args.isCustom && args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      }, { fetchJsonImpl });
      if (probe.ok && probe.models && probe.models.length > 0) {
        return {
          apiKey: serverKey,
          hasSavedKey,
          keyPreview,
          status: { state: "connected", models: probe.models },
          detectedModel: probe.selectedModel ?? "",
          detectedConfig: probe.detected ?? null,
        };
      }
      // Probe failed — key may be invalid/expired; still return the key for editing
      return {
        apiKey: serverKey,
        hasSavedKey,
        keyPreview,
        status: { state: "idle" },
        detectedModel: "",
        detectedConfig: null,
      };
    } catch {
      // Network error — return key anyway so user can re-test
    }
  }

  return {
    apiKey: serverKey,
    hasSavedKey,
    keyPreview,
    status: { state: "idle" },
    detectedModel: "",
    detectedConfig: null,
  };
}

export function matchServiceConfigEntryForDetail(
  entries: ReadonlyArray<Record<string, unknown>>,
  serviceId: string,
): Record<string, unknown> | undefined {
  return entries.find((entry) => {
    if (typeof entry.service !== "string") return false;
    if (serviceId.startsWith("custom:")) {
      return entry.service === "custom" && `custom:${String(entry.name ?? "")}` === serviceId;
    }
    if (serviceId === "custom") return false;
    return entry.service === serviceId;
  });
}

export async function saveServiceConfig(args: {
  readonly effectiveServiceId: string;
  readonly serviceId: string;
  readonly isCustom: boolean;
  readonly resolvedCustomName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly protocol: ServiceDetailProtocol;
  readonly stream: boolean;
  readonly temperature: string;
  readonly detectedModel: string;
  readonly note: string;
  readonly website: string;
  readonly authField: string;
  readonly modelMain: string;
  readonly modelHaiku: string;
  readonly modelSonnet: string;
  readonly modelOpus: string;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const trimmedKey = args.apiKey.trim();
  const trimmedBaseUrl = args.baseUrl.trim();

  if (!trimmedKey) {
    return {
      status: { state: "error", message: "请先输入 API Key" },
      detectedModel: "",
      detectedConfig: null,
    };
  }
  if (args.isCustom && !trimmedBaseUrl) {
    return {
      status: { state: "error", message: "请先填写 Base URL" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  let probe: ServiceProbeResponse;
  try {
    probe = await probeServiceForDetail(args.effectiveServiceId, {
      apiKey: trimmedKey,
      apiFormat: args.apiFormat,
      stream: args.stream,
      ...(args.isCustom ? { baseUrl: trimmedBaseUrl } : {}),
    }, { fetchJsonImpl });
  } catch (error) {
    return {
      status: { state: "error", message: error instanceof Error ? error.message : "连接失败" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  if (!probe.ok) {
    return {
      status: { state: "error", message: probe.error ?? "连接失败" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  const detectedModelRaw = String(probe.selectedModel ?? args.detectedModel ?? "").trim();
  const fallbackFromMain = args.modelMain.trim();
  const firstProbeModelId = probe.models?.find((m) => typeof m.id === "string" && m.id.trim().length > 0)?.id?.trim() ?? "";
  const detectedModel = detectedModelRaw || fallbackFromMain || firstProbeModelId;
  const detectedConfig = probe.detected ?? null;
  const savedApiFormat = detectedConfig?.apiFormat ?? args.apiFormat;
  const savedStream = typeof detectedConfig?.stream === "boolean" ? detectedConfig.stream : args.stream;
  const savedBaseUrl = args.isCustom ? (detectedConfig?.baseUrl ?? trimmedBaseUrl) : undefined;

  await fetchJsonImpl(`/services/${encodeURIComponent(args.effectiveServiceId)}/secret`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: trimmedKey }),
  });

  await fetchJsonImpl("/services/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: args.effectiveServiceId,
      ...(detectedModel.length > 0 ? { defaultModel: detectedModel } : {}),
      services: [
        {
          service: args.isCustom ? "custom" : args.serviceId,
          temperature: parseFloat(args.temperature),
          baseUrl: trimmedBaseUrl,
          apiFormat: savedApiFormat,
          protocol: args.protocol,
          stream: savedStream,
          note: args.note.trim(),
          website: args.website.trim(),
          authField: args.authField.trim(),
          modelMain: args.modelMain.trim(),
          modelHaiku: args.modelHaiku.trim(),
          modelSonnet: args.modelSonnet.trim(),
          modelOpus: args.modelOpus.trim(),
          ...(args.isCustom ? {
            name: args.resolvedCustomName,
            baseUrl: savedBaseUrl,
          } : {}),
        },
      ],
    }),
  });

  return {
    status: { state: "connected", models: probe.models ?? [] },
    detectedModel,
    detectedConfig,
  };
}
