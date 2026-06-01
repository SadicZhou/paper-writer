import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ServiceConfig } from "../entities/service-config.entity.js";
import { createLLMClient, chatCompletion, getAllEndpoints } from "@actalk/inkos-core";

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return "********";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(ServiceConfig)
    private svcRepo: Repository<ServiceConfig>,
  ) {}

  /** Find by UUID or service name */
  private async resolve(userId: string, idOrName: string): Promise<ServiceConfig> {
    // Try UUID first
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName)) {
      const byId = await this.svcRepo.findOne({ where: { id: idOrName, userId } });
      if (byId) return byId;
    }
    // Fallback: lookup by service name
    const byName = await this.svcRepo.findOne({ where: { service: idOrName, userId } });
    if (!byName) throw new NotFoundException("Service config not found");
    return byName;
  }

  async listByUser(userId: string) {
    const configs = await this.svcRepo.find({ where: { userId }, order: { updatedAt: "DESC" } });
    const configMap = new Map(configs.map((c) => [c.service, c]));

    // 合并内置端点与用户配置
    const builtIn = getAllEndpoints().map((ep) => {
      const userCfg = configMap.get(ep.id);
      const firstModel = ep.models.find((m) => m.enabled !== false);
      return {
        service: ep.id,
        label: ep.label,
        group: ep.group ?? undefined,
        baseUrl: userCfg?.baseUrl ?? ep.baseUrl,
        defaultModel: userCfg?.modelMain ?? firstModel?.id,
        models: ep.models.map((m) => ({ id: m.id, name: m.id })),
        connected: !!(userCfg?.apiKey && userCfg.apiKey.length > 0),
        hasApiKey: !!(userCfg?.apiKey && userCfg.apiKey.length > 0),
        apiKeyPreview: userCfg?.apiKey ? maskApiKey(userCfg.apiKey) : "",
      };
    });

    // 用户自定义服务 (不在内置列表中的)
    const customConfigs = configs.filter((c) => !builtIn.some((b) => b.service === c.service));
    const customServices = customConfigs.map((c) => ({
      service: c.service,
      label: c.name || c.service,
      group: undefined,
      baseUrl: c.baseUrl ?? undefined,
      defaultModel: c.modelMain ?? undefined,
      models: c.modelMain ? [{ id: c.modelMain, name: c.modelMain }] : [],
      connected: !!(c.apiKey && c.apiKey.length > 0),
      hasApiKey: !!(c.apiKey && c.apiKey.length > 0),
      apiKeyPreview: c.apiKey ? maskApiKey(c.apiKey) : "",
      id: c.id,
      userId: c.userId,
      modelHaiku: c.modelHaiku,
      modelSonnet: c.modelSonnet,
      modelOpus: c.modelOpus,
      temperature: c.temperature,
      protocol: c.protocol,
      stream: c.stream,
      isDefault: c.isDefault,
    }));

    return { services: [...builtIn, ...customServices] };
  }

  async getById(userId: string, idOrName: string) {
    const c = await this.resolve(userId, idOrName);
    return {
      ...c,
      apiKey: undefined,
      hasApiKey: !!(c.apiKey && c.apiKey.length > 0),
      apiKeyPreview: c.apiKey ? maskApiKey(c.apiKey) : "",
    };
  }

  async create(userId: string, dto: {
    service: string; name?: string; baseUrl?: string; apiKey?: string;
    modelMain?: string; modelHaiku?: string; modelSonnet?: string; modelOpus?: string;
    temperature?: number; protocol?: string; stream?: boolean;
  }) {
    const config = this.svcRepo.create({ ...dto, userId });
    await this.svcRepo.save(config);
    return { id: config.id, service: config.service, name: config.name };
  }

  async update(userId: string, idOrName: string, dto: Record<string, unknown>) {
    const c = await this.resolve(userId, idOrName);

    const updatable = ["name", "baseUrl", "modelMain", "modelHaiku", "modelSonnet", "modelOpus", "temperature", "protocol", "stream", "isDefault"];
    for (const key of updatable) {
      if (dto[key] !== undefined) (c as any)[key] = dto[key];
    }
    await this.svcRepo.save(c);
    return { ok: true };
  }

  async updateSecret(userId: string, idOrName: string, apiKey: string) {
    // Upsert: 如果服务配置不存在则自动创建
    let c = await this.resolve(userId, idOrName).catch(() => null);
    if (!c) {
      const ep = getAllEndpoints().find((e) => e.id === idOrName);
      c = this.svcRepo.create({
        userId,
        service: idOrName,
        name: ep?.label ?? idOrName,
        baseUrl: ep?.baseUrl ?? "",
        modelMain: ep?.models.find((m) => m.enabled !== false)?.id,
        protocol: ep?.api === "anthropic-messages" ? "anthropic-messages" : ep?.api === "openai-completions" ? "chat" : undefined,
        apiKey,
      });
    } else {
      c.apiKey = apiKey;
    }
    await this.svcRepo.save(c);
    return { hasApiKey: true, preview: maskApiKey(apiKey) };
  }

  /** 保存完整服务配置 (对应旧 PUT /services/config) */
  async saveConfig(userId: string, dto: Record<string, unknown>) {
    const name = String(dto.service ?? "");
    if (!name) throw new NotFoundException("Service name required");

    let c = await this.svcRepo.findOne({ where: { service: name, userId } });
    if (!c) {
      const ep = getAllEndpoints().find((e) => e.id === name);
      c = this.svcRepo.create({
        userId,
        service: name,
        name: ep?.label ?? name,
        baseUrl: typeof dto.baseUrl === "string" ? dto.baseUrl : ep?.baseUrl ?? "",
        modelMain: typeof dto.defaultModel === "string" ? dto.defaultModel : ep?.models.find((m) => m.enabled !== false)?.id,
        protocol: typeof dto.protocol === "string" ? dto.protocol : undefined,
        stream: typeof dto.stream === "boolean" ? dto.stream : true,
        temperature: typeof dto.temperature === "number" ? dto.temperature : undefined,
        apiKey: typeof dto.apiKey === "string" ? dto.apiKey : undefined,
      });
    } else {
      if (typeof dto.baseUrl === "string") c.baseUrl = dto.baseUrl;
      if (typeof dto.defaultModel === "string") c.modelMain = dto.defaultModel;
      if (typeof dto.protocol === "string") c.protocol = dto.protocol as any;
      if (typeof dto.stream === "boolean") c.stream = dto.stream;
      if (typeof dto.temperature === "number") c.temperature = dto.temperature;
      if (typeof dto.apiKey === "string") c.apiKey = dto.apiKey;
    }
    await this.svcRepo.save(c);
    return { ok: true };
  }

  async getSecret(userId: string, idOrName: string) {
    const c = await this.resolve(userId, idOrName);
    return { hasApiKey: !!(c.apiKey && c.apiKey.length > 0), preview: c.apiKey ? maskApiKey(c.apiKey) : "" };
  }

  async delete(userId: string, idOrName: string) {
    // Try UUID first, then service name
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName)) {
      await this.svcRepo.delete({ id: idOrName, userId });
    } else {
      await this.svcRepo.delete({ service: idOrName, userId });
    }
    return { ok: true };
  }

  // ── Admin: manage any user's services ──

  async adminListByUser(userId: string) {
    return this.listByUser(userId);
  }

  async adminCreateForUser(userId: string, dto: { service: string; name?: string; baseUrl?: string; apiKey?: string; modelMain?: string; protocol?: string }) {
    return this.create(userId, dto);
  }

  async adminUpdateForUser(userId: string, idOrName: string, dto: Record<string, unknown>) {
    return this.update(userId, idOrName, dto);
  }

  async adminDeleteForUser(userId: string, idOrName: string) {
    return this.delete(userId, idOrName);
  }

  // ── Test connection ──

  async testConnection(userId: string, idOrName: string) {
    const c = await this.resolve(userId, idOrName);
    if (!c.apiKey) return { ok: false, error: "API Key 未配置" };
    if (!c.modelMain) return { ok: false, error: "模型未配置" };

    try {
      const client = createLLMClient({
        provider: c.protocol?.includes("anthropic") ? "anthropic" : "openai",
        service: c.service,
        configSource: "studio",
        baseUrl: c.baseUrl ?? "",
        apiKey: c.apiKey,
        model: c.modelMain,
        temperature: c.temperature ?? 0.7,
        thinkingBudget: 0,
        apiFormat: (c.protocol === "responses" ? "responses" : "chat") as "chat" | "responses",
        stream: c.stream ?? true,
      } as any);
      await chatCompletion(client, c.modelMain, [{ role: "user", content: "ping" }], { maxTokens: 64 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
