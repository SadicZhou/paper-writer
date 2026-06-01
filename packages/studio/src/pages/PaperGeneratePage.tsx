import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, Loader2, Play, Download, FileUp, ChevronDown, ChevronRight, Settings, RefreshCw, RotateCcw } from "lucide-react";
import { useApi, postApi, fetchJson } from "../hooks/use-api";
import type { SSEMessage } from "../hooks/use-sse";
import { usePaperPipelineProgress } from "../hooks/use-paper-pipeline-progress";
import { downloadPaperDocx } from "../lib/download-paper-docx";

interface Nav {
  toPaperWorkspace: (id: string) => void;
}

const STAGE_ZH: Record<string, string> = {
  brainstorm: "选题构思",
  "literature-search": "文献检索",
  outline: "大纲构建",
  writing: "正文撰写",
  polish: "润色降重",
  "format-export": "格式导出",
};

const DEGREE_LABELS: Record<string, string> = {
  undergraduate: "本科",
  master: "硕士",
  doctor: "博士",
};

const CITATION_LABELS: Record<string, string> = {
  gb7714: "GB/T 7714",
  apa: "APA",
  mla: "MLA",
  chicago: "Chicago",
};

interface OutlineNode {
  id: string;
  number: string;
  title: string;
  type: string;
  wordCount?: number;
  status?: string;
  children?: OutlineNode[];
}

const PIPELINE_STAGES = [
  "brainstorm",
  "literature-search",
  "outline",
  "writing",
  "polish",
  "format-export",
] as const;

