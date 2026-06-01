---
name: project-workdir
description: Current working state
type: project
originSessionId: 536621f2-569a-4f2f-8e47-acac09269872
---
As of 2026-06-01, the project has been significantly restructured:

**New backend**: NestJS server (`packages/server/`) with MySQL + Redis + TypeORM + JWT auth. Replaces the old Hono server for multi-user scenarios.

**Frontend split**: Studio (`packages/studio/`) for paper writing, Admin Panel (`packages/admin-panel/`) for user management. InkOS branding removed, replaced with "Paper Writer".

**Data migration**: Paper content migrating from filesystem-only to MySQL + filesystem dual-write. DB tables: `paper_sections`, `paper_outlines`, `paper_references`, `paper_innovations`, `pipeline_states`.

**Service configs**: LLM service configurations moved from `inkos.json` to MySQL `service_configs` table with per-user isolation.

**Deployment**: Docker Compose + Nginx proxy configuration ready.

Key bugs fixed: SSE events format, export 401, service delete auth, outline display, token auto-refresh.

Remote: `https://github.com/SadicZhou/paper-writer`
