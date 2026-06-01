import { useState, useEffect } from "react";
import { useApi, postApi, fetchJson } from "../hooks/use-api";
import { Plus, FileText, Loader2, Trash2, AlertTriangle, Settings } from "lucide-react";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface PaperSummary {
  id: string;
  title: string;
  major: string;
  degreeLevel: "undergraduate" | "master" | "doctor";
  totalSections: number;
  completedSections: number;
  totalWords: number;
  aiDetectionScore?: number;
  pipelineStage: string;
  createdAt: string;
  updatedAt: string;
}

interface Nav {
  toDashboard: () => void;
  toPaper: (id: string) => void;
  toPaperCreate: () => void;
  toServices: () => void;
}

const degreeLabels: Record<string, string> = {
  undergraduate: "本科",
  master: "硕士",
  doctor: "博士",
};

const stageLabels: Record<string, string> = {
  idle: "未开始",
  brainstorm: "选题构思",
  "literature-search": "文献检索",
  outline: "大纲构建",
  writing: "正文撰写",
  polish: "润色降重",
  "format-export": "格式导出",
};

export function PaperHome({ nav }: { nav: Nav }) {
  const { data, loading, refetch } = useApi<{ papers: PaperSummary[] }>("/papers");
  const [deleteTarget, setDeleteTarget] = useState<PaperSummary | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);

  useEffect(() => {
    fetchJson<{ services: Array<{ hasApiKey: boolean }> }>("/services")
      .then((d) => setNeedsApiKey(!(d.services ?? []).some((s) => s.hasApiKey)))
      .catch(() => {});
  }, []);

  const papers = data?.papers ?? [];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await postApi(`/papers/${deleteTarget.id}/delete`, {});
    setDeleteTarget(null);
    refetch();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      {needsApiKey && (
        <div className="mb-6 rounded-xl border-2 border-amber-500/30 bg-amber-500/[0.06] p-5 flex items-start gap-4">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground mb-1">未配置 API 密钥</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Paper Writer 需要接入大语言模型才能工作。请先配置至少一个服务商的 API Key。
            </p>
            <button
              onClick={nav.toServices}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-amber-600 transition-colors"
            >
              <Settings size={13} />
              <span>前往配置</span>
            </button>
          </div>
        </div>
      )}
      <div className="mb-6 rounded-xl border border-border/60 bg-card/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          开始写论文请使用「论文生成」一键跑全量流水线并下载 Word；此处不展开写作方法论。若无项目请先新建论文。
        </p>
        <button
          type="button"
          onClick={nav.toPaperCreate}
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          <span>新建论文</span>
        </button>
      </div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">论文列表 — v2</h1>
          <p className="text-sm text-muted-foreground mt-1">管理你的学术论文项目</p>
        </div>
        <button
          onClick={nav.toPaperCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          <span>新建论文</span>
        </button>
      </div>

      {papers.length === 0 ? (
        <div className="text-center py-20">
          <FileText size={48} className="mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm">暂无论文项目</p>
          <p className="text-muted-foreground/60 text-xs mt-1">点击"新建论文"开始</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {papers.map((paper) => (
            <div
              key={paper.id}
              className="group rounded-xl border border-border/60 bg-card p-5 hover:border-border hover:shadow-sm transition-all cursor-pointer"
              onClick={() => nav.toPaper(paper.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold truncate">{paper.title}</h3>
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {degreeLabels[paper.degreeLevel]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{paper.major}</p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>章节: {paper.completedSections}/{paper.totalSections}</span>
                    <span>字数: {paper.totalWords.toLocaleString()}</span>
                    <span>阶段: {stageLabels[paper.pipelineStage] ?? paper.pipelineStage}</span>
                    {paper.aiDetectionScore !== undefined && (
                      <span className={`font-mono ${paper.aiDetectionScore < 0.3 ? "text-emerald-500" : paper.aiDetectionScore < 0.5 ? "text-amber-500" : "text-red-500"}`}>
                        AI: {(paper.aiDetectionScore * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(paper);
                  }}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Progress bar */}
              <div className="mt-3 h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{
                    width: `${paper.totalSections > 0 ? (paper.completedSections / paper.totalSections) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除论文"
        message={`确认删除「${deleteTarget?.title ?? ""}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        cancelLabel="取消"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
