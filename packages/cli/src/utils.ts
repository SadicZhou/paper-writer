import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createLLMClient,
  StateManager,
  createLogger,
  createStderrSink,
  createJsonLineSink,
  resolveEffectiveLLMConfig,
  loadLLMEnvLayers,
  GLOBAL_CONFIG_DIR,
  GLOBAL_ENV_PATH,
  type EffectiveLLMConfigResult,
  type LLMConfigCliOverrides,
  type ProjectConfig,
  type LogSink,
} from "@actalk/inkos-core";
import { formatSqliteMemorySupportWarning } from "./runtime-requirements.js";

export { GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH };

let sqliteMemorySupportWarned = false;

export async function resolveContext(opts: {
  readonly context?: string;
  readonly contextFile?: string;
}): Promise<string | undefined> {
  if (opts.context) return opts.context;
  if (opts.contextFile) {
    return readFile(resolve(opts.contextFile), "utf-8");
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (text.length > 0) return text;
  }
  return undefined;
}

export function findProjectRoot(): string {
  return process.cwd();
}

export async function loadConfig(options?: {
  readonly requireApiKey?: boolean;
  readonly projectRoot?: string;
  readonly cli?: LLMConfigCliOverrides;
}): Promise<ProjectConfig> {
  return (await loadConfigWithDiagnostics(options)).config;
}

export async function loadConfigWithDiagnostics(options?: {
  readonly requireApiKey?: boolean;
  readonly projectRoot?: string;
  readonly cli?: LLMConfigCliOverrides;
}): Promise<EffectiveLLMConfigResult> {
  const root = options?.projectRoot ?? findProjectRoot();
  const cli = {
    ...parseLLMOverridesFromArgv(process.argv.slice(2)),
    ...options?.cli,
  };
  const envLayers = await loadLLMEnvLayers(root);
  return resolveEffectiveLLMConfig({
    consumer: "cli",
    projectRoot: root,
    envLayers,
    cli,
    requireApiKey: options?.requireApiKey,
  });
}

export function createClient(config: ProjectConfig) {
  return createLLMClient(config.llm);
}

export function parseLLMOverridesFromArgv(argv: readonly string[]): LLMConfigCliOverrides {
  const overrides: {
    service?: string;
    model?: string;
    apiKeyEnv?: string;
    baseUrl?: string;
    apiFormat?: "chat" | "responses";
    stream?: boolean;
  } = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    const [flag, inlineValue] = arg.split("=", 2) as [string, string | undefined];
    const nextValue = () => inlineValue ?? argv[++i];

    if (flag === "--service") {
      const value = nextValue();
      if (value) overrides.service = value;
    } else if (flag === "--model") {
      const value = nextValue();
      if (value) overrides.model = value;
    } else if (flag === "--api-key-env") {
      const value = nextValue();
      if (value) overrides.apiKeyEnv = value;
    } else if (flag === "--base-url") {
      const value = nextValue();
      if (value) overrides.baseUrl = value;
    } else if (flag === "--api-format") {
      const value = nextValue();
      if (value === "chat" || value === "responses") overrides.apiFormat = value;
    } else if (flag === "--stream") {
      overrides.stream = true;
    } else if (flag === "--no-stream") {
      overrides.stream = false;
    }
  }

  return overrides;
}

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function logError(message: string): void {
  process.stderr.write(`[ERROR] ${message}\n`);
}
