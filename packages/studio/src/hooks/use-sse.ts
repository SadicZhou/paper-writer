import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEMessage {
  readonly event: string;
  readonly data: unknown;
  readonly timestamp: number;
}

export const STUDIO_SSE_EVENTS = [
  "book:creating", "book:created", "book:deleted", "book:error",
  "write:start", "write:complete", "write:error",
  "draft:start", "draft:complete", "draft:error",
  "daemon:chapter", "daemon:started", "daemon:stopped", "daemon:error",
  "agent:start", "agent:complete", "agent:error",
  "session:title",
  "audit:start", "audit:complete", "audit:error",
  "revise:start", "revise:complete", "revise:error",
  "rewrite:start", "rewrite:complete", "rewrite:error",
  "style:start", "style:complete", "style:error",
  "import:start", "import:complete", "import:error",
  "fanfic:start", "fanfic:complete", "fanfic:error",
  "fanfic:refresh:start", "fanfic:refresh:complete", "fanfic:refresh:error",
  "draft:delta",
  "radar:start", "radar:complete", "radar:error",
  "log", "llm:progress", "ping",
  "thinking:start", "thinking:delta", "thinking:end",
  "paper:created", "paper:pipeline-done",
  "paper:stage-start", "paper:stage-progress", "paper:stage-complete", "paper:stage-error",
  "paper:section-writing", "paper:section-detection", "paper:section-polishing",
  "paper:detection-complete", "paper:detection-error",
  "paper:reduction-complete", "paper:reduction-error",
  "paper:reset",
  "literature:updated",
] as const;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 6000, 12000]; // 3s, 6s, 12s

function getSSEToken(): string | null {
  try {
    const raw = localStorage.getItem("paper_writer_auth");
    if (raw) {
      const data = JSON.parse(raw);
      return data.accessToken ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

export function useSSE(url = "/api/v1/events") {
  const [messages, setMessages] = useState<ReadonlyArray<SSEMessage>>([]);
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);

  const connect = useCallback(() => {
    const token = getSSEToken();
    if (!token) return; // don't connect without auth
    const sseUrl = `${url}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      retryRef.current = 0; // reset retry counter on success
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      const retries = retryRef.current;
      if (retries < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retries] ?? 12000;
        setTimeout(() => {
          retryRef.current = retries + 1;
          setReconnectCount((c) => c + 1);
          connect();
        }, delay);
      }
    };

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = e.data ? JSON.parse(e.data) : null;
        setMessages((prev) => [...prev.slice(-99), { event: e.type, data, timestamp: Date.now() }]);
      } catch {
        // ignore parse errors
      }
    };

    for (const event of STUDIO_SSE_EVENTS) {
      es.addEventListener(event, handleEvent);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, connected, clear, reconnectCount };
}
