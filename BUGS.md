# Paper Writer Bug 跟踪文档

## BUG-001: SSR 响应不更新 — SSE 事件格式错误

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 前台流水线进度、日志、状态按钮

### 现象
- 日志可以实时更新，但流水线状态在大纲构建后不再更新
- 论文写完后跳过了步骤 4（写作），直接跳转步骤 5（润色）
- 完成之后"流水线运行中"按钮状态不刷新，刷新页面后才正常
- 所有 SSE 事件需要刷新页面才能看到

### 根因

`packages/server/src/paper/sse.controller.ts`

三个原因：

**1. EventEmitter2 wildcard 事件名被拆分**

`EventEmitterModule.forRoot({ wildcard: true, delimiter: ":" })` 配置下，EventEmitter2 的 `onAny` 回调收到的 `eventName` 参数类型是 `string | string[]`。`"paper:stage-complete"` 被 `:` 拆分成了 `["paper", "stage-complete"]`。代码只取 `eventName[0]`（即 `"paper"`），丢掉了后一半。

```typescript
// ❌ 错误：只取了数组第一个元素 "paper"
const name = Array.isArray(eventName) ? eventName[0] : eventName;
// 实际发送: event: paper (前端永远匹配不到 paper:stage-complete)
```

**2. SSE 缺少 `event:` 头**

原始代码只写了 `data:` 行，没有 `event:` 行。前端 `EventSource.addEventListener("paper:stage-complete", ...)` 只能匹配命名事件，无名事件被忽略。

```typescript
// ❌ 错误：缺少 event 头
res.write(`data: ${JSON.stringify(data)}\n\n`);
// ✅ 正确：先写 event 再写 data
res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
```

**3. EventEmitterModule 重复导入导致实例不一致**

`PaperModule` 导入了 `EventEmitterModule`（不含 `forRoot()`），同时 `AppModule` 导入了 `EventEmitterModule.forRoot()`。两者可能创建了不同的 `EventEmitter2` 实例，PaperService emit 的事件 SseController 收不到。

### 修复

1. `onAny` 回调中正确合成事件名：`Array.isArray(eventName) ? eventName.join(":") : eventName`
2. SSE 写入格式改为 `event: {name}\ndata: {json}\n\n`
3. 从 `PaperModule` 中移除 `EventEmitterModule` import，统一使用 `AppModule` 的全局实例

---

## BUG-002: 导出返回 401

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 论文导出功能（GET / POST）

### 现象
- 浏览器访问 `GET .../export/docx` 返回 `{"message":"Unauthorized","statusCode":401}`
- Admin Panel 导出按钮也无法正常工作

### 根因

`packages/server/src/paper/paper.controller.ts`

三个原因：

**1. 导出接口只有 POST，浏览器地址栏 GET 请求未命中路由**

路由定义为 `@Post(":id/export/:format")`，浏览器地址栏发起的是 GET 请求。请求未命中任何已知路由后，全局 JWT 守卫直接返回 401。

**2. 全局 JWT 守卫拦截所有未认证请求**

`JwtAuthGuard` 注册为 `APP_GUARD`，在所有路由上先校验 JWT。浏览器无法发送 `Authorization: Bearer` 请求头，即使路由存在也会 401。

**3. 导出只返回文件路径，不返回文件流**

修复前 `exportPaper` 方法只返回 `{ filePath: "..." }`，浏览器拿到 JSON 而不是 `.docx` 文件。

### 修复

1. 同时添加 `@Get(":id/export/:format")` 和 `@Post(":id/export/:format")`
2. 两个端点都标记 `@Public()`，用 query 参数 `?token=` 传递 JWT
3. 响应改为文件流下载：设置 `Content-Type` + `Content-Disposition: attachment`，用 `res.send(buffer)` 返回 `.docx` 二进制内容

---

## BUG-003: 前台服务配置无法删除

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 前台服务商列表删除按钮

### 现象
- Studio 服务配置页 hover 显示删除按钮，但点击后删除失败
- 控制台显示 401

### 根因

`packages/studio/src/pages/ServiceListPage.tsx`

`handleDelete` 使用原生 `fetch()` 调用 `DELETE /api/v1/services/:name`，**未携带 Authorization header**。全局 JWT 守卫拦截返回 401。

```typescript
// ❌ 缺少 auth header
const res = await fetch(`/api/v1/services/${name}`, { method: "DELETE" });
```

