---
name: sse-events
description: SSE event system — how real-time events work, common bugs, and fixes
metadata:
  type: project
---

# SSE 实时事件系统

## 架构

```
PaperRunner (core)
  │  onEvent({ type, stage, message, data })
  ▼
PaperService → eventEmitter.emit(`paper:${event.type}`, payload)
  │  EventEmitter2 (global, wildcard: true, delimiter: ":")
  ▼
SseController → onAny handler → res.write("event: name\ndata: json\n\n")
  │  SSE named events
  ▼
浏览器 EventSource → addEventListener → useSSE hook
  │
  ▼
usePaperPipelineProgress → currentStage, completedStages, lines, done
```

## 关键文件

- `packages/server/src/paper/sse.controller.ts` — SSE 端点
- `packages/server/src/paper/paper.service.ts` — 事件发射
- `packages/studio/src/hooks/use-sse.ts` — 前端 SSE hook
- `packages/studio/src/hooks/use-paper-pipeline-progress.ts` — 流水线进度解析

## BUG 历史

### BUG-001: SSE 事件格式错误
- **根因**: EventEmitter2 wildcard delimiter ":" 拆分事件名。`onAny` 收到的 `eventName` 可能是 `["paper", "stage-complete"]` 数组，取 `[0]` 只得到 "paper"
- **修复**: `Array.isArray(eventName) ? eventName.join(":") : eventName`
- **修复**: SSE 写入 `event: name\ndata: json\n\n` 格式
- **修复**: 从 PaperModule 移除重复的 EventEmitterModule import

### Token 过期导致 SSE 断开
- SSE 使用 `?token=` query 参数传递 JWT
- Token 过期后 SSE 返回 401，EventSource 断开
- 已添加自动重连（3s/6s/12s 退避，最多 3 次）+ token 自动刷新（过期前 5 分钟）

## SSE 事件类型（PaperRunner PipelineEventType）
- `stage-start`, `stage-progress`, `stage-complete`, `stage-error`
- `section-writing`, `section-diagram-verify`, `section-detection`, `section-polishing`
- `pipeline-done`
