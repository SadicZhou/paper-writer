import { useEffect, useMemo, useRef, useState } from "react";
import type { SSEMessage } from "./use-sse";

export interface PaperPipelineLogLine {
  readonly id: string;
  readonly event: string;
  readonly message: string;
  readonly stage?: string;
  readonly at: number;
}

export function pickMessage(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const msg = data.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  const err = data.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  return "";
}

/**
 * 从全局 SSE 消息中筛选当前论文的流水线进度与日志。
 * @author zjh
 * @date 2026-05-12
 */
export function usePaperPipelineProgress(
  paperId: string | undefined,
  sseMessages: ReadonlyArray<SSEMessage>,
): {
  readonly currentStage: string | null;
  readonly done: boolean;
  readonly error: string | null;
  readonly lines: ReadonlyArray<PaperPipelineLogLine>;
  readonly completedStages: ReadonlyArray<string>;
  readonly sectionIndex: number;
  readonly sectionTotal: number;
} {
  const [lines, setLines] = useState<PaperPipelineLogLine[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [sectionTotal, setSectionTotal] = useState(0);
  const processedRef = useRef<{ readonly t: number; readonly ev: string } | null>(null);

  // Reset all state when paperId changes
  useEffect(() => {
    if (!paperId) return;
    setLines([]);
    setDone(false);
    setError(null);
    setCompletedStages([]);
    setSectionIndex(0);
    setSectionTotal(0);
    processedRef.current = null;
  }, [paperId]);

  // Process the last SSE message
  useEffect(() => {
    const last = sseMessages.at(-1);
    if (!last || !paperId) return;
    const data = last.data as Record<string, unknown> | null;
    const pid = typeof data?.paperId === "string" ? data.paperId : null;
    if (pid !== paperId) return;
    if (!last.event.startsWith("paper:")) return;

    const sig = { t: last.timestamp, ev: last.event };
    if (
      processedRef.current
      && processedRef.current.t === sig.t
      && processedRef.current.ev === sig.ev
    ) {
      return;
    }
    processedRef.current = sig;

    const message = pickMessage(data);
    const stage = typeof data?.stage === "string" ? data.stage : undefined;
    const id = `${sig.t}-${sig.ev}-${Math.random().toString(36).slice(2, 8)}`;

    if (last.event === "paper:pipeline-done") {
      setDone(true);
      setError(null);
    }
    if (last.event === "paper:stage-error") {
      setError(message || "流水线出错");
      setDone(true);
    }

    // Track completed stages
    if (last.event === "paper:stage-complete" && stage) {
      setCompletedStages((prev) => {
        if (prev.includes(stage)) return prev;
        return [...prev, stage];
      });
    }

    // Track per-section writing progress
    if (last.event === "paper:section-writing") {
      const nested = data?.data as Record<string, unknown> | undefined;
      if (nested) {
        const idx = typeof nested.index === "number" ? nested.index : -1;
        const tot = typeof nested.total === "number" ? nested.total : 0;
        if (idx >= 0) setSectionIndex(idx + 1); // 1-based for display
        if (tot > 0) setSectionTotal(tot);
      }
    }

    // Reset section progress on stage start
    if (last.event === "paper:stage-start" && stage && stage !== "writing") {
      setSectionIndex(0);
      setSectionTotal(0);
    }

    setLines((prev) => [
      ...prev.slice(-199),
      {
        id,
        event: last.event,
        message: message || last.event,
        stage,
        at: last.timestamp,
      },
    ]);
  }, [sseMessages, paperId]);

  const currentStage = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const e = lines[i].event;
      if (e === "paper:stage-start" || e === "paper:stage-progress") {
        return lines[i].stage ?? null;
      }
    }
    return null;
  }, [lines]);

  return { currentStage, done, error, lines, completedStages, sectionIndex, sectionTotal };
}
