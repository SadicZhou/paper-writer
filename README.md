<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Paper Writer Logo">
</p>

<h1 align="center">Paper Writer<br><sub>AI 学术论文自动写作 Agent</sub></h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/SadicZhou/paper-writer/stargazers"><img src="https://img.shields.io/github/stars/SadicZhou/paper-writer?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | 中文
</p>

---

AI Agent 自动撰写学术论文——从选题、文献检索、大纲生成，到逐节写作、AI 检测降重、学术润色，全程接管。支持本科论文、硕士论文、博士学位论文，内置 GB7714 / APA / MLA / Chicago 四种引用格式。人工审核门控确保你始终掌控全局。

**Paper Writer Studio 正式发布！** — 运行 `inkos` 启动本地 Web 工作台。论文管理、章节编辑、AI 检测面板、文献面板、大纲编辑、导出——CLI 能做的，Studio 全部可视化。

## 快速开始

### 安装

```bash
pnpm install
pnpm build
```

### 配置 LLM

项目根目录创建 `.env`：

```bash
INKOS_LLM_PROVIDER=custom
INKOS_LLM_BASE_URL=https://api.deepseek.com/anthropic
INKOS_LLM_API_KEY=sk-...
INKOS_LLM_MODEL=deepseek-v4-flash
```

或在 `inkos.json` 中配置服务（Studio 推荐）：

```json
{
  "llm": {
    "service": "deepseek",
    "defaultModel": "deepseek-v4-flash",
    "services": [{
      "service": "deepseek",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "protocol": "anthropic-messages",
      "modelMain": "deepseek-v4-flash"
    }]
  }
}
```

### 写第一篇论文

```bash
# 1. 创建论文项目
inkos paper create --title "基于Spring Boot的图书管理系统设计与实现" --major "计算机科学与技术" --degree undergraduate

# 2. 一键跑通全流程：选题 → 文献 → 大纲 → 写作 → 润色 → AI检测降重
inkos paper generate <paper-id>

# 3. 也可以分步执行
inkos paper brainstorm <paper-id>   # 选题与创新点提取
inkos paper search <paper-id>      # 文献检索
inkos paper outline <paper-id>     # 大纲生成
inkos paper write <paper-id>       # 逐节写作
inkos paper polish <paper-id>      # 学术润色 + AI 降重
inkos paper detect <paper-id>      # AI 检测
inkos paper reduce <paper-id>      # AI 痕迹削减

# 4. 导出为 Word 文档
inkos paper export <paper-id>
```

### 启动 Studio 工作台

```bash
inkos studio
# 或直接
inkos
```

浏览器打开 `http://localhost:4567`，通过可视化界面管理论文全流程。

---

## 工作管线

每一篇论文由 6+ 个 Agent 按序协作完成：

```
选题分析 → 文献检索 → 大纲构建 → 逐节写作 → 学术润色 + AI降重 → Word导出
```

| Agent | 职责 |
|-------|------|
| **选题头脑风暴 Topic Brainstormer** | 分析选题可行性，提取创新点，生成研究背景与意义 |
| **文献检索 Literature Searcher** | 自动检索相关文献，生成文献综述，管理参考文献列表 |
| **大纲构建 Outline Builder** | 规划论文章节结构，确定各章节标题与内容要点 |
| **逐节写作 Section Writer** | 按大纲逐节撰写正文，支持断点续写和单节重写 |
| **学术润色 Academic Polisher** | 提升学术表达，规范术语使用，优化句式结构 |
| **AI 检测审计 AI Detection Auditor** | 对全文做 AIGC 检测，输出各章节 AI 痕迹评分 |
| **AI 降重重写 AI Reduction Reviser** | 针对高 AI 痕迹段落重写，降低检测率 |
| **图表验证 Diagram Verifier** | 验证论文中的流程图、架构图的正确性与一致性 |
| **引用格式化 Citation Formatter** | 按 GB7714 / APA / MLA / Chicago 格式化参考文献 |
| **Word 导出 Word Exporter** | 生成规范的 .docx 文档，含目录、页眉页脚、图表索引 |

如果 AI 检测评分超标，管线自动进入"降重重写 → 再检测"循环，直到达标。

### 支持的论文类型

| 学位等级 | 默认字数 | 典型章节结构 |
|---------|---------|------------|
| 本科 (undergraduate) | 20,000 字 | 5-6 章 |
| 硕士 (master) | 30,000 字 | 6-8 章 |
| 博士 (doctor) | 50,000+ 字 | 8-10 章 |

