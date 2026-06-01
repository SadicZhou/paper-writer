import { useState, FormEvent } from "react";
import { useAuthStore } from "../store/auth";

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      await login(username, password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请检查用户名和密码");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* Left: branding */}
      <div className="hidden lg:flex w-1/2 items-center justify-center p-12" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1d4ed8 100%)" }}>
        <div className="max-w-md">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-8" style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
            P
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Paper Writer</h1>
          <p className="text-lg text-blue-200/80 leading-relaxed">
            学术论文 AI 写作平台管理后台。管理用户账号、查看使用数据、控制访问权限。
          </p>
          <div className="flex gap-6 mt-10">
            {[
              { value: "10+", label: "AI Agent" },
              { value: "4 种", label: "论文类型" },
              { value: "GB/APA", label: "引用格式" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-sm text-blue-200/60">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-3" style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}>
              P
            </div>
            <h2 className="text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>Paper Writer</h2>
            <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>管理后台</p>
          </div>

          <div className="p-8 rounded-2xl shadow-sm border" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
            <h2 className="text-xl font-bold mb-1" style={{ color: "var(--color-text-primary)" }}>登录</h2>
            <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>使用管理员账号登录后台系统</p>

            {error && (
              <div className="mb-5 p-3 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: "var(--color-danger-light)", color: "var(--color-danger)" }}>
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>用户名</label>
                <input
                  type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none transition-all border focus:ring-2"
                  style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                  placeholder="请输入用户名"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>密码</label>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm outline-none transition-all border focus:ring-2"
                  style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
                  placeholder="请输入密码"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
              >
                {loading ? "登录中..." : "登 录"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
