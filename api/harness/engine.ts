// 动态 harness：
//   规划（确定性）→ 路由 / 议程 → 模型在工具循环里执行 → 每次提交过校验器，不合格退回修正 → 未覆盖部分规则兜底。
// 模型只提议，不直接改任何数据；所有结果作为事件流式返回给浏览器。
import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage, type ToolSet } from "ai";
import { z, type ZodType } from "zod";
import {
  judgementSchema, planSchema, routeSchema, synthesisSchema,
  type HarnessEvent, type Judgement, type Plan, type PlanResult, type ReviewMode, type ReviewResult, type Route, type Snapshot, type Synthesis,
} from "@contracts/harness";
import { offlinePlan, offlineReview } from "@contracts/fallback";
import { keywordRoute, type Archetype } from "@contracts/playbooks";
import { autoFixPlan, busySlots, checkPlan, derivePlan, freeSlots, rulePlan, ruleRoute, verifyRoute, weeklyLoad } from "@contracts/planner";
import {
  computeBalance, computeSignals, daysFrom, planReview, ruleJudgement, ruleSynthesis, verifyJudgement, verifySynthesis,
  type ItemSignals, type VerifyContext,
} from "@contracts/signals";
import { classifyAiError, AiInvalidRequest, AiMisconfigured, AiTransient, AiUnavailable, ContentRejected } from "../ai-client";
import type { AiBackend, Effort } from "../ai/provider";
import { routerSystem, reviewSystem, specialistSystem } from "./prompts";

export type Emit = (event: HarnessEvent) => void;

interface RunStats { steps: number; tokens: number; rejected: number }

export function friendly(error: unknown): { message: string; code: string } {
  const e = classifyAiError(error);
  if (e instanceof AiUnavailable) return { code: "unavailable", message: "模型额度或余额不足，已改用规则结果。" };
  if (e instanceof AiMisconfigured) return { code: "misconfigured", message: "模型密钥无效或未配置，已改用规则结果。" };
  if (e instanceof ContentRejected) return { code: "rejected", message: "这段描述被模型拒绝了，换个说法试试。" };
  if (e instanceof AiInvalidRequest) return { code: "invalid", message: `模型请求未通过：${e.message.slice(0, 80)}` };
  if (e instanceof AiTransient) return { code: "transient", message: "模型暂时没有回应，已改用规则结果。" };
  return { code: "unknown", message: "模型调用中断，已改用规则结果。" };
}

function issues(error: z.ZodError): string[] {
  return error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(根)"}：${i.message}`);
}

function schemaOf(schema: ZodType) {
  // 结构交给模型看，校验由我们自己做，这样退回时能给出中文原因
  return jsonSchema<Record<string, unknown>>(z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Parameters<typeof jsonSchema>[0]);
}

interface SubmitLoop<T> {
  ai: AiBackend;
  effort: Effort;
  system: string;
  prompt: string;
  name: string;
  description: string;
  schema: ZodType<T>;
  verify: (value: T) => string[];
  target: string;
  maxSteps: number;
  maxRejections: number;
  emit: Emit;
  stats: RunStats;
  signal?: AbortSignal;
}

