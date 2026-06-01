import type { StateCreator } from "zustand";
import type { ChatStore, MessageActions, PipelineStage } from "../../types";
import { shouldRefreshSidebarForTool } from "../../message-policy";
import {
  deriveFlat,
  extractToolError,
  findRunningToolPart,
  getOrCreateStream,
  replaceLast,
  resolveToolLabel,
  sessionMatchesEvent,
  summarizeResult,
  updateSession,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

interface AttachSessionStreamListenersInput {
  sessionId: string;
  streamTs: number;
  streamEs: EventSource;
  set: SliceSet;
  get: SliceGet;
  onActivity?: () => void;
}

export function attachSessionStreamListeners({
  sessionId,
  streamTs,
  streamEs,
  set,
  get,
  onActivity,
}: AttachSessionStreamListenersInput): void {
  const markActivity = (): void => {
    onActivity?.();
  };

  streamEs.addEventListener("thinking:start", () => {
    /* 已关闭服务端 thinking SSE；忽略历史或其它来源的 thinking 事件 */
  });

  streamEs.addEventListener("thinking:delta", () => {
    /* 同上 */
  });

  streamEs.addEventListener("thinking:end", () => {
    /* 同上 */
  });

  streamEs.addEventListener("draft:delta", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "text") {
            parts[parts.length - 1] = { ...last, content: last.content + data.text };
          } else {
            parts.push({ type: "text", content: data.text });
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:start", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];

          if (data.tool === "sub_agent") {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && last.content) {
              parts.pop();
              const prev = parts[parts.length - 1];
              if (prev?.type === "thinking") {
                parts[parts.length - 1] = {
                  ...prev,
                  content: prev.content + (prev.content ? "\n\n" : "") + last.content,
                };
              } else {
                parts.push({ type: "thinking", content: last.content, streaming: false });
              }
            }
          }

          const agent = data.tool === "sub_agent" ? (data.args?.agent as string | undefined) : undefined;
          const stages: PipelineStage[] | undefined = Array.isArray(data.stages) && data.stages.length > 0
            ? (data.stages as string[]).map((label) => ({ label, status: "pending" as const }))
            : undefined;

          parts.push({
            type: "tool",
            execution: {
              id: data.id as string,
              tool: data.tool as string,
              agent,
              label: resolveToolLabel(data.tool as string, agent),
              status: "running",
              args: data.args as Record<string, unknown> | undefined,
              stages,
              startedAt: Date.now(),
            },
          });

          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:end", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = (stream.parts ?? []).map((part) => {
            if (part.type !== "tool" || part.execution.id !== data.id) return part;
            const execution = { ...part.execution };
            execution.status = data.isError ? "error" : "completed";
            execution.completedAt = Date.now();
            execution.stages = execution.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage,
            );
            if (data.isError) execution.error = extractToolError(data.result);
            else execution.result = summarizeResult(data.result);
            return { type: "tool" as const, execution };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));

      if (shouldRefreshSidebarForTool(data.tool as string)) {
        get().bumpBookDataVersion();
      }
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:update", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || data?.tool !== "sub_agent") return;
      const partial = (data?.partialResult ?? {}) as {
        stage?: string;
        progress?: number;
      };
      if (!partial.stage) return;
      const stageMatchers: Record<string, ReadonlyArray<string>> = {
        planning: ["准备", "输入", "计划", "planning"],
        writing: ["撰写", "写作", "writer", "writing"],
        auditing: ["审计", "审核", "audit", "auditing"],
        revising: ["修订", "修正", "revis", "revising"],
        persisting: ["保存", "持久化", "落盘", "persist"],
      };
      const matcher = stageMatchers[partial.stage] ?? [partial.stage];
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = (stream.parts ?? []).map((part) => {
            if (part.type !== "tool" || part.execution.tool !== "sub_agent") return part;
            const stages = (part.execution.stages ?? []).map((stage) => {
              const hit = matcher.some((token) => stage.label.toLowerCase().includes(token.toLowerCase()));
              if (hit) {
                return {
                  ...stage,
                  status: partial.progress !== undefined && partial.progress >= 100 ? "completed" as const : "active" as const,
                  progress: partial.progress !== undefined
                    ? {
                        status: `${partial.progress}%`,
                        elapsedMs: 0,
                        totalChars: 0,
                        chineseChars: 0,
                      }
                    : stage.progress,
                };
              }
              if (stage.status === "active" && !hit) {
                return { ...stage, status: "completed" as const };
              }
              return stage;
            });
            return { type: "tool" as const, execution: { ...part.execution, stages } };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("write:stage", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      const partial = data as { stage?: string; progress?: number; bookId?: string };
      if (!partial.stage) return;
      const stageMatchers: Record<string, ReadonlyArray<string>> = {
        planning: ["准备", "输入", "计划", "planning"],
        writing: ["撰写", "写作", "writer", "writing"],
        auditing: ["审计", "审核", "audit", "auditing", "状态结算"],
        revising: ["修订", "修正", "revis", "revising"],
        persisting: ["保存", "持久化", "落盘", "persist", "回写", "索引", "快照"],
      };
      const matcher = stageMatchers[partial.stage] ?? [partial.stage];
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const currentParts = [...(stream.parts ?? [])];
          const hasSubAgentTool = currentParts.some((p) => p.type === "tool" && p.execution.tool === "sub_agent");
          if (!hasSubAgentTool) {
            currentParts.push({
              type: "tool",
              execution: {
                id: `write-stage-${Date.now().toString(36)}`,
                tool: "sub_agent",
                agent: "writer",
                label: "写作",
                status: "running",
                args: partial.bookId ? { agent: "writer", bookId: partial.bookId } : { agent: "writer" },
                startedAt: Date.now(),
                stages: [
                  { label: "准备写作材料", status: "pending" },
                  { label: "撰写章节草稿", status: "pending" },
                  { label: "落盘最终章节", status: "pending" },
                  { label: "生成最终参考文件", status: "pending" },
                  { label: "同步记忆索引", status: "pending" },
                ],
              },
            });
          }
          const parts = currentParts.map((part) => {
            if (part.type !== "tool" || part.execution.tool !== "sub_agent") return part;
            const stages = (part.execution.stages ?? []).map((stage) => {
              const hit = matcher.some((token) => stage.label.toLowerCase().includes(token.toLowerCase()));
              if (hit) {
                return {
                  ...stage,
                  status: partial.progress !== undefined && partial.progress >= 100 ? "completed" as const : "active" as const,
                  progress: partial.progress !== undefined
                    ? {
                        status: `${partial.progress}%`,
                        elapsedMs: 0,
                        totalChars: 0,
                        chineseChars: 0,
                      }
                    : stage.progress,
                };
              }
              if (stage.status === "active" && !hit) {
                return { ...stage, status: "completed" as const, progress: undefined };
              }
              return stage;
            });
            return { type: "tool" as const, execution: { ...part.execution, stages } };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("log", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      const message = data?.message as string | undefined;
      if (!message) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const runningTool = findRunningToolPart([...(stream.parts ?? [])]);
          if (!runningTool) return {};
          const parts = (stream.parts ?? []).map((part) => {
            if (part.type !== "tool" || part.execution.id !== runningTool.execution.id) return part;
            return {
              type: "tool" as const,
              execution: { ...part.execution, logs: [...(part.execution.logs ?? []), message] },
            };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("llm:progress", (event: MessageEvent) => {
    try {
      markActivity();
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const runningTool = findRunningToolPart([...(stream.parts ?? [])]);
          if (!runningTool?.execution.stages) return {};
          const parts = (stream.parts ?? []).map((part) => {
            if (part.type !== "tool" || part.execution.id !== runningTool.execution.id) return part;
            return {
              type: "tool" as const,
              execution: {
                ...part.execution,
                stages: part.execution.stages?.map((stage) =>
                  stage.status === "active"
                    ? {
                        ...stage,
                        progress: {
                          status: data.status,
                          elapsedMs: data.elapsedMs,
                          totalChars: data.totalChars,
                          chineseChars: data.chineseChars,
                        },
                      }
                    : stage,
                ),
              },
            };
          });
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });
}
