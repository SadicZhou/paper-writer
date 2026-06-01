import { useEffect, useState } from "react";
import { useAuthStore } from "../store/auth";

interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

interface UsageTrends {
  days: number;
  byAgent: Record<string, AgentUsage>;
  totalTokens: number;
  totalCalls: number;
}

export function UsageStats() {
  const [data, setData] = useState<UsageTrends | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetch(`/api/v1/admin/usage?days=${days}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, [accessToken, days]);

  if (!data) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span style={{ color: "var(--color-text-muted)" }}>加载中...</span>
        </div>
      </div>
    );
  }

  const agents = Object.entries(data.byAgent).sort((a, b) => b[1].totalTokens - a[1].totalTokens);
  const maxTokens = agents.length > 0 ? Math.max(...agents.map(([, u]) => u.totalTokens)) : 1;

  const agentNames: Record<string, string> = {
    "Topic Brainstormer": "选题分析",
    "Literature Searcher": "文献检索",
    "Outline Builder": "大纲构建",
    "Section Writer": "逐节写作",
    "Academic Polisher": "学术润色",
    "AI Detection Auditor": "AI检测",
    "AI Reduction Reviser": "AI降重",
    "Diagram Verifier": "图表验证",
    "Citation Formatter": "引用格式化",
    "Word Exporter": "文档导出",
  };

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return n.toString();
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text-primary)" }}>用量统计</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>LLM Token 消耗与 API 调用分析</p>
        </div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}
          className="px-4 py-2.5 rounded-lg text-sm border outline-none"
          style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "总 Token 消耗", value: formatTokens(data.totalTokens), sub: `${days} 天累计`, color: "#3b82f6", bg: "#eff6ff" },
          { label: "总 API 调用", value: data.totalCalls.toLocaleString(), sub: "请求次数", color: "#7c3aed", bg: "#f5f3ff" },
          { label: "Agent 类型", value: agents.length, sub: "活跃 Agent", color: "#16a34a", bg: "#f0fdf4" },
          { label: "平均每次", value: formatTokens(data.totalCalls > 0 ? Math.round(data.totalTokens / data.totalCalls) : 0), sub: "Token / 请求", color: "#d97706", bg: "#fffbeb" },
        ].map((card) => (
          <div key={card.label} className="p-5 rounded-xl border" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
            <div className="text-xs font-medium mb-3" style={{ color: "var(--color-text-muted)" }}>{card.label}</div>
            <div className="text-2xl font-bold" style={{ color: "var(--color-text-primary)" }}>{card.value}</div>
            <div className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="p-6 rounded-xl border mb-8" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-6" style={{ color: "var(--color-text-primary)" }}>各 Agent Token 消耗分布</h2>
        {agents.length === 0 ? (
          <div className="py-12 text-center" style={{ color: "var(--color-text-muted)" }}>暂无数据</div>
        ) : (
          <div className="space-y-4">
            {agents.map(([name, usage], i) => {
              const percent = Math.max(2, Math.round((usage.totalTokens / maxTokens) * 100));
              const colors = ["#3b82f6", "#7c3aed", "#16a34a", "#d97706", "#0891b2", "#dc2626", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
              const color = colors[i % colors.length];
              return (
                <div key={name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{agentNames[name] ?? name}</span>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {formatTokens(usage.totalTokens)} tokens · {usage.calls} 次调用
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full relative overflow-hidden" style={{ backgroundColor: "var(--color-border-light)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${percent}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>输入: {formatTokens(usage.promptTokens)}</span>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>输出: {formatTokens(usage.completionTokens)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent detail table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="font-semibold" style={{ color: "var(--color-text-primary)" }}>Agent 调用明细</h2>
        </div>
        {agents.length === 0 ? (
          <div className="py-12 text-center" style={{ color: "var(--color-text-muted)" }}>暂无数据</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: "right" }}>调用次数</th>
                <th style={{ textAlign: "right" }}>输入 Token</th>
                <th style={{ textAlign: "right" }}>输出 Token</th>
                <th style={{ textAlign: "right" }}>总计 Token</th>
                <th style={{ textAlign: "right" }}>占比</th>
              </tr>
            </thead>
            <tbody>
              {agents.map(([name, usage]) => {
                const pct = data.totalTokens > 0 ? ((usage.totalTokens / data.totalTokens) * 100).toFixed(1) : "0.0";
                return (
                  <tr key={name}>
                    <td className="font-medium" style={{ color: "var(--color-text-primary)" }}>{agentNames[name] ?? name}</td>
                    <td style={{ textAlign: "right" }}>{usage.calls.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{usage.promptTokens.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{usage.completionTokens.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>{usage.totalTokens.toLocaleString()}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-10 h-1 rounded-full" style={{ backgroundColor: "var(--color-border-light)" }}>
                          <div className="h-full rounded-full transition-all" style={{
                            width: `${pct}%`,
                            backgroundColor: "var(--color-accent)",
                          }} />
                        </div>
                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
