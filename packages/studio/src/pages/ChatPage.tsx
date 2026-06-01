import { useRef, useEffect, useMemo, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import type { SSEMessage } from "../hooks/use-sse";
import { fetchJson } from "../hooks/use-api";
import { chatSelectors, useChatStore } from "../store/chat";
import { useServiceStore } from "../store/service";
import { ChatMessage } from "../components/chat/ChatMessage";

import { ToolExecutionSteps } from "../components/chat/ToolExecutionSteps";
import {
  Loader2,
  BotMessageSquare,
  ArrowUp,
} from "lucide-react";
import { Shimmer } from "../components/ai-elements/shimmer";
import {
  Message,
  MessageContent,
} from "../components/ai-elements/message";
import {
  type ChatPageModelPreference,
  getPaperCreateSessionId,
  pickModelSelection,
  setPaperCreateSessionId,
} from "./chat-page-state";

// -- Types --

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toServices: () => void;
}

export interface ChatPageProps {
  readonly activeBookId?: string;
  readonly nav: Nav;
  readonly theme: Theme;
  readonly t: TFunction;
  readonly sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}

interface ServiceConfigPayload {
  readonly service?: string | null;
  readonly defaultModel?: string | null;
}

// -- Component --

export function ChatPage({ activeBookId, nav, theme, t, sse: _sse }: ChatPageProps) {
  // -- Store selectors --
  const messages = useChatStore(chatSelectors.activeMessages);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const input = useChatStore((s) => s.input);
  const loading = useChatStore(chatSelectors.isActiveSessionStreaming);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const selectedService = useChatStore((s) => s.selectedService);
  // -- Store actions --
  const setInput = useChatStore((s) => s.setInput);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const upsertRuntimeWriteProgress = useChatStore((s) => s.upsertRuntimeWriteProgress);
  const loadSessionList = useChatStore((s) => s.loadSessionList);
  const createSession = useChatStore((s) => s.createSession);
  const loadSessionDetail = useChatStore((s) => s.loadSessionDetail);
  const activateSession = useChatStore((s) => s.activateSession);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isZh = t("nav.connected") === "\u5DF2\u8FDE\u63A5";
  // Derived: is the assistant currently streaming/thinking/executing tools?
  const isStreaming = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return last.thinkingStreaming === true
      || !last.content
      || (last.toolExecutions?.some(t => t.status === "running" || t.status === "processing") ?? false);
  }, [messages]);

  // -- Service / model state for auto-select --
  const services = useServiceStore((s) => s.services);
  const modelsByService = useServiceStore((s) => s.modelsByService);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const fetchCustomModels = useServiceStore((s) => s.fetchCustomModels);
  const [configuredModelSelection, setConfiguredModelSelection] = useState<ChatPageModelPreference | null>(null);
  const [serviceConfigLoaded, setServiceConfigLoaded] = useState(false);
  const [bootRuntimeWrite, setBootRuntimeWrite] = useState<{
    status: "idle" | "running" | "completed" | "failed";
    stage?: "planning" | "writing" | "auditing" | "revising" | "persisting";
    progress?: number;
    error?: string;
  } | null>(null);

  useEffect(() => { void fetchServices(); }, [fetchServices]);
  useEffect(() => {
    void fetchBankModels();
    void fetchCustomModels();
  }, [fetchBankModels, fetchCustomModels]);
  useEffect(() => {
    let cancelled = false;

    void fetchJson<ServiceConfigPayload>("/services/config")
      .then((payload) => {
        if (cancelled) return;
        setConfiguredModelSelection({
          service: payload.service ?? null,
          model: payload.defaultModel ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setConfiguredModelSelection(null);
      })
      .finally(() => {
        if (!cancelled) setServiceConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedModels = useMemo(() => {
    return services
      .filter((s) => s.connected && (modelsByService[s.service]?.length ?? 0) > 0)
      .map((s) => ({ service: s.service, label: s.label, models: modelsByService[s.service]! }));
  }, [services, modelsByService]);

  const selectedModelLabel = useMemo(() => {
    if (!selectedModel) return "选择模型";
    const group = groupedModels.find((item) => item.service === selectedService);
    const model = group?.models.find((item) => item.id === selectedModel);
    const modelLabel = model?.name ?? selectedModel;
    return group ? `${group.label} · ${modelLabel}` : modelLabel;
  }, [groupedModels, selectedModel, selectedService]);

  const modelSelectValue = useMemo(() => {
    if (selectedService && selectedModel) return `${selectedService}\t${selectedModel}`;
    return "";
  }, [selectedModel, selectedService]);

  const modelPickerStatus = useServiceStore((s) => s.getModelPickerStatus());

  /**
   * 以模型配置页写入的默认服务/模型为准做回显；不在此 effect 依赖聊天中的临时选择，避免与项目配置冲突时无法对齐。
   * @author zjh
   * @date 2026-05-12
   */
  useEffect(() => {
    if (!serviceConfigLoaded) return;
    if (useServiceStore.getState().getModelPickerStatus() !== "ready") return;

    const { selectedModel: storeModel, selectedService: storeService } = useChatStore.getState();
    const nextSelection = pickModelSelection(
      groupedModels,
      storeModel,
      storeService,
      configuredModelSelection,
      { preferProjectConfig: true },
    );
    if (nextSelection) {
      setSelectedModel(nextSelection.model, nextSelection.service);
    }
  }, [configuredModelSelection, groupedModels, serviceConfigLoaded, setSelectedModel]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  // Entering a book loads its latest session; book-create mode persists its orphan session in localStorage.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (activeBookId) {
        await loadSessionList(activeBookId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const currentSession = state.activeSessionId ? state.sessions[state.activeSessionId] : null;
        if (currentSession?.bookId === activeBookId) {
          await loadSessionDetail(currentSession.sessionId);
          return;
        }
        const ids = state.sessionIdsByBook[activeBookId] ?? [];
        if (ids.length > 0) {
          activateSession(ids[0]);
          await loadSessionDetail(ids[0]);
          return;
        }

        await createSession(activeBookId);
        return;
      }

      const existingId = getPaperCreateSessionId();
      if (existingId) {
        await loadSessionDetail(existingId);
        if (cancelled) return;

        const state = useChatStore.getState();
        const session = state.sessions[existingId];
        if (session && session.bookId === null) {
          activateSession(existingId);
          return;
        }
      }

      const newSessionId = await createSession(null);
      if (!cancelled) {
        setPaperCreateSessionId(newSessionId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBookId, activateSession, createSession, loadSessionDetail, loadSessionList]);

  useEffect(() => {
    if (!activeBookId || !activeSessionId) return;
    let cancelled = false;
    const pullRuntime = async () => {
      try {
        const data = await fetchJson<{
          write: {
            status: "idle" | "running" | "completed" | "failed";
            stage?: "planning" | "writing" | "auditing" | "revising" | "persisting";
            progress?: number;
            error?: string;
          };
        }>(`/papers/${activeBookId}/runtime-status`);
        if (cancelled) return;
        if (data.write.status !== "idle") {
          upsertRuntimeWriteProgress(activeSessionId, activeBookId, data.write);
        }
      } catch {
        // ignore transient pull errors
      }
    };
    void pullRuntime();
    const timer = window.setInterval(() => {
      void pullRuntime();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeBookId, activeSessionId, upsertRuntimeWriteProgress]);

  useEffect(() => {
    /**
     * 页面首屏加载时主动拉一次 runtime-status。
     * 即使会话尚未激活，也先缓存结果，待会话就绪后立即恢复对话框进度。
     * @author zjh
     * @date 2026-05-08
     */
    if (!activeBookId) {
      setBootRuntimeWrite(null);
      return;
    }
    let cancelled = false;
    void fetchJson<{
      write: {
        status: "idle" | "running" | "completed" | "failed";
        stage?: "planning" | "writing" | "auditing" | "revising" | "persisting";
        progress?: number;
        error?: string;
      };
    }>(`/papers/${activeBookId}/runtime-status`)
      .then((data) => {
        if (cancelled) return;
        setBootRuntimeWrite(data.write);
      })
      .catch(() => {
        if (!cancelled) setBootRuntimeWrite(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBookId]);

  useEffect(() => {
    if (!activeBookId || !activeSessionId || !bootRuntimeWrite) return;
    if (bootRuntimeWrite.status === "idle") return;
    upsertRuntimeWriteProgress(activeSessionId, activeBookId, bootRuntimeWrite);
  }, [activeBookId, activeSessionId, bootRuntimeWrite, upsertRuntimeWriteProgress]);

  const onSend = (text: string) => {
    if (!activeSessionId) return;
    void sendMessage(activeSessionId, text, activeBookId);
  };

  const emptyGuidance = isZh
    ? "\u544A\u8BC9\u6211\u4F60\u8981\u5199\u4EC0\u4E48\u8BBA\u6587\u2014\u2014\u7814\u7A76\u4E3B\u9898\u3001\u6838\u5FC3\u8BBA\u70B9\u3001\u65B9\u6CD5\u8BBA\u3001\u7ED3\u8BBA\u65B9\u5411"
    : "Tell me about your paper \u2014 research topic, core argument, methodology, key findings";

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Message scroll area */}
      <div
        ref={scrollRef}
        className="chat-message-scroll flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 py-6"
      >
        {messages.length === 0 && !loading ? (
          <div className="h-full flex flex-col items-center justify-center text-center select-none">
            <div className="w-14 h-14 rounded-2xl border border-dashed border-border flex items-center justify-center mb-4 bg-secondary/30 opacity-40">
              <BotMessageSquare size={24} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground/70 max-w-md leading-7">
              {emptyGuidance}
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg, i) => (
              <div key={`${msg.timestamp}-${i}`}>
                {msg.role === "user" ? (
                  /* User message */
                  <ChatMessage role="user" content={msg.content} timestamp={msg.timestamp} theme={theme} />
                ) : msg.parts && msg.parts.length > 0 ? (
                  /* Assistant message — parts-based rendering (chronological) */
                  /* Merge consecutive utility tool parts into one group */
                  <>
                    {(() => {
                      type RenderItem =
                        | { kind: "text"; pi: number; part: Extract<typeof msg.parts[0], { type: "text" }> }
                        | { kind: "tools"; parts: Array<Extract<typeof msg.parts[0], { type: "tool" }>>; startIdx: number };

                      const items: RenderItem[] = [];
                      for (let pi = 0; pi < msg.parts!.length; pi++) {
                        const part = msg.parts![pi];
                        if (part.type === "thinking") continue;
                        if (part.type === "text") {
                          items.push({ kind: "text", pi, part });
                        } else if (part.type === "tool") {
                          const last = items[items.length - 1];
                          if (last?.kind === "tools") {
                            last.parts.push(part);
                          } else {
                            items.push({ kind: "tools", parts: [part], startIdx: pi });
                          }
                        }
                      }

                      return items.map((item) => {
                        if (item.kind === "tools") {
                          return <ToolExecutionSteps key={`x-${item.startIdx}`} executions={item.parts.map(p => p.execution)} />;
                        }
                        if (item.kind === "text" && item.part.content) {
                          return (
                            <ChatMessage
                              key={`c-${item.pi}`}
                              role="assistant"
                              content={item.part.content}
                              timestamp={msg.timestamp}
                              theme={theme}
                            />
                          );
                        }
                        return null;
                      });
                    })()}
                  </>
                ) : (
                  /* Assistant message — fallback (no parts, e.g. error messages) */
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    timestamp={msg.timestamp}
                    theme={theme}
                  />
                )}
              </div>
            ))}

            {/* Loading indicator — only when loading and no streaming activity */}
            {loading && !isStreaming && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer className="text-sm" duration={1.5}>
                    {isZh ? "生成中…" : "Generating…"}
                  </Shimmer>
                </MessageContent>
              </Message>
            )}

          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border/40 px-4 py-3">
        <div className="max-w-3xl mx-auto">
            <div className="rounded-xl bg-secondary/30 transition-all">
              <div className="flex items-center gap-2 px-3 py-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input); } }}
                  placeholder={isZh ? "输入指令..." : "Enter command..."}
                  disabled={loading || !activeSessionId}
                  rows={1}
                  className="flex-1 bg-transparent text-sm leading-6 placeholder:text-muted-foreground/50 outline-none! border-none! ring-0! shadow-none focus:outline-none! focus:ring-0! focus:border-none! resize-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
                />
                <button
                  type="button"
                  onClick={() => onSend(input)}
                  disabled={!input.trim() || loading || !activeSessionId}
                  className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:scale-105 active:scale-95 transition-all disabled:opacity-20 disabled:scale-100 shadow-sm shadow-primary/20"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.5} />}
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 pb-2 border-t border-border/20 pt-1.5 flex-wrap">
                {loading && activeSessionId && (
                  <button
                    onClick={() => stopStreaming(activeSessionId, "已手动停止等待，可重新发送指令。")}
                    className="text-xs px-2 py-1 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  >
                    停止等待
                  </button>
                )}
                <select
                  aria-label={isZh ? "选择对话模型" : "Select chat model"}
                  className="max-w-[min(100%,220px)] text-xs rounded-md border border-border/60 bg-background px-2 py-1 text-foreground shrink-0"
                  disabled={loading || modelPickerStatus !== "ready" || groupedModels.length === 0}
                  value={modelSelectValue}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!raw) return;
                    const tab = raw.indexOf("\t");
                    if (tab < 0) return;
                    const svc = raw.slice(0, tab);
                    const m = raw.slice(tab + 1);
                    if (svc && m) setSelectedModel(m, svc);
                  }}
                >
                  <option value="">
                    {modelPickerStatus === "loading"
                      ? (isZh ? "加载模型…" : "Loading models…")
                      : groupedModels.length === 0
                        ? (isZh ? "无可用模型" : "No models")
                        : (isZh ? "选择模型" : "Select model")}
                  </option>
                  {groupedModels.map((g) => (
                    <optgroup key={g.service} label={g.label}>
                      {g.models.map((m) => (
                        <option key={`${g.service}:${m.id}`} value={`${g.service}\t${m.id}`}>
                          {m.name ?? m.id}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {selectedModel ? selectedModelLabel : (isZh ? "未配置模型" : "No model configured")}
                </span>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
