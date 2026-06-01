import { useApi, postApi } from "../hooks/use-api";
import { ArrowLeft, Loader2, Shield, RefreshCw } from "lucide-react";
import { useState } from "react";

interface DetectionStats {
  sections: Array<{
    sectionNumber: string;
    title: string;
    score: number;
    status: string;
  }>;
  averageScore: number;
}

interface Nav {
  toPaperWorkspace: (paperId: string) => void;
}

export function DetectionPanel({ paperId, nav }: { paperId: string; nav: Nav }) {
  const { data, loading, refetch } = useApi<DetectionStats>(`/papers/${paperId}/detection-stats`);
  const [detecting, setDetecting] = useState(false);

  const handleDetectAll = async () => {
    setDetecting(true);
    try {
      await postApi(`/papers/${paperId}/detect-all`, {});
      refetch();
    } finally {
      setDetecting(false);
    }
  };

  const handleReduce = async () => {
    setDetecting(true);
    try {
      await postApi(`/papers/${paperId}/reduce-ai-all`, {});
      refetch();
    } finally {
      setDetecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  const sections = data?.sections ?? [];
  const avgScore = data?.averageScore;

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => nav.toPaperWorkspace(paperId)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回工作台</span>
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">AI 检测</h1>
          {avgScore !== undefined && (
            <p className={`text-sm font-mono mt-1 ${
              avgScore < 0.3 ? "text-emerald-500" : avgScore < 0.5 ? "text-amber-500" : "text-red-500"
            }`}>
              平均分: {(avgScore * 100).toFixed(1)}%
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void handleDetectAll()}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            <Shield size={12} />
            <span>全量检测</span>
          </button>
          <button
            onClick={() => void handleReduce()}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw size={12} />
            <span>降重</span>
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          暂无检测数据 — 请先撰写章节后执行检测
        </div>
      ) : (
        <div className="space-y-2">
          {sections.map((section) => {
            const scoreColor = section.score < 0.3 ? "text-emerald-500 bg-emerald-500/5 border-emerald-500/20" :
              section.score < 0.5 ? "text-amber-500 bg-amber-500/5 border-amber-500/20" :
              "text-red-500 bg-red-500/5 border-red-500/20";

            return (
              <div key={section.sectionNumber} className={`rounded-lg border p-4 ${scoreColor}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-mono text-muted-foreground mr-2">{section.sectionNumber}</span>
                    <span className="text-sm">{section.title}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted-foreground">{section.status}</span>
                    <span className="text-lg font-bold font-mono">{(section.score * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
