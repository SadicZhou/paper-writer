import { useApi } from "../hooks/use-api";
import { Loader2, Play, FileText, BookOpen, Shield, Download, ArrowLeft, MessageSquare } from "lucide-react";

interface PaperDetail {
  id: string;
  title: string;
  major: string;
  degreeLevel: string;
  targetWordCount: number;
  citationFormat: string;
  language: string;
}

interface PaperSectionSummary {
  sectionNumber: string;
  title: string;
  wordCount: number;
  status: string;
  aiDetectionScore?: number;
}

interface PaperOutline {
  title: string;
  sections: OutlineSection[];
}

interface OutlineSection {
  id: string;
  number: string;
  title: string;
  type: string;
  wordCount: number;
  status: string;
  children: OutlineSection[];
}

interface Nav {
  toDashboard: () => void;
  toPaper: (paperId: string) => void;
  toPaperSection: (paperId: string, sectionNumber: string) => void;
  toPaperLiterature: (paperId: string) => void;
  toPaperDetection: (paperId: string) => void;
  toPaperExport: (paperId: string) => void;
  toPaperChat: (paperId: string) => void;
}

export function PaperWorkspace({ paperId, nav }: { paperId: string; nav: Nav }) {
  const { data: paper, loading } = useApi<PaperDetail>(`/papers/${paperId}`);
  const { data: sectionsData } = useApi<{ sections: PaperSectionSummary[] }>(`/papers/${paperId}/sections`);
  const { data: outlineData } = useApi<PaperOutline>(`/papers/${paperId}/outline`);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!paper) return null;

  const sections = sectionsData?.sections ?? [];
  const outline = outlineData?.sections ?? [];
  const totalWords = sections.reduce((s, sec) => s + sec.wordCount, 0);
  const completedSections = sections.filter((s) => s.status === "approved" || s.status === "drafted" || s.status === "polishing").length;

  return (
    <div className="max-w-5xl mx-auto">
      <button
        onClick={nav.toDashboard}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
      >
        <ArrowLeft size={14} />
        <span>返回列表</span>
      </button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2">{paper.title}</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{paper.major}</span>
          <span>·</span>
          <span>{paper.degreeLevel === "undergraduate" ? "本科" : paper.degreeLevel === "master" ? "硕士" : "博士"}</span>
          <span>·</span>
          <span>目标 {paper.targetWordCount.toLocaleString()} 字</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        <StatCard label="章节进度" value={`${completedSections}/${sections.length}`} icon={<FileText size={16} />} />
        <StatCard label="总字数" value={totalWords.toLocaleString()} icon={<BookOpen size={16} />} />
        <StatCard label="引用格式" value={paper.citationFormat.toUpperCase()} icon={<Shield size={16} />} />
        <StatCard label="语言" value={paper.language === "zh" ? "中文" : "EN"} icon={<Download size={16} />} />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-8">
        <button
          onClick={() => nav.toPaper(paperId)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-colors"
        >
          <Play size={14} />
          <span>论文生成</span>
        </button>
        <button
          onClick={() => nav.toPaperChat(paperId)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-secondary/50 transition-colors"
        >
          <MessageSquare size={14} />
          <span>高级指令（对话）</span>
        </button>
        <button
          onClick={() => nav.toPaperLiterature(paperId)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-secondary/50 transition-colors"
        >
          <BookOpen size={14} />
          <span>文献管理</span>
        </button>
        <button
          onClick={() => nav.toPaperDetection(paperId)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-secondary/50 transition-colors"
        >
          <Shield size={14} />
          <span>AI 检测</span>
        </button>
        <button
          onClick={() => nav.toPaperExport(paperId)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm hover:bg-secondary/50 transition-colors"
        >
          <Download size={14} />
          <span>导出</span>
        </button>
      </div>

      {/* Sections table */}
      <div>
        <h2 className="text-lg font-semibold mb-4">章节大纲</h2>
        {outline.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            尚未生成大纲 — 请打开「论文生成」一键运行全量流水线（构思 → 文献 → 大纲 → 写作 → 导出 Word）。
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <OutlineTree
              sections={outline}
              depth={0}
              paperId={paperId}
              sectionsData={sections}
              onSectionClick={(sectionNumber) => nav.toPaperSection(paperId, sectionNumber)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function OutlineTree({
  sections,
  depth,
  paperId,
  sectionsData,
  onSectionClick,
}: {
  sections: OutlineSection[];
  depth: number;
  paperId: string;
  sectionsData: PaperSectionSummary[];
  onSectionClick: (sectionNumber: string) => void;
}) {
  return (
    <>
      {sections.map((section) => {
        const sectionData = sectionsData.find((s) => s.sectionNumber === section.number);
        const statusColor =
          sectionData?.status === "approved"
            ? "bg-emerald-500"
            : sectionData?.status === "drafted"
              ? "bg-blue-500"
              : sectionData?.status === "writing"
                ? "bg-amber-500 animate-pulse"
                : "bg-muted-foreground/20";

        return (
          <div key={section.id}>
            <button
              onClick={() => onSectionClick(section.number)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors text-left border-b border-border/30"
              style={{ paddingLeft: `${16 + depth * 24}px` }}
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} />
              <span className="text-xs text-muted-foreground font-mono shrink-0 w-12">{section.number}</span>
              <span className="text-sm flex-1 truncate">{section.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">{section.wordCount} 字</span>
              {sectionData?.aiDetectionScore !== undefined && (
                <span className={`text-xs font-mono shrink-0 ${
                  sectionData.aiDetectionScore < 0.3 ? "text-emerald-500" :
                  sectionData.aiDetectionScore < 0.5 ? "text-amber-500" : "text-red-500"
                }`}>
                  {(sectionData.aiDetectionScore * 100).toFixed(0)}%
                </span>
              )}
            </button>
            {section.children.length > 0 && (
              <OutlineTree
                sections={section.children}
                depth={depth + 1}
                paperId={paperId}
                sectionsData={sectionsData}
                onSectionClick={onSectionClick}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