/** 单一产出的"评估-优化"循环：模型提交 → 校验 → 退回原因 → 再提交 */
async function submitLoop<T>(o: SubmitLoop<T>): Promise<{ value: T | null; last: T | null }> {
  let accepted: T | null = null;
  let last: T | null = null;
  let rejected = 0;
  const submit = tool({
    description: o.description,
    inputSchema: schemaOf(o.schema),
    execute: async (input) => {
      const parsed = o.schema.safeParse(input);
      const errors = parsed.success ? o.verify(parsed.data) : issues(parsed.error);
      if (parsed.success) last = parsed.data;
      if (errors.length) {
        rejected += 1;
        o.stats.rejected += 1;
        o.emit({ type: "rejected", target: o.target, errors });
        return { ok: false, errors, hint: rejected >= o.maxRejections ? "已达修正上限，系统会自动修正" : "按错误原因修改后重新提交" };
      }
      accepted = parsed.data as T;
      return { ok: true };
    },
  });
  let messages: ModelMessage[] = [{ role: "user", content: o.prompt }];
  for (let round = 0; round < 2 && !accepted && rejected < o.maxRejections; round += 1) {
    const result = await generateText({
      model: o.ai.model,
      system: o.system,
      messages,
      tools: { [o.name]: submit },
      stopWhen: [stepCountIs(o.maxSteps), () => accepted !== null || rejected >= o.maxRejections],
      providerOptions: o.ai.options(o.effort),
      maxRetries: 0,
      abortSignal: o.signal,
    });
    o.stats.steps += result.steps.length;
    o.stats.tokens += result.totalUsage.totalTokens ?? 0;
    messages = [...messages, ...result.response.messages, { role: "user", content: `请调用 ${o.name} 提交结果，不要只回复文字。` }];
  }
  return { value: accepted, last };
}

// ---------------------------------------------------------------- 规划：我想做一件事

export async function runPlan(
  input: { intent: string; answer?: { question: string; answer: string }; snapshot: Snapshot },
  ai: AiBackend | null,
  emit: Emit,
  signal?: AbortSignal,
): Promise<RunStats> {
  const stats: RunStats = { steps: 0, tokens: 0, rejected: 0 };
  if (!ai) {
    offlinePlan(input, emit);
    return stats;
  }
  const { snapshot } = input;
  const prior = keywordRoute(input.intent);
  const text = input.answer ? `${input.intent}\n（补充：${input.answer.question} → ${input.answer.answer}）` : input.intent;

  // 1. 路由
  emit({ type: "stage", stage: "route", label: "路由", detail: ai ? `${ai.label} 判断任务类型` : "未接入模型，按关键词判断" });
  let route: Route;
  let via: "model" | "prior" | "rule" = "rule";
  if (ai) {
    const categories = [...new Set(snapshot.items.map((i) => i.category))].slice(0, 12);
    let value: Route | null = null;
    try {
      ({ value } = await submitLoop<Route>({
      ai, effort: "none", system: routerSystem(snapshot.today, categories), prompt: `用户说：${text}`,
      name: "submit_route", description: "提交路由结果", schema: routeSchema,
      verify: (r) => (input.answer ? [] : verifyRoute(r)), target: "路由",
      maxSteps: 3, maxRejections: 2, emit, stats, signal,
      }));
    } catch (error) {
      if (signal?.aborted) throw error;
      emit({ type: "error", ...friendly(error) });
      ai = null;
    }
    route = value ?? ruleRoute(input.intent, snapshot.today);
    via = value ? "model" : "rule";
    // 模型没把握、关键词先验很强且结论不同 → 用先验（动态路由的第二意见）
    if (value && value.confidence < 0.55 && input.answer && prior.score >= 2 && prior.archetype !== value.archetype) {
      route = { ...value, archetype: prior.archetype, confidence: 0.6, reason: `${value.reason}；关键词先验更明确` };
      via = "prior";
    }
  } else {
    route = ruleRoute(input.intent);
  }
  if (!ai) {
    offlinePlan(input, emit, "模型不可用，改用策略库模板");
    return stats;
  }
  emit({ type: "route", route, prior: { archetype: prior.archetype, score: prior.score }, decided: route.archetype, via });

  if (route.clarify && !input.answer && route.confidence < 0.55) {
    emit({ type: "clarify", question: route.clarify.question, options: route.clarify.options, route });
    return stats;
  }

  // 2. 专家
  const archetype: Archetype = route.archetype;
  const ctx = {
    today: snapshot.today, now: snapshot.now, capacityPerDay: snapshot.capacityMinutesPerDay,
    loadWeek: weeklyLoad(snapshot), busy: busySlots(snapshot), free: freeSlots(snapshot, 60, 6),
  };
  emit({ type: "stage", stage: "specialist", label: "专家方案", detail: `交给「${archetype}」策略` });
  let plan: Plan | null = null;
  let last: Plan | null = null;
  if (ai) {
    try {
    const result = await submitLoop<Plan>({
      ai, effort: "none", system: specialistSystem(archetype, ctx),
      prompt: `任务：${route.name}\n分类：${route.category}\n用户原话：${text}\n${route.deadline ? `截止：${route.deadline}\n` : ""}路由理由：${route.reason}`,
      name: "submit_plan", description: "提交这件事的执行方案", schema: planSchema,
      verify: (p) => checkPlan(p, archetype, snapshot).errors, target: "方案",
      maxSteps: 4, maxRejections: 3, emit, stats, signal,
    });
    plan = result.value;
    last = result.last;
    } catch (error) {
      if (signal?.aborted) throw error;
      emit({ type: "error", ...friendly(error) });
    }
  }

  // 3. 评审 / 兜底
  emit({ type: "stage", stage: "verify", label: "评审", detail: "按策略库逐条检查" });
  let source: PlanResult["source"] = "model";
  let autoFixed: string[] = [];
  if (!plan) {
    const base = last ?? rulePlan(route, snapshot);
    source = last ? "model" : "rule";
    const fixed = autoFixPlan(base, archetype, snapshot);
    plan = fixed.plan;
    autoFixed = fixed.fixes;
  }
  const { checks } = checkPlan(plan, archetype, snapshot);
  emit({ type: "accepted", target: "方案", label: `${checks.filter((c) => c.ok).length}/${checks.length} 项通过` });
  emit({ type: "plan", result: { route, plan, derived: derivePlan(plan, archetype, snapshot), checks, autoFixed, source } });
  return stats;
}

