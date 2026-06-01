import { useEffect, useState, useMemo } from "react";
import { App, Modal } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useAuthStore } from "../store/auth";

interface User {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  role: string;
  isActive: boolean;
  maxPapers: number;
  maxTokens: number;
  tokensUsed: number;
  papersCreated: number;
  expiresAt?: string;
  createdAt: string;
}

interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export function UserManagement() {
  const { message } = App.useApp();
  const [data, setData] = useState<UserListResponse | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  // Add user modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    username: "", password: "", role: "user" as "admin" | "user",
    displayName: "", email: "", maxPapers: 10,
    expiresAt: "",
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit user state
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ role: "user" as "admin" | "user", displayName: "", email: "", maxPapers: 10, isActive: true, expiresAt: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Service management state
  interface SvcInfo { id: string; service: string; name?: string; baseUrl?: string; apiKeyPreview?: string; hasApiKey: boolean; modelMain?: string; protocol?: string; }
  const [svcUser, setSvcUser] = useState<User | null>(null);
  const [svcList, setSvcList] = useState<SvcInfo[]>([]);
  const [svcLoading, setSvcLoading] = useState(false);
  const [showSvcAdd, setShowSvcAdd] = useState(false);
  const [svcAddForm, setSvcAddForm] = useState({ service: "", name: "", baseUrl: "", apiKey: "", modelMain: "", protocol: "" });

  async function openServiceModal(u: User) {
    setSvcUser(u);
    setShowSvcAdd(false);
    setSvcLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${u.id}/services`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      setSvcList(data.services ?? []);
    } catch { setSvcList([]); }
    setSvcLoading(false);
  }

  async function handleAddSvc(e: React.FormEvent) {
    e.preventDefault();
    if (!svcUser || !svcAddForm.service.trim()) return;
    try {
      await fetch(`/api/v1/admin/users/${svcUser.id}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ service: svcAddForm.service.trim(), name: svcAddForm.name || undefined, baseUrl: svcAddForm.baseUrl || undefined, apiKey: svcAddForm.apiKey || undefined, modelMain: svcAddForm.modelMain || undefined, protocol: svcAddForm.protocol || undefined }),
      });
      setSvcAddForm({ service: "", name: "", baseUrl: "", apiKey: "", modelMain: "", protocol: "" });
      setShowSvcAdd(false);
      openServiceModal(svcUser);
    } catch { /* */ }
  }

  async function handleDeleteSvc(svcId: string) {
    if (!svcUser) return;
    Modal.confirm({
      title: "确认删除",
      icon: <ExclamationCircleOutlined />,
      content: "确定删除此服务配置吗？",
      okText: "确认删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await fetch(`/api/v1/admin/users/${svcUser.id}/services/${encodeURIComponent(svcId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        message.success("删除成功");
        openServiceModal(svcUser);
      },
    });
  }

  function openEditModal(u: User) {
    setEditUser(u);
    setEditForm({
      role: u.role as "admin" | "user",
      displayName: u.displayName ?? "",
      email: u.email ?? "",
      maxPapers: u.maxPapers,
      isActive: u.isActive,
      expiresAt: u.expiresAt ? u.expiresAt.slice(0, 10) : "",
    });
    setEditError(null);
  }

  async function handleEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${editUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          role: editForm.role,
          displayName: editForm.displayName || undefined,
          email: editForm.email || undefined,
          maxPapers: editForm.maxPapers,
          isActive: editForm.isActive,
          expiresAt: editForm.expiresAt || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "更新失败" }));
        throw new Error((err as any).message ?? "更新失败");
      }
      setEditUser(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setEditLoading(false);
    }
  }

  const fetchUsers = () => {
    fetch(`/api/v1/admin/users?page=${page}&limit=20`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  };

  useEffect(fetchUsers, [accessToken, page, refreshKey]);

  async function toggleActive(userId: string, currentActive: boolean) {
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (res.ok) setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error("Failed to toggle user status", e);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!addForm.username.trim() || !addForm.password.trim()) {
      setAddError("用户名和密码不能为空");
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch("/api/v1/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          username: addForm.username.trim(),
          password: addForm.password,
          role: addForm.role,
          displayName: addForm.displayName || undefined,
          email: addForm.email || undefined,
          maxPapers: addForm.maxPapers,
          expiresAt: addForm.expiresAt || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "创建失败" }));
        throw new Error((err as any).message ?? "创建失败");
      }
      setShowAddModal(false);
      setAddForm({ username: "", password: "", role: "user", displayName: "", email: "", maxPapers: 10, expiresAt: "" });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setAddLoading(false);
    }
  }

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    return data.users.filter((u) => {
      if (search && !u.username.toLowerCase().includes(search.toLowerCase()) && !(u.displayName ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      return true;
    });
  }, [data, search, roleFilter, statusFilter]);

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

  const totalPages = Math.ceil(data.total / data.limit);

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text-primary)" }}>用户管理</h1>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>共 {data.total} 个用户</p>
        </div>
        <button
          onClick={() => { setAddError(null); setShowAddModal(true); }}
          className="px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-all flex items-center gap-2"
          style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          添加用户
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索用户名或昵称..."
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm outline-none transition-all border focus:ring-2"
            style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
        >
          <option value="all">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 rounded-lg text-sm border outline-none"
          style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}
        >
          <option value="all">全部状态</option>
          <option value="active">已激活</option>
          <option value="inactive">已禁用</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)", borderColor: "var(--color-border)" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th style={{ textAlign: "right" }}>论文 (已用/上限)</th>
              <th>过期时间</th>
              <th style={{ textAlign: "right" }}>注册时间</th>
              <th style={{ textAlign: "center", width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="py-16 text-center">
                    <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--color-text-muted)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span style={{ color: "var(--color-text-muted)" }}>未找到匹配的用户</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium" style={{ color: "var(--color-text-primary)" }}>{u.username}</div>
                      {u.displayName && <div className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{u.displayName}</div>}
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === "admin" ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}>
                        {u.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        u.isActive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? "bg-green-500" : "bg-red-500"}`} />
                        {u.isActive ? "已激活" : "已禁用"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="text-sm">{u.papersCreated}</span>
                      <span style={{ color: "var(--color-text-muted)" }} className="text-xs"> / {u.maxPapers}</span>
                    </td>
                    <td>
                      {u.expiresAt ? (
                        <span className={`text-xs ${new Date(u.expiresAt) < new Date() ? "text-red-500" : ""}`}>
                          {new Date(u.expiresAt).toLocaleDateString("zh-CN")}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 13 }}>{new Date(u.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td style={{ textAlign: "center" }}>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openServiceModal(u)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          style={{ color: "var(--color-accent)" }}
                          title="管理服务"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-1.5 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                          style={{ color: "var(--color-text-muted)" }}
                          title="编辑用户"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => toggleActive(u.id, u.isActive)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                            u.isActive ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
                          }`}
                          title={u.isActive ? "点击禁用" : "点击启用"}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              u.isActive ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          显示第 {(page - 1) * 20 + 1}-{Math.min(page * 20, data.total)} 条，共 {data.total} 条
        </div>
        <div className="flex gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
            上一页
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const p = start + i;
            if (p > totalPages) return null;
            return (
              <button key={p} onClick={() => setPage(p)}
                className="w-9 h-9 rounded-lg text-sm font-medium transition-colors"
                style={{
                  backgroundColor: p === page ? "var(--color-accent)" : "transparent",
                  color: p === page ? "#fff" : "var(--color-text-secondary)",
                }}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
            下一页
          </button>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={() => setShowAddModal(false)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <div>
                <h3 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>添加用户</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>创建新的系统用户账号</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: "var(--color-text-muted)" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAddUser} className="px-6 py-5 space-y-4">
              {addError && (
                <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: "var(--color-danger-light)", color: "var(--color-danger)" }}>
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {addError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>用户名 <span className="text-red-500">*</span></label>
                  <input type="text" value={addForm.username} onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2" placeholder="请输入用户名"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>密码 <span className="text-red-500">*</span></label>
                  <input type="password" value={addForm.password} onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2" placeholder="请输入密码"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>角色</label>
                  <select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value as "admin" | "user" })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}>
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>显示名称</label>
                  <input type="text" value={addForm.displayName} onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2" placeholder="选填"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>邮箱</label>
                <input type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2" placeholder="选填"
                  style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>论文上限</label>
                  <input type="number" value={addForm.maxPapers} onChange={(e) => setAddForm({ ...addForm, maxPapers: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>过期时间</label>
                  <input type="date" value={addForm.expiresAt} onChange={(e) => setAddForm({ ...addForm, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
              </div>

              <div className="flex gap-3 pt-2 justify-end">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium border transition-colors"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                  取消
                </button>
                <button type="submit" disabled={addLoading}
                  className="px-5 py-2.5 rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
                  {addLoading ? "创建中..." : "确认创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={() => setEditUser(null)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <div>
                <h3 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>编辑用户</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{editUser.username}</p>
              </div>
              <button onClick={() => setEditUser(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: "var(--color-text-muted)" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleEditUser} className="px-6 py-5 space-y-4">
              {editError && (
                <div className="p-3 rounded-lg text-sm flex items-center gap-2" style={{ backgroundColor: "var(--color-danger-light)", color: "var(--color-danger)" }}>
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {editError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>角色</label>
                  <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as "admin" | "user" })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}>
                    <option value="user">普通用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>状态</label>
                  <select value={editForm.isActive ? "active" : "inactive"} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === "active" })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}>
                    <option value="active">已激活</option>
                    <option value="inactive">已禁用</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>显示名称</label>
                  <input type="text" value={editForm.displayName} onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>邮箱</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>论文上限</label>
                  <input type="number" value={editForm.maxPapers} onChange={(e) => setEditForm({ ...editForm, maxPapers: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>过期时间</label>
                  <input type="date" value={editForm.expiresAt} onChange={(e) => setEditForm({ ...editForm, expiresAt: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                    style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                </div>
              </div>

              <div className="flex gap-3 pt-2 justify-end">
                <button type="button" onClick={() => setEditUser(null)}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium border transition-colors"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}>
                  取消
                </button>
                <button type="submit" disabled={editLoading}
                  className="px-5 py-2.5 rounded-lg text-white text-sm font-medium transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>
                  {editLoading ? "保存中..." : "保存修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Service Management Modal */}
      {svcUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={() => setSvcUser(null)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden" style={{ backgroundColor: "var(--color-bg-card)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <div>
                <h3 className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>服务管理</h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>用户: {svcUser.username}</p>
              </div>
              <button onClick={() => setSvcUser(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" style={{ color: "var(--color-text-muted)" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-3 max-h-96 overflow-y-auto">
              {svcLoading ? (
                <div className="py-8 text-center" style={{ color: "var(--color-text-muted)" }}>加载中...</div>
              ) : svcList.length === 0 ? (
                <div className="py-8 text-center text-sm" style={{ color: "var(--color-text-muted)" }}>暂无服务配置</div>
              ) : (
                svcList.map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "var(--color-border)" }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{svc.name || svc.service}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                        {svc.modelMain || "未配置模型"} {svc.hasApiKey ? "· 已配置Key" : ""} {svc.baseUrl ? `· ${svc.baseUrl}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteSvc(svc.id)}
                      className="p-1.5 rounded-lg transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                      style={{ color: "var(--color-danger)" }}
                      title="删除服务"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Add service form */}
            <div className="px-6 py-4 border-t" style={{ borderColor: "var(--color-border)" }}>
              {!showSvcAdd ? (
                <button
                  onClick={() => setShowSvcAdd(true)}
                  className="w-full py-2 rounded-lg text-sm font-medium border border-dashed transition-colors hover:border-blue-400 hover:text-blue-600"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                >
                  + 添加服务
                </button>
              ) : (
                <form onSubmit={handleAddSvc} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" placeholder="服务标识 (如 deepseek)" value={svcAddForm.service}
                      onChange={(e) => setSvcAddForm({ ...svcAddForm, service: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} required />
                    <input type="text" placeholder="显示名称" value={svcAddForm.name}
                      onChange={(e) => setSvcAddForm({ ...svcAddForm, name: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" placeholder="Base URL" value={svcAddForm.baseUrl}
                      onChange={(e) => setSvcAddForm({ ...svcAddForm, baseUrl: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                    <input type="text" placeholder="API Key" value={svcAddForm.apiKey}
                      onChange={(e) => setSvcAddForm({ ...svcAddForm, apiKey: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" placeholder="模型 (如 deepseek-v4-flash)" value={svcAddForm.modelMain}
                      onChange={(e) => setSvcAddForm({ ...svcAddForm, modelMain: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }} />
                    <select value={svcAddForm.protocol} onChange={(e) => setSvcAddForm({ ...svcAddForm, protocol: e.target.value })}
                      className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2"
                      style={{ backgroundColor: "var(--color-bg-primary)", borderColor: "var(--color-border)", color: "var(--color-text-primary)" }}>
                      <option value="">协议自动</option>
                      <option value="chat">Chat Completions</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowSvcAdd(false)}
                      className="px-4 py-2 rounded-lg text-sm" style={{ color: "var(--color-text-muted)" }}>取消</button>
                    <button type="submit"
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: "linear-gradient(135deg, #3b82f6, #2563eb)" }}>确认添加</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
