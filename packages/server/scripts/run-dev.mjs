/**
 * 跨平台开发启动脚本：tsc --watch 编译 + 可控重启 node 服务。
 * 避免 node --watch 在 tsc 重编译时端口未释放导致 EADDRINUSE。
 * @author zjh
 */
import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");
const distDir = path.join(serverDir, "dist");
const require = createRequire(path.join(serverDir, "package.json"));
const tscBin = require.resolve("typescript/bin/tsc");

/** @type {import("node:child_process").ChildProcess | null} */
let serverProcess = null;
let shuttingDown = false;
let restartTimer = null;
let restartInFlight = false;
let restartQueued = false;

const initial = spawnSync(process.execPath, [tscBin], {
  cwd: serverDir,
  stdio: "inherit",
});
if (initial.status !== 0) {
  process.exit(initial.status ?? 1);
}

const tscWatch = spawn(process.execPath, [tscBin, "--watch", "--preserveWatchOutput"], {
  cwd: serverDir,
  stdio: "inherit",
});

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function startServer() {
  if (shuttingDown || serverProcess) return;
  serverProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: serverDir,
    stdio: "inherit",
  });
  serverProcess.once("exit", () => {
    serverProcess = null;
    if (!shuttingDown && restartQueued) {
      restartQueued = false;
      void restartServer();
    }
  });
}

async function stopServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  serverProcess = null;
  proc.kill("SIGTERM");
  await waitForExit(proc);
  // 给 OS 一点时间释放端口
  await new Promise((r) => setTimeout(r, 300));
}

async function restartServer() {
  if (shuttingDown) return;
  if (restartInFlight) {
    restartQueued = true;
    return;
  }
  restartInFlight = true;
  try {
    await stopServer();
    if (!shuttingDown) startServer();
  } finally {
    restartInFlight = false;
    if (restartQueued && !shuttingDown) {
      restartQueued = false;
      void restartServer();
    }
  }
}

function scheduleRestart() {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void restartServer();
  }, 400);
}

startServer();

try {
  watch(distDir, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".js")) return;
    scheduleRestart();
  });
} catch {
  // dist 目录尚不存在时忽略
}

async function cleanup() {
  shuttingDown = true;
  clearTimeout(restartTimer);
  tscWatch.kill();
  await stopServer();
  process.exit(0);
}

process.on("SIGINT", () => void cleanup());
process.on("SIGTERM", () => void cleanup());

tscWatch.on("close", (code) => {
  void cleanup().finally(() => process.exit(code ?? 0));
});
