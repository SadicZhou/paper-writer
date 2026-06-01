// Models
export {
  type PaperConfig,
  type Reference,
  type ReferenceType,
  type DegreeLevel,
  type CitationFormat,
  PaperConfigSchema,
  ReferenceSchema,
  ReferenceTypeSchema,
  DegreeLevelSchema,
  CitationFormatSchema,
  derivePaperIdFromTitle,
} from "./models/paper.js";
export {
  type SectionNode,
  type SectionType,
  type SectionStatus,
  type ArgumentClaim,
  type PaperOutline,
  SectionNodeSchema,
  SectionTypeSchema,
  SectionStatusSchema,
  ArgumentClaimSchema,
  PaperOutlineSchema,
} from "./models/paper-outline.js";
export {
  type AIDetectionLog,
  type InnovationPoint,
  type CitationMap,
  type PaperSectionState,
  type PipelineStage,
  type PipelineState,
  type PaperProjectSummary,
  AIDetectionLogSchema,
  InnovationPointSchema,
  CitationMapSchema,
  PaperSectionStateSchema,
  PipelineStageSchema,
  PipelineStateSchema,
  PaperProjectSummarySchema,
} from "./models/paper-state.js";
export {
  type WordAnnotation,
  type WordAnnotationType,
  type ImportedDocument,
  type SectionRevision,
  WordAnnotationSchema,
  WordAnnotationTypeSchema,
  ImportedDocumentSchema,
  SectionRevisionSchema,
} from "./models/paper-annotation.js";
export {
  type ProjectConfig,
  type LLMConfig,
  type NotifyChannel,
  type DetectionConfig,
  type QualityGates,
  type AgentLLMOverride,
  type AIDetectionMode,
  ProjectConfigSchema,
  LLMConfigSchema,
  AgentLLMOverrideSchema,
  DetectionConfigSchema,
  QualityGatesSchema,
  AIDetectionModeSchema,
} from "./models/project.js";
export { type DetectionHistoryEntry, type DetectionStats } from "./models/detection.js";
export {
  type LengthCountingMode,
  type LengthNormalizeMode,
  type LengthSpec,
  type LengthTelemetry,
  type LengthWarning,
  LengthCountingModeSchema,
  LengthNormalizeModeSchema,
  LengthSpecSchema,
  LengthTelemetrySchema,
  LengthWarningSchema,
} from "./models/length-governance.js";

// Agent base
export { BaseAgent, type AgentContext } from "./agents/base.js";

// Paper agents
export { TopicBrainstormer, type BrainstormInput, type BrainstormOutput } from "./agents/topic-brainstormer.js";
export { LiteratureSearcher, type LiteratureSearchInput, type LiteratureSearchOutput } from "./agents/literature-searcher.js";
export { OutlineBuilder, type OutlineBuildInput, type OutlineBuildOutput } from "./agents/outline-builder.js";
export { OutlineAgent, type OutlineAgentInput, type OutlineAgentOutput } from "./agents/outline-agent.js";
export { SectionWriter, type SectionWriteInput, type SectionWriteOutput } from "./agents/section-writer.js";
export { AIDetectionAuditor, type DetectionInput, type DetectionOutput, type DetectedPassage, type DetectionMetrics } from "./agents/ai-detection-auditor.js";
export { AIReductionReviser, type ReductionInput, type ReductionOutput } from "./agents/ai-reduction-reviser.js";
export { AcademicPolisher, type PolishInput, type PolishOutput } from "./agents/academic-polisher.js";
export { CitationFormatter, type FormatReferencesInput, type FormatReferencesOutput } from "./agents/citation-formatter.js";
export { DiagramVerifier, type DiagramVerifyInput, type DiagramVerifyOutput, type DiagramInfo } from "./agents/diagram-verifier.js";
export { WordImporter, type ImportInput, type ImportOutput } from "./agents/word-importer.js";

