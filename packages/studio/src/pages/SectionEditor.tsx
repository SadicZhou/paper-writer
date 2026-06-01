import { useState } from "react";
import { useApi, postApi, putApi } from "../hooks/use-api";
import { ArrowLeft, Loader2, RefreshCw, Shield } from "lucide-react";

interface SectionDetail {
  sectionNumber: string;
  title: string;
  content: string;
  wordCount: number;
  status: string;
  aiDetectionScore?: number;
  citations: string[];
  lastModified: string;
}

interface Nav {
  toPaperWorkspace: (paperId: string) => void;
}

export function SectionEditor({ paperId, sectionNumber, nav }: { paperId: string; sectionNumber: string; nav: Nav }) {
  const { data, loading, refetch } = useApi<SectionDetail>(`/papers/${paperId}/sections/${sectionNumber}`);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionScore, setDetectionScore] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  const section = data;

  const handleEdit = () => {
    setEditContent(section?.content ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    if (!section) return;
    setSaving(true);
    try {
      await putApi(`/papers/${paperId}/sections/${section.sectionNumber}`, { content: editContent });
      setEditing(false);
      refetch();
    } finally {
      setSaving(false);
    }
  };

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await postApi<{ score: number }>(`/papers/${paperId}/detect/${section?.sectionNumber}`, {});
      setDetectionScore(result.score);
    } finally {
      setDetecting(false);
    }
  };

  const handleRegenerate = async () => {
    setSaving(true);
    try {
      await postApi(`/papers/${paperId}/sections/${section?.sectionNumber}/regenerate`, {});
      // Don't refetch immediately — regeneration is async and driven by SSE events.
      // Refetching now would reset scroll position without showing new content.
    } finally {
      setSaving(false);
    }
  };

  const score = detectionScore ?? section?.aiDetectionScore;
  const scoreColor = score !== undefined
    ? score < 0.3 ? "text-emerald-500" : score < 0.5 ? "text-amber-500" : "text-red-500"
    : "";

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => nav.toPaperWorkspace(paperId)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回工作台</span>
      </button>

      {section ? (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold">
                <span className="text-muted-foreground font-mono text-sm mr-2">{section.sectionNumber}</span>
                {section.title}
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{section.wordCount} 字</span>
                <span>·</span>
                <span>状态: {section.status}</span>
                {score !== undefined && (
                  <>
                    <span>·</span>
                    <span className={`font-mono ${scoreColor}`}>AI: {(score * 100).toFixed(0)}%</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleDetect()}
                disabled={detecting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                {detecting ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />}
                <span>检测AI</span>
              </button>
              <button
                onClick={() => void handleRegenerate()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} />
                <span>AI重写</span>
              </button>
              {!editing && (
                <button
                  onClick={handleEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  编辑
                </button>
              )}
            </div>
          </div>

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={24}
                className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-serif leading-relaxed outline-none focus:border-primary/50 resize-y"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-secondary/50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  <span>保存</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-8">
              <div className="prose prose-sm max-w-none dark:prose-invert font-serif leading-relaxed whitespace-pre-wrap">
                {section.content || (
                  <span className="text-muted-foreground italic">本节尚未撰写</span>
                )}
              </div>
            </div>
          )}

          {/* Citations */}
          {section.citations.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2">引用</h3>
              <div className="flex flex-wrap gap-1.5">
                {section.citations.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground font-mono">
                    [{c}]
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-muted-foreground">未找到此章节</div>
      )}
    </div>
  );
}
