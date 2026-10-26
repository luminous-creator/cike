import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AiMisconfigured, listModels } from "../ai-client";

// 两种接入方式，自动识别：
//   1. 自配 OpenAI 兼容接口（默认 DeepSeek）：DEEPSEEK_API_KEY 或 AI_API_KEY
//   2. Kimi 平台网关：平台注入 KIMI_AGENTGW_API_KEY / KIMI_AGENTGW_BASE_URL
// 都没有时 resolveAi() 返回 null，harness 走规则兜底，本地功能不受影响。

try { process.loadEnvFile(); } catch { /* 没有 .env 时保持现状 */ }

const read = (key: string) => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export const kimiGw = createOpenAICompatible({
  name: "kimi-gw",
  baseURL: process.env.KIMI_AGENTGW_BASE_URL ?? "",
  apiKey: process.env.KIMI_AGENTGW_API_KEY ?? "",
  includeUsage: true,
  supportsStructuredOutputs: true,
});

export type Effort = "none" | "low" | "high" | "max";

export interface AiBackend {
  kind: "custom" | "kimi";
  label: string;
  modelId: string;
  model: LanguageModel;
  /** 按调用设置思考强度；不支持的后端返回 undefined */
  options: (effort: Effort) => Record<string, Record<string, string>> | undefined;
  defaultEffort: Effort;
}

const PROVIDER = "cike";

function customConfig() {
  // 还没有密钥时重读 .env：填好密钥后不用重启服务。
  // 不能用 loadEnvFile——启动时读进来的空值也算"已存在"，不会被覆盖。
  if (!read("AI_API_KEY") && !read("DEEPSEEK_API_KEY")) {
    try {
      const fresh = parseEnv(readFileSync(".env", "utf8"));
      for (const [key, value] of Object.entries(fresh)) if (!read(key) && value) process.env[key] = value;
    } catch { /* 没有 .env */ }
  }
  const apiKey = read("AI_API_KEY") ?? read("DEEPSEEK_API_KEY");
  if (!apiKey) return null;
  const baseURL = (read("AI_BASE_URL") ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const modelId = read("AI_MODEL") ?? "deepseek-flash";
  const isDeepSeek = /deepseek/i.test(baseURL);
  const effortEnv = read("AI_REASONING_EFFORT") as Effort | undefined;
  return { apiKey, baseURL, modelId, isDeepSeek, effortEnv };
}

export function aiStatus(): { configured: boolean; kind: AiBackend["kind"] | null; label: string; model: string | null } {
  const custom = customConfig();
  if (custom) return { configured: true, kind: "custom", label: custom.isDeepSeek ? "DeepSeek" : new URL(custom.baseURL).host, model: custom.modelId };
  if (read("KIMI_AGENTGW_API_KEY") && read("KIMI_AGENTGW_BASE_URL")) return { configured: true, kind: "kimi", label: "Kimi 网关", model: null };
  return { configured: false, kind: null, label: "未接入模型", model: null };
}

let cachedKimiModel: string | null = null;

export async function resolveAi(): Promise<AiBackend | null> {
  const custom = customConfig();
  if (custom) {
    const provider = createOpenAICompatible({
      name: PROVIDER,
      baseURL: custom.baseURL,
      apiKey: custom.apiKey,
      includeUsage: true,
    });
    const sendsEffort = custom.isDeepSeek || Boolean(custom.effortEnv);
    return {
      kind: "custom",
      label: custom.isDeepSeek ? "DeepSeek" : new URL(custom.baseURL).host,
      modelId: custom.modelId,
      model: provider(custom.modelId),
      options: (effort) => (sendsEffort ? { [PROVIDER]: { reasoningEffort: effort } } : undefined),
      defaultEffort: custom.effortEnv ?? "low",
    };
  }
  if (read("KIMI_AGENTGW_API_KEY") && read("KIMI_AGENTGW_BASE_URL")) {
    // 平台约定：不要硬编码模型 id，运行时读 default_model_id
    if (!cachedKimiModel) cachedKimiModel = (await listModels()).defaultModelId;
    return { kind: "kimi", label: "Kimi 网关", modelId: cachedKimiModel, model: kimiGw(cachedKimiModel), options: () => undefined, defaultEffort: "none" };
  }
  return null;
}

export function requireAi(backend: AiBackend | null): AiBackend {
  if (!backend) throw new AiMisconfigured("未配置模型：在 .env 填 DEEPSEEK_API_KEY，或在 Kimi 平台发布站点");
  return backend;
}
