import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import {
  matchServiceConfigEntryForDetail,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailProtocol,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [secretPreview, setSecretPreview] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [protocol, setProtocol] = useState<ServiceDetailProtocol>("anthropic-messages");
  const [authField, setAuthField] = useState("ANTHROPIC_AUTH_TOKEN");
  const [modelMain, setModelMain] = useState("");
  const [modelHaiku, setModelHaiku] = useState("");
  const [modelSonnet, setModelSonnet] = useState("");
  const [modelOpus, setModelOpus] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<"chat" | "responses">("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (matched) {
          if (isCustom) setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
          setNote(String(matched.note ?? ""));
          setWebsite(String(matched.website ?? ""));
          if (matched.protocol === "chat" || matched.protocol === "responses" || matched.protocol === "anthropic-messages") {
            setProtocol(matched.protocol);
          }
          setAuthField(String(matched.authField ?? "ANTHROPIC_AUTH_TOKEN"));
          setModelMain(String(matched.modelMain ?? ""));
          setModelHaiku(String(matched.modelHaiku ?? ""));
          setModelSonnet(String(matched.modelSonnet ?? ""));
          setModelOpus(String(matched.modelOpus ?? ""));
          if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
          if (matched.apiFormat === "chat" || matched.apiFormat === "responses") setApiFormat(matched.apiFormat);
          if (typeof matched.stream === "boolean") setStream(matched.stream);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const studioSecretStorageKey = `inkos.studio.apiKey.${effectiveServiceId}`;
  const label = isCustom ? (customName || persistedCustomName || "自定义服务") : (svc?.label ?? serviceId);
  const defaultBaseUrl = svc?.baseUrl ?? "";
  const defaultModel = svc?.defaultModel ?? "";
  const deepseekClaudeCompat = serviceId === "deepseek" ? "https://api.deepseek.com/anthropic" : "";
  const effectiveBaseUrl = baseUrl.trim() || deepseekClaudeCompat || defaultBaseUrl;
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    if (!isCustom && !baseUrl) {
      setBaseUrl(deepseekClaudeCompat || defaultBaseUrl);
    }
    if (!website && serviceId === "deepseek") {
      setWebsite("https://platform.deepseek.com");
    }
    if (!modelMain && defaultModel) {
      setModelMain(defaultModel);
      setModelHaiku(defaultModel);
      setModelSonnet(defaultModel);
      setModelOpus(defaultModel);
    }
  }, [baseUrl, deepseekClaudeCompat, defaultBaseUrl, defaultModel, isCustom, modelMain, serviceId, website]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        // Prefer server-returned key, fall back to sessionStorage cache, then empty
        const cached =
          typeof globalThis.sessionStorage !== "undefined"
            ? globalThis.sessionStorage.getItem(studioSecretStorageKey)
            : null;
        setApiKey(result.apiKey || cached || "");
        setHasSavedSecret(result.hasSavedKey);
        setSecretPreview(result.keyPreview);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
    studioSecretStorageKey,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const models = status.state === "connected" ? status.models : (storeModels ?? []);
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setStatus({ state: "error", message: "请先输入 API Key" });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setApiKey(trimmedKey);
    setStatus({ state: "testing" });
    try {
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        protocol,
        stream,
        baseUrl: effectiveBaseUrl,
      });
      if (result.ok) {
        const models = result.models ?? [];
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setStatus({ state: "connected", models });
        setStoreModels(effectiveServiceId, models); // Write to global store
      } else {
        setStatus({ state: "error", message: result.error ?? "连接失败" });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "连接失败" });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: "请先填写 Base URL" });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl: effectiveBaseUrl,
        apiFormat,
        protocol,
        stream,
        temperature,
        detectedModel,
        note,
        website,
        authField,
        modelMain,
        modelHaiku,
        modelSonnet,
        modelOpus,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      if (trimmedKey && typeof globalThis.sessionStorage !== "undefined") {
        globalThis.sessionStorage.setItem(studioSecretStorageKey, trimmedKey);
      }
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : "保存失败" });
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        返回服务商管理
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            已连接
          </span>
        )}
      </div>

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label="服务名称">
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder="例如：本地 Ollama" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key */}
        <Field label="API Key">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasSavedSecret ? "已保存密钥；可粘贴新 Key 覆盖" : "sk-..."}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {hasSavedSecret ? (
            <p className="text-xs text-muted-foreground/80 mt-1.5 leading-relaxed">
              服务器已保存密钥{secretPreview ? `（${secretPreview}）` : ""}。保存成功后同一浏览器会缓存完整 Key 便于再次编辑；换浏览器或清空站点数据后需重新粘贴。
            </p>
          ) : null}
        </Field>

        {/* Actions + feedback */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleTest} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
              {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
              测试连接
            </button>
            <button onClick={handleSave} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
              保存
            </button>
          </div>
          {/* Status feedback */}
          {status.state === "connected" && (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 break-words">
              连接成功，{models.length} 个模型
              {detectedModel ? `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "responses" ? "Responses" : "Chat"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}` : ""}
            </div>
          )}
          {status.state === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive whitespace-pre-wrap break-words">
              {status.message}
            </div>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">已保存</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Field label="供应商名称">
            <input
              type="text"
              value={label}
              readOnly
              className="w-full rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
            />
          </Field>
          <Field label="备注">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：公司专用账号"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="官网链接">
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://platform.deepseek.com"
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="请求地址（完整 URL）">
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={deepseekClaudeCompat || defaultBaseUrl || "https://api.example.com/v1"}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="API 格式">
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as ServiceDetailProtocol)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="anthropic-messages">Anthropic Messages (原生)</option>
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>
          <Field label="认证字段">
            <input
              type="text"
              value={authField}
              onChange={(e) => setAuthField(e.target.value)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>

        <p className="text-xs text-muted-foreground/75 leading-relaxed">
          「主模型」在保存成功后会写入项目默认对话模型；下方 Haiku / Sonnet / Opus 档位为预留字段（当前 Paper Studio 对话与写作管线不读取），仅作备忘或与后续 CLI 能力对齐。
        </p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="主模型">
            <input
              type="text"
              value={modelMain}
              onChange={(e) => setModelMain(e.target.value)}
              placeholder={detectedModel || defaultModel}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Haiku 默认模型">
            <input
              type="text"
              value={modelHaiku}
              onChange={(e) => setModelHaiku(e.target.value)}
              placeholder={detectedModel || defaultModel}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Sonnet 默认模型">
            <input
              type="text"
              value={modelSonnet}
              onChange={(e) => setModelSonnet(e.target.value)}
              placeholder={detectedModel || defaultModel}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Opus 默认模型">
            <input
              type="text"
              value={modelOpus}
              onChange={(e) => setModelOpus(e.target.value)}
              placeholder={detectedModel || defaultModel}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="协议类型">
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as "chat" | "responses")}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">Chat / Completions</option>
              <option value="responses">Responses</option>
            </select>
          </Field>

          <Field label="流式响应">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? "开启" : "关闭"}</span>
            </label>
          </Field>
        </div>

        {/* Models — show when connected via store or via local auto-probe */}
        {(isConnected || status.state === "connected") && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
              可用模型（{models.length}）
            </p>
            {models.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {models.map((m) => (
                  <span key={m.id} className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15">
                    {m.name ?? m.id}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">点击“测试连接”查看可用模型</p>
            )}
          </div>
        )}

        {/* Advanced params */}
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            高级参数
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
