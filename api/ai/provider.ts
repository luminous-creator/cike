import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

if (!process.env.KIMI_AGENTGW_BASE_URL || !process.env.KIMI_AGENTGW_API_KEY) {
  try { process.loadEnvFile(); } catch { /* The client maps missing provisioning to a readable error. */ }
}

export const kimiGw = createOpenAICompatible({
  name: "kimi-gw",
  baseURL: process.env.KIMI_AGENTGW_BASE_URL!,
  apiKey: process.env.KIMI_AGENTGW_API_KEY!,
  includeUsage: true,
  supportsStructuredOutputs: true,
});
