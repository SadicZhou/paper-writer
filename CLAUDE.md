# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **BUGS.md 同步规则**: 每次修复 bug 后，必须在 `BUGS.md` 中记录：发现时间、状态、现象、根因（引用具体文件/行号）、修复方案。修改完成后同步更新 BUGS.md。

## Commands

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (tsc for core/cli, vite + tsc for studio)
pnpm dev              # Watch-mode builds for all packages in parallel
pnpm test             # Run all vitest tests across packages
pnpm lint             # Run linting across packages
pnpm typecheck        # Type-check all packages (tsc --noEmit)
```

### Package-scoped commands

```bash
pnpm --filter @actalk/inkos-core test           # Run core tests only
pnpm --filter @actalk/inkos-core test -- path/to/test.test.ts  # Run a single test file
pnpm --filter @actalk/inkos-studio dev          # Start Studio dev server (API + Vite HMR)
pnpm --filter @actalk/inkos-server build        # Build NestJS server
pnpm --filter @actalk/inkos-server start        # Start NestJS server (port 3000)
pnpm --filter @actalk/inkos build               # Build CLI only
```

Tests use `vitest`. There is no Jest or Mocha.

## Architecture

This is a **pnpm monorepo** with three packages:

### `packages/core` (`@actalk/inkos-core`)
The engine. Contains all agents, the pipeline runner, state management, LLM abstraction, interaction runtime, and notification transports. Exports ~100+ symbols from `src/index.ts`. The `cli` and `studio` packages depend on this via `workspace:*`.

Key directories:
- **`src/agents/`** — Each agent is a class extending `BaseAgent` (provides `chat()` and `chatWithSearch()` helpers). The 10 pipeline agents: `planner.ts`, `composer.ts`, `architect.ts`, `writer.ts`, `length-normalizer.ts`, `continuity.ts` (auditor), `reviser.ts`, `radar.ts`, `polisher.ts`, `consolidator.ts`. Supporting files: `writer-prompts.ts`, `settler-prompts.ts`, `observer-prompts.ts`, `settler-delta-parser.ts`, `style-analyzer.ts`, `detector.ts`, `fanfic-*.ts`.
- **`src/pipeline/`** — `runner.ts` is the central orchestrator (~2500+ lines) that coordinates the entire per-chapter pipeline. `agent.ts` handles the interactive agent loop. `scheduler.ts` handles daemon scheduling. `chapter-state-recovery.ts` handles degraded state recovery after validation failures.
- **`src/state/`** — `manager.ts` manages book directories, truth files, control documents, chapter file I/O, and file locking. `state-reducer.ts` applies Zod-validated JSON deltas immutably. `state-projections.ts` renders markdown from JSON state. `memory-db.ts` provides SQLite-based relevance retrieval (Node 22+).
- **`src/llm/`** — `provider.ts` wraps the pi-ai SDK for chat completion/streaming. `service-presets.ts` is a registry of service presets (OpenAI, Anthropic, Google, Moonshot, etc.) with model lists, base URLs, and protocol compatibility. `service-resolver.ts` validates model-to-service binding. `providers/endpoints/` has ~40 endpoint configuration files.
- **`src/interaction/`** — Shared interaction runtime for CLI, TUI, Studio, and OpenClaw. `runtime.ts` is the execution kernel. `nl-router.ts` routes natural language to 15+ intent types. `session.ts` defines interaction sessions with creation drafts and pending decisions. `project-tools.ts` creates tool definitions for the agent loop.
- **`src/utils/`** — Configuration loading (`config-loader.ts`, `effective-llm-config.ts`, `llm-env.ts`), hook governance (`hook-*.ts`), context assembly, length metrics, analytics, and more.
- **`src/models/`** — Zod schemas and TypeScript types for books, chapters, projects, runtime state, input governance, genre profiles, style profiles, detection, etc.

### `packages/cli` (`@actalk/inkos` — published as `inkos` binary)
The CLI layer. Thin wrapper around core: `program.ts` registers all commands via `commander`, each command in `src/commands/` delegates to core. The `tui/` directory implements a full-screen React (Ink) terminal dashboard. `localization.ts` handles i18n (zh/en).

### `packages/studio` (`@actalk/inkos-studio`)
The web workbench. Frontend: Vite + React 19 + Tailwind CSS v4 + Zustand. Backend: Hono server (`src/api/server.ts`) that imports from core and provides REST + SSE endpoints. Uses hash-based routing. The Hono server is embedded — `src/api/index.ts` is the entry point that starts the server and serves the built frontend.

### `packages/server` (`@actalk/inkos-server`)
NestJS API server providing authentication, quota management, and admin dashboard. Replaces the Hono server for multi-user deployments. Port 3000 by default.

Key modules:
- **AuthModule** — JWT + Redis authentication (register, login, refresh, logout). Passport JWT strategy with Redis token blacklist. First-time setup endpoint creates initial admin.
- **UserModule** — User profile, password change, quota checks.
- **PaperModule** — Wraps `@actalk/inkos-core` StateManager and PaperRunner behind authenticated REST endpoints. Full CRUD, pipeline stage triggers, section management, outline/references editing, Word export.
- **AdminModule** — Admin-only routes: user CRUD, usage statistics, dashboard metrics. Protected by `@Roles('admin')` guard.
- **Common** — `JwtAuthGuard` (global, with `@Public()` opt-out), `RolesGuard`, `QuotaGuard` (checks paper/token limits), `UsageInterceptor`.

Database: MySQL via TypeORM. Entities: `User`, `Paper`, `UsageRecord`. Redis stores refresh tokens and JWT blacklist.

Config: `.env` in project root or `packages/server/`. See `.env.example` for required vars (`DB_*`, `REDIS_URL`, `JWT_SECRET`).

### Pipeline flow (per chapter)
1. **Plan**: Planner generates `chapter-XXXX.intent.md` (must-keep / must-avoid) from author intent, current focus, and memory retrieval
2. **Compose**: Composer selects relevant context from truth files, builds rule stack, generates `context.json`, `rule-stack.yaml`, `trace.json`
3. **Draft**: Writer produces prose (Phase 1, high temperature) → Observer over-extracts facts → Reflector outputs JSON delta → Normalizer adjusts length
4. **Audit**: Continuity auditor runs 33-dimension check against 7 truth files; can flag AI-tells, sensitive words, pacing monotony, etc.
5. **Revise**: Reviser fixes critical issues; pipeline loops audit→revise until all critical issues clear
6. **State settlement**: Zod-validated JSON delta is immutably applied to `story/state/*.json` truth files

### Input governance modes
- `v2` (default): `plan → compose → write` pipeline with structured control documents
- `legacy`: Old prompt-assembly path (explicit opt-in via `inkos.json` `inputGovernanceMode: "legacy"`)

### LLM configuration layering
Studio uses only project services + secrets. CLI/daemon adds env overlay: Studio/project config → secrets → `~/.inkos/.env` → project `.env` → process env → CLI args. The `--service` / `--model` / `--api-key-env` / `--base-url` flags apply for a single CLI invocation.

### Truth files (per book)
Stored as `story/state/*.json` (schema-validated) with `story/*.md` markdown projections:
- `current_state.md` — world state: character locations, relationships, knowledge
- `particle_ledger.md` — resource/inventory tracking
- `pending_hooks.md` — unresolved foreshadowing and promises
- `chapter_summaries.md` — per-chapter summaries with character appearances and events
- `subplot_board.md` — A/B/C plotline progress
- `emotional_arcs.md` — per-character emotional trajectories
- `character_matrix.md` — character interaction matrix and information boundaries

### Key dependencies
- `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core` (`0.67.1`): AI/agent SDK used as the LLM transport layer. Both pinned via pnpm overrides.
- `zod` (`^3.25`): Runtime schema validation for state, models, and LLM outputs
- `commander` (`^13`): CLI argument parsing
- `ink` (`^7`): React renderer for terminal (TUI)
- `hono` (`^4`): Studio HTTP server
- `zustand` (`^5`): Studio client state
- `vite` (`^6`): Studio frontend build

### Naming conventions
- Chapter directories use zero-padded 4-digit numbers: `chapters/0031/`
- Book IDs are derived from title via `deriveBookIdFromTitle()` (safe filename subset)
- Runtime artifacts: `chapter-XXXX.intent.md`, `chapter-XXXX.context.json`, `chapter-XXXX.rule-stack.yaml`, `chapter-XXXX.trace.json`

### Genres
Built-in genre profiles are Markdown files in `packages/core/genres/` (both English and Chinese genres). These are shipped with the published package and read at runtime via `readGenreProfile()`.
