export interface ChatPageModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ChatPageModelGroup {
  readonly service: string;
  readonly label: string;
  readonly models: ReadonlyArray<ChatPageModelInfo>;
}

export interface ChatPageModelPreference {
  readonly model?: string | null;
  readonly service?: string | null;
}

/**
 * 从项目已保存的 LLM 偏好解析出可选的模型与服务（不包含「取第一个可用模型」兜底）。
 * @author zjh
 * @date 2026-05-12
 */
function resolveFromPreferenceOnly(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  preference?: ChatPageModelPreference | null,
): { model: string; service: string } | null {
  const preferredService = preference?.service?.trim();
  const preferredModel = preference?.model?.trim();
  if (preferredService) {
    const preferredGroup = groupedModels.find((group) => group.service === preferredService);
    const exactModel = preferredModel
      ? preferredGroup?.models.find((model) => model.id === preferredModel)
      : undefined;
    if (preferredGroup && exactModel) {
      return { model: exactModel.id, service: preferredGroup.service };
    }
    const firstPreferredModel = preferredGroup?.models[0];
    if (preferredGroup && firstPreferredModel) {
      return { model: firstPreferredModel.id, service: preferredGroup.service };
    }
  }

  if (preferredModel) {
    for (const group of groupedModels) {
      const exactModel = group.models.find((model) => model.id === preferredModel);
      if (exactModel) return { model: exactModel.id, service: group.service };
    }
  }

  return null;
}

export interface PickModelSelectionOptions {
  /**
   * 为 true 时，以模型配置页写入项目的默认服务/模型为准，与当前聊天选择不一致时也会对齐（用于跨页回显）。
   * @author zjh
   * @date 2026-05-12
   */
  readonly preferProjectConfig?: boolean;
}

const PAPER_CREATE_SESSION_KEY = "inkos.paper-create.session-id";

export function getPaperCreateSessionId(): string | null {
  return globalThis.localStorage?.getItem(PAPER_CREATE_SESSION_KEY) ?? null;
}

export function setPaperCreateSessionId(sessionId: string): void {
  globalThis.localStorage?.setItem(PAPER_CREATE_SESSION_KEY, sessionId);
}

export function clearPaperCreateSessionId(): void {
  globalThis.localStorage?.removeItem(PAPER_CREATE_SESSION_KEY);
}

export function filterModelGroups(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  search: string,
): ReadonlyArray<ChatPageModelGroup> {
  const query = search.trim().toLowerCase();
  if (!query) return groupedModels;

  return groupedModels
    .map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        (model.name ?? model.id).toLowerCase().includes(query)
        || group.label.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.models.length > 0);
}

export function pickModelSelection(
  groupedModels: ReadonlyArray<ChatPageModelGroup>,
  selectedModel: string | null,
  selectedService: string | null,
  preference?: ChatPageModelPreference | null,
  options?: PickModelSelectionOptions,
): { model: string; service: string } | null {
  const fromPreference = resolveFromPreferenceOnly(groupedModels, preference);
  const preferProject = Boolean(options?.preferProjectConfig);

  if (preferProject && fromPreference) {
    const aligned = selectedModel === fromPreference.model && selectedService === fromPreference.service;
    return aligned ? null : fromPreference;
  }

  const selectedStillAvailable = selectedModel && selectedService
    ? groupedModels.some((group) =>
        group.service === selectedService
        && group.models.some((model) => model.id === selectedModel),
      )
    : false;
  if (selectedStillAvailable) return null;

  if (fromPreference) return fromPreference;

  const firstGroup = groupedModels.find((group) => group.models.length > 0);
  const firstModel = firstGroup?.models[0];
  if (!firstGroup || !firstModel) return null;
  return { model: firstModel.id, service: firstGroup.service };
}
