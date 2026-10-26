import { Hono, type Context } from "hono";
import { stream } from "hono/streaming";
import { planRequestSchema, reviewRequestSchema, todayRequestSchema, type HarnessEvent } from "@contracts/harness";
import { aiStatus, resolveAi } from "../ai/provider";
import { friendly, runPlan, runReview, runToday } from "../harness/engine";
import { log } from "../lib/logger";

export const harnessRoutes = new Hono();

harnessRoutes.get("/ai/status", (c) => c.json(aiStatus()));

type Runner = (emit: (event: HarnessEvent) => void, signal: AbortSignal) => Promise<{ steps: number }>;

function ndjson(c: Context, label: string, run: Runner, model: string | null) {
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-store");
  const started = Date.now();
  return stream(c, async (s) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    s.onAbort(() => controller.abort());
    const emit = (event: HarnessEvent) => { void s.write(`${JSON.stringify(event)}\n`); };
    try {
      const stats = await run(emit, controller.signal);
      emit({ type: "done", durationMs: Date.now() - started, steps: stats.steps, model });
    } catch (error) {
      const info = friendly(error);
      log.error(`${label} failed`, { code: info.code, message: (error as Error)?.message });
      emit({ type: "error", ...info });
      emit({ type: "done", durationMs: Date.now() - started, steps: 0, model });
    } finally {
      clearTimeout(timeout);
    }
  });
}

harnessRoutes.post("/plan", async (c) => {
  const parsed = planRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请求格式不正确" }, 400);
  const ai = await resolveAi().catch(() => null);
  return ndjson(c, "plan", (emit, signal) => runPlan(parsed.data, ai, emit, signal), ai?.modelId ?? null);
});

harnessRoutes.post("/review", async (c) => {
  const parsed = reviewRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请求格式不正确" }, 400);
  const ai = await resolveAi().catch(() => null);
  return ndjson(c, "review", (emit, signal) => runReview(parsed.data, ai, emit, signal), ai?.modelId ?? null);
});

harnessRoutes.post("/today", async (c) => {
  const parsed = todayRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "请求格式不正确" }, 400);
  const ai = await resolveAi().catch(() => null);
  return ndjson(c, "today", (emit, signal) => runToday(parsed.data, ai, emit, signal), ai?.modelId ?? null);
});
