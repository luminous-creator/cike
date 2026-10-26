// 确定性信号层 + 校验器 + 规则兜底。模型的每条评判都要和这里算出的数对得上。
// 约定：快照里的时间字段都是浏览器本地时间 'YYYY-MM-DDTHH:mm'（由前端转换），这里只做字符串切片，避免服务端时区错位。
import type { AgendaEntry, BalanceRow, Judgement, Proposal, ReviewMode, Snapshot, SnapshotItem, Synthesis, Verdict } from './harness'

export function dayNumber(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}
export function daysFrom(from: string, to: string): number { return dayNumber(to) - dayNumber(from) }
export function addDay(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * 86_400_000).toISOString().slice(0, 10)
}
export function minutesOf(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
export function hhmmOf(minutes: number): string { return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }

const DEFAULT_SESSION = { once: 30, routine: 30, learning: 20 } as const

export interface ItemSignals {
  id: string
  name: string
  category: string
  type: SnapshotItem['type']
  archetype?: SnapshotItem['archetype']
  status: 'active' | 'paused' | 'completed'
  priority: number
  ageDays: number
  daysSinceLast: number | null
  overdueDays: number
  dueInDays: number
  total: number
  last7: number
  last14: number
  minutes7: number
  expected14: number | null
  adherence14: number | null
  intervalDays: number
  currentInterval: number
  timeSlot?: string
  sessionMinutes: number
  sessionsPerWeek: number | null
  daysToDeadline: number | null
  ratings: string[]
  forgetRate: number | null
  notes: string[]
  hasWhy: boolean
  nameChars: number
}

export function computeSignals(snapshot: Snapshot): Map<string, ItemSignals> {
  const { today } = snapshot
  const byItem = new Map<string, Snapshot['checkIns']>()
  for (const entry of snapshot.checkIns) {
    const list = byItem.get(entry.itemId) ?? []
    list.push(entry)
    byItem.set(entry.itemId, list)
  }
  const result = new Map<string, ItemSignals>()
  for (const item of snapshot.items) {
    const entries = (byItem.get(item.id) ?? []).slice().sort((a, b) => a.doneAt.localeCompare(b.doneAt))
    const age = Math.max(0, daysFrom(item.createdAt, today))
    const within = (days: number) => entries.filter((e) => daysFrom(e.doneAt, today) < days)
    const sessionMinutes = item.sessionMinutes ?? DEFAULT_SESSION[item.type]
    const perDay = item.type === 'once' ? 0 : item.sessionsPerWeek ? item.sessionsPerWeek / 7 : 1 / Math.max(1, item.type === 'learning' ? item.currentInterval : item.intervalDays)
    const windowDays = Math.min(14, age + 1)
    const expected = perDay * windowDays
    const ratings = entries.filter((e) => e.rating).slice(-5).map((e) => e.rating as string)
    const lastDay = item.lastDoneAt ?? entries.at(-1)?.doneAt
    result.set(item.id, {
      id: item.id,
      name: item.name,
      category: item.category,
      type: item.type,
      archetype: item.archetype,
      status: item.completedAt ? 'completed' : item.paused ? 'paused' : 'active',
      priority: item.priority,
      ageDays: age,
      daysSinceLast: lastDay ? daysFrom(lastDay, today) : null,
      overdueDays: Math.max(0, daysFrom(item.dueDate, today)),
      dueInDays: daysFrom(today, item.dueDate),
      total: entries.length,
      last7: within(7).length,
      last14: within(14).length,
      minutes7: within(7).reduce((sum, e) => sum + (e.duration ?? sessionMinutes), 0),
      expected14: expected >= 1 ? Math.round(expected * 10) / 10 : null,
      adherence14: expected >= 1 ? Math.round((within(14).length / expected) * 100) / 100 : null,
      intervalDays: item.intervalDays,
      currentInterval: item.currentInterval,
      timeSlot: item.timeSlot,
      sessionMinutes,
      sessionsPerWeek: item.sessionsPerWeek ?? null,
      daysToDeadline: item.deadline ? daysFrom(today, item.deadline) : null,
      ratings,
      forgetRate: ratings.length >= 2 ? ratings.filter((r) => r === 'forgot' || r === 'hard').length / ratings.length : null,
      notes: entries.filter((e) => e.note).slice(-3).map((e) => `${e.doneAt.slice(5, 10)} ${e.note}`),
      hasWhy: Boolean(item.why?.trim()),
      nameChars: [...item.name.trim()].length,
    })
  }
  return result
}

/** 名字短不等于模糊：晨跑、背单词这类习惯和记忆任务本身就清楚。只对项目、理解型和未分类的事要求完成标准。 */
function isVague(s: ItemSignals): boolean {
  return s.nameChars <= 3 && !s.hasWhy && !(s.archetype === 'habit' || s.archetype === 'memory' || s.archetype === 'skill')
}

// ---------- 投入平衡：这个项目练太多、那个太少 ----------

export function computeBalance(snapshot: Snapshot, signals: Map<string, ItemSignals>): BalanceRow[] {
  const rows: BalanceRow[] = []
  for (const item of snapshot.items) {
    const s = signals.get(item.id)
    if (!s || s.status !== 'active' || item.type === 'once' || !item.sessionMinutes) continue
    const perWeek = item.sessionsPerWeek ?? 7 / Math.max(1, item.type === 'learning' ? item.currentInterval : item.intervalDays)
    const target = Math.round(perWeek * item.sessionMinutes)
    const ratio = target ? Math.round((s.minutes7 / target) * 100) / 100 : 0
    const state: BalanceRow['state'] = s.minutes7 === 0 ? (s.ageDays >= 3 ? 'idle' : 'ok') : ratio > 1.5 ? 'over' : ratio < 0.5 && s.ageDays >= 5 ? 'under' : 'ok'
    rows.push({ itemId: item.id, name: item.name, targetMinutes: target, actualMinutes: s.minutes7, ratio, state })
  }
  return rows.sort((a, b) => b.ratio - a.ratio)
}

// ---------- 动态规划：这次复盘该看哪几件 ----------

export interface ReviewPlan {
  agenda: AgendaEntry[]
  induce: boolean
  allowPatterns: boolean
  notes: string[]
  budget: number
}

export function planReview(snapshot: Snapshot, signals: Map<string, ItemSignals>, balance: BalanceRow[], mode: ReviewMode, itemId?: string): ReviewPlan {
  const notes: string[] = []
  const balanceById = new Map(balance.map((row) => [row.itemId, row]))
  const scored: AgendaEntry[] = []
  for (const s of signals.values()) {
    if (s.status !== 'active' && !(mode === 'single' && s.id === itemId)) continue
    const reasons: string[] = []
    let score = 0
    if (s.overdueDays >= 3) { reasons.push(`逾期 ${s.overdueDays} 天`); score += 3 + Math.min(s.overdueDays, 14) / 4 }
    if (s.total === 0 && s.ageDays >= 5) { reasons.push(`建了 ${s.ageDays} 天还没开始`); score += 2.5 }
    if (s.type !== 'once' && s.adherence14 !== null && s.expected14 !== null && s.expected14 >= 2) {
      if (s.adherence14 < 0.5) { reasons.push(`近两周完成 ${s.last14} 次 / 计划约 ${Math.round(s.expected14)} 次`); score += 3 }
      else if (s.adherence14 > 1.6) { reasons.push(`近两周做了 ${s.last14} 次，超出计划约 ${Math.round(s.expected14)} 次`); score += 1.5 }
    }
    if (s.forgetRate !== null && s.forgetRate >= 0.5) { reasons.push(`最近 ${s.ratings.length} 次回忆有 ${Math.round(s.forgetRate * s.ratings.length)} 次忘记或模糊`); score += 3 }
    if (s.type === 'learning' && s.currentInterval >= 30 && s.ratings.slice(-3).every((r) => r === 'good' || r === 'easy') && s.ratings.length >= 3) { reasons.push(`复习间隔已到 ${s.currentInterval} 天且连续记得`); score += 1.5 }
    if (isVague(s)) { reasons.push(`名称只有 ${s.nameChars} 个字，缺少完成标准`); score += 1.5 }
    if (s.daysToDeadline !== null && s.daysToDeadline >= 0 && s.daysToDeadline <= 7) { reasons.push(`距截止还有 ${s.daysToDeadline} 天`); score += 2 }
    const row = balanceById.get(s.id)
    if (row?.state === 'over') { reasons.push(`本周投入 ${row.actualMinutes} 分钟，是预算 ${row.targetMinutes} 分钟的 ${row.ratio} 倍`); score += 2 }
    if (row?.state === 'under' || row?.state === 'idle') { reasons.push(`本周投入 ${row.actualMinutes} 分钟，预算 ${row.targetMinutes} 分钟`); score += 2 }
    if (s.dueInDays <= 0 && !reasons.length) { reasons.push('今天到期'); score += 0.5 }
    if (mode === 'single' && s.id === itemId && !reasons.length) reasons.push('你点名要评判这件事')
    if (reasons.length) scored.push({ itemId: s.id, name: s.name, reasons, score: Math.round(score * 10) / 10 })
  }
  scored.sort((a, b) => b.score - a.score)

  let agenda: AgendaEntry[] = []
  if (mode === 'single') agenda = scored.filter((entry) => entry.itemId === itemId)
  else if (mode !== 'induce') {
    agenda = scored.filter((entry) => entry.score >= 1.5).slice(0, 6)
    if (agenda.length < 2) agenda = scored.slice(0, 3)
    const skipped = scored.length - agenda.length
    if (skipped > 0) notes.push(`另有 ${skipped} 件信号较弱，本轮跳过`)
    if (!agenda.length) notes.push('没有需要评判的进行中事项')
  }
  const active = [...signals.values()].filter((s) => s.status === 'active').length
  const induce = (mode === 'full' || mode === 'induce') && active >= 2
  if ((mode === 'full' || mode === 'induce') && !induce) notes.push('进行中的事少于 2 件，跳过归纳')
  const allowPatterns = snapshot.checkIns.length >= 5
  if (induce && !allowPatterns) notes.push(`打卡只有 ${snapshot.checkIns.length} 条，不归纳行为规律`)
  const budget = Math.min(24, 4 + agenda.length * 2 + (induce ? 4 : 0))
  return { agenda, induce, allowPatterns, notes, budget }
}

// ---------- 校验器 ----------

export interface VerifyContext {
  signals: Map<string, ItemSignals>
  balance: BalanceRow[]
  agendaIds: Set<string>
  judged: Set<string>
  snapshot: Snapshot
  allowPatterns: boolean
}

const hasNumber = (text: string) => /\d/.test(text)

export function slotConflict(snapshot: Snapshot, timeSlot: string, minutes: number, exceptId?: string): string | null {
  const start = minutesOf(timeSlot)
  const end = start + minutes
  for (const item of snapshot.items) {
    if (item.id === exceptId || !item.timeSlot || item.completedAt || item.paused) continue
    const s = minutesOf(item.timeSlot)
    const e = s + (item.sessionMinutes ?? 30)
    if (start < e && s < end) return `${item.name}（${item.timeSlot}–${hhmmOf(e)}）`
  }
  return null
}

function checkProposal(p: Proposal, s: ItemSignals, ctx: VerifyContext): string[] {
  const errors: string[] = []
  const isProject = s.archetype === 'project'
  // 临近截止：可以缩短单次、降低启动门槛，但不能降频或拉长间隔
  if (s.daysToDeadline !== null && s.daysToDeadline >= 0 && s.daysToDeadline <= 14) {
    const currentPerWeek = s.sessionsPerWeek ?? 7 / Math.max(1, s.intervalDays)
    if (p.kind === 'set_session' && p.sessionsPerWeek < currentPerWeek) errors.push(`距截止只剩 ${s.daysToDeadline} 天，不要把频率从每周 ${Math.round(currentPerWeek)} 次降到 ${p.sessionsPerWeek} 次；可以保持频率、缩短单次时长`)
    if (p.kind === 'set_interval' && p.days > s.intervalDays) errors.push(`距截止只剩 ${s.daysToDeadline} 天，不要拉长间隔`)
    if (p.kind === 'pause' || p.kind === 'postpone') errors.push(`距截止只剩 ${s.daysToDeadline} 天，不要暂停或顺延`)
  }
  switch (p.kind) {
    case 'set_interval':
      if (s.type !== 'routine') errors.push('set_interval 只能用于周期行动；学习复习的间隔由每次回忆结果自动调整')
      else if (p.days === s.intervalDays) errors.push(`间隔已经是 ${s.intervalDays} 天，提议没有变化`)
      break
    case 'set_session':
      if (s.type === 'once') errors.push('一次性事务不适用 set_session')
      break
    case 'set_slot': {
      const clash = slotConflict(ctx.snapshot, p.timeSlot, s.sessionMinutes, s.id)
      if (clash) errors.push(`时段 ${p.timeSlot} 与 ${clash} 冲突，请换一个`)
      break
    }
    case 'split':
      if (s.type !== 'once' && !isProject) errors.push('只有一次性事务或项目可以拆分')
      if (new Set(p.subtasks).size !== p.subtasks.length) errors.push('子任务有重复')
      break
    case 'rename':
      if (p.name.trim() === s.name.trim()) errors.push('新名称与原名相同')
      break
    case 'archive':
      if (s.type === 'once') errors.push('一次性事务打卡即归档，不需要 archive')
      break
    case 'pause':
      if (s.status === 'paused') errors.push('已经是暂停状态')
      break
    case 'postpone':
      break
  }
  return errors
}

export function verifyJudgement(input: unknown, parsed: Judgement | null, parseErrors: string[], ctx: VerifyContext): string[] {
  if (!parsed) return parseErrors
  const errors: string[] = []
  const s = ctx.signals.get(parsed.itemId)
  if (!s) return [`itemId ${parsed.itemId} 不存在，请用议程里的 id`]
  if (!ctx.agendaIds.has(parsed.itemId)) errors.push(`「${s.name}」不在本轮议程里`)
  if (ctx.judged.has(parsed.itemId)) errors.push(`「${s.name}」已经提交过评判`)
  const row = ctx.balance.find((r) => r.itemId === parsed.itemId)
  const v: Verdict = parsed.verdict
  if (v === 'mastered' && s.type !== 'learning') errors.push('mastered 只用于学习复习类')
  if (v === 'struggling' && s.type !== 'learning' && s.archetype !== 'skill') errors.push('struggling 只用于学习或技能练习')
  if (v === 'stalled') {
    const idle = s.daysSinceLast ?? s.ageDays
    if (!(s.overdueDays > 0 || idle >= Math.max(3, 2 * s.intervalDays))) errors.push(`判为 stalled 需要停滞证据，但它逾期 ${s.overdueDays} 天、距上次 ${idle} 天`)
  }
  if (v === 'on_track' && s.overdueDays > 2) errors.push(`逾期 ${s.overdueDays} 天，不能判为 on_track`)
  if ((v === 'rhythm_off' || v === 'overinvested' || v === 'underinvested') && s.type === 'once') errors.push(`${v} 不适用于一次性事务`)
  if (v === 'overinvested' && !(row?.state === 'over' || (s.adherence14 ?? 0) > 1.2)) errors.push(`判为 overinvested 缺少依据：本周投入 ${row?.actualMinutes ?? s.minutes7} 分钟，完成率 ${s.adherence14 ?? '无'}`)
  if (v === 'underinvested' && !(row?.state === 'under' || row?.state === 'idle' || (s.adherence14 ?? 1) < 0.8)) errors.push(`判为 underinvested 缺少依据：完成率 ${s.adherence14 ?? '无'}`)
  if (!parsed.evidence.some(hasNumber)) errors.push('evidence 至少一条要引用具体数字（天数、次数或分钟），只能用工具给出的数据')
  if (parsed.proposal) errors.push(...checkProposal(parsed.proposal, s, ctx))
  void input
  return errors
}

export function verifySynthesis(parsed: Synthesis | null, parseErrors: string[], ctx: VerifyContext): string[] {
  if (!parsed) return parseErrors
  const errors: string[] = []
  const exists = (id: string) => ctx.signals.has(id)
  for (const theme of parsed.themes) {
    const missing = theme.itemIds.filter((id) => !exists(id))
    if (missing.length) errors.push(`主题「${theme.name}」包含不存在的 id：${missing.join(', ')}`)
  }
  const focusIds = parsed.focus.map((f) => f.itemId)
  if (new Set(focusIds).size !== focusIds.length) errors.push('focus 里有重复事项')
  for (const id of focusIds) {
    const s = ctx.signals.get(id)
    if (!s) errors.push(`focus 的 id ${id} 不存在`)
    else if (s.status !== 'active') errors.push(`「${s.name}」不是进行中，不能放进 focus`)
  }
  if (!ctx.allowPatterns && parsed.patterns.length) errors.push(`打卡少于 5 条（当前 ${ctx.snapshot.checkIns.length}），patterns 必须为空数组`)
  for (const pattern of parsed.patterns) if (!hasNumber(pattern.evidence)) errors.push(`规律「${pattern.observation}」的 evidence 需要具体数字`)
  if (ctx.balance.some((r) => r.state !== 'ok') && !parsed.balance.trim()) errors.push('存在投入失衡的项目，balance 不能为空')
  return errors
}

// ---------- 规则兜底（离线 / 未接模型 / 模型没覆盖） ----------

export function ruleJudgement(entry: AgendaEntry, s: ItemSignals, row?: BalanceRow): Judgement {
  const evidence = entry.reasons.slice(0, 3)
  const base = { itemId: s.id, evidence: evidence.length ? evidence : [`已打卡 ${s.total} 次`] }
  if (s.forgetRate !== null && s.forgetRate >= 0.5) {
    return { ...base, verdict: 'struggling', summary: '回忆吃力，间隔已自动缩短', nextAction: '先合上资料默写 5 分钟，再对答案', proposal: null }
  }
  if (s.type === 'learning' && s.currentInterval >= 30 && s.ratings.length >= 3 && s.ratings.slice(-3).every((r) => r === 'good' || r === 'easy')) {
    return { ...base, verdict: 'mastered', summary: '已经记得很稳，可以考虑归档', nextAction: '最后做一次完整自测确认', proposal: { kind: 'archive' } }
  }
  if (row?.state === 'over') {
    return { ...base, verdict: 'overinvested', summary: '本周投入明显超出预算', nextAction: '把多出的一个时段让给预算不足的项目', proposal: null }
  }
  const nearDeadline = s.daysToDeadline !== null && s.daysToDeadline >= 0 && s.daysToDeadline <= 14
  if (nearDeadline && s.type !== 'once' && ((s.adherence14 ?? 1) < 0.8 || row?.state === 'under' || row?.state === 'idle' || s.overdueDays >= 3)) {
    // 临近截止：频率不能降，降的是单次启动门槛
    const minutes = Math.max(30, Math.round(s.sessionMinutes / 2))
    const proposal: Proposal | null = minutes < s.sessionMinutes ? { kind: 'set_session', minutes, sessionsPerWeek: s.sessionsPerWeek ?? Math.max(1, Math.round(7 / s.intervalDays)) } : null
    return { ...base, evidence: [...base.evidence.slice(0, 2), `距截止 ${s.daysToDeadline} 天`], verdict: 'underinvested', summary: '临近截止却没推起来，先缩短单次', nextAction: `下一个时段只做 ${minutes} 分钟`, proposal }
  }
  if (s.type !== 'once' && s.adherence14 !== null && s.adherence14 < 0.5) {
    const proposal: Proposal | null = s.sessionsPerWeek
      ? { kind: 'set_session', minutes: s.sessionMinutes, sessionsPerWeek: Math.max(1, Math.round(s.sessionsPerWeek * Math.max(s.adherence14, 0.3))) }
      : s.type === 'routine' ? { kind: 'set_interval', days: Math.min(30, Math.max(s.intervalDays + 1, Math.round(s.intervalDays / Math.max(s.adherence14, 0.25)))) } : null
    return { ...base, verdict: 'rhythm_off', summary: '计划频率高于实际能做到的', nextAction: '先按真实节奏降频，稳定后再加', proposal }
  }
  if (s.overdueDays >= 3 || (s.total === 0 && s.ageDays >= 5)) {
    const proposal: Proposal | null = s.type !== 'once' && s.sessionMinutes > 20 ? { kind: 'set_session', minutes: Math.max(10, Math.round(s.sessionMinutes / 2)), sessionsPerWeek: s.sessionsPerWeek ?? Math.max(1, Math.round(7 / s.intervalDays)) } : null
    return { ...base, verdict: 'stalled', summary: '停住了，先把启动门槛降下来', nextAction: '只做 10 分钟，做完就算数', proposal }
  }
  if (isVague(s)) {
    return { ...base, verdict: 'too_vague', summary: '描述太短，不知道做完是什么样子', nextAction: '补一句“做完的标志是……”', proposal: null }
  }
  return { ...base, verdict: 'on_track', summary: '节奏正常，按计划继续', nextAction: '照常在固定时间做下一次', proposal: null }
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function ruleSynthesis(snapshot: Snapshot, signals: Map<string, ItemSignals>, balance: BalanceRow[], allowPatterns: boolean): Synthesis {
  const active = [...signals.values()].filter((s) => s.status === 'active')
  const recent = snapshot.checkIns.filter((e) => daysFrom(e.doneAt, snapshot.today) < 7)
  const minutes = recent.reduce((sum, e) => sum + (e.duration ?? 0), 0)
  const groups = new Map<string, string[]>()
  for (const s of active) groups.set(s.category, [...(groups.get(s.category) ?? []), s.id])
  const themes = [...groups.entries()].filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 5).map(([name, itemIds]) => ({ name: name.slice(0, 16), itemIds, note: `${itemIds.length} 件` }))
  const patterns: Synthesis['patterns'] = []
  if (allowPatterns) {
    const byDay = new Array(7).fill(0)
    const byPart = { 早上: 0, 下午: 0, 晚上: 0 }
    for (const e of snapshot.checkIns) {
      byDay[new Date(`${e.doneAt.slice(0, 10)}T12:00:00Z`).getUTCDay()] += 1
      const hour = Number(e.doneAt.slice(11, 13))
      if (Number.isFinite(hour)) byPart[hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上'] += 1
    }
    const total = snapshot.checkIns.length
    const peak = byDay.indexOf(Math.max(...byDay))
    // 只报告明显的规律：某天占比 ≥ 30%、某时段占比 ≥ 50%
    if (byDay[peak] / total >= 0.3) patterns.push({ observation: `行动集中在${WEEKDAYS[peak]}`, evidence: `${WEEKDAYS[peak]}共 ${byDay[peak]} 次，占 ${Math.round((byDay[peak] / total) * 100)}%` })
    const [part, count] = Object.entries(byPart).sort((a, b) => b[1] - a[1])[0]
    if (count / total >= 0.5) patterns.push({ observation: `更常在${part}行动`, evidence: `${part} ${count} 次 / 共 ${total} 次，占 ${Math.round((count / total) * 100)}%` })
  }
  const focus = active
    .slice()
    .sort((a, b) => (a.dueInDays <= 0 ? 0 : 1) - (b.dueInDays <= 0 ? 0 : 1) || a.priority - b.priority || b.overdueDays - a.overdueDays)
    .slice(0, Math.min(3, Math.max(1, active.length)))
    .map((s) => ({ itemId: s.id, reason: s.dueInDays <= 0 ? '今天可做' : `${s.dueInDays} 天后到期` }))
  const over = balance.filter((r) => r.state === 'over').map((r) => r.name)
  const under = balance.filter((r) => r.state === 'under' || r.state === 'idle').map((r) => r.name)
  const balanceText = over.length || under.length
    ? `${over.length ? `投入偏多：${over.join('、')}。` : ''}${under.length ? `投入不足：${under.join('、')}。` : ''}`.slice(0, 120)
    : ''
  return {
    headline: `${active.length} 件进行中，近 7 天打卡 ${recent.length} 次`.slice(0, 40),
    narrative: `近 7 天共打卡 ${recent.length} 次${minutes ? `，记录 ${minutes} 分钟` : ''}。${active.filter((s) => s.overdueDays > 0).length} 件过了建议日期。`,
    themes,
    patterns,
    focus: focus.length ? focus : [],
    balance: balanceText,
  }
}