### 引用格式

- **GB7714** — 中国国家标准（默认）
- **APA** — 美国心理学会格式
- **MLA** — 现代语言协会格式
- **Chicago** — 芝加哥格式

---

## 核心特性

### AI 检测 + 降重闭环

内置 AIGC 检测审计员，对全文各章节做 AI 痕迹评分（支持 GPTZero、Originality 等检测引擎）。降重重写 Agent 针对高 AI 痕迹段落自动重写——替换句式、增加学术表达、消除 LLM 味。检测→降重→再检测循环，直到达标。

### Word 文档导入

`inkos paper import-word <file.docx>` 导入已有 Word 论文，自动解析目录结构、提取章节正文，还原为大纲 + 章节内容，支持断点续写和局部修改。

### 文献管理

文献检索 Agent 自动根据选题搜索相关文献，生成结构化综述。参考文献统一管理，支持增删改查，导出时自动按引用格式规范排版。

### 图表验证与生成

支持在论文中嵌入 Mermaid 图表（流程图、架构图、ER 图、时序图等）。图表验证 Agent 检查图表与正文描述的一致性，确保"图如其文"。

### Studio Web 工作台

- **论文管理** — 创建、查看、删除论文项目
- **大纲编辑** — 可视化调整章节结构、拖拽排序
- **章节编辑** — 在线编辑各节正文，实时保存
- **文献面板** — 管理参考文献，支持增删改
- **AI 检测面板** — 逐节展示 AI 评分，一键触发降重
- **管线进度** — 实时展示当前阶段和执行日志
- **导出面板** — 一键导出 Word，预览章节统计

### 断点续写

每个阶段完成后自动保存状态快照。管线中断后可从上次完成的 stage 继续，不会丢失已有成果。支持 `--resume-from` 指定恢复起点。

### 字数治理

`--target-words` 指定目标总字数。逐节写作时系统自动按章节权重分配字数预算，超出/不足时由润色阶段做归一化调整。

---

## 命令参考

| 命令 | 说明 |
|------|------|
| `inkos paper create --title <标题> --major <专业>` | 创建论文项目 |
| `inkos paper list` | 列出所有论文 |
| `inkos paper info <id>` | 查看论文详情 |
| `inkos paper generate <id>` | 一键跑通全流程 |
| `inkos paper brainstorm <id>` | 选题分析（Stage 1） |
| `inkos paper search <id>` | 文献检索（Stage 2） |
| `inkos paper outline <id>` | 大纲生成（Stage 3） |
| `inkos paper write <id> [--section <num>]` | 写作（Stage 4），可选重写指定节 |
| `inkos paper polish <id>` | 学术润色（Stage 5） |
| `inkos paper detect <id>` | AI 检测 |
| `inkos paper reduce <id>` | AI 降重 |
| `inkos paper export <id>` | 导出 Word 文档（Stage 6） |
| `inkos paper import-word <file>` | 导入 Word 文档 |
| `inkos paper delete <id>` | 删除论文 |
| `inkos doctor` | 诊断 LLM 配置与 API 连通性 |
| `inkos` / `inkos studio` | 启动 Studio Web 工作台 |

所有命令支持 `--json` 输出结构化数据。

---

## 项目结构

```
paper-writer/
├── packages/
│   ├── core/          # 核心引擎：Agent、管线、状态管理、LLM 抽象
│   │   └── src/
│   │       ├── agents/        # 10 个 Agent 实现
│   │       ├── pipeline/      # 管线编排器 (paper-runner)
│   │       ├── state/         # 文件态管理、状态快照
│   │       ├── llm/           # LLM 客户端、40+ Provider 端点
│   │       └── models/        # Zod schema + 类型定义
│   ├── cli/           # CLI 层（commander），命令注册
│   └── studio/        # Web 工作台（Vite + React 19 + Hono）
│       └── src/
│           ├── pages/         # 论文管理、章节编辑、检测面板、导出
│           ├── api/           # Hono REST + SSE 服务端
│           └── components/    # UI 组件库
└── papers/            # 论文项目输出目录
```

## 开发

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动所有包 watch 模式
pnpm --filter @actalk/inkos-studio dev  # 仅启动 Studio
pnpm test             # 运行测试
pnpm typecheck        # 类型检查
pnpm build            # 构建所有包
```

## 许可证

[AGPL-3.0](LICENSE)
