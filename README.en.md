<p align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Paper Writer Logo">
</p>

<h1 align="center">Paper Writer<br><sub>AI Academic Paper Writing Agent</sub></h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/SadicZhou/paper-writer/stargazers"><img src="https://img.shields.io/github/stars/SadicZhou/paper-writer?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
</p>

<p align="center">
  English | <a href="README.md">中文</a>
</p>

---

An AI Agent that autonomously writes academic papers — from topic ideation, literature search, and outline generation, to section-by-section writing, AI detection & reduction, and academic polishing. Supports undergraduate theses, master's dissertations, and doctoral dissertations. Built-in citation formatting for GB7714, APA, MLA, and Chicago styles. Human review gates keep you in control.

**Paper Writer Studio is here!** — run `inkos` to launch a local web workbench. Paper management, section editing, AI detection dashboard, literature panel, outline editor, export — everything the CLI does, now visual.

## Quick Start

### Install

```bash
pnpm install
pnpm build
```

### Configure LLM

Create `.env` in the project root:

```bash
INKOS_LLM_PROVIDER=custom
INKOS_LLM_BASE_URL=https://api.deepseek.com/anthropic
INKOS_LLM_API_KEY=sk-...
INKOS_LLM_MODEL=deepseek-v4-flash
```

Or configure via `inkos.json` (recommended for Studio):

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

### Write Your First Paper

```bash
# 1. Create a paper project
inkos paper create --title "Design and Implementation of a Library Management System Based on Spring Boot" --major "Computer Science" --degree undergraduate --language en

# 2. Run the full pipeline
inkos paper generate <paper-id>

# 3. Or run individual stages
inkos paper brainstorm <paper-id>    # Topic ideation & innovation extraction
inkos paper search <paper-id>       # Literature search
inkos paper outline <paper-id>      # Outline generation
inkos paper write <paper-id>        # Section-by-section writing
inkos paper polish <paper-id>       # Academic polish + AI reduction
inkos paper detect <paper-id>       # AI detection
inkos paper reduce <paper-id>       # AI trace reduction

# 4. Export to Word document
inkos paper export <paper-id>
```

### Launch Studio

```bash
inkos studio
# or simply
inkos
```

Open `http://localhost:4567` in your browser.

---

## Pipeline

Each paper is produced by 6+ agents in sequence:

```
Topic Ideation → Literature Search → Outline Build → Section Writing → Polish + AI Reduction → Word Export
```

| Agent | Responsibility |
|-------|---------------|
| **Topic Brainstormer** | Analyze topic viability, extract innovation points, generate research background |
| **Literature Searcher** | Search for relevant literature, generate structured literature review |
| **Outline Builder** | Plan chapter structure, assign section titles and key points |
| **Section Writer** | Write each section sequentially, with resume and single-section rewrite support |
| **Academic Polisher** | Improve academic expression, normalize terminology, optimize sentence structure |
| **AI Detection Auditor** | Run AIGC detection across all sections, produce per-section AI scores |
| **AI Reduction Reviser** | Rewrite high-AI-trace sections to lower detection scores |
| **Diagram Verifier** | Validate flowcharts, architecture diagrams, and Mermaid figures |
| **Citation Formatter** | Format references in GB7714 / APA / MLA / Chicago style |
| **Word Exporter** | Generate a properly formatted .docx with TOC, headers, footers, and figure index |

If the AI detection score exceeds the threshold, the pipeline automatically enters a "reduce → re-detect" loop until it passes.

### Supported Degree Levels

| Level | Default Words | Typical Chapters |
|-------|--------------|-----------------|
| Undergraduate | 20,000 | 5-6 |
| Master | 30,000 | 6-8 |
| Doctor | 50,000+ | 8-10 |

### Citation Formats

- **GB7714** — Chinese national standard (default)
- **APA** — American Psychological Association
- **MLA** — Modern Language Association
- **Chicago** — Chicago Manual of Style

