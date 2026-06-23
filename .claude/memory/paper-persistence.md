---
name: paper-persistence
description: How paper data is stored — MySQL as sole data source
metadata:
  type: project
---

# 论文持久化机制

## 数据策略（2026-06-02 更新）

**MySQL 为唯一数据源**，文件系统仅用于流水线运行时。

### MySQL 表（唯一数据源）
- `papers` — 论文元数据（id, title, major, userId, status）
- `paper_sections` — 章节内容（paperId, sectionNumber, content [MEDIUMTEXT], wordCount, status）
- `paper_outlines` — 大纲（paperId, sectionsJson [LONGTEXT]）
- `paper_references` — 参考文献（paperId, refId [256], title, authorsJson, year, doi）
- `paper_innovations` — 创新点（paperId, pointId, title, content, status）
- `pipeline_states` — 流水线状态（paperId PK, currentStage, status, eventsJson）

### 文件系统（仅流水线运行时）
- `papers/<id>/paper.json` — 论文配置（PaperRunner 需要）
- `papers/<id>/state/sections/<n>.json` — 章节（PaperRunner 写入）
- `papers/<id>/state/outline.json` — 大纲（PaperRunner 写入）
- `papers/<id>/state/references.json` — 参考文献（PaperRunner 写入）
- `papers/<id>/state/innovation_points.json` — 创新点（PaperRunner 写入）
- `papers/<id>/runtime/pipeline_state.json` — 流水线状态（PaperRunner 写入）

## 读写策略

- **读**: 仅从 MySQL 读取
- **写**: CRUD 操作仅写入 MySQL
- **流水线**: PaperRunner 写文件系统，完成后自动调用 `syncSectionsFromFilesystem` 同步到 MySQL
- **导出**: 从 MySQL 读取数据，传给 WordExporter

## 注意事项

- `StateManager`（来自 `@actalk/inkos-core`）仅用于 PaperRunner 流水线运行时
- `DbStorageService` 是 MySQL 的唯一访问层
- `PaperService` 协调两者
- PaperRunner 内部通过 `onEvent` 回调传递进度，完成后由 PaperService 的 `.then()` 回调触发同步
