---
name: common-bugs
description: Frequently encountered bugs and their fixes across the codebase
metadata:
  type: reference
---

# 常见 Bug 速查

## SSR / 流水线状态不更新
**文件**: `sse.controller.ts`
**原因**: EventEmitter2 wildcard delimiter 拆分事件名 + SSE 缺少 `event:` 头
**修复**: 见 `sse-events.md`

## 导出 401 / 导出无响应
**原因 1**: 前端 `download-paper-docx.ts` 用原生 `fetch` 缺 Authorization header
**修复 1**: 从 localStorage 读 token 加入请求头

**原因 2**: 导出端点只有 POST，浏览器地址栏 GET 被 JWT 守卫拦截
**修复 2**: 添加 `@Get()` + `@Public()` + `?token=` query param

**原因 3**: WordExporter 的 Mermaid 渲染 `fetch` 失败无限重试导致挂起
**修复 3**: `Promise.race` 加 30 秒超时

## 前台服务配置无法删除
**文件**: `ServiceListPage.tsx`
**原因**: `fetch` 缺 Authorization header
**修复**: localStorage 读取 token

## 前台大纲不显示
**文件**: `paper.controller.ts`
**原因**: Controller 多包装一层 `{ outline: {...} }`，前端期望直接 `{ title, sections }`
**修复**: 直接返回 outline 对象

## 后台用户服务管理无数据
**文件**: `services.service.ts`
**原因**: `listByUser` 返回裸数组，前端期望 `{ services: [...] }`
**修复**: 包裹在 `{ services: ... }` 中

## 前台服务列表无内置服务商
**文件**: `services.service.ts`
**原因**: 迁移到 MySQL 后只查用户配置，未合并 `getAllEndpoints()` 
**修复**: 合并内置端点 + 用户配置

## 保存 API Key 返回 "not found"
**文件**: `services.service.ts`
**原因**: `updateSecret` 只更新已存在的配置，首次配置时不存在
**修复**: 改为 upsert（查不到自动创建）

## bcrypt.hash is not a function
**文件**: `auth.service.ts`, `admin.service.ts`, `user.service.ts`
**原因**: bcryptjs 是 CJS 模块，ESM context 下 `import * as bcrypt` 不兼容
**修复**: 改为 `import bcrypt from "bcryptjs"`

## MySQL 中文 paper ID URL 编码问题
**现象**: curl 测试中文 paper ID 返回 400 "Failed to decode param"
**原因**: curl 用 GBK 编码中文字符，NestJS 只接受 UTF-8
**结论**: 浏览器 fetch 用 UTF-8，正常工作；仅 curl 测试需手动 UTF-8 编码
