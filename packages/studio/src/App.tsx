import { useState, useEffect } from "react";
import { useHashRoute } from "./hooks/use-hash-route";
import type { HashRoute } from "./hooks/use-hash-route";
import { PaperSidebar } from "./components/PaperSidebar";
import { PaperHome } from "./pages/PaperHome";
import { PaperCreate } from "./pages/PaperCreate";
import { PaperWorkspace } from "./pages/PaperWorkspace";
import { SectionEditor } from "./pages/SectionEditor";
import { LiteraturePanel } from "./pages/LiteraturePanel";
import { DetectionPanel } from "./pages/DetectionPanel";
import { ExportPanel } from "./pages/ExportPanel";
import { ImportWord } from "./pages/ImportWord";
import { PaperGeneratePage } from "./pages/PaperGeneratePage";
import { ChatPage } from "./pages/ChatPage";
import { ServiceListPage } from "./pages/ServiceListPage";
import { ServiceDetailPage } from "./pages/ServiceDetailPage";
import { LogViewer } from "./pages/LogViewer";
import { DoctorView } from "./pages/DoctorView";
import { SetupHomePage } from "./pages/SetupHomePage";
import { LoginPage } from "./pages/LoginPage";
import { useAuthStore } from "./store/auth";
import { useSSE } from "./hooks/use-sse";
import { useSessionEvents } from "./hooks/use-session-events";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { fetchJson, postApi, putApi, useApi } from "./hooks/use-api";
import { Sun, Moon, Settings, LogOut } from "lucide-react";
import { House } from "lucide-react";

export type { HashRoute as Route } from "./hooks/use-hash-route";

export function deriveActivePaperId(route: HashRoute): string | undefined {
  if ("paperId" in route) return (route as { paperId: string }).paperId;
  return undefined;
}

