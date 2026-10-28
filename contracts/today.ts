// 「此刻」的核心：不是排计划，而是告诉你现在做哪一件、还可以做什么、明天有什么。
// 输出格式固定（TodayBrief）。排序规则写死、可解释；模型只能在这个格式里重排并写理由，且要过校验。
import { z } from 'zod'
import type { Snapshot } from './harness'
import { computeBalance, computeSignals, minutesOf, type ItemSignals } from './signals'

export interface TodayPick {
  itemId: string
  name: string
  minutes: number
  timeSlot?: string
  /** 为什么是它，最多 3 条，带具体数字 */
  reasons: string[]
  firstAction: string
}

export interface TodayBrief {
  date: string
  now: TodayPick | null
  also: TodayPick[]
  laterToday: { itemId: string; name: string; timeSlot: string; minutes: number }[]
  tomorrow: { itemId: string; name: string; timeSlot?: string; reason: string }[]
  /** 今天到期但没展示的件数（折叠） */
  restCount: number
  source: 'rule' | 'model'
  /** 模型给的一句话，规则版为空 */
  message?: string
}

const DAY_END = 23 * 60

function defaultFirstAction(s: ItemSignals): string {
  if (s.type === 'learning') return '合上资料，先回忆上次的内容'
  if (s.type === 'once') return '先做 2 分钟就能完成的第一步'
  if (s.archetype === 'project') return '写下这次只推进的一个产出，然后开始'
  return '先做 10 分钟，做完就算数'
}

interface Candidate { s: ItemSignals; score: number; reasons: string[]; slotState: 'now' | 'later' | 'missed' | 'none' }

export interface BriefOptions {
  skip?: string[]
  /** 用户手动“提上日程”的事：固定时段没到也当成现在可做，并排在最前 */
  pull?: string[]
  firstActions?: Record<string, string>
}

export function buildBrief(snapshot: Snapshot, opts: BriefOptions = {}): TodayBrief {
  const signals = computeSignals(snapshot)
  const balance = new Map(computeBalance(snapshot, signals).map((r) => [r.itemId, r]))
  const nowMin = snapshot.now ? minutesOf(snapshot.now) : 12 * 60
  const skip = new Set(opts.skip ?? [])
  const pull = new Set(opts.pull ?? [])
  const pick = (c: Candidate): TodayPick => ({
    itemId: c.s.id, name: c.s.name, minutes: c.s.sessionMinutes, timeSlot: c.s.timeSlot,
    reasons: c.reasons.slice(0, 3), firstAction: opts.firstActions?.[c.s.id] ?? defaultFirstAction(c.s),
  })

  const candidates: Candidate[] = []
  for (const s of signals.values()) {
    if (s.status !== 'active' || skip.has(s.id)) continue
    const deadlineSoon = s.daysToDeadline !== null && s.daysToDeadline >= 0 && s.daysToDeadline <= 3
    if (s.dueInDays > 0 && !deadlineSoon) continue
    const reasons: string[] = []
    let score = 0
    let slotState: Candidate['slotState'] = 'none'
    if (pull.has(s.id)) { slotState = 'now'; score += 200; reasons.push(s.timeSlot ? `你把 ${s.timeSlot} 的这件提前了` : '你刚提上日程') }
    else if (s.timeSlot) {
      const delta = nowMin - minutesOf(s.timeSlot)
      if (delta >= -15 && delta <= 60) { slotState = 'now'; score += 100; reasons.push(`${s.timeSlot} 的固定时段到了`) }
      else if (delta < -15) { slotState = 'later'; score -= 50 }
      else { slotState = 'missed'; score += 4; reasons.push(`${s.timeSlot} 的时段已过，还能补`) }
    }
    if (s.overdueDays > 0) { score += Math.min(15, s.overdueDays * 3); reasons.push(`已过建议日期 ${s.overdueDays} 天`) }
    if (s.daysToDeadline !== null && s.daysToDeadline >= 0 && s.daysToDeadline <= 14) { score += 15 - s.daysToDeadline; reasons.push(`离截止还有 ${s.daysToDeadline} 天`) }
    const row = balance.get(s.id)
    if (row?.state === 'under' || row?.state === 'idle') { score += 8; reasons.push(`本周才投入 ${row.actualMinutes}/${row.targetMinutes} 分钟`) }
    if (row?.state === 'over') { score -= 15; reasons.push(`本周已投入 ${row.actualMinutes} 分钟，超出预算`) }
    if (s.type === 'learning') { score += 6; reasons.push(s.forgetRate !== null && s.forgetRate >= 0.5 ? `复习到期，最近忘得多（${Math.round(s.forgetRate * 100)}%）` : '复习到期，拖久了会忘') }
    score += (4 - s.priority) * 4
    if (s.sessionMinutes <= 20) { score += 3; if (reasons.length < 2) reasons.push(`只要 ${s.sessionMinutes} 分钟`) }
    if (DAY_END - nowMin < s.sessionMinutes && slotState !== 'later') score -= 20
    if (!reasons.length) reasons.push(s.dueInDays < 0 ? '今天可做' : '今天到期')
    candidates.push({ s, score, reasons, slotState })
  }
  candidates.sort((a, b) => b.score - a.score)

  const doable = candidates.filter((c) => c.slotState !== 'later')
  const now = doable[0] ?? null
  const also = doable.slice(1, 3)
  const shown = new Set([now, ...also].filter(Boolean).map((c) => c!.s.id))
  const laterToday = candidates
    .filter((c) => c.slotState === 'later')
    .map((c) => ({ itemId: c.s.id, name: c.s.name, timeSlot: c.s.timeSlot!, minutes: c.s.sessionMinutes }))
    .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
  laterToday.forEach((l) => shown.add(l.itemId))

  const tomorrow = [...signals.values()]
    .filter((s) => s.status === 'active' && s.dueInDays === 1)
    .sort((a, b) => a.priority - b.priority || (a.timeSlot ?? '99').localeCompare(b.timeSlot ?? '99'))
    .slice(0, 3)
    .map((s) => ({ itemId: s.id, name: s.name, timeSlot: s.timeSlot, reason: s.type === 'learning' ? '复习到期' : s.timeSlot ? `${s.timeSlot} 固定时段` : '建议日期到了' }))

  return {
    date: snapshot.today,
    now: now ? pick(now) : null,
    also: also.map(pick),
    laterToday,
    tomorrow,
    restCount: candidates.filter((c) => !shown.has(c.s.id)).length,
    source: 'rule',
  }
}

