import { Injectable } from "@nestjs/common";

@Injectable()
export class AppService {
  private projectRoot = process.env.INKOS_PROJECT_ROOT ?? process.cwd();

  async getProjectConfig(): Promise<Record<string, unknown>> {
    try {
      const { loadProjectConfig } = await import("@actalk/inkos-core");
      return await loadProjectConfig(this.projectRoot, { consumer: "studio" });
    } catch {
      // Return minimal config so frontend can boot without inkos.json
      return {
        language: "zh",
        languageExplicit: true,
        llm: { provider: "custom", service: "deepseek", model: "deepseek-v4-flash" },
      };
    }
  }

  async updateProjectConfig(body: Record<string, unknown>): Promise<{ ok: boolean }> {
    const { join } = await import("node:path");
    const { readFile, writeFile } = await import("node:fs/promises");

    const configPath = join(this.projectRoot, "inkos.json");
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(await readFile(configPath, "utf-8"));
    } catch { /* new file */ }

    if (body.llm) raw.llm = { ...(raw.llm as Record<string, unknown> ?? {}), ...(body.llm as Record<string, unknown>) };
    if (body.language !== undefined) raw.language = body.language;
    if (body.modelOverrides !== undefined) raw.modelOverrides = body.modelOverrides;

    await writeFile(configPath, JSON.stringify(raw, null, 2), "utf-8");
    return { ok: true };
  }

  async getServices(): Promise<{ services: Array<{ service: string; hasApiKey: boolean; label?: string }> }> {
    try {
      const { loadSecrets } = await import("@actalk/inkos-core");
      const secrets = await loadSecrets(this.projectRoot);
      return {
        services: Object.entries(secrets).map(([service, key]) => ({
          service,
          hasApiKey: typeof key === "string" && key.length > 0,
          label: service,
        })),
      };
    } catch {
      return { services: [] };
    }
  }
}
