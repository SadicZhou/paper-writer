---
name: paper-persistence
description: How paper data is stored — MySQL + filesystem dual-write architecture
metadata:
  type: project
---

# 论文持久化机制

## 双重存储

论文数据同时存储在 MySQL 和文件系统中：

### MySQL 表（主存储）
- `papers` — 论文元数据（id, title, major, userId, status）
- `paper_sections` — 章节内容（paperId, sectionNumber, content [MEDIUMTEXT], wordCount, status）
- `paper_outlines` — 大纲（paperId, sectionsJson [LONGTEXT]）
- `paper_references` — 参考文献（paperId, refId [256], title, authorsJson, year, doi）
- `paper_innovations` — 创新点（paperId, pointId, title, content, status）
- `pipeline_states` — 流水线状态（paperId PK, currentStage, status, eventsJson）

### 文件系统（兼容保留）
- `papers/<id>/paper.json` — 论文配置
- `papers/<id>/state/sections/<n>.json` — 章节
- `papers/<id>/state/outline.json` — 大纲
- `papers/<id>/state/references.json` — 参考文献
- `papers/<id>/state/innovation_points.json` — 创新点
- `papers/<id>/runtime/pipeline_state.json` — 流水线状态

## 读写策略

- **读**: MySQL 优先，找不到时 fallback 到文件系统
- **写**: 同时写入 MySQL 和文件系统（dual-write）
- **流水线同步**: PaperRunner 直接写文件系统，`regenerateSection`/`runWriting`/`runPolish` 完成后自动调用 `syncSectionsFromFilesystem` 同步到 MySQL

## 数据迁移

迁移脚本: `scripts/migrate-papers-to-db.mjs`
运行方式: `pnpm --filter @actalk/inkos-server exec node ../../scripts/migrate-papers-to-db.mjs`

## 注意事项

- `StateManager`（来自 `@actalk/inkos-core`）只能读写文件系统，不碰 MySQL
- `DbStorageService` 只读写 MySQL，不碰文件系统
- `PaperService` 协调两者
- PaperRunner 内部通过 `onEvent` 回调传递进度，完成后由 PaperService 的 `.then()` 回调触发同步
