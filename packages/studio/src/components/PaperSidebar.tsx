import { useApi } from "../hooks/use-api";
import { useChatStore } from "../store/chat";
import type { SSEMessage } from "../hooks/use-sse";
import {
  Settings,
  Terminal,
  Plus,
  ScrollText,
  Stethoscope,
  FileInput,
  FileText,
  ChevronRight,
  BookOpen,
  Shield,
  Download,
  MessageSquare,
  Play,
  LayoutDashboard,
} from "lucide-react";

interface PaperSummary {
  id: string;
  title: string;
  major: string;
  degreeLevel: string;
  totalSections: number;
  completedSections: number;
  pipelineStage: string;
  aiDetectionScore?: number;
}

interface SidebarNav {
  toDashboard: () => void;
  toPaper: (id: string) => void;
  toPaperWorkspace: (paperId: string) => void;
  toPaperChat: (paperId: string) => void;
  toPaperCreate: () => void;
  toPaperSection: (paperId: string, sectionNumber: string) => void;
  toPaperLiterature: (paperId: string) => void;
  toPaperDetection: (paperId: string) => void;
  toPaperExport: (paperId: string) => void;
  toServices: () => void;
  toLogs: () => void;
  toImportWord: (paperId: string) => void;
  toDoctor: () => void;
}

export function PaperSidebar({ nav, activePage, sse }: {
  nav: SidebarNav;
  activePage: string;
  sse: { messages: ReadonlyArray<SSEMessage> };
}) {
  const { data } = useApi<{ papers: PaperSummary[] }>("/papers");
  const papers = data?.papers ?? [];

  const activePaperId = activePage.startsWith("paper:")
    ? activePage.replace("paper:", "")
    : undefined;

  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-background/80 backdrop-blur-md flex flex-col h-full overflow-hidden select-none">
      {/* Logo */}
      <div className="px-6 py-8">
        <button
          onClick={nav.toDashboard}
          className="group flex items-center gap-2 hover:opacity-80 transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
            <ScrollText size={18} />
          </div>
          <div className="flex flex-col">
            <span className="font-serif text-xl leading-none italic font-medium">Paper</span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mt-1">Writer</span>
          </div>
        </button>
      </div>

      {/* Papers Section */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        <div>
          <div className="px-3 mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              论文
            </span>
            <button
              onClick={nav.toPaperCreate}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
            >
              <Plus size={12} />
              <span>新建</span>
            </button>
          </div>

          <div className="space-y-0.5">
            {papers.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/50 italic text-center">
                暂无论文 — 点击"新建"开始
              </div>
            ) : (
              papers.map((paper) => {
                const isActive = activePaperId === paper.id;
                return (
                  <div key={paper.id}>
                    <button
                      onClick={() => nav.toPaper(paper.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                        isActive
                          ? "bg-secondary text-foreground font-medium shadow-sm border border-border"
                          : "text-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <FileText size={14} className={`shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="truncate flex-1 text-left">{paper.title}</span>
                      {paper.aiDetectionScore !== undefined && (
                        <span className={`text-[10px] font-mono shrink-0 ${
                          paper.aiDetectionScore < 0.3 ? "text-emerald-500" :
                          paper.aiDetectionScore < 0.5 ? "text-amber-500" : "text-red-500"
                        }`}>
                          {(paper.aiDetectionScore * 100).toFixed(0)}%
                        </span>
                      )}
                    </button>

                    {/* Paper sub-nav */}
                    {isActive && (
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        <PaperSubItem
                          icon={<Play size={13} />}
                          label="论文生成"
                          onClick={() => nav.toPaper(paper.id)}
                        />
                        <PaperSubItem
                          icon={<LayoutDashboard size={13} />}
                          label="工作台"
                          onClick={() => nav.toPaperWorkspace(paper.id)}
                        />
                        <PaperSubItem
                          icon={<MessageSquare size={13} />}
                          label="高级指令"
                          onClick={() => nav.toPaperChat(paper.id)}
                        />
                        <PaperSubItem
                          icon={<BookOpen size={13} />}
                          label="文献"
                          onClick={() => nav.toPaperLiterature(paper.id)}
                        />
                        <PaperSubItem
                          icon={<Shield size={13} />}
                          label="AI检测"
                          onClick={() => nav.toPaperDetection(paper.id)}
                        />
                        <PaperSubItem
                          icon={<Download size={13} />}
                          label="导出"
                          onClick={() => nav.toPaperExport(paper.id)}
                        />
                        <PaperSubItem
                          icon={<FileInput size={13} />}
                          label="导入Word"
                          onClick={() => nav.toImportWord(paper.id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* System Section */}
        <div>
          <div className="px-3 mb-2">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground font-bold">
              系统
            </span>
          </div>
          <div className="space-y-0.5">
            <SidebarItem
              icon={<Settings size={16} />}
              label="模型配置"
              active={activePage === "services"}
              onClick={nav.toServices}
            />
            <SidebarItem
              icon={<Terminal size={16} />}
              label="日志"
              active={activePage === "logs"}
              onClick={nav.toLogs}
            />
            <SidebarItem
              icon={<Stethoscope size={16} />}
              label="环境诊断"
              active={activePage === "doctor"}
              onClick={nav.toDoctor}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        active
          ? "bg-secondary text-foreground font-medium shadow-sm border border-border"
          : "text-foreground hover:text-foreground hover:bg-secondary/50"
      }`}
    >
      <span className={`transition-colors ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function PaperSubItem({ icon, label, onClick }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 pl-4 pr-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
