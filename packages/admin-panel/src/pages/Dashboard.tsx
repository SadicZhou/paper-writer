import { useEffect, useState } from "react";
import { App, Modal } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useAuthStore } from "../store/auth";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalPapers: number;
  papersToday: number;
  totalTokens: number;
}

interface PaperItem {
  id: string; title: string; username: string; major?: string;
  status: string; currentWordCount: number; createdAt: string;
}

const STAT_CARDS = [
  { key: "totalUsers" as const, label: "总用户数", color: "#3b82f6", bg: "#eff6ff", darkBg: "#1e3a5f", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
  { key: "activeUsers" as const, label: "活跃用户", color: "#16a34a", bg: "#f0fdf4", darkBg: "#052e16", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "totalPapers" as const, label: "论文总数", color: "#7c3aed", bg: "#f5f3ff", darkBg: "#1e1b4b", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { key: "papersToday" as const, label: "今日新增", color: "#d97706", bg: "#fffbeb", darkBg: "#451a03", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "totalTokens" as const, label: "Token 消耗", color: "#0891b2", bg: "#ecfeff", darkBg: "#0c3d42", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
];

export function Dashboard() {
  const { message } = App.useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [papersRefresh, setPapersRefresh] = useState(0);
  const accessToken = useAuthStore((s) => s.accessToken);

  const fetchData = () => {
    Promise.all([
      fetch("/api/v1/admin/stats", { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json()),
      fetch("/api/v1/admin/papers?page=1&limit=5", { headers: { Authorization: `Bearer ${accessToken}` } }).then((r) => r.json()),
    ]).then(([statsData, papersData]) => {
      setStats(statsData[0] ?? null);
      setPapers(papersData.papers ?? []);
    }).catch(console.error);
  };

  useEffect(fetchData, [accessToken, papersRefresh]);

  async function handleExport(paperId: string) {
    try {
      const res = await fetch(`/api/v1/papers/${paperId}/export/docx`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        message.success(`导出成功: ${data.filePath ?? ""}`);
      } else {
        message.error("导出失败");
      }
    } catch (e) {
      message.error("导出失败");
    }
  }

  async function handleDelete(paperId: string, title: string) {
    Modal.confirm({
      title: "确认删除",
      icon: <ExclamationCircleOutlined />,
      content: `确定删除论文「${title}」吗？此操作不可撤销。`,
      okText: "确认删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/v1/papers/${paperId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (res.ok) {
            message.success("删除成功");
            setPapersRefresh((k) => k + 1);
          } else {
            message.error("删除失败");
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  }

  if (!stats) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
          <span style={{ color: "var(--color-text-muted)" }}>加载中...</span>
        </div>
      </div>
    );
  }

  const statValues: Record<string, number | string> = {
    totalUsers: stats.totalUsers,
    activeUsers: stats.activeUsers,
    totalPapers: stats.totalPapers,
    papersToday: stats.papersToday,
    totalTokens: stats.totalTokens.toLocaleString(),
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "var(--color-text-primary)" }}>仪表盘</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>系统运行概览和关键指标</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {STAT_CARDS.map((card) => (
          <div key={card.key} className="p-5 rounded-xl border transition-shadow hover:shadow-md" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: card.bg }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={card.color} strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                </svg>
              </div>
            </div>
            <div className="text-2xl font-bold mb-0.5" style={{ color: "var(--color-text-primary)" }}>
              {statValues[card.key]}
            </div>
            <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>{card.label}</div>
          </div>
        ))}
      </div>

      {/* Recent papers */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="font-semibold" style={{ color: "var(--color-text-primary)" }}>最近论文</h2>
        </div>
        {papers.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>暂无数据</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>论文标题</th>
                <th>作者</th>
                <th>专业</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}>字数</th>
                <th style={{ textAlign: "right" }}>创建时间</th>
                <th style={{ textAlign: "center", width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium" style={{ color: "var(--color-text-primary)", maxWidth: 240 }} title={p.title}>
                    <span className="truncate block">{p.title}</span>
                  </td>
                  <td>{p.username}</td>
                  <td>{p.major ?? "—"}</td>
                  <td>
                    {(() => {
                      const statusMap: Record<string, { label: string; cls: string }> = {
                        draft: { label: "草稿", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
                        brainstorming: { label: "选题中", cls: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
                        searching: { label: "检索中", cls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" },
                        outlining: { label: "大纲中", cls: "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400" },
                        writing: { label: "写作中", cls: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
                        polishing: { label: "润色中", cls: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
                        completed: { label: "已完成", cls: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
                        error: { label: "异常", cls: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
                      };
                      const s = statusMap[p.status] ?? { label: p.status, cls: "bg-gray-100 text-gray-600" };
                      return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
                          {s.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: "right" }}>{p.currentWordCount.toLocaleString()}</td>
                  <td style={{ textAlign: "right", fontSize: 13 }}>{new Date(p.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td style={{ textAlign: "center" }}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleExport(p.id)}
                        className="px-2.5 py-1.5 rounded text-xs font-medium transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/30"
                        style={{ color: "var(--color-accent)" }}
                        title="导出 Word"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(p.id, p.title)}
                        className="px-2.5 py-1.5 rounded text-xs font-medium transition-colors hover:bg-red-50 dark:hover:bg-red-900/30"
                        style={{ color: "var(--color-danger)" }}
                        title="删除论文"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
