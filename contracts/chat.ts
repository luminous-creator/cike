// 聊天版的数据契约：
//   - 结构化系统提示词（JSON，默认值在 prompts/chat.json，可在设置里改）
//   - 发给模型的当前数据（ChatContext，只读）
//   - 模型能提的改动（ChatAction）：只是提议，用户点「采用」才生效；提交时先过校验，不合格退回模型修正
import { z } from 'zod'
import defaultBundle from '../prompts/chat.json'
import { HORIZON_KINDS, LEAD_CHOICES, type HorizonKind } from './horizon'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式要是 YYYY-MM-DD')

// ---------- 提示词 ----------

/** 只约束骨架，其余字段随你加，原样交给模型 */
export const chatBundleSchema = z.object({
  version: z.number().int(),
  name: z.string().min(1).max(20).optional(),
  persona: z.union([z.string().min(1), z.array(z.string()).min(1)]),
  goal: z.string().optional(),
  rules: z.array(z.string()).min(1),
  intents: z.array(z.object({
    id: z.string().min(1),
    when: z.array(z.string()).optional(),
    do: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
  }).passthrough()).min(1),
  style: z.object({ max_chars: z.number().int().min(20).max(1000).optional() }).passthrough().optional(),
}).passthrough()

export type ChatBundle = z.infer<typeof chatBundleSchema>
export const DEFAULT_BUNDLE: ChatBundle = chatBundleSchema.parse(defaultBundle)
export const MAX_BUNDLE_CHARS = 20_000

