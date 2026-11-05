import { Hono } from "hono";
import { chatRequestSchema, type ChatContext } from "@contracts/chat";
import { resolveAi } from "../ai/provider";
import { runChat } from "../chat/engine";
import { friendly } from "../harness/engine";
import { log } from "../lib/logger";

export const chatRoutes = new Hono();

// 聊天版必须接模型：没配置时返回 503，前端提示去设置里接入
chatRoutes.post("/", async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请求格式不正确" }, 400);
  const ai = await resolveAi().catch(() => null);
  if (!ai) return c.json({ error: "还没接入模型：在设置里填模型，或在服务端 .env 里填 DEEPSEEK_API_KEY", code: "no_model" }, 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const reply = await runChat({ ...parsed.data, context: parsed.data.context as unknown as ChatContext }, ai, controller.signal);
    return c.json(reply);
  } catch (error) {
    const info = friendly(error);
    log.error("chat failed", { code: info.code, message: (error as Error)?.message });
    return c.json({ error: info.message.replace("，已改用规则结果。", ""), code: info.code }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
