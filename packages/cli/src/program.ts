import { createRequire } from "node:module";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { paperCommand } from "./commands/paper.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { createStudioCommand, launchStudioEntry } from "./commands/studio.js";
import { createTuiCommand } from "./commands/tui.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export interface ProgramHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
  readonly launchStudio?: (projectRoot: string, port: string) => Promise<void> | void;
}

export function createProgram(hooks: ProgramHooks = {}): Command {
  const program = new Command();

  program
    .name("inkos")
    .description("InkOS — AI academic paper writing system")
    .version(version)
    .enablePositionalOptions()
    .option("--service <service>", "Override LLM service for this CLI run")
    .option("--model <model>", "Override LLM model for this CLI run")
    .option("--api-key-env <envVar>", "Read LLM API key from this environment variable for this CLI run")
    .option("--base-url <url>", "Override LLM base URL for this CLI run")
    .option("--api-format <chat|responses>", "Override LLM API format for this CLI run")
    .option("--stream", "Force streaming LLM responses for this CLI run")
    .option("--no-stream", "Force non-streaming LLM responses for this CLI run")
    .action(async () => {
      await launchStudioEntry(process.cwd(), "4567", { launchStudio: hooks.launchStudio });
    });

  program.addCommand(initCommand);
  program.addCommand(configCommand);
  program.addCommand(paperCommand);
  program.addCommand(statusCommand);
  program.addCommand(doctorCommand);
  program.addCommand(createStudioCommand({ launchStudio: hooks.launchStudio }));
  program.addCommand(createTuiCommand({ launchTui: hooks.launchTui }));

  return program;
}

export async function runProgram(
  argv: string[] = process.argv,
  hooks: ProgramHooks = {},
): Promise<void> {
  const program = createProgram(hooks);
  await program.parseAsync(argv);
}
