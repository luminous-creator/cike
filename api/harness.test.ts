import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { HarnessEvent, Snapshot } from "@contracts/harness";
import { checkPlan, autoFixPlan, rulePlan, ruleRoute } from "@contracts/planner";
import { computeBalance, computeSignals, planReview, ruleJudgement } from "@contracts/signals";
import { keywordRoute, reviewPreview, ridgelineCap } from "@contracts/playbooks";
import { runPlan, runReview } from "./harness/engine";
import type { AiBackend } from "./ai/provider";

const today = "2026-10-26";
const snapshot: Snapshot = {
  today,
  now: "09:00",
  capacityMinutesPerDay: 180,
  items: [
    { id: "p1", name: "整理个人作品集", category: "个人项目", type: "routine", archetype: "project", priority: 1, intervalDays: 1, currentInterval: 1, dueDate: "2026-10-20", createdAt: "2026-10-01T10:00", lastDoneAt: "2026-10-18T20:30", paused: false, timeSlot: "20:00", sessionMinutes: 90, sessionsPerWeek: 5 },
    { id: "l1", name: "考研英语单词", category: "学业", type: "learning", archetype: "memory", priority: 2, intervalDays: 1, currentInterval: 2, dueDate: today, createdAt: "2026-10-10T08:00", lastDoneAt: "2026-10-24T08:00", paused: false, sessionMinutes: 20 },
    { id: "r1", name: "晨跑", category: "健康", type: "routine", archetype: "habit", priority: 2, intervalDays: 1, currentInterval: 1, dueDate: today, createdAt: "2026-10-01T07:00", lastDoneAt: "2026-10-25T07:30", paused: false, timeSlot: "07:00", sessionMinutes: 20, sessionsPerWeek: 7 },
  ],
  checkIns: [
    { itemId: "p1", doneAt: "2026-10-18T20:30", duration: 90 },
    { itemId: "l1", doneAt: "2026-10-20T08:00", rating: "forgot" },
    { itemId: "l1", doneAt: "2026-10-22T08:00", rating: "hard" },
    { itemId: "l1", doneAt: "2026-10-24T08:00", rating: "good" },
    ...[20, 21, 22, 23, 24, 25].map((d) => ({ itemId: "r1", doneAt: `2026-10-${d}T07:30`, duration: 60 })),
  ],
};

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
let callId = 0;
const call = (toolName: string, input: unknown) => ({ type: "tool-call" as const, toolCallId: `c${++callId}`, toolName, input: JSON.stringify(input) });
const step = (...content: ReturnType<typeof call>[]) => ({ content, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage, warnings: [] });