export function App() {
  const { route, setRoute } = useHashRoute();
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t, lang: currentLang } = useI18n();
  const { data: project, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>("/project");
  const [ready, setReady] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [hasAnyKey, setHasAnyKey] = useState(false);
  const [skipSetupGate, setSkipSetupGate] = useState(false);
  const [checkTrigger, setCheckTrigger] = useState(0);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authUser = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const authLoadFromStorage = useAuthStore((s) => s.loadFromStorage);

  useEffect(() => { authLoadFromStorage(); }, [authLoadFromStorage]);

  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (project) {
      setReady(true);
    }
  }, [project]);

  /**
   * 配置页状态守卫：
   * 路由切换（尤其是从服务详情返回列表）时重新检查 API Key，
   * 避免保存成功后仍停留在“未配置”状态。
   * @author zjh
   * @date 2026-05-11
   */
  useEffect(() => {
    if (!ready || !project) return;
    fetchJson<{ services: Array<{ hasApiKey: boolean }> }>("/services")
      .then((data) => {
        const hasKey = (data.services ?? []).some((s) => s.hasApiKey);
        setHasAnyKey(hasKey);
        setNeedsSetup(!project.languageExplicit || !hasKey);
      })
      .catch(() => {})
      .finally(() => setSetupChecked(true));
  }, [ready, project, checkTrigger, route.page]);

  useSessionEvents(sse, route, setRoute);

  const nav = {
    toDashboard: () => setRoute({ page: "dashboard" }),
    /** 打开论文时的默认落地：一键生成页 */
    toPaper: (paperId: string) => setRoute({ page: "paper-generate", paperId }),
    toPaperWorkspace: (paperId: string) => setRoute({ page: "paper-workspace", paperId }),
    toPaperChat: (paperId: string) => setRoute({ page: "paper-chat", paperId }),
    toPaperCreate: () => setRoute({ page: "paper-create" }),
    toPaperSection: (paperId: string, sectionNumber: string) =>
      setRoute({ page: "paper-section", paperId, sectionNumber }),
    toPaperLiterature: (paperId: string) =>
      setRoute({ page: "paper-literature", paperId }),
    toPaperDetection: (paperId: string) =>
      setRoute({ page: "paper-detection", paperId }),
    toPaperExport: (paperId: string) =>
      setRoute({ page: "paper-export", paperId }),
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
    toLogs: () => setRoute({ page: "logs" }),
    toImportWord: (paperId: string) => setRoute({ page: "import-word", paperId }),
    toDoctor: () => setRoute({ page: "doctor" }),
  };

  const activePaperId = deriveActivePaperId(route);
  const activePage =
    activePaperId
      ? `paper:${activePaperId}`
      : route.page === "service-detail"
        ? "services"
        : route.page;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={authLoadFromStorage} />;
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!setupChecked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (needsSetup && !skipSetupGate && route.page === "dashboard") {
    return (
      <SetupHomePage
        language={currentLang}
        languageExplicit={Boolean(project?.languageExplicit)}
        hasApiKey={hasAnyKey}
        theme={theme}
        onSelectLanguage={async (lang) => {
          await postApi("/project/language", { language: lang });
          await refetchProject();
          setCheckTrigger((c) => c + 1);
        }}
        onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
        onGoDashboard={() => {
          setSkipSetupGate(true);
          nav.toDashboard();
        }}
        toServiceDetail={nav.toServiceDetail}
        onStayHere={() => setCheckTrigger((c) => c + 1)}
      />
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Left Sidebar */}
      <PaperSidebar nav={nav} activePage={activePage} sse={sse} />

      {/* Center Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/30 backdrop-blur-sm">
        {/* Header Strip */}
        <header className="h-14 shrink-0 flex items-center justify-between px-8 border-b border-border/40">
          <div className="flex items-center gap-2">
            <button
              onClick={nav.toDashboard}
              className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary/50 transition-colors"
            >
              <House size={14} />
              <span>首页</span>
              <span className="text-muted-foreground/70">/</span>
              <span className="font-serif">Paper Writer</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex gap-0.5 bg-muted/50 rounded-md p-0.5">
              <button
                onClick={async () => {
                  await putApi("/project", { language: "zh" });
                  refetchProject();
                }}
                className={`text-xs px-2 py-0.5 rounded ${currentLang === "zh" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                中
              </button>
              <button
                onClick={async () => {
                  await putApi("/project", { language: "en" });
                  refetchProject();
                }}
                className={`text-xs px-2 py-0.5 rounded ${currentLang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                EN
              </button>
            </div>

            <button
              onClick={nav.toServices}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-card/70 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/50 transition-colors"
            >
              <Settings size={13} />
              <span>模型配置</span>
            </button>
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {isDark ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <span className="text-xs text-muted-foreground">{authUser?.username}</span>
            <button
              onClick={authLogout}
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 bg-card/70 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={12} />
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-y-auto scroll-smooth">
          {route.page === "dashboard" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <PaperHome nav={{ ...nav, toServices: nav.toServices }} />
            </div>
          )}
          {route.page === "paper-create" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <PaperCreate nav={nav} />
            </div>
          )}
          {route.page === "paper-workspace" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <PaperWorkspace paperId={route.paperId} nav={nav} />
            </div>
          )}
          {route.page === "paper-generate" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <PaperGeneratePage paperId={route.paperId} nav={nav} sseMessages={sse.messages} sseReconnectCount={sse.reconnectCount} />
            </div>
          )}
          {route.page === "paper-chat" && (
            <div className="absolute inset-0 flex min-w-0">
              <ChatPage
                activeBookId={route.paperId}
                nav={{ ...nav, toBook: nav.toPaper } as never}
                theme={theme}
                t={t}
                sse={sse}
              />
            </div>
          )}
          {route.page === "paper-section" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <SectionEditor paperId={route.paperId} sectionNumber={route.sectionNumber} nav={nav} />
            </div>
          )}
          {route.page === "paper-literature" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <LiteraturePanel paperId={route.paperId} nav={nav} />
            </div>
          )}
          {route.page === "paper-detection" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <DetectionPanel paperId={route.paperId} nav={nav} />
            </div>
          )}
          {route.page === "paper-export" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ExportPanel paperId={route.paperId} nav={nav} />
            </div>
          )}
          {route.page === "import-word" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ImportWord paperId={route.paperId} nav={nav} />
            </div>
          )}
          {route.page === "services" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ServiceListPage nav={nav as never} />
            </div>
          )}
          {route.page === "service-detail" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <ServiceDetailPage serviceId={route.serviceId} nav={nav as never} />
            </div>
          )}
          {route.page === "logs" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <LogViewer nav={nav as never} theme={theme} t={t} />
            </div>
          )}
          {route.page === "doctor" && (
            <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
              <DoctorView nav={nav as never} theme={theme} t={t} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