// ---------------------------------------------------------------- 复盘：评判 + 归纳

function itemDetail(snapshot: Snapshot, s: ItemSignals) {
  const item = snapshot.items.find((i) => i.id === s.id)!;
  const history = snapshot.checkIns.filter((c) => c.itemId === s.id).slice(-12).map((c) => ({
    date: c.doneAt, minutes: c.duration ?? null, rating: c.rating ?? null, note: c.note ?? null,
  }));
  return { ...s, why: item.why ?? null, deadline: item.deadline ?? null, history };
}

function compact(s: ItemSignals) {
  return {
    id: s.id, name: s.name, category: s.category, type: s.type, archetype: s.archetype ?? null, status: s.status,
    overdueDays: s.overdueDays, daysSinceLast: s.daysSinceLast, total: s.total, last14: s.last14, expected14: s.expected14,
    adherence14: s.adherence14, minutes7: s.minutes7, interval: s.type === "learning" ? s.currentInterval : s.intervalDays,
    sessionMinutes: s.sessionMinutes, sessionsPerWeek: s.sessionsPerWeek, timeSlot: s.timeSlot ?? null, forgetRate: s.forgetRate,
  };
}

export async function runReview(
  input: { mode: ReviewMode; itemId?: string; snapshot: Snapshot },
  ai: AiBackend | null,
  emit: Emit,
  signal?: AbortSignal,
): Promise<RunStats> {
  const started = Date.now();
  const stats: RunStats = { steps: 0, tokens: 0, rejected: 0 };
  if (!ai) {
    offlineReview(input, emit);
    return stats;
  }
  const { snapshot } = input;
  const signals = computeSignals(snapshot);
  const balance = computeBalance(snapshot, signals);
  const plan = planReview(snapshot, signals, balance, input.mode, input.itemId);
  emit({ type: "agenda", agenda: plan.agenda, induce: plan.induce, notes: plan.notes, budget: plan.budget });

  const judgements = new Map<string, Judgement & { source: "model" | "rule" }>();
  let synthesis: (Synthesis & { source: "model" | "rule" }) | null = null;
  const ctx: VerifyContext = {
    signals, balance, snapshot, allowPatterns: plan.allowPatterns,
    agendaIds: new Set(plan.agenda.map((a) => a.itemId)), judged: new Set(),
  };
  const done = () => plan.agenda.every((a) => judgements.has(a.itemId)) && (!plan.induce || synthesis !== null);

  if (plan.agenda.length || plan.induce) {
    emit({ type: "stage", stage: "agent", label: "评审循环", detail: `${ai.label} · 预算 ${plan.budget} 步` });
    const tools: ToolSet = {
      get_item: tool({
        description: "查看某件事的完整信号、打卡历史与备注",
        inputSchema: z.object({ itemId: z.string() }),
        execute: async ({ itemId }) => {
          const s = signals.get(itemId);
          emit({ type: "tool", name: "get_item", label: s ? `查看「${s.name}」的记录` : `查看 ${itemId}` });
          return s ? itemDetail(snapshot, s) : { error: "id 不存在" };
        },
      }),
      recent_activity: tool({
        description: "查看近 N 天的整体行动：每天打卡数、各分类分钟、备注",
        inputSchema: z.object({ days: z.number().int().min(1).max(60) }),
        execute: async ({ days }) => {
          emit({ type: "tool", name: "recent_activity", label: `查看近 ${days} 天的整体行动` });
          const recent = snapshot.checkIns.filter((c) => daysFrom(c.doneAt, snapshot.today) < days);
          const perDay: Record<string, number> = {};
          const perCategory: Record<string, number> = {};
          for (const c of recent) {
            perDay[c.doneAt.slice(0, 10)] = (perDay[c.doneAt.slice(0, 10)] ?? 0) + 1;
            const s = signals.get(c.itemId);
            if (s) perCategory[s.category] = (perCategory[s.category] ?? 0) + (c.duration ?? s.sessionMinutes);
          }
          return { total: recent.length, perDay, minutesByCategory: perCategory, notes: recent.filter((c) => c.note).slice(-10).map((c) => `${c.doneAt.slice(5, 16)} ${signals.get(c.itemId)?.name ?? ""}：${c.note}`), balance };
        },
      }),
      submit_judgement: tool({
        description: "提交对议程中一件事的评判",
        inputSchema: schemaOf(judgementSchema),
        execute: async (raw) => {
          const parsed = judgementSchema.safeParse(raw);
          const errors = verifyJudgement(raw, parsed.success ? parsed.data : null, parsed.success ? [] : issues(parsed.error), ctx);
          const name = parsed.success ? signals.get(parsed.data.itemId)?.name ?? "未知事项" : "评判";
          if (errors.length) {
            stats.rejected += 1;
            emit({ type: "rejected", target: name, errors });
            return { ok: false, errors };
          }
          const judgement = { ...parsed.data!, source: "model" as const };
          judgements.set(judgement.itemId, judgement);
          ctx.judged.add(judgement.itemId);
          emit({ type: "judgement", judgement });
          return { ok: true, remaining: plan.agenda.filter((a) => !judgements.has(a.itemId)).map((a) => a.itemId) };
        },
      }),
      submit_synthesis: tool({
        description: "全部评判之后，提交整体归纳",
        inputSchema: schemaOf(synthesisSchema),
        execute: async (raw) => {
          if (!plan.induce) return { ok: false, errors: ["本轮不需要归纳"] };
          const missing = plan.agenda.filter((a) => !judgements.has(a.itemId)).map((a) => a.name);
          if (missing.length) return { ok: false, errors: [`先评判完：${missing.join("、")}`] };
          const parsed = synthesisSchema.safeParse(raw);
          const errors = verifySynthesis(parsed.success ? parsed.data : null, parsed.success ? [] : issues(parsed.error), ctx);
          if (errors.length) {
            stats.rejected += 1;
            emit({ type: "rejected", target: "归纳", errors });
            return { ok: false, errors };
          }
          synthesis = { ...parsed.data!, source: "model" };
          emit({ type: "synthesis", synthesis });
          return { ok: true };
        },
      }),
    };

    const agendaText = plan.agenda.map((a) => ({ ...compact(signals.get(a.itemId)!), reasons: a.reasons }));
    const others = [...signals.values()].filter((s) => s.status === "active" && !ctx.agendaIds.has(s.id)).map((s) => ({ id: s.id, name: s.name, category: s.category, type: s.type }));
    let messages: ModelMessage[] = [{
      role: "user",
      content: `今天 ${snapshot.today}。\n本轮议程（${plan.agenda.length} 件）：\n${JSON.stringify(agendaText)}\n其它进行中事项：${JSON.stringify(others)}\n投入平衡（近 7 天）：${JSON.stringify(balance)}\n系统备注：${plan.notes.join("；") || "无"}`,
    }];
    try {
      for (let round = 0; round < 2 && !done(); round += 1) {
        const result = await generateText({
          model: ai.model,
          system: reviewSystem(plan.induce, plan.allowPatterns),
          messages,
          tools,
          stopWhen: [stepCountIs(plan.budget), () => done()],
          // 动态收束：评判做完就只留归纳工具；快到预算时提示立即提交
          prepareStep: ({ stepNumber }) => {
            const judgedAll = plan.agenda.every((a) => judgements.has(a.itemId));
            return {
              activeTools: judgedAll ? ["recent_activity", "submit_synthesis"] : ["get_item", "recent_activity", "submit_judgement"],
              ...(stepNumber >= plan.budget - 2 ? { system: `${reviewSystem(plan.induce, plan.allowPatterns)}\n步数预算即将用尽：立即提交剩余结果，不要再查看。` } : {}),
            };
          },
          onStepFinish: () => { stats.steps += 1; },
          providerOptions: ai.options(ai.defaultEffort),
          maxRetries: 0,
          abortSignal: signal,
        });
        stats.tokens += result.totalUsage.totalTokens ?? 0;
        const missing = plan.agenda.filter((a) => !judgements.has(a.itemId)).map((a) => `${a.name}（${a.itemId}）`);
        messages = [...messages, ...result.response.messages, { role: "user", content: `还没完成：${missing.length ? `评判 ${missing.join("、")}` : ""}${plan.induce && !synthesis ? " 归纳 submit_synthesis" : ""}。请直接调用工具提交。` }];
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      emit({ type: "error", ...friendly(error) });
    }
  }

  // 兜底：没覆盖到的用规则补齐，结果一定完整
  const fallback = plan.agenda.filter((a) => !judgements.has(a.itemId));
  if (fallback.length) emit({ type: "stage", stage: "fallback", label: "规则补齐", detail: `${fallback.length} 件由规则评判` });
  for (const entry of fallback) {
    const judgement = { ...ruleJudgement(entry, signals.get(entry.itemId)!, balance.find((r) => r.itemId === entry.itemId)), source: "rule" as const };
    judgements.set(entry.itemId, judgement);
    emit({ type: "judgement", judgement });
  }
  if (plan.induce && !synthesis) {
    const ruled = { ...ruleSynthesis(snapshot, signals, balance, plan.allowPatterns), source: "rule" as const };
    if (ruled.focus.length) {
      synthesis = ruled;
      emit({ type: "synthesis", synthesis: ruled });
    }
  }

  const result: ReviewResult = {
    mode: input.mode,
    generatedAt: new Date().toISOString(),
    judgements: plan.agenda.map((a) => judgements.get(a.itemId)!).filter(Boolean),
    synthesis,
    balance,
    stats: { steps: stats.steps, rejected: stats.rejected, durationMs: Date.now() - started, model: ai.modelId, tokens: stats.tokens },
  };
  emit({ type: "review", result });
  return stats;
}
