import { Hono } from "hono";
import { generateObject } from "ai";
import { taskAnalysisInputSchema, taskAnalysisSchema } from "@contracts/ai";
import { classifyAiError, AiInvalidRequest, AiMisconfigured, AiTransient, AiUnavailable, ContentRejected } from "../ai-client";
import { requireAi, resolveAi } from "../ai/provider";
import { log } from "../lib/logger";

export const analyzeRoutes = new Hono();

const SYSTEM_PROMPT = `你是“此刻”个人行动系统的任务整理助手。用户会提供一件事、可选的行动动机、任务类型和建议间隔。
你的职责是把模糊想法整理成轻松、具体、可执行的建议，不是训斥、规划人生或制造压力。
严格输出三个短字段：
1. definition：用一句话界定这件事具体在做什么，不重复空泛口号。
2. nextAction：一个现在可以开始的最小下一步，以动词开头，尽量能在一次短行动中完成。
3. cadence：结合任务类型给出一句节奏建议；一次任务说明完成后归档，周期行动围绕建议间隔，学习复习围绕主动回忆和反馈。
尊重用户原始意图，不擅自添加目标、截止日期或工作量，不夸大收益，不作医疗或财务建议。使用自然简洁的简体中文，不使用 Markdown、表情符号、编号或第二人称说教。`;

analyzeRoutes.post("/", async (c) => {
  const parsed = taskAnalysisInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请先填写任务名称，并检查输入内容。" }, 400);

  try {
    const ai = requireAi(await resolveAi());
    const input = parsed.data;
    const { object } = await generateObject({
      model: ai.model,
      providerOptions: ai.options("none"),
      schema: taskAnalysisSchema,
      system: SYSTEM_PROMPT,
      prompt: `请分析以下任务：\n${JSON.stringify(input)}`,
      maxOutputTokens: 700,
      abortSignal: AbortSignal.timeout(45_000),
    });
    return c.json({ analysis: object });
  } catch (cause) {
    const error = classifyAiError(cause);
    log.error("AI analysis failed", { type: error.name, message: error.message });
    if (error instanceof AiUnavailable) {
      return c.json({ error: "AI 额度暂时不可用，请稍后再试。任务仍可正常保存和打卡。" }, 503);
    }
    if (error instanceof ContentRejected) {
      return c.json({ error: "这段描述暂时无法分析，请换一种表述。任务仍可正常保存。" }, 400);
    }
    if (error instanceof AiMisconfigured) {
      return c.json({ error: "AI 服务尚未配置，请先保存任务；本地功能不受影响。" }, 503);
    }
    if (error instanceof AiTransient) {
      return c.json({ error: "AI 暂时没有回应，请稍后手动重试。任务仍可正常保存和打卡。" }, 503);
    }
    if (error instanceof AiInvalidRequest) {
      return c.json({ error: "分析请求未通过，请调整描述后再试。" }, 400);
    }
    return c.json({ error: "分析暂时失败，请稍后手动重试。" }, 500);
  }
});
