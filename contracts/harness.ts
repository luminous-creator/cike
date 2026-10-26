// 动态 harness 的数据契约：浏览器发来的快照、模型必须提交的结构、流式事件。
import { z } from 'zod'
import { ARCHETYPES, REF_KEYS, type Archetype, type RefKey } from './playbooks'
import type { TodayBrief } from './today'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

// ---------- 快照（浏览器 → 服务端，只读） ----------

export const snapshotItemSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(80),
  category: z.string().max(40),
  why: z.string().max(400).optional(),
  type: z.enum(['once', 'routine', 'learning']),
  archetype: z.enum(ARCHETYPES as [Archetype, ...Archetype[]]).optional(),
  priority: z.number().int().min(1).max(3),
  intervalDays: z.number().int().min(1).max(365),
  currentInterval: z.number().int().min(1).max(365),
  dueDate: date,
  createdAt: z.string(),
  lastDoneAt: z.string().optional(),
  completedAt: z.string().optional(),
  paused: z.boolean(),
  timeSlot: hhmm.optional(),
  sessionMinutes: z.number().int().min(1).max(600).optional(),
  sessionsPerWeek: z.number().int().min(1).max(14).optional(),
  deadline: date.optional(),
})

export const snapshotCheckInSchema = z.object({
  itemId: z.string(),
  doneAt: z.string(),
  duration: z.number().min(0).max(1440).optional(),
  rating: z.enum(['forgot', 'hard', 'good', 'easy']).optional(),
  note: z.string().max(300).optional(),
})

export const snapshotSchema = z.object({
  today: date,
  /** 当前本地时间 HH:MM，用于判断"现在"之后还有哪些空档 */
  now: hhmm.optional(),
  capacityMinutesPerDay: z.number().int().min(15).max(960).default(120),
  items: z.array(snapshotItemSchema).max(400),
  checkIns: z.array(snapshotCheckInSchema).max(1500),
})

export type Snapshot = z.infer<typeof snapshotSchema>
export type SnapshotItem = z.infer<typeof snapshotItemSchema>
export type SnapshotCheckIn = z.infer<typeof snapshotCheckInSchema>

// ---------- 路由：这件事属于哪一类 ----------

export const routeSchema = z.object({
  archetype: z.enum(ARCHETYPES as [Archetype, ...Archetype[]]),
  confidence: z.number().min(0).max(1),
  name: z.string().trim().min(2).max(40),
  category: z.string().trim().min(1).max(20),
  deadline: date.nullable().optional(),
  reason: z.string().trim().min(2).max(90),
  clarify: z.object({
    question: z.string().trim().min(4).max(60),
    options: z.array(z.string().trim().min(1).max(24)).min(2).max(4),
  }).nullable().optional(),
})
export type Route = z.infer<typeof routeSchema>

// ---------- 专家方案：这件事具体怎么做 ----------

export const planSchema = z.object({
  name: z.string().trim().min(2).max(40),
  category: z.string().trim().min(1).max(20),
  method: z.string().trim().min(4).max(40),
  rationale: z.string().trim().min(10).max(160),
  sessionMinutes: z.number().int().min(2).max(240),
  sessionsPerWeek: z.number().int().min(1).max(7).nullable(),
  firstIntervalDays: z.number().int().min(1).max(30).nullable(),
  timeSlot: hhmm.nullable(),
  startDate: date,
  deadline: date.nullable(),
  firstAction: z.string().trim().min(4).max(44),
  ifThen: z.string().trim().min(6).max(90),
  fallback: z.string().trim().min(4).max(90),
  steps: z.array(z.object({ title: z.string().trim().min(2).max(44), minutes: z.number().int().min(1).max(240).nullable() })).min(2).max(6),
  pitfalls: z.array(z.string().trim().min(2).max(56)).min(1).max(3),
  refs: z.array(z.enum(REF_KEYS as [RefKey, ...RefKey[]])).min(1).max(4),
})
export type Plan = z.infer<typeof planSchema>

export interface PlanCheck { id: string; label: string; ok: boolean; detail: string }

export interface PlanDerived {
  itemType: 'once' | 'routine' | 'learning'
  intervalDays: number
  weeklyMinutes: number
  /** 加上这件事之后，一周的计划投入 / 可支配时间 */
  loadBefore: number
  loadAfter: number
  capacityWeek: number
  /** 学习类：接下来几次复习距今的天数 */
  reviewOffsets: number[]
}

export interface PlanResult {
  route: Route
  plan: Plan
  derived: PlanDerived
  checks: PlanCheck[]
  autoFixed: string[]
  source: 'model' | 'rule'
}