function PipelineStageBar({
  currentStage,
  completedStages,
  error,
}: {
  readonly currentStage: string | null;
  readonly completedStages: ReadonlyArray<string>;
  readonly error: string | null;
}) {
  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage, idx) => {
        const isCompleted = completedStages.includes(stage);
        const isActive = currentStage === stage && !isCompleted;
        const isError = !!error && currentStage === stage;

        return (
          <div key={stage} className="flex items-center gap-1 flex-1 last:flex-[0_0_auto]">
            <div className="flex flex-col items-center gap-0.5 flex-1">
              {/* Circle indicator */}
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                  isError
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : isCompleted
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : isActive
                    ? "border-primary bg-primary/10 text-primary animate-pulse"
                    : "border-muted-foreground/30 bg-muted text-muted-foreground"
                }`}
              >
                {isError ? "!" : isCompleted ? "✓" : isActive ? (idx + 1) : idx + 1}
              </div>
              {/* Stage label */}
              <span
                className={`text-[10px] leading-tight text-center ${
                  isActive ? "text-primary font-medium" : "text-muted-foreground"
                }`}
              >
                {STAGE_ZH[stage] ?? stage}
              </span>
            </div>
            {/* Connector line */}
            {idx < PIPELINE_STAGES.length - 1 ? (
              <div
                className={`h-0.5 flex-1 min-w-[12px] rounded-full -mt-3 ${
                  isCompleted ? "bg-emerald-500" : "bg-muted-foreground/20"
                }`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 论文一键生成：调用全量流水线并展示 SSE 进度，完成后下载 Word。
 * @author zjh
 * @date 2026-05-12
 */
export function PaperGeneratePage({
  paperId,
  nav,
  sseMessages,
  sseReconnectCount,
}: {
  readonly paperId: string;
  readonly nav: Nav;
  readonly sseMessages: ReadonlyArray<SSEMessage>;
  readonly sseReconnectCount: number;
}) {
  const { data: paper, loading, refetch: refetchPaper } = useApi<{
    title: string;
    major: string;
    degreeLevel?: string;
    proposalText: string;
    targetWordCount: number;
    citationFormat: string;
    language: "zh" | "en";
  }>(`/papers/${paperId}`);

  const { data: sectionsData, refetch: refetchSections } = useApi<{ sections: Array<{ sectionNumber: string; title: string; wordCount: number; status: string; aiDetectionScore?: number }> }>(
    `/papers/${paperId}/sections`,
  );

  // Actual progress from saved sections
  const sections = sectionsData?.sections ?? [];
  const actualWordCount = sections.reduce((sum, s) => sum + s.wordCount, 0);
  const actualCompletedSections = sections.filter((s) => s.status === "approved" || s.status === "drafted" || s.status === "polishing").length;

  // Settings state
  const [major, setMajor] = useState("");
  const [degreeLevel, setDegreeLevel] = useState("undergraduate");
  const [targetWordCount, setTargetWordCount] = useState(20000);
  const [citationFormat, setCitationFormat] = useState("gb7714");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [proposalText, setProposalText] = useState("");

  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);

  // Pipeline initial status (loaded from API on mount)
  const [initialCompletedStages, setInitialCompletedStages] = useState<string[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<"idle" | "running" | "completed" | "error">("idle");
  const [initialLogLines, setInitialLogLines] = useState<Array<{ id: string; event: string; message: string; stage?: string; at: number }>>([]);

  useEffect(() => {
    fetchJson<{ currentStage?: string; completedStages?: string[]; totalSections?: number; completedSections?: number; status?: string; events?: Array<{ timestamp: string; type: string; stage?: string; message: string }> }>(
      `/papers/${encodeURIComponent(paperId)}/pipeline/status`,
    )
      .then((s) => {
        if (Array.isArray(s.completedStages)) {
          setInitialCompletedStages(s.completedStages);
        }
        if (s.status === "running" || s.status === "completed" || s.status === "error") {
          setPipelineStatus(s.status);
        }
        if (Array.isArray(s.events) && s.events.length > 0) {
          setInitialLogLines(s.events.map((e) => ({
            id: `${e.timestamp}-${e.type}-${Math.random().toString(36).slice(2, 8)}`,
            event: e.type,
            message: e.message || e.type,
            stage: e.stage,
            at: new Date(e.timestamp).getTime(),
          })));
        }
      })
      .catch(() => { /* not started yet */ });
  }, [paperId]);

  // Re-fetch pipeline status on SSE reconnect to restore progress display
  useEffect(() => {
    if (sseReconnectCount === 0) return;
    fetchJson<{ status?: string; completedStages?: string[]; events?: Array<{ timestamp: string; type: string; stage?: string; message: string }> }>(
      `/papers/${encodeURIComponent(paperId)}/pipeline/status`,
    )
      .then((s) => {
        if (s.status === "running" || s.status === "completed" || s.status === "error") {
          setPipelineStatus(s.status);
        }
        if (Array.isArray(s.completedStages)) {
          setInitialCompletedStages(s.completedStages);
        }
        if (Array.isArray(s.events) && s.events.length > 0) {
          setInitialLogLines(s.events.map((e) => ({
            id: `${e.timestamp}-${e.type}-${Math.random().toString(36).slice(2, 8)}`,
            event: e.type,
            message: e.message || e.type,
            stage: e.stage,
            at: new Date(e.timestamp).getTime(),
          })));
        }
      })
      .catch(() => {});
  }, [sseReconnectCount, paperId]);

  // Outline state
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [regeneratingOutline, setRegeneratingOutline] = useState(false);

  const { currentStage, done, error, lines, completedStages: liveCompletedStages, sectionIndex, sectionTotal } = usePaperPipelineProgress(paperId, sseMessages);

  // Completed stages = initial (from API) + live (from SSE)
  const allCompletedStages = (() => {
    const merged = new Set([...initialCompletedStages, ...liveCompletedStages]);
    return [...merged];
  })();

  // Merge pipeline-status API completedStages with live SSE completedStages
  const completedStages = liveCompletedStages;

  // Has previous progress? (pipeline started with at least one completed stage, or sections exist)
  const hasProgress = allCompletedStages.length > 0 || actualCompletedSections > 0;

  // Merge persisted log lines with live SSE lines
  const allLines = (() => {
    const seen = new Set<string>();
    const merged = [...initialLogLines];
    for (const l of merged) seen.add(l.id);
    for (const l of lines) {
      if (!seen.has(l.id)) {
        merged.push(l);
        seen.add(l.id);
      }
    }
    // Sort by timestamp, keep last 300
    merged.sort((a, b) => a.at - b.at);
    return merged.slice(-300);
  })();

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync all settings from paper data
  useEffect(() => {
    if (paper) {
      setProposalText(paper.proposalText ?? "");
      setMajor(paper.major ?? "");
      setDegreeLevel(paper.degreeLevel ?? "undergraduate");
      setTargetWordCount(paper.targetWordCount ?? 20000);
      setCitationFormat(paper.citationFormat ?? "gb7714");
      setLanguage(paper.language ?? "zh");
    }
  }, [paper]);

  // Fetch outline
  const fetchOutline = useCallback(async () => {
    setOutlineLoading(true);
    try {
      const data = await fetchJson<{ sections: OutlineNode[] } | OutlineNode[] | { error?: string }>(
        `/papers/${encodeURIComponent(paperId)}/outline`,
      );
      if (Array.isArray(data)) {
        setOutline(data);
      } else if (data && typeof data === "object" && "sections" in data && Array.isArray(data.sections)) {
        setOutline(data.sections as OutlineNode[]);
      } else {
        setOutline(null);
      }
    } catch {
      setOutline(null);
    } finally {
      setOutlineLoading(false);
    }
  }, [paperId]);

  useEffect(() => {
    fetchOutline();
  }, [fetchOutline]);

  // Auto-refresh outline when pipeline outline stage completes
  useEffect(() => {
    const outlineComplete = sseMessages.some(
      (m) =>
        m.event === "paper:stage-complete" &&
        (m as { stage?: string }).stage === "outline",
    );
    if (outlineComplete) {
      fetchOutline();
    }
  }, [sseMessages, fetchOutline]);

  const handleSaveProposal = async () => {
    setSaving(true);
    try {
      await fetchJson(`/papers/${encodeURIComponent(paperId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalText }),
      });
      await refetchPaper();
    } finally {
      setSaving(false);
    }
  };

  const debouncedSaveSetting = (field: string, value: unknown) => {
    setSavingField(field);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetchJson(`/papers/${encodeURIComponent(paperId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        await refetchPaper();
      } finally {
        setSavingField(null);
      }
    }, 600);
  };

  const handleUploadProposalDocx = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setDownloadErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/v1/papers/${encodeURIComponent(paperId)}/proposal-from-docx`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof j.error === "string" ? j.error : `上传失败 (${res.status})`);
      }
      const data = (await res.json()) as { paper?: { proposalText?: string } };
      if (typeof data.paper?.proposalText === "string") {
        setProposalText(data.paper.proposalText);
      }
      await refetchPaper();
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleStartPipeline = async () => {
    setStarting(true);
    setDownloadErr(null);
    try {
      await postApi(`/papers/${paperId}/pipeline/start`, {});
    } finally {
      setStarting(false);
    }
  };

  const handleRestartPipeline = async () => {
    setRestarting(true);
    setDownloadErr(null);
    try {
      // Clear all pipeline artifacts
      await postApi(`/papers/${paperId}/pipeline/reset`, {});
      // Reset local state
      setInitialCompletedStages([]);
      setPipelineStatus("idle");
      setInitialLogLines([]);
      setOutline(null);
      // Reload page data to reflect clean state
      await Promise.all([refetchPaper(), refetchSections(), fetchOutline()]);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };

  const handleRegenerateOutline = async () => {
    setRegeneratingOutline(true);
    try {
      const result = await fetchJson<{ sections: OutlineNode[]; structureRationale?: string }>(
        `/papers/${encodeURIComponent(paperId)}/generate-outline`,
        { method: "POST" },
      );
      if (result.sections) {
        setOutline(result.sections);
      }
    } catch {
      // Error is broadcast via SSE paper:stage-error
    } finally {
      setRegeneratingOutline(false);
    }
  };

  const handleDownload = async () => {
    setDownloadErr(null);
    try {
      await downloadPaperDocx(paperId);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading || !paper) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  const stageLabel = currentStage ? (STAGE_ZH[currentStage] ?? currentStage) : null;

  // Render a single outline node recursively
  const renderOutlineNode = (node: OutlineNode, depth: number) => (
    <div key={node.id} className="py-0.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground font-mono text-xs min-w-[2rem]">
          {node.number}
        </span>
        <span className="text-foreground">{node.title}</span>
        {node.wordCount ? (
          <span className="text-xs text-muted-foreground/60">
            ~{node.wordCount.toLocaleString()}字
          </span>
        ) : null}
        {node.status === "writing" || node.status === "polishing" ? (
          <Loader2 size={10} className="animate-spin text-primary/60" />
        ) : null}
      </div>
      {node.children?.map((child) => renderOutlineNode(child, depth + 1))}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-1">
      <button
        type="button"
        onClick={() => nav.toPaperWorkspace(paperId)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回工作台</span>
      </button>

      <h1 className="text-xl font-bold mb-1">论文生成</h1>
      <p className="text-sm text-muted-foreground mb-6">
        配置论文参数后一键运行全量流水线（构思 → 文献 → 大纲 → 写作 → 润色 → 导出）。完成后可下载 Word；预计耗时较长，请勿关闭页面。
      </p>

      {/* Paper Settings Panel */}
      <div className="rounded-xl border border-border bg-card mb-4 overflow-hidden">
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium hover:bg-secondary/30 transition-colors"
        >
          {settingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Settings size={14} />
          <span>论文设置</span>
          {savingField ? (
            <span className="text-xs text-muted-foreground ml-auto">保存中…</span>
          ) : null}
        </button>
        {settingsOpen ? (
          <div className="px-5 pb-4 space-y-3 border-t border-border/60 pt-3">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">论文标题</div>
              <div className="text-sm font-medium">{paper.title}</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  专业方向
                </label>
                <input
                  type="text"
                  value={major}
                  onChange={(e) => {
                    setMajor(e.target.value);
                    debouncedSaveSetting("major", e.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                  placeholder="如：计算机科学与技术"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  学位层次
                </label>
                <select
                  value={degreeLevel}
                  onChange={(e) => {
                    setDegreeLevel(e.target.value);
                    debouncedSaveSetting("degreeLevel", e.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                >
                  {Object.entries(DEGREE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  目标字数
                </label>
                <input
                  type="number"
                  value={targetWordCount}
                  min={1000}
                  step={1000}
                  onChange={(e) => {
                    const v = Math.max(1000, parseInt(e.target.value, 10) || 1000);
                    setTargetWordCount(v);
                    debouncedSaveSetting("targetWordCount", v);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  引用格式
                </label>
                <select
                  value={citationFormat}
                  onChange={(e) => {
                    setCitationFormat(e.target.value);
                    debouncedSaveSetting("citationFormat", e.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                >
                  {Object.entries(CITATION_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  语言
                </label>
                <select
                  value={language}
                  onChange={(e) => {
                    const v = e.target.value as "zh" | "en";
                    setLanguage(v);
                    debouncedSaveSetting("language", v);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Actual Progress Stats */}
      {sections.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground mb-0.5">章节进度</div>
            <div className="text-lg font-bold">{actualCompletedSections}/{sections.length}</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground mb-0.5">实际字数</div>
            <div className="text-lg font-bold">{actualWordCount.toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-3">
            <div className="text-xs text-muted-foreground mb-0.5">目标字数</div>
            <div className="text-lg font-bold">{paper?.targetWordCount?.toLocaleString() ?? "-"}</div>
          </div>
        </div>
      ) : null}

      {/* Outline Preview */}
      <div className="rounded-xl border border-border bg-card mb-4 overflow-hidden">
        <button
          type="button"
          onClick={() => setOutlineOpen(!outlineOpen)}
          className="w-full flex items-center gap-2 px-5 py-3 text-sm font-medium hover:bg-secondary/30 transition-colors"
        >
          {outlineOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileUp size={14} />
          <span>论文大纲</span>
          {outlineLoading ? (
            <Loader2 size={12} className="animate-spin text-muted-foreground ml-auto" />
          ) : null}
        </button>
        {outlineOpen ? (
          <div className="px-5 pb-4 border-t border-border/60 pt-3">
            {outline && outline.length > 0 ? (
              <div className="space-y-0 max-h-80 overflow-y-auto">
                {outline.map((node) => renderOutlineNode(node, 0))}
              </div>
            ) : outlineLoading ? (
              <p className="text-sm text-muted-foreground">加载中…</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无大纲。请先运行流水线，或点击下方按钮单独生成大纲。
              </p>
            )}
            <button
              type="button"
              disabled={regeneratingOutline}
              onClick={() => void handleRegenerateOutline()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50"
            >
              {regeneratingOutline ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {regeneratingOutline ? "生成中…" : "重新生成大纲"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Proposal Text */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 mb-6">
        <div>
          <label htmlFor="proposal-area" className="block text-sm font-medium mb-1.5">
            开题 / 素材正文（将写入项目配置）
          </label>
          <textarea
            id="proposal-area"
            value={proposalText}
            onChange={(e) => setProposalText(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            placeholder="粘贴开题报告要点、研究问题、方法等…"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveProposal()}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存开题文本"}
            </button>
            <label className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50 cursor-pointer inline-flex items-center gap-1">
              <FileUp size={12} />
              <span>{uploading ? "解析中…" : "从 Word 导入到开题"}</span>
              <input
                type="file"
                accept=".docx"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  void handleUploadProposalDocx(f);
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {/* Pipeline is actively running (SSE detected OR persisted status says running) — show status, no start/continue */}
        {(currentStage !== null && !done) || pipelineStatus === "running" ? (
          <div className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
            <Loader2 size={14} className="animate-spin" />
            流水线运行中{((): string => { const s = currentStage; return s ? ` — ${STAGE_ZH[s] ?? s}` : ""; })()}
          </div>
        ) : pipelineStatus === "completed" ? (
          /* Pipeline finished successfully — only offer regenerate */
          <button
            type="button"
            disabled={restarting}
            onClick={() => void handleRestartPipeline()}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-card px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            重新生成
          </button>
        ) : hasProgress ? (
          /* Has previous progress (interrupted / stale state) */
          <>
            <button
              type="button"
              disabled={starting || restarting}
              onClick={() => void handleStartPipeline()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              继续上次流水线
            </button>
            <button
              type="button"
              disabled={starting || restarting}
              onClick={() => void handleRestartPipeline()}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-card px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              重新生成
            </button>
          </>
        ) : (
          /* Clean slate */
          <button
            type="button"
            disabled={starting}
            onClick={() => void handleStartPipeline()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            开始生成论文（全量流水线）
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-secondary/50"
        >
          <Download size={14} />
          仅导出当前 Word
        </button>
      </div>

      {downloadErr ? (
        <div className="mb-4 text-sm text-destructive">{downloadErr}</div>
      ) : null}

      {/* Pipeline Progress */}
      <div className="rounded-xl border border-border/60 bg-card/50 p-4 mb-4">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">流水线状态</div>

        {/* Stage progress bar */}
        <PipelineStageBar
          currentStage={currentStage}
          completedStages={allCompletedStages}
          error={error}
        />

        {/* Writing stage per-section progress */}
        {currentStage === "writing" && sectionTotal > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>正文撰写进度</span>
              <span>{sectionIndex} / {sectionTotal} 节</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.round((sectionIndex / sectionTotal) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Current stage label */}
        {stageLabel ? (
          <div className="text-sm mt-3">
            当前阶段：<span className="font-medium text-foreground">{stageLabel}</span>
          </div>
        ) : allCompletedStages.length > 0 ? (
          <div className="text-sm mt-3 text-muted-foreground">
            已完成的步骤将自动跳过；点击「开始生成论文」从上次中断处继续。
          </div>
        ) : (
          <div className="text-sm mt-3 text-muted-foreground">尚未收到阶段事件；点击「开始生成」后此处会更新。</div>
        )}

        {done && !error ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-2">流水线已完成。请点击「仅导出当前 Word」下载，或到导出页再次导出。</p>
        ) : null}
        {error ? <p className="text-sm text-destructive mt-2">{error}</p> : null}
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/20 p-3 max-h-64 overflow-y-auto">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">事件日志</div>
        <ul className="space-y-1 text-xs font-mono text-muted-foreground">
          {allLines.length === 0 ? <li>暂无</li> : null}
          {allLines.map((line) => (
            <li key={line.id} className="break-words">
              <span className="text-muted-foreground/60">{new Date(line.at).toLocaleTimeString()}</span>{" "}
              {line.stage ? <span className="text-primary/80">[{line.stage}] </span> : null}
              {line.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
