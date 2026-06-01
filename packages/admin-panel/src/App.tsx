import { useEffect, useState } from "react";
import { useAuthStore } from "./store/auth";
import { LoginPage } from "./pages/LoginPage";
import { Dashboard } from "./pages/Dashboard";
import { UserManagement } from "./pages/UserManagement";
import { UsageStats } from "./pages/UsageStats";

type Page = "dashboard" | "users" | "usage";

const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
  { key: "dashboard", label: "仪表盘", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { key: "users", label: "用户管理", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { key: "usage", label: "用量统计", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
];

function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  return (
    <aside className="w-60 shrink-0 flex flex-col h-screen" style={{ backgroundColor: "var(--color-bg-sidebar)" }}>
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
          P
        </div>
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--color-text-sidebar-active)" }}>Paper Writer</div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>管理后台</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = page === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
              style={{
                color: isActive ? "var(--color-text-sidebar-active)" : "var(--color-text-sidebar)",
                backgroundColor: isActive ? "var(--color-bg-sidebar-active)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.target as HTMLElement).style.backgroundColor = "var(--color-bg-sidebar-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.target as HTMLElement).style.backgroundColor = "transparent";
              }}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* User footer */}
      <UserFooter />
    </aside>
  );
}

function UserFooter() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="p-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: "linear-gradient(135deg, #06b6d4, #3b82f6)" }}>
          {(user?.username ?? "A")[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: "var(--color-text-sidebar-active)" }}>{user?.username}</div>
          <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>管理员</div>
        </div>
        <button
          onClick={logout}
          className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
          style={{ color: "var(--color-text-muted)" }}
          title="退出登录"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function AdminLayout({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        {page === "dashboard" && <Dashboard />}
        {page === "users" && <UserManagement />}
        {page === "usage" && <UsageStats />}
      </main>
    </div>
  );
}

export function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>加载中...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={() => loadFromStorage()} />;
  }

  if (user?.role !== "admin") {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg-primary)" }}>
        <div className="text-center p-8 rounded-xl shadow-lg" style={{ backgroundColor: "var(--color-bg-card)" }}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-danger-light)" }}>
            <svg className="w-8 h-8" style={{ color: "var(--color-danger)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--color-text-primary)" }}>无访问权限</h2>
          <p className="mb-6" style={{ color: "var(--color-text-secondary)" }}>此账号不是管理员，请使用管理员账号登录后台系统。</p>
          <button onClick={logout} className="px-5 py-2.5 rounded-lg text-white font-medium transition-colors" style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
            返回登录
          </button>
        </div>
      </div>
    );
  }

  return <AdminLayout onLogout={logout} />;
}
