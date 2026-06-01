import { CheckCircle2, Circle, Moon, Sun } from "lucide-react";
import { ServiceListPage } from "./ServiceListPage";

interface SetupHomePageProps {
  readonly language: "zh" | "en";
  readonly languageExplicit: boolean;
  readonly hasApiKey: boolean;
  readonly theme: "light" | "dark";
  readonly onSelectLanguage: (lang: "zh" | "en") => Promise<void>;
  readonly onToggleTheme: () => void;
  readonly onGoDashboard: () => void;
  readonly toServiceDetail: (id: string) => void;
  readonly onStayHere: () => void;
}

/**
 * 启动首页（统一配置页）：
 * 合并语言设置与模型 API 设置，降低首次使用门槛。
 * @author zjh
 * @date 2026-05-11
 */
export function SetupHomePage(props: SetupHomePageProps) {
  const allReady = props.languageExplicit && props.hasApiKey;
  const isDark = props.theme === "dark";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 space-y-8">
        <div className="flex justify-end">
          <button
            onClick={props.onToggleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50 transition-colors"
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
            <span>{isDark ? "浅色" : "深色"}</span>
          </button>
        </div>

        <section className="rounded-xl border border-border/50 bg-card/60 p-6 space-y-5">
          <div>
            <h1 className="text-xl font-semibold text-foreground">开始配置 Paper Writer</h1>
            <p className="text-sm text-muted-foreground mt-1">
              请先完成语言与模型服务配置，完成后即可进入论文工作台。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => void props.onSelectLanguage("zh")}
              className={[
                "rounded-lg border p-4 text-left transition-colors",
                props.language === "zh" ? "border-primary bg-primary/5" : "border-border/60 hover:bg-secondary/40",
              ].join(" ")}
            >
              <div className="font-medium text-foreground">中文</div>
              <div className="text-xs text-muted-foreground mt-1">适用于中文论文写作</div>
            </button>

            <button
              onClick={() => void props.onSelectLanguage("en")}
              className={[
                "rounded-lg border p-4 text-left transition-colors",
                props.language === "en" ? "border-primary bg-primary/5" : "border-border/60 hover:bg-secondary/40",
              ].join(" ")}
            >
              <div className="font-medium text-foreground">English</div>
              <div className="text-xs text-muted-foreground mt-1">For academic writing in English</div>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="inline-flex items-center gap-1.5 text-muted-foreground">
              {props.languageExplicit ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Circle size={14} />}
              <span>语言已设置</span>
            </div>
            <div className="inline-flex items-center gap-1.5 text-muted-foreground">
              {props.hasApiKey ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Circle size={14} />}
              <span>模型 API 已配置</span>
            </div>
          </div>

          {allReady && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400">
              配置已完成，点击左侧“首页”即可进入工作台。
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="text-sm font-medium text-foreground">模型服务配置</div>
          <ServiceListPage
            nav={{
              toDashboard: props.onGoDashboard,
              toServiceDetail: props.toServiceDetail,
            }}
          />
        </section>
      </div>
    </div>
  );
}