---

## Key Features

### AI Detection & Reduction Loop

Built-in AIGC detection auditor scores every section for AI traces (supports GPTZero, Originality, and custom detection engines). The reduction reviser automatically rewrites high-score sections — diversifying sentence patterns, strengthening academic voice, eliminating "LLM tells." Detection → reduction → re-detection loops until the target score is met.

### Word Document Import

`inkos paper import-word <file.docx>` imports existing Word papers. Automatically parses the table of contents structure, extracts section bodies, and reconstructs the outline and chapter content. Supports resume writing and partial modification.

### Literature Management

The literature search agent automatically finds relevant papers based on your topic and generates a structured review. References are managed centrally with add/edit/delete support, and auto-formatted on export.

### Diagram Verification & Generation

Supports embedding Mermaid diagrams (flowcharts, architecture diagrams, ER diagrams, sequence diagrams). The diagram verifier agent checks consistency between figures and their descriptions in the text.

### Studio Web Workbench

- **Paper Management** — Create, view, delete paper projects
- **Outline Editor** — Visual chapter structure editing with drag-and-drop
- **Section Editor** — In-browser editing with auto-save
- **Literature Panel** — Reference management (add/edit/delete)
- **AI Detection Panel** — Per-section AI scores with one-click reduction
- **Pipeline Progress** — Real-time stage display and event log
- **Export Panel** — One-click Word export with chapter statistics preview

### Resume & Recovery

Pipeline state is auto-saved after each stage. Interrupted runs can resume from the last completed stage without losing progress. `--resume-from` flag for explicit recovery points.

### Word Count Governance

`--target-words` sets the total target word count. The Section Writer auto-allocates word budgets per chapter based on outline weights. The polisher stage normalizes any over/under-shoots.

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `inkos paper create --title <title> --major <field>` | Create a new paper project |
| `inkos paper list` | List all papers |
| `inkos paper info <id>` | Show paper details |
| `inkos paper generate <id>` | Run full pipeline |
| `inkos paper brainstorm <id>` | Topic ideation (Stage 1) |
| `inkos paper search <id>` | Literature search (Stage 2) |
| `inkos paper outline <id>` | Outline generation (Stage 3) |
| `inkos paper write <id> [--section <num>]` | Section writing (Stage 4), optionally rewrite one section |
| `inkos paper polish <id>` | Academic polish (Stage 5) |
| `inkos paper detect <id>` | AI detection |
| `inkos paper reduce <id>` | AI reduction |
| `inkos paper export <id>` | Export to Word (Stage 6) |
| `inkos paper import-word <file>` | Import Word document |
| `inkos paper delete <id>` | Delete a paper |
| `inkos doctor` | Diagnose LLM configuration and API connectivity |
| `inkos` / `inkos studio` | Launch Studio web workbench |

All commands support `--json` for structured output.

---

## Project Structure

```
paper-writer/
├── packages/
│   ├── core/          # Engine: agents, pipeline runner, state management, LLM abstraction
│   │   └── src/
│   │       ├── agents/        # 10 agent implementations
│   │       ├── pipeline/      # Pipeline orchestrator (paper-runner)
│   │       ├── state/         # File-based state management & snapshots
│   │       ├── llm/           # LLM client, 40+ provider endpoints
│   │       └── models/        # Zod schemas & TypeScript types
│   ├── cli/           # CLI layer (commander), command registration
│   └── studio/        # Web workbench (Vite + React 19 + Hono)
│       └── src/
│           ├── pages/         # Paper mgmt, section editor, detection panel, export
│           ├── api/           # Hono REST + SSE server
│           └── components/    # UI component library
└── papers/            # Paper project output directory
```

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Watch mode for all packages
pnpm --filter @actalk/inkos-studio dev  # Start Studio only
pnpm test             # Run tests
pnpm typecheck        # Type-check
pnpm build            # Build all packages
```

## License

[AGPL-3.0](LICENSE)