### 修复

从 localStorage 读取 JWT token 并添加到请求头：

```typescript
const token = JSON.parse(localStorage.getItem("paper_writer_auth") ?? "{}").accessToken ?? "";
const res = await fetch(`/api/v1/services/${name}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
});
```

---

## BUG-004: 后台用户服务管理无数据

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: Admin Panel 用户服务管理弹窗

### 现象
- Admin Panel 用户管理 → 服务管理弹窗：看不到用户的服务配置
- 前台已有服务配置，后台没有回显

### 根因

`packages/server/src/services/services.service.ts`

`listByUser` 返回的是原始数组 `[...]`，但前端代码期望 `{ services: [...] }` 格式。

```typescript
// ❌ 返回裸数组
return configs.map((c) => ({ ...c, hasApiKey: ... }));
// ✅ 应该返回
return { services: configs.map(...) };
```

同时，ServicesController 的 `list()` 方法又包了一层 `{ services }`，造成 `{ services: [...] }` 变成了 `{ services: { services: [...] } }`。

### 修复

1. `listByUser` 返回 `{ services: [...] }` 格式
2. ServicesController 的 `list()` 和 `config()` 直接返回 `listByUser` 的结果，不再二次包装

---

## BUG-005: 默认服务商列表消失

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 前台服务商列表

### 现象
- 前台服务列表只显示用户创建的自定义服务
- DeepSeek/OpenAI/Google 等 40+ 内置服务商全部不可见
- 用户无法快速选择预置服务商

### 根因

`packages/server/src/services/services.service.ts`

`listByUser` 只从 MySQL 的 `service_configs` 表查询用户配置，没有合并内置端点。更换为 DB 存储后，原本从 `getAllEndpoints()` 获取的预置服务商列表丢失。

### 修复

`listByUser` 改为合并两个数据源：
1. `getAllEndpoints()` 获取内置服务端点
2. MySQL `service_configs` 表获取用户配置
3. 对每个内置端点，检查是否有用户配置（显示连接状态、模型等）

---

## BUG-006: 保存 API Key 返回 "not found"

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 前台服务配置 — 保存 API Key

### 现象
- 用户在 Studio 服务详情页输入 API Key 并保存，返回 "not found"
- `PUT /api/v1/services/:name/secret` 返回 404

### 根因

`packages/server/src/services/services.service.ts`

`updateSecret` 方法只更新**已存在**的 ServiceConfig 记录。对于内置服务商（如 Moonshot），用户首次配置时 DB 中还没有对应记录，`resolve()` 查不到抛出 NotFoundException。

### 修复

`updateSecret` 改为 upsert 模式：查不到记录时自动创建（从内置端点填充默认值），再保存 API Key。

---

## BUG-007: 前台大纲不显示

**发现时间**: 2026-06-01  
**状态**: ✅ 已修复  
**影响范围**: 前台论文大纲展示

### 现象
- 论文生成后进入工作台，大纲区域空白
- API 返回数据正确但前端无法解析

### 根因

`packages/server/src/paper/paper.controller.ts`

`getOutline` 控制器多包装了一层：

```typescript
// ❌ 返回格式: { outline: { title, sections } }
return { outline: await this.paperService.getOutline(id) };
```

但前端 `useApi<PaperOutline>` 期望 `{ title, sections }` 直接在最外层。

### 修复

去掉多余包装，直接返回 PaperOutline 对象。

---

## 修复汇总

| BUG # | 根因分类 | 修复文件 |
|-------|---------|---------|
| 001 | EventEmitter2 事件名拆分 + SSE 缺少 event 头 | `sse.controller.ts`, `paper.module.ts` |
| 002 | 导出无 GET 路由 + 全局 JWT 守卫 | `paper.controller.ts` |
| 003 | 原生 fetch 缺 auth header | `ServiceListPage.tsx` |
| 004 | API 返回格式不匹配 | `services.service.ts`, `services.controller.ts` |
| 005 | DB 替换丢失内置端点 | `services.service.ts` |
| 006 | upsert 缺失 | `services.service.ts` |
| 007 | Controller 多包装一层 | `paper.controller.ts` |

---

> **维护规则**: 每次修复 bug 后同步更新本文档。新增 bug 时按序号追加，注释发现时间、状态、现象、根因和修复方案。