// ---------- 模型重排：格式固定，只能从候选里挑 ----------

export const todaySchema = z.object({
  now: z.object({ itemId: z.string(), reason: z.string().trim().min(4).max(40), firstAction: z.string().trim().min(4).max(40) }),
  also: z.array(z.object({ itemId: z.string(), reason: z.string().trim().min(2).max(30) })).max(2),
  message: z.string().trim().min(4).max(40),
})
export type TodayModelOutput = z.infer<typeof todaySchema>

/** 校验模型的重排：只能选今天能做的候选；不能选还没到时段的；不能重复 */
export function verifyToday(out: TodayModelOutput, brief: TodayBrief, candidateIds: string[]): string[] {
  const errors: string[] = []
  const allowed = new Set(candidateIds)
  const later = new Set(brief.laterToday.map((l) => l.itemId))
  const ids = [out.now.itemId, ...out.also.map((a) => a.itemId)]
  if (new Set(ids).size !== ids.length) errors.push('now 和 also 里有重复事项')
  for (const id of ids) {
    if (later.has(id)) errors.push(`${id} 的固定时段还没到，不能排进“现在”或“也可以”`)
    else if (!allowed.has(id)) errors.push(`${id} 不在今天可做的候选里`)
  }
  return errors
}

/** 把模型输出合并进规则版 brief：顺序和理由用模型的，数据（分钟、时段）仍取自规则版 */
export function mergeToday(brief: TodayBrief, out: TodayModelOutput, picks: Map<string, TodayPick>): TodayBrief {
  const toPick = (itemId: string, reason: string, firstAction?: string): TodayPick => {
    const base = picks.get(itemId)!
    // 模型的一句理由已经概括了规则理由，并列会重复
    return { ...base, reasons: [reason], firstAction: firstAction ?? base.firstAction }
  }
  const now = toPick(out.now.itemId, out.now.reason, out.now.firstAction)
  const also = out.also.map((a) => toPick(a.itemId, a.reason))
  const shown = new Set([now.itemId, ...also.map((a) => a.itemId), ...brief.laterToday.map((l) => l.itemId)])
  return { ...brief, now, also, restCount: [...picks.keys()].filter((id) => !shown.has(id)).length, source: 'model', message: out.message }
}

/** 规则版的全部候选（含未展示的），供模型挑选与合并 */
export function allPicks(snapshot: Snapshot, opts: BriefOptions = {}): TodayPick[] {
  const brief = buildBrief(snapshot, opts)
  const picks: TodayPick[] = [...(brief.now ? [brief.now] : []), ...brief.also]
  // 其余候选：逐个排除已选，再跑一次拿到剩下的
  let rest = buildBrief(snapshot, { ...opts, skip: [...(opts.skip ?? []), ...picks.map((p) => p.itemId)] })
  while (rest.now) {
    picks.push(rest.now, ...rest.also)
    rest = buildBrief(snapshot, { ...opts, skip: [...(opts.skip ?? []), ...picks.map((p) => p.itemId)] })
  }
  return picks
}
