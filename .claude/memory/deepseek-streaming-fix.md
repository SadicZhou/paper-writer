---
name: deepseek-streaming-fix
description: DeepSeek Anthropic endpoint empty streaming response fix
metadata:
  type: project
---

DeepSeek 的 `/anthropic` 端点（`https://api.deepseek.com/anthropic`）默认开启 extended thinking，导致所有输出 token 进入 `thinking_delta` 事件而非 `text_delta`。

**根因**：inkos 在 `provider.ts` 的 `chatCompletionViaPiAi` 和 `chatWithToolsViaPiAi` 中设置 `streamOpts.thinking = { type: "disabled" }`，但 pi-ai SDK 的 `buildParams` 不读取 `options.thinking`，只检查 `options.thinkingEnabled`，且仅在 `model.reasoning === true` 时才将 thinking 参数写入 API 请求。DeepSeek 的 piModel 默认 `reasoning: false`，导致 thinking 禁用逻辑完全不生效。

**修复**（`packages/core/src/llm/provider.ts`）：
- 第 1166-1173 行 `chatCompletionViaPiAi`：同时设置 `piModel.reasoning = true` 和 `streamOpts.thinkingEnabled = false`
- 第 1270-1274 行 `chatWithToolsViaPiAi`：同上

**Why:** pi-ai 的 `buildParams` 需要 `model.reasoning === true` 才会进入 thinking 配置分支，而 `streamSimpleAnthropic` 在 `options.reasoning` 未设时会自动传 `thinkingEnabled: false`，两者配合才能生成 `params.thinking = { type: "disabled" }`。

**How to apply:** 如果其他模型（非 DeepSeek）也通过 `/anthropic` 端点遇到空响应，同样的修复模式适用。