// LLM
export {
  createLLMClient,
  chatCompletion,
  chatWithTools,
  createStreamMonitor,
  PartialResponseError,
  type LLMClient,
  type LLMResponse,
  type LLMMessage,
  type ToolDefinition,
  type ToolCall,
  type AgentMessage,
  type ChatWithToolsResult,
  type StreamProgress,
  type OnStreamProgress,
} from "./llm/provider.js";
export {
  SERVICE_PRESETS,
  SERVICE_TO_PI_PROVIDER,
  resolveServicePreset,
  resolveServiceProviderFamily,
  resolveServicePiProvider,
  resolveServiceModelsBaseUrl,
  guessServiceFromBaseUrl,
  listModelsForService,
  listServicesWithModelCount,
  type ServicePreset,
  type ModelInfo,
} from "./llm/service-presets.js";
export { resolveServiceModel, type ResolvedModel } from "./llm/service-resolver.js";
export { loadSecrets, saveSecrets, getServiceApiKey, type SecretsFile } from "./llm/secrets.js";
export { migrateConfig, type MigrationResult } from "./llm/config-migration.js";
export {
  getAllEndpoints,
  getEndpoint,
  type InkosEndpoint,
  type InkosModel,
  type EndpointGroup,
} from "./llm/providers/index.js";
export { probeModelsFromUpstream, type ProbedModel } from "./llm/providers/probe.js";

// Utils
export { fetchUrl, searchWeb } from "./utils/web-search.js";
export { createLogger, createStderrSink, createJsonLineSink, nullSink, type Logger, type LogSink, type LogLevel, type LogEntry } from "./utils/logger.js";
export {
  loadProjectConfig,
  GLOBAL_CONFIG_DIR,
  GLOBAL_ENV_PATH,
  isApiKeyOptionalForEndpoint,
} from "./utils/config-loader.js";
export {
  resolveEffectiveLLMConfig,
  type EffectiveLLMConfigResult,
  type EffectiveLLMDiagnostics,
  type LLMConfigCliOverrides,
  type LLMConfigMode,
  type LLMConsumer,
  type LLMValueSource,
} from "./utils/effective-llm-config.js";
export {
  loadLLMEnvLayers,
  mergeEnvMaps,
  studioIgnoredEnv,
  cliOverlayEnv,
  legacyEnv,
  type LLMEnvLayers,
  type LLMEnvMap,
} from "./utils/llm-env.js";
export {
  countChapterLength,
  resolveLengthCountingMode,
  formatLengthCount,
  buildLengthSpec,
  isOutsideSoftRange,
  isOutsideHardRange,
  chooseNormalizeMode,
  type LengthLanguage,
} from "./utils/length-metrics.js";
export {
  buildProxyFetchInit,
  fetchWithProxy,
  resolveProxyUrl,
} from "./utils/proxy-fetch.js";
export { assertSafeBookId, deriveBookIdFromTitle, isSafeBookId } from "./utils/book-id.js";
export { safeChildPath } from "./utils/path-safety.js";

// State
export { StateManager } from "./state/manager.js";
export { MemoryDB, type Fact, type StoredSummary } from "./state/memory-db.js";

// Pipeline
export { PaperRunner, type PaperRunnerOptions, type PipelineEvent, type PipelineEventCallback, type PipelineEventType } from "./pipeline/paper-runner.js";
export { WordExporter, type ExportInput, type ExportOutput } from "./pipeline/word-exporter.js";

// Notify
export {
  dispatchNotification,
  dispatchWebhookEvent,
  type NotifyMessage,
} from "./notify/dispatcher.js";
export type { TelegramConfig } from "./notify/telegram.js";
export type { FeishuConfig } from "./notify/feishu.js";
export type { WechatWorkConfig } from "./notify/wechat-work.js";
export type { WebhookConfig, WebhookEvent, WebhookPayload } from "./notify/webhook.js";

export async function sendTelegram(
  config: import("./notify/telegram.js").TelegramConfig,
  message: string,
): Promise<void> {
  const transport = await import("./notify/telegram.js");
  await transport.sendTelegram(config, message);
}

export async function sendFeishu(
  config: import("./notify/feishu.js").FeishuConfig,
  title: string,
  text: string,
): Promise<void> {
  const transport = await import("./notify/feishu.js");
  await transport.sendFeishu(config, title, text);
}

export async function sendWechatWork(
  config: import("./notify/wechat-work.js").WechatWorkConfig,
  text: string,
): Promise<void> {
  const transport = await import("./notify/wechat-work.js");
  await transport.sendWechatWork(config, text);
}

export async function sendWebhook(
  config: import("./notify/webhook.js").WebhookConfig,
  payload: import("./notify/webhook.js").WebhookPayload,
): Promise<void> {
  const transport = await import("./notify/webhook.js");
  await transport.sendWebhook(config, payload);
}
