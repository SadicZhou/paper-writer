import { Command } from "commander";
import { log } from "../utils.js";

export interface TuiCommandHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
}

export function createTuiCommand(hooks: TuiCommandHooks = {}): Command {
  return new Command("tui")
    .description("Open the InkOS project workspace TUI")
    .action(async () => {
      if (hooks.launchTui) {
        await hooks.launchTui(process.cwd());
        return;
      }
      log("InkOS TUI has been removed. Please use InkOS Studio (web UI) instead: inkos studio");
    });
}
