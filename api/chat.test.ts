import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { DEFAULT_BUNDLE, buildChatSystem, describeAction, parseBundle, verifyTool, type ChatContext } from "@contracts/chat";
import { runChat } from "./chat/engine";
import type { AiBackend } from "./ai/provider";

const ctx: ChatContext = {
  today: "2026-11-01", now: "21:00", weekday: "周日", capacity_minutes_per_day: 180,
  now_pick: { item_id: "phy", name: "大物学习", minutes: 90, time_slot: "20:00", reasons: ["离考试还有 6 天"], first_action: "写下这次要推进的一个具体产出" },
  also: [], later_today: [],
  plan_today: [
    { key: "ev:item:phy:2026-11-07@7", type: "event", title: "大物学习考试", hint: "把剩下的内容排到具体哪几天", days_left: 6, late_days: 1, lead: 7 },
    { key: "week:2026-11-02", type: "week", title: "规划下周", hint: "", days_left: 1, late_days: 0 },
  ],
  plan_tomorrow: [], happening: [],
  upcoming: [{ id: "fest:christmas:2026", name: "圣诞节", date: "2026-12-25", weekday: "周五", kind: "fun", days_left: 54, source: "festival", checkpoints: [{ lead: 14, date: "2026-12-11", state: "future", key: "ev:fest:christmas:2026@14" }] }],
  weeks: {
    this_week: { week_start: "2026-10-26" },
    next_week: { week_start: "2026-11-02", draft: { events: [], deadlines: ["周六 大物学习考试"], committed_hours: 44, capacity_hours: 21, weekend_free: true, suggestions: [] } },
  },
  tomorrow: { date: "2026-11-02", due: ["大物学习"] },
  items: [
    { id: "phy", name: "大物学习", type: "learning", category: "学业", due_date: "2026-10-28", overdue_days: 4, deadline: "2026-11-07", time_slot: "20:00", minutes: 90, paused: false },
    { id: "gym", name: "健身", type: "routine", category: "习惯", due_date: "2026-10-27", overdue_days: 5, minutes: 45, paused: false },
  ],
  recent_checkins: [],
};

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
let n = 0;
const call = (toolName: string, input: unknown) => ({ type: "tool-call" as const, toolCallId: `t${++n}`, toolName, input: JSON.stringify(input) });
const tools = (...content: ReturnType<typeof call>[]) => ({ content, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage, warnings: [] });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] });

function mockAi(script: unknown[]) {
  const queue = [...script];
  const model = new MockLanguageModelV3({ doGenerate: async () => (queue.shift() ?? text("好")) as never });
  const ai: AiBackend = { kind: "custom", label: "Mock", modelId: "mock", defaultEffort: "none", options: () => undefined, temperature: () => 1, model };
  return { ai, model };
}

describe("聊天：结构化提示词", () => {
  it("默认提示词能通过校验，系统提示里是两段 JSON", () => {
    expect(DEFAULT_BUNDLE.intents.map((i) => i.id)).toContain("week_plan");
    const system = buildChatSystem(DEFAULT_BUNDLE, ctx);
    expect(system).toContain('"name":"大肥鱼"');
    expect(system).toContain('"today":"2026-11-01"');
  });

  it("编辑后的 JSON：格式错给出原因，自定义字段原样保留", () => {
    expect(parseBundle("{ 不是 json").error).toContain("不是合法的 JSON");
    expect(parseBundle(JSON.stringify({ version: 1, persona: "x", rules: [], intents: [{ id: "a" }] })).error).toContain("rules");
    const custom = parseBundle(JSON.stringify({ ...DEFAULT_BUNDLE, my_habits: { sleep: "23:30" } }));
    expect((custom.bundle as Record<string, unknown>).my_habits).toEqual({ sleep: "23:30" });
  });
});

describe("聊天：提议的校验", () => {
  it("不能加过去的事、不能给学习项不带回忆就打卡、不能用不存在的 key", () => {
    expect(verifyTool("propose_add_event", { name: "去海边", date: "2026-10-01", kind: "fun" }, ctx).errors[0]).toContain("之后");
    expect(verifyTool("propose_check_in", { item_id: "phy" }, ctx).errors[0]).toContain("rating");
    expect(verifyTool("propose_plan_done", { key: "ev:nope@7" }, ctx).errors[0]).toContain("不在");
    expect(verifyTool("propose_week_plan", { week_start: "2026-11-09", focus: "a", fun: "" }, ctx).errors[0]).toContain("只能是");
  });

  it("合格的提议整理成 action，卡片上有一句话", () => {
    const { action } = verifyTool("propose_add_event", { name: "去海边", date: "2026-12-05", kind: "fun", leads: [7, 30] }, ctx);
    expect(action).toEqual({ type: "add_event", event: { name: "去海边", date: "2026-12-05", kind: "fun", leads: [30, 7], note: undefined } });
    expect(describeAction(action!).title).toBe("加入「去海边」· 12/5");
    const plan = verifyTool("propose_plan_done", { key: "ev:fest:christmas:2026@14", note: "和室友吃火锅" }, ctx).action;
    expect(plan).toMatchObject({ type: "plan_done", title: "圣诞节", note: "和室友吃火锅" });
  });
});

describe("聊天：工具循环", () => {
  it("提议被退回后模型改正，最后带着卡片和提议回复", async () => {
    const { ai, model } = mockAi([
      tools(call("show_card", { card: "week" }), call("propose_week_plan", { week_start: "2026-11-09", focus: "大物冲刺", fun: "周日看电影" })),
      tools(call("propose_week_plan", { week_start: "2026-11-02", focus: "大物冲刺", fun: "周日看电影" })),
      text("下周主线就是大物，周日放松一下。要的话点采用。"),
    ]);
    const reply = await runChat({ bundle: DEFAULT_BUNDLE, context: ctx, messages: [{ role: "user", content: "帮我规划下周" }] }, ai);
    expect(reply.cards).toEqual(["week"]);
    expect(reply.actions).toEqual([{ type: "week_plan", weekStart: "2026-11-02", focus: "大物冲刺", fun: "周日看电影" }]);
    expect(reply.rejected).toBe(1);
    expect(reply.text).toContain("点采用");
    // 退回原因交给了模型
    const second = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(second).toContain("只能是 2026-10-26 或 2026-11-02");
  });

  it("你改的提示词会原样进系统提示", async () => {
    const { ai, model } = mockAi([text("咕噜")]);
    const bundle = { ...DEFAULT_BUNDLE, rules: [...DEFAULT_BUNDLE.rules, "每次回复都以“咕噜”开头"] };
    await runChat({ bundle, context: ctx, messages: [{ role: "user", content: "在吗" }] }, ai);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("每次回复都以“咕噜”开头");
  });
});
