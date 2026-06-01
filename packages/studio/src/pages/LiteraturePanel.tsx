import { useApi, postApi } from "../hooks/use-api";
import { ArrowLeft, Loader2, Search, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface Reference {
  id: string;
  type: string;
  title: string;
  authors: string[];
  year: number;
  journal?: string;
  rawCitation: string;
}

interface Nav {
  toPaperWorkspace: (paperId: string) => void;
}

export function LiteraturePanel({ paperId, nav }: { paperId: string; nav: Nav }) {
  const { data, loading, refetch } = useApi<{ references: Reference[] }>(`/papers/${paperId}/references`);
  const [searching, setSearching] = useState(false);
  const references = data?.references ?? [];

  const handleSearch = async () => {
    setSearching(true);
    try {
      await postApi(`/papers/${paperId}/pipeline/search-literature`, {});
      refetch();
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

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
        <h1 className="text-xl font-bold">文献管理</h1>
        <button
          onClick={() => void handleSearch()}
          disabled={searching}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          <span>智能检索</span>
        </button>
      </div>

      {references.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          暂无文献 — 点击"智能检索"自动搜索
        </div>
      ) : (
        <div className="space-y-2">
          {references.map((ref, i) => (
            <div key={ref.id} className="rounded-lg border border-border/60 bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">[{i + 1}]</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{ref.rawCitation || `${ref.authors.join(", ")}. ${ref.title}. ${ref.journal ?? ""}, ${ref.year}.`}</p>
                  <span className="text-[10px] text-muted-foreground uppercase mt-1">{ref.type}</span>
                </div>
                <button className="shrink-0 p-1 text-muted-foreground/30 hover:text-red-500 transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