// ---------- 复盘：评判 + 归纳 ----------

export const VERDICTS = ['on_track', 'stalled', 'too_big', 'too_vague', 'rhythm_off', 'struggling', 'mastered', 'overinvested', 'underinvested', 'drop_candidate'] as const
export type Verdict = typeof VERDICTS[number]

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_interval'), days: z.number().int().min(1).max(60) }),
  z.object({ kind: z.literal('set_session'), minutes: z.number().int().min(5).max(240), sessionsPerWeek: z.number().int().min(1).max(7) }),
  z.object({ kind: z.literal('set_slot'), timeSlot: hhmm }),
  z.object({ kind: z.literal('split'), subtasks: z.array(z.string().trim().min(2).max(30)).min(2).max(5) }),
  z.object({ kind: z.literal('rename'), name: z.string().trim().min(2).max(40) }),
  z.object({ kind: z.literal('postpone'), days: z.number().int().min(1).max(14) }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('archive') }),
])
export type Proposal = z.infer<typeof proposalSchema>

export const judgementSchema = z.object({
  itemId: z.string(),
  verdict: z.enum(VERDICTS),
  summary: z.string().trim().min(4).max(70),
  evidence: z.array(z.string().trim().min(2).max(70)).min(1).max(3),
  nextAction: z.string().trim().min(4).max(50),
  proposal: proposalSchema.nullable(),
})
export type Judgement = z.infer<typeof judgementSchema>

export const synthesisSchema = z.object({
  headline: z.string().trim().min(4).max(40),
  narrative: z.string().trim().min(10).max(260),
  themes: z.array(z.object({ name: z.string().trim().min(1).max(16), itemIds: z.array(z.string()).min(1), note: z.string().trim().max(60) })).max(5),
  patterns: z.array(z.object({ observation: z.string().trim().min(4).max(60), evidence: z.string().trim().min(2).max(70) })).max(4),
  focus: z.array(z.object({ itemId: z.string(), reason: z.string().trim().min(2).max(50) })).min(1).max(3),
  balance: z.string().trim().max(120),
})
export type Synthesis = z.infer<typeof synthesisSchema>

export type ReviewMode = 'full' | 'judge' | 'induce' | 'single'

export const reviewRequestSchema = z.object({
  mode: z.enum(['full', 'judge', 'induce', 'single']),
  itemId: z.string().optional(),
  snapshot: snapshotSchema,
})

export const planRequestSchema = z.object({
  intent: z.string().trim().min(2).max(300),
  answer: z.object({ question: z.string().max(80), answer: z.string().max(80) }).optional(),
  snapshot: snapshotSchema,
})

export const todayRequestSchema = z.object({
  snapshot: snapshotSchema,
  skip: z.array(z.string()).max(200).optional(),
  firstActions: z.record(z.string(), z.string().max(60)).optional(),
})

export interface AgendaEntry { itemId: string; name: string; reasons: string[]; score: number }

export interface BalanceRow {
  itemId: string
  name: string
  targetMinutes: number
  actualMinutes: number
  /** 实际 / 目标 */
  ratio: number
  state: 'over' | 'under' | 'ok' | 'idle'
}

export interface ReviewResult {
  mode: ReviewMode
  generatedAt: string
  judgements: (Judgement & { source: 'model' | 'rule' })[]
  synthesis: (Synthesis & { source: 'model' | 'rule' }) | null
  balance: BalanceRow[]
  stats: { steps: number; rejected: number; durationMs: number; model: string | null; tokens: number | null }
}

// ---------- 流式事件（NDJSON，一行一个） ----------

export type HarnessEvent =
  | { type: 'stage'; stage: string; label: string; detail?: string }
  | { type: 'route'; route: Route; prior: { archetype: Archetype; score: number }; decided: Archetype; via: 'model' | 'prior' | 'rule' }
  | { type: 'clarify'; question: string; options: string[]; route: Route }
  | { type: 'tool'; name: string; label: string }
  | { type: 'rejected'; target: string; errors: string[] }
  | { type: 'accepted'; target: string; label: string }
  | { type: 'agenda'; agenda: AgendaEntry[]; induce: boolean; notes: string[]; budget: number }
  | { type: 'judgement'; judgement: Judgement & { source: 'model' | 'rule' } }
  | { type: 'synthesis'; synthesis: Synthesis & { source: 'model' | 'rule' } }
  | { type: 'plan'; result: PlanResult }
  | { type: 'review'; result: ReviewResult }
  | { type: 'today'; brief: TodayBrief }
  | { type: 'error'; message: string; code?: string }
  | { type: 'done'; durationMs: number; steps: number; model: string | null }
