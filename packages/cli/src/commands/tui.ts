import { Command } from "commander";
import { log } from "../utils.js";

export interface TuiCommandHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
}

export function createTuiCommand(hooks: TuiCommandHooks = {}): Command {
  return new Command("tui")
    .description("打开项目工作区 TUI（已弃用）")
    .action(async () => {
      if (hooks.launchTui) {
        await hooks.launchTui(process.cwd());
        return;
      }
      log("TUI 已移除，请使用 Studio Web 界面代替：inkos studio");
    });
}