/** 解析你编辑的 JSON；错了给出中文原因 */
export function parseBundle(text: string): { bundle?: ChatBundle; error?: string } {
  if (text.length > MAX_BUNDLE_CHARS) return { error: `太长了（${text.length} 字），上限 ${MAX_BUNDLE_CHARS}` }
  let raw: unknown
  try { raw = JSON.parse(text) } catch (e) { return { error: `不是合法的 JSON：${(e as Error).message}` } }
  const parsed = chatBundleSchema.safeParse(raw)
  if (!parsed.success) return { error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(根)'}：${i.message}`).join('；') }
  return { bundle: parsed.data }
}

// ---------- 当前数据 ----------

export interface ChatPlanTask { key: string; type: 'event' | 'week' | 'tomorrow'; title: string; hint: string; days_left: number; late_days: number; lead?: number }

export interface ChatContext {
  today: string
  now: string
  weekday: string
  capacity_minutes_per_day: number
  now_pick: { item_id: string; name: string; minutes: number; time_slot?: string; reasons: string[]; first_action: string } | null
  also: { item_id: string; name: string; minutes: number; reason: string }[]
  later_today: { item_id: string; name: string; time_slot: string; minutes: number }[]
  plan_today: ChatPlanTask[]
  plan_tomorrow: ChatPlanTask[]
  happening: string[]
  upcoming: { id: string; name: string; date: string; weekday: string; kind: HorizonKind; days_left: number; source: string; note?: string; checkpoints: { lead: number; date: string; state: string; key: string }[] }[]
  weeks: {
    this_week: { week_start: string; plan?: { focus: string; fun: string } }
    next_week: { week_start: string; plan?: { focus: string; fun: string }; draft: { events: string[]; deadlines: string[]; committed_hours: number; capacity_hours: number; weekend_free: boolean; suggestions: string[] } }
  }
  tomorrow: { date: string; due: string[]; note?: string }
  day_note?: string
  items: { id: string; name: string; type: 'once' | 'routine' | 'learning'; category: string; due_date: string; overdue_days: number; deadline?: string; time_slot?: string; minutes?: number; paused: boolean }[]
  recent_checkins: { name: string; at: string; minutes?: number; rating?: string }[]
}

export const chatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const chatRequestSchema = z.object({
  bundle: chatBundleSchema,
  context: z.record(z.string(), z.unknown()),
  messages: z.array(chatMessageSchema).min(1).max(40),
})

// ---------- 模型可以提的改动 ----------

export const CARD_KINDS = ['today', 'week', 'upcoming'] as const
export type CardKind = (typeof CARD_KINDS)[number]

export const toolSchemas = {
  show_card: z.object({ card: z.enum(CARD_KINDS) }),
  propose_add_event: z.object({
    name: z.string().trim().min(1).max(40),
    date,
    kind: z.enum(HORIZON_KINDS as [HorizonKind, ...HorizonKind[]]),
    leads: z.array(z.number().int()).max(5).optional(),
    note: z.string().trim().max(300).optional(),
  }),
  propose_plan_done: z.object({ key: z.string().min(1), note: z.string().trim().max(300).optional() }),
  propose_week_plan: z.object({ week_start: date, focus: z.string().trim().max(300), fun: z.string().trim().max(300) }),
  propose_tomorrow_note: z.object({ note: z.string().trim().min(1).max(300) }),
  propose_check_in: z.object({
    item_id: z.string().min(1),
    minutes: z.number().int().min(1).max(600).optional(),
    rating: z.enum(['forgot', 'hard', 'good', 'easy']).optional(),
    note: z.string().trim().max(200).optional(),
  }),
  propose_not_today: z.object({ item_id: z.string().min(1) }),
}
export type ToolName = keyof typeof toolSchemas

export const toolDescriptions: Record<ToolName, string> = {
  show_card: '在回复下面显示一张卡片：today=现在做什么与今天可以规划；week=本周/下周规划与草稿；upcoming=接下来要来的事',
  propose_add_event: '提议加一件要来的事（玩、考试、截止、见人），到提前量那天会提醒规划。只是提议，用户点采用才生效',
  propose_plan_done: '提议把一次规划标记为完成，并记下安排。key 取自 plan_today / plan_tomorrow / upcoming.checkpoints',
  propose_week_plan: '提议保存某一周的规划：主线 focus 和想玩的 fun。week_start 是那周周一，只能是本周或下周',
  propose_tomorrow_note: '提议保存“明天先做什么”，明早打开就能看到',
  propose_check_in: '提议给一件项目打卡（做完了）。学习类必须带 rating',
  propose_not_today: '提议把一件今天的事挪到明天',
}

export type ChatAction =
  | { type: 'add_event'; event: { name: string; date: string; kind: HorizonKind; leads: number[]; note?: string } }
  | { type: 'plan_done'; key: string; title: string; note?: string }
  | { type: 'week_plan'; weekStart: string; focus: string; fun: string }
  | { type: 'tomorrow_note'; date: string; note: string }
  | { type: 'check_in'; itemId: string; name: string; minutes?: number; rating?: 'forgot' | 'hard' | 'good' | 'easy'; note?: string }
  | { type: 'not_today'; itemId: string; name: string }

const ratingText = { forgot: '忘了', hard: '模糊', good: '记得', easy: '轻松' }
const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`

/** 卡片上的一句话 */
export function describeAction(a: ChatAction): { title: string; detail?: string } {
  switch (a.type) {
    case 'add_event': return { title: `加入「${a.event.name}」· ${shortDay(a.event.date)}`, detail: `提前 ${a.event.leads.join(' / ')} 天提醒规划${a.event.note ? `；${a.event.note}` : ''}` }
    case 'plan_done': return { title: `「${a.title}」规划好了`, detail: a.note }
    case 'week_plan': return { title: `${shortDay(a.weekStart)} 那周的规划`, detail: `主线：${a.focus || '—'}；想玩：${a.fun || '—'}` }
    case 'tomorrow_note': return { title: `明天（${shortDay(a.date)}）先做`, detail: a.note }
    case 'check_in': return { title: `「${a.name}」打卡`, detail: [a.minutes ? `${a.minutes} 分钟` : '', a.rating ? `回忆：${ratingText[a.rating]}` : '', a.note ?? ''].filter(Boolean).join(' · ') || undefined }
    case 'not_today': return { title: `「${a.name}」挪到明天` }
  }
}

/**
 * 校验模型提交的改动：只能引用当前数据里有的东西，日期不能在过去。
 * 返回 errors（退回模型修正）或整理好的 action。
 */
export function verifyTool(name: ToolName, input: unknown, ctx: ChatContext): { errors: string[]; action?: ChatAction; card?: CardKind } {
  const schema = toolSchemas[name]
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { errors: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(根)'}：${i.message}`) }
  const v = parsed.data as Record<string, unknown>
  const item = (id: unknown) => ctx.items.find((i) => i.id === id)
  switch (name) {
    case 'show_card':
      return { errors: [], card: v.card as CardKind }
    case 'propose_add_event': {
      const e = parsed.data as z.infer<typeof toolSchemas.propose_add_event>
      if (e.date <= ctx.today) return { errors: [`date 要在今天（${ctx.today}）之后`] }
      const allowed = new Set<number>(LEAD_CHOICES)
      const leads = [...new Set(e.leads ?? [30, 7, 1])].filter((l) => allowed.has(l)).sort((a, b) => b - a)
      if (e.leads && leads.length !== new Set(e.leads).size) return { errors: [`leads 只能从 ${LEAD_CHOICES.join(' / ')} 里选`] }
      return { errors: [], action: { type: 'add_event', event: { name: e.name, date: e.date, kind: e.kind, leads: leads.length ? leads : [30, 7, 1], note: e.note || undefined } } }
    }
    case 'propose_plan_done': {
      const key = v.key as string
      const task = [...ctx.plan_today, ...ctx.plan_tomorrow].find((t) => t.key === key)
      const checkpoint = ctx.upcoming.flatMap((u) => u.checkpoints.map((c) => ({ ...c, name: u.name }))).find((c) => c.key === key)
      if (!task && !checkpoint) return { errors: [`key「${key}」不在 plan_today / plan_tomorrow / upcoming.checkpoints 里`] }
      return { errors: [], action: { type: 'plan_done', key, title: task?.title ?? checkpoint!.name, note: (v.note as string) || undefined } }
    }
    case 'propose_week_plan': {
      const weekStart = v.week_start as string
      const weeks = [ctx.weeks.this_week.week_start, ctx.weeks.next_week.week_start]
      if (!weeks.includes(weekStart)) return { errors: [`week_start 只能是 ${weeks.join(' 或 ')}`] }
      if (!(v.focus as string) && !(v.fun as string)) return { errors: ['focus 和 fun 至少写一个'] }
      return { errors: [], action: { type: 'week_plan', weekStart, focus: v.focus as string, fun: v.fun as string } }
    }
    case 'propose_tomorrow_note':
      return { errors: [], action: { type: 'tomorrow_note', date: ctx.tomorrow.date, note: v.note as string } }
    case 'propose_check_in': {
      const target = item(v.item_id)
      if (!target) return { errors: [`item_id「${String(v.item_id)}」不在 items 里`] }
      if (target.type === 'learning' && !v.rating) return { errors: [`「${target.name}」是学习类，要带 rating（先问用户回忆得怎么样）`] }
      return { errors: [], action: { type: 'check_in', itemId: target.id, name: target.name, minutes: v.minutes as number | undefined, rating: target.type === 'learning' ? v.rating as 'forgot' : undefined, note: (v.note as string) || undefined } }
    }
    case 'propose_not_today': {
      const target = item(v.item_id)
      if (!target) return { errors: [`item_id「${String(v.item_id)}」不在 items 里`] }
      return { errors: [], action: { type: 'not_today', itemId: target.id, name: target.name } }
    }
  }
}

/** 把提示词和数据拼成系统提示：两段 JSON */
export function buildChatSystem(bundle: ChatBundle, ctx: ChatContext): string {
  return [
    '下面第一段 JSON 是你的设定（persona、规则、意图、风格），严格照做；第二段 JSON 是用户此刻的数据，只读。',
    '【设定】',
    JSON.stringify(bundle),
    '【数据】',
    JSON.stringify(ctx),
  ].join('\n')
}

export interface ChatReply {
  text: string
  actions: ChatAction[]
  cards: CardKind[]
  steps: number
  rejected: number
  model: string | null
}
