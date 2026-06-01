---
name: project-architecture
description: Overall project architecture — monorepo structure, NestJS backend, dual frontends
metadata:
  type: project
---

# Paper Writer 项目架构

## 项目位置
`F:\AI\paper-witer\paper-writer\`

## 包结构
- `packages/core/` (`@actalk/inkos-core`) — 核心引擎：Agents、PaperRunner、StateManager、LLM 抽象、WordExporter、MermaidRenderer
- `packages/cli/` (`@actalk/inkos`) — CLI 命令行工具
- `packages/server/` (`@actalk/inkos-server`) — **NestJS API 服务器**（生产环境主入口）
- `packages/studio/` (`@actalk/inkos-studio`) — **用户前台**（Vite + React 19 + Hono），端口 4567
- `packages/admin-panel/` (`@actalk/inkos-admin`) — **管理后台**（独立 Vite + React + Tailwind + antd），端口 5173

## NestJS 模块结构
```
AuthModule    — JWT + Redis 认证
UserModule    — 用户资料、配额
PaperModule   — 论文 CRUD + 流水线 + SSE
ServicesModule — LLM 服务配置（MySQL 持久化，用户隔离）
AdminModule   — 管理仪表盘、用户管理、服务管理
AppBaseModule — 项目配置（/project 端点）
```

## 数据库
- MySQL 8.0 — paper_writer 库
- Redis — JWT 黑名单 + refresh token
- TypeORM with synchronize: true

## 前端架构
- Admin Panel 和 Studio 使用同一个 NestJS API，Vite dev proxy 转发 `/api` → `:3000`
- Admin 使用 `paper_writer_auth` localStorage key 共享认证状态
- SSE 端点 `/api/v1/events?token=` 用于实时流水线进度
