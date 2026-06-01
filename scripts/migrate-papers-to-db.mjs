/**
 * 将文件系统中 papers/ 目录的论文数据迁移到 MySQL
 * 运行: node scripts/migrate-papers-to-db.mjs
 */
import { readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// pnpm isolates packages — resolve mysql2 from packages/server/node_modules
const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromServer = createRequire(join(__dirname, "..", "packages", "server", "package.json"));
const mysql2 = requireFromServer("mysql2/promise");
const { createConnection } = mysql2.default?.createConnection ? mysql2.default : mysql2;

// Resolve project root: try env, then go up from scripts/ to monorepo root
const PROJECT_ROOT = process.env.INKOS_PROJECT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const PAPERS_DIR = join(PROJECT_ROOT, "papers");
console.log("Project root:", PROJECT_ROOT);
console.log("Papers dir:", PAPERS_DIR);

const DB = {
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: parseInt(process.env.DB_PORT ?? "3306"),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASS ?? "rootzjh@",
  database: process.env.DB_NAME ?? "paper_writer",
};

async function safeReadJson(path) {
  try { return JSON.parse(await readFile(path, "utf-8")); }
  catch { return null; }
}

async function migrate() {
  const conn = await createConnection(DB);
  console.log("Connected to MySQL");

  // List paper directories
  let dirs;
  try { dirs = await readdir(PAPERS_DIR); }
  catch { console.log("No papers/ directory found"); await conn.end(); return; }

  let migrated = 0;
  let skipped = 0;

  for (const dir of dirs) {
    const paperDir = join(PAPERS_DIR, dir);
    try { await access(join(paperDir, "paper.json")); }
    catch { continue; } // skip non-paper dirs

    const paperId = dir;
    console.log(`\n📄 ${paperId}`);

    // 1. Paper config → papers table (update if exists)
    const paperJson = await safeReadJson(join(paperDir, "paper.json"));
    if (paperJson) {
      const existing = await conn.execute("SELECT id FROM papers WHERE id = ?", [paperId]);
      if (existing[0].length > 0) {
        await conn.execute(
          `UPDATE papers SET title=?, major=?, degreeLevel=?, language=?, updatedAt=NOW() WHERE id=?`,
          [paperJson.title ?? "", paperJson.major ?? "", paperJson.degreeLevel ?? "undergraduate", paperJson.language ?? "zh", paperId]
        );
        console.log("  ✅ papers (updated)");
        skipped++;
      } else {
        await conn.execute(
          `INSERT INTO papers (id, userId, title, major, degreeLevel, language, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', NOW(), NOW())`,
          [paperId, "9123ed20-a784-4c68-aa95-fe745a514b12", paperJson.title ?? "", paperJson.major ?? "", paperJson.degreeLevel ?? "undergraduate", paperJson.language ?? "zh"]
        );
        console.log("  ✅ papers (inserted)");
        migrated++;
      }
    }

    // 2. Sections
    const sectionsDir = join(paperDir, "state", "sections");
    try {
      const files = await readdir(sectionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const secJson = await safeReadJson(join(sectionsDir, file));
        if (!secJson) continue;
        const num = secJson.sectionNumber ?? file.replace(".json", "");
        await conn.execute(
          `INSERT INTO paper_sections (id, paperId, sectionNumber, title, content, wordCount, status, aiDetectionScore, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), wordCount=VALUES(wordCount), status=VALUES(status), aiDetectionScore=VALUES(aiDetectionScore), updatedAt=NOW()`,
          [randomUUID(), paperId, num, secJson.title ?? "", secJson.content ?? "", secJson.wordCount ?? 0, secJson.status ?? "draft", secJson.aiDetectionScore ?? null]
        );
      }
      console.log(`  ✅ sections (${files.filter(f => f.endsWith(".json")).length} files)`);
    } catch { console.log("  ⚠️  no sections"); }

    // 3. Outline
    const outlineJson = await safeReadJson(join(paperDir, "state", "outline.json"));
    if (outlineJson) {
      await conn.execute(
        `INSERT INTO paper_outlines (id, paperId, title, sectionsJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE title=VALUES(title), sectionsJson=VALUES(sectionsJson), updatedAt=NOW()`,
        [randomUUID(), paperId, outlineJson.title ?? "", JSON.stringify(outlineJson.sections ?? outlineJson)]
      );
      console.log("  ✅ outline");
    }

    // 4. References
    const refsJson = await safeReadJson(join(paperDir, "state", "references.json"));
    if (refsJson && Array.isArray(refsJson)) {
      await conn.execute("DELETE FROM paper_references WHERE paperId = ?", [paperId]);
      for (const r of refsJson) {
        await conn.execute(
          `INSERT INTO paper_references (id, paperId, refId, type, title, authorsJson, year, journal, volume, issue, pages, doi, url, rawCitation, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), paperId, String(r.id ?? Math.random()).slice(0, 255), r.type ?? "other", r.title ?? "", r.authors ? JSON.stringify(r.authors) : null, r.year ?? null, r.journal ?? null, r.volume ?? null, r.issue ?? null, r.pages ?? null, r.doi ?? null, r.url ?? null, r.rawCitation ?? r.title ?? ""]
        );
      }
      console.log(`  ✅ references (${refsJson.length} entries)`);
    }

    // 5. Innovations
    const innovJson = await safeReadJson(join(paperDir, "state", "innovation_points.json"));
    if (innovJson && Array.isArray(innovJson)) {
      await conn.execute("DELETE FROM paper_innovations WHERE paperId = ?", [paperId]);
      for (const p of innovJson) {
        await conn.execute(
          `INSERT INTO paper_innovations (id, paperId, pointId, title, content, status, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), paperId, p.id ?? String(Math.random()), p.title ?? "", p.content ?? "", p.status ?? "planned"]
        );
      }
      console.log(`  ✅ innovations (${innovJson.length} entries)`);
    }

    // 6. Pipeline state
    const pipelineJson = await safeReadJson(join(paperDir, "runtime", "pipeline_state.json"));
    if (pipelineJson) {
      await conn.execute(
        `INSERT INTO pipeline_states (paperId, currentStage, completedStagesJson, status, error, totalSections, completedSections, eventsJson, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE currentStage=VALUES(currentStage), completedStagesJson=VALUES(completedStagesJson), status=VALUES(status), error=VALUES(error), totalSections=VALUES(totalSections), completedSections=VALUES(completedSections), eventsJson=VALUES(eventsJson), updatedAt=NOW()`,
        [paperId, pipelineJson.currentStage ?? "idle", pipelineJson.completedStages ? JSON.stringify(pipelineJson.completedStages) : null, pipelineJson.status ?? "idle", pipelineJson.error ?? null, pipelineJson.totalSections ?? 0, pipelineJson.completedSections ?? 0, pipelineJson.events ? JSON.stringify(pipelineJson.events) : null]
      );
      console.log("  ✅ pipeline state");
    }
  }

  await conn.end();
  console.log(`\n🎉 Done! ${migrated} new papers inserted, ${skipped} updated.`);
}

migrate().catch(e => { console.error(e); process.exit(1); });