function mockAi(script: ReturnType<typeof step>[]): AiBackend {
  const queue = [...script];
  return {
    kind: "custom", label: "Mock", modelId: "mock-model", defaultEffort: "none", options: () => undefined,
    model: new MockLanguageModelV3({
      doGenerate: async () => queue.shift() ?? { content: [{ type: "text", text: "完成" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] },
    }),
  };
}

function collect() {
  const events: HarnessEvent[] = [];
  return { events, emit: (e: HarnessEvent) => events.push(e) };
}

describe("策略库与路由先验", () => {
  it("关键词先验能区分记忆、项目和事务", () => {
    expect(keywordRoute("背考研英语单词").archetype).toBe("memory");
    expect(keywordRoute("做一个作品集网站").archetype).toBe("project");
    expect(keywordRoute("明天去交实习材料").archetype).toBe("errand");
  });

  it("离线路由能从口语里抽出截止日期", async () => {
    const { parseDeadline } = await import("@contracts/planner");
    expect(parseDeadline("12 月 20 日考试", today)).toBe("2026-12-20");
    expect(parseDeadline("两周后交", today)).toBe("2026-11-09");
    expect(parseDeadline("3 月 1 号考试", today)).toBe("2027-03-01");
    expect(parseDeadline("周五前交材料", today)).toBe("2026-10-30");
    expect(ruleRoute("背考研政治选择题，12 月 20 日考试", today)).toMatchObject({ name: "背考研政治选择题", deadline: "2026-12-20" });
  });

  it("名字短的习惯不算模糊；临近截止的项目不降频，只降单次门槛", () => {
    const signals = computeSignals(snapshot);
    const balance = computeBalance(snapshot, signals);
    const plan = planReview(snapshot, signals, balance, "full");
    expect(plan.agenda.find((a) => a.itemId === "r1")?.reasons.join()).not.toContain("名称只有");
    const near: Snapshot = { ...snapshot, items: snapshot.items.map((i) => (i.id === "p1" ? { ...i, deadline: "2026-11-05" } : i)) };
    const s2 = computeSignals(near);
    const b2 = computeBalance(near, s2);
    const entry = planReview(near, s2, b2, "judge").agenda.find((a) => a.itemId === "p1")!;
    const j = ruleJudgement(entry, s2.get("p1")!, b2.find((r) => r.itemId === "p1"));
    expect(j.verdict).toBe("underinvested");
    expect(j.proposal).toMatchObject({ kind: "set_session", sessionsPerWeek: 5, minutes: 45 });
  });

  it("复习间隔受考试日期的时间山脊约束，越近越密", () => {
    expect(ridgelineCap(7)).toBe(2);
    expect(ridgelineCap(365)).toBe(29);
    const offsets = reviewPreview(1, 10);
    expect(offsets.at(-1)!).toBeLessThanOrEqual(10);
    for (let i = 1; i < offsets.length; i += 1) expect(offsets[i] - offsets[i - 1]).toBeLessThanOrEqual(ridgelineCap(10 - offsets[i - 1]));
  });
});

describe("确定性信号与动态议程", () => {
  const signals = computeSignals(snapshot);
  const balance = computeBalance(snapshot, signals);

  it("识别投入过多和逾期", () => {
    expect(balance.find((r) => r.itemId === "r1")?.state).toBe("over");
    expect(signals.get("p1")?.overdueDays).toBe(6);
  });

  it("议程按信号强弱挑选，逾期项目排在前面", () => {
    const plan = planReview(snapshot, signals, balance, "full");
    expect(plan.agenda[0].itemId).toBe("p1");
    expect(plan.agenda.map((a) => a.itemId)).toContain("r1");
    expect(plan.induce).toBe(true);
    expect(plan.allowPatterns).toBe(true);
  });
});

describe("方案评审", () => {
  it("项目没有固定时段、与已有时段冲突都会被拦下，自动修正后通过", () => {
    const route = { ...ruleRoute("做比赛路演视频"), archetype: "project" as const };
    const bad = { ...rulePlan(route, snapshot), timeSlot: "20:30", sessionsPerWeek: 7, sessionMinutes: 150 };
    const { errors } = checkPlan(bad, "project", snapshot);
    expect(errors.some((e) => e.includes("重叠"))).toBe(true);
    const fixed = autoFixPlan(bad, "project", snapshot);
    expect(checkPlan(fixed.plan, "project", snapshot).errors).toEqual([]);
    expect(fixed.fixes.length).toBeGreaterThan(0);
  });

  it("学习方案没有主动回忆会被拦下", () => {
    const route = { ...ruleRoute("背单词"), archetype: "memory" as const };
    const plan = { ...rulePlan(route, snapshot), firstAction: "打开单词书读一遍", steps: [{ title: "通读单词表", minutes: 20 }, { title: "再读一遍", minutes: 10 }] };
    expect(checkPlan(plan, "memory", snapshot).errors.some((e) => e.includes("主动回忆"))).toBe(true);
  });
});

describe("规划 harness：路由 → 专家 → 评审退回 → 修正", () => {
  it("第一版方案不合格被退回，第二版通过，来源为模型", async () => {
    const route = { archetype: "project", confidence: 0.9, name: "做比赛路演视频", category: "比赛", deadline: null, reason: "有交付产出，需要多次推进", clarify: null };
    const draft = { ...rulePlan({ ...route, archetype: "project" } as never, snapshot), timeSlot: null };
    const good = { ...draft, timeSlot: "14:00", sessionMinutes: 90, sessionsPerWeek: 4, refs: ["gollwitzer2006", "leroy2009"] };
    const ai = mockAi([step(call("submit_route", route)), step(call("submit_plan", draft)), step(call("submit_plan", good))]);
    const { events, emit } = collect();
    await runPlan({ intent: "我想做比赛的路演视频", snapshot }, ai, emit);
    expect(events.find((e) => e.type === "route")).toMatchObject({ decided: "project", via: "model" });
    const rejected = events.filter((e) => e.type === "rejected");
    expect(rejected).toHaveLength(1);
    const result = events.find((e) => e.type === "plan");
    expect(result && result.type === "plan" && result.result.source).toBe("model");
    expect(result && result.type === "plan" && result.result.plan.timeSlot).toBe("14:00");
    expect(result && result.type === "plan" && result.result.checks.every((c) => c.ok)).toBe(true);
  });

  it("模型没把握时动态追问，而不是硬猜", async () => {
    const route = { archetype: "concept", confidence: 0.45, name: "学 Python", category: "学习", deadline: null, reason: "可能是学课程也可能是练技能", clarify: { question: "你更想要哪种结果？", options: ["系统学完一门课", "能写出小程序"] } };
    const { events, emit } = collect();
    await runPlan({ intent: "学 Python", snapshot }, mockAi([step(call("submit_route", route))]), emit);
    expect(events.some((e) => e.type === "clarify")).toBe(true);
    expect(events.some((e) => e.type === "plan")).toBe(false);
  });

  it("没接模型时整条链路用规则跑通", async () => {
    const { events, emit } = collect();
    await runPlan({ intent: "背考研英语单词，12 月考试", snapshot }, null, emit);
    const result = events.find((e) => e.type === "plan");
    expect(result && result.type === "plan" && result.result.route.archetype).toBe("memory");
    expect(result && result.type === "plan" && result.result.checks.every((c) => c.ok)).toBe(true);
  });
});

describe("复盘 harness：评判 → 校验 → 规则补齐", () => {
  it("把逾期 6 天的项目判为 on_track 会被退回，改判后接受；漏掉的由规则补齐", async () => {
    const wrong = { itemId: "p1", verdict: "on_track", summary: "进展不错", evidence: ["一直在做"], nextAction: "继续推进作品集", proposal: null };
    const right = { itemId: "p1", verdict: "stalled", summary: "停了一周，先降低启动门槛", evidence: ["逾期 6 天", "距上次 8 天"], nextAction: "今晚只做 30 分钟", proposal: { kind: "set_session", minutes: 45, sessionsPerWeek: 4 } };
    const ai = mockAi([step(call("get_item", { itemId: "p1" })), step(call("submit_judgement", wrong)), step(call("submit_judgement", right))]);
    const { events, emit } = collect();
    await runReview({ mode: "judge", snapshot }, ai, emit);
    expect(events.filter((e) => e.type === "rejected")).toHaveLength(1);
    const review = events.find((e) => e.type === "review");
    expect(review?.type).toBe("review");
    if (review?.type !== "review") return;
    const p1 = review.result.judgements.find((j) => j.itemId === "p1");
    expect(p1).toMatchObject({ verdict: "stalled", source: "model" });
    expect(review.result.judgements.filter((j) => j.source === "rule").length).toBeGreaterThan(0);
    expect(review.result.stats.rejected).toBe(1);
  });

  it("临近截止时，模型提议降频会被退回，改成缩短单次才接受", async () => {
    const near: Snapshot = { ...snapshot, items: snapshot.items.map((i) => (i.id === "p1" ? { ...i, deadline: "2026-11-07" } : i)) };
    const base = { itemId: "p1", verdict: "rhythm_off", summary: "计划频率过高", evidence: ["近两周完成 1 次 / 计划约 10 次"], nextAction: "今晚只练开场 30 秒" };
    const fewer = { ...base, proposal: { kind: "set_session", minutes: 60, sessionsPerWeek: 3 } };
    const shorter = { ...base, proposal: { kind: "set_session", minutes: 45, sessionsPerWeek: 5 } };
    const { events, emit } = collect();
    await runReview({ mode: "single", itemId: "p1", snapshot: near }, mockAi([step(call("submit_judgement", fewer)), step(call("submit_judgement", shorter))]), emit);
    const rejected = events.filter((e) => e.type === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].type === "rejected" && rejected[0].errors.join()).toContain("不要把频率");
    const review = events.find((e) => e.type === "review");
    expect(review?.type === "review" && review.result.judgements[0].proposal).toMatchObject({ sessionsPerWeek: 5, minutes: 45 });
  });

  it("没接模型时给出完整的规则评判与归纳", async () => {
    const { events, emit } = collect();
    await runReview({ mode: "full", snapshot }, null, emit);
    const review = events.find((e) => e.type === "review");
    if (review?.type !== "review") throw new Error("no review");
    expect(review.result.judgements.length).toBeGreaterThan(0);
    expect(review.result.judgements.find((j) => j.itemId === "r1")?.verdict).toBe("overinvested");
    expect(review.result.synthesis?.balance).toContain("晨跑");
  });
});
