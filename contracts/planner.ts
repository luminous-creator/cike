// 方案层的确定性部分：时段冲突、可支配时间、方案校验与自动修正、离线规则方案。
import type { Plan, PlanCheck, PlanDerived, Route, Snapshot } from './harness'
import { PLAYBOOKS, intervalFromSessions, keywordRoute, reviewPreview, type Archetype, type RefKey } from './playbooks'
import { addDay, daysFrom, hhmmOf, minutesOf, slotConflict } from './signals'

const PREFERRED_SLOTS = ['20:00', '19:00', '07:30', '21:00', '12:30', '08:00', '14:00', '16:00', '10:00', '18:00', '22:00', '06:30']
const GENERAL_REFS: RefKey[] = ['gollwitzer2006', 'buehler1994', 'biwer2023']
const RETRIEVAL = /自测|回忆|默写|做题|不看|合上|复述|提取|测验|卡片|闭卷|讲给/
const IF_THEN = /(如果|当|每当|一到|之后|以后|结束后)[\s\S]*(就|便|立刻|马上|则|开始)/

export function weeklyLoad(snapshot: Snapshot): number {
  let total = 0
  for (const item of snapshot.items) {
    if (item.completedAt || item.paused || item.type === 'once') continue
    const perWeek = item.sessionsPerWeek ?? 7 / Math.max(1, item.type === 'learning' ? item.currentInterval : item.intervalDays)
    total += perWeek * (item.sessionMinutes ?? (item.type === 'learning' ? 20 : 30))
  }
  return Math.round(total)
}

export function busySlots(snapshot: Snapshot): { name: string; from: string; to: string }[] {
  return snapshot.items
    .filter((item) => item.timeSlot && !item.completedAt && !item.paused)
    .map((item) => ({ name: item.name, from: item.timeSlot!, to: hhmmOf(minutesOf(item.timeSlot!) + (item.sessionMinutes ?? 30)) }))
    .sort((a, b) => a.from.localeCompare(b.from))
}

export function freeSlots(snapshot: Snapshot, minutes: number, count = 4): string[] {
  return PREFERRED_SLOTS.filter((slot) => minutesOf(slot) + minutes <= 24 * 60 && !slotConflict(snapshot, slot, minutes)).slice(0, count)
}

function weeklyMinutesOf(plan: Plan, archetype: Archetype): number {
  const book = PLAYBOOKS[archetype]
  if (book.itemType === 'once') return 0
  if (book.itemType === 'learning') return Math.round(plan.sessionMinutes * Math.min(3.5, 7 / Math.max(1, plan.firstIntervalDays ?? 1)))
  return plan.sessionMinutes * (plan.sessionsPerWeek ?? 1)
}

export function derivePlan(plan: Plan, archetype: Archetype, snapshot: Snapshot): PlanDerived {
  const book = PLAYBOOKS[archetype]
  const loadBefore = weeklyLoad(snapshot)
  const weeklyMinutes = weeklyMinutesOf(plan, archetype)
  const daysToDeadline = plan.deadline ? daysFrom(plan.startDate, plan.deadline) : null
  return {
    itemType: book.itemType,
    intervalDays: book.itemType === 'learning' ? plan.firstIntervalDays ?? 1 : book.itemType === 'routine' ? intervalFromSessions(plan.sessionsPerWeek ?? 1) : 1,
    weeklyMinutes,
    loadBefore,
    loadAfter: loadBefore + weeklyMinutes,
    capacityWeek: snapshot.capacityMinutesPerDay * 7,
    reviewOffsets: book.itemType === 'learning' ? reviewPreview(plan.firstIntervalDays ?? 1, daysToDeadline) : [],
  }
}

/** 方案评审：每一项都对应策略库里的一条原则。返回全部检查项（含通过的），errors 用于退回模型。 */
export function checkPlan(plan: Plan, archetype: Archetype, snapshot: Snapshot): { checks: PlanCheck[]; errors: string[] } {
  const book = PLAYBOOKS[archetype]
  const checks: PlanCheck[] = []
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail })

  add('session', '单次时长合理', plan.sessionMinutes >= book.session.min && plan.sessionMinutes <= book.session.max,
    `${book.label}单次 ${book.session.min}–${book.session.max} 分钟，当前 ${plan.sessionMinutes}`)

  if (book.itemType === 'learning') {
    const r = book.firstInterval!
    const v = plan.firstIntervalDays
    add('spacing', '首次复习间隔贴合遗忘曲线', v !== null && v >= r.min && v <= r.max, `首次复习应在 ${r.min}–${r.max} 天内，当前 ${v ?? '未设置'}`)
  } else if (book.itemType === 'routine') {
    const r = book.sessionsPerWeek!
    const v = plan.sessionsPerWeek
    add('frequency', '频率分散且可持续', v !== null && v >= r.min && v <= r.max, `${book.label}每周 ${r.min}–${r.max} 次，当前 ${v ?? '未设置'}`)
  }

  if (book.fixedSlot) add('slot', '钉在固定时段', Boolean(plan.timeSlot), plan.timeSlot ? `每次 ${plan.timeSlot} 开始` : `${book.label}必须给出固定开始时间（HH:MM）`)
  if (plan.timeSlot) {
    const clash = slotConflict(snapshot, plan.timeSlot, plan.sessionMinutes)
    const free = freeSlots(snapshot, plan.sessionMinutes)
    add('conflict', '不与已有时段冲突', !clash, clash ? `${plan.timeSlot} 与 ${clash} 重叠，可选：${free.join(' / ') || '无空档'}` : '没有重叠')
  }

  if (book.retrieval) {
    const text = [plan.firstAction, ...plan.steps.map((s) => s.title)].join(' ')
    add('retrieval', '包含主动回忆', RETRIEVAL.test(text), RETRIEVAL.test(text) ? '步骤里有自测 / 回忆' : '学习类步骤必须包含合书自测、默写或做题，不能只有阅读')
  }

  add('ifthen', '写成如果-那么', IF_THEN.test(plan.ifThen), IF_THEN.test(plan.ifThen) ? plan.ifThen : 'ifThen 要写成“如果/当……就……”的形式，含具体触发点')

  const derived = derivePlan(plan, archetype, snapshot)
  const remaining = derived.capacityWeek - derived.loadBefore
  const minimal = book.session.min * (book.sessionsPerWeek?.min ?? 1)
  const fits = derived.weeklyMinutes <= Math.max(remaining, minimal)
  add('capacity', '总量不超出可支配时间', fits,
    `加入后每周 ${derived.loadAfter} / ${derived.capacityWeek} 分钟${fits ? '' : `，本项最多约 ${Math.max(remaining, minimal)} 分钟/周`}`)

  const allowed = new Set<RefKey>([...book.principles.map((p) => p.ref), ...GENERAL_REFS])
  const badRefs = plan.refs.filter((ref) => !allowed.has(ref))
  add('refs', '依据来自策略库', badRefs.length === 0, badRefs.length ? `不相关的依据：${badRefs.join(', ')}` : plan.refs.join(', '))

  const startOk = daysFrom(snapshot.today, plan.startDate) >= 0 && daysFrom(snapshot.today, plan.startDate) <= 30
  const deadlineOk = !plan.deadline || daysFrom(plan.startDate, plan.deadline) >= 0
  add('dates', '日期有效', startOk && deadlineOk, !startOk ? `开始日期应在今天到 30 天内，当前 ${plan.startDate}` : !deadlineOk ? '截止日期早于开始日期' : `从 ${plan.startDate} 开始`)

  const errors = checks.filter((c) => !c.ok).map((c) => `${c.label}：${c.detail}`)
  return { checks, errors }
}

/** 模型修正两轮仍不合格时，按策略库把方案拉回合规区间 */
export function autoFixPlan(plan: Plan, archetype: Archetype, snapshot: Snapshot): { plan: Plan; fixes: string[] } {
  const book = PLAYBOOKS[archetype]
  const fixes: string[] = []
  const next: Plan = { ...plan, steps: [...plan.steps], refs: [...plan.refs] }
  const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))
  if (next.sessionMinutes < book.session.min || next.sessionMinutes > book.session.max) {
    fixes.push(`单次时长 ${next.sessionMinutes} → ${clamp(next.sessionMinutes, book.session)} 分钟`)
    next.sessionMinutes = clamp(next.sessionMinutes, book.session)
  }
  if (book.itemType === 'learning') {
    const fixed = clamp(next.firstIntervalDays ?? book.firstInterval!.default, book.firstInterval!)
    if (fixed !== next.firstIntervalDays) { fixes.push(`首次复习间隔 → ${fixed} 天`); next.firstIntervalDays = fixed }
  } else if (book.itemType === 'routine') {
    const fixed = clamp(next.sessionsPerWeek ?? book.sessionsPerWeek!.default, book.sessionsPerWeek!)
    if (fixed !== next.sessionsPerWeek) { fixes.push(`每周次数 → ${fixed}`); next.sessionsPerWeek = fixed }
  } else next.sessionsPerWeek = null
  // 容量：先减次数，再减时长
  const remaining = snapshot.capacityMinutesPerDay * 7 - weeklyLoad(snapshot)
  if (book.itemType === 'routine' && next.sessionsPerWeek) {
    while (next.sessionMinutes * next.sessionsPerWeek > remaining && next.sessionsPerWeek > book.sessionsPerWeek!.min) next.sessionsPerWeek -= 1
    while (next.sessionMinutes * next.sessionsPerWeek > remaining && next.sessionMinutes - 10 >= book.session.min) next.sessionMinutes -= 10
    if (next.sessionsPerWeek !== (plan.sessionsPerWeek ?? 0) || next.sessionMinutes !== plan.sessionMinutes) fixes.push(`为不超出可支配时间，调整为每周 ${next.sessionsPerWeek} 次 × ${next.sessionMinutes} 分钟`)
  }
  if ((book.fixedSlot && !next.timeSlot) || (next.timeSlot && slotConflict(snapshot, next.timeSlot, next.sessionMinutes))) {
    const slot = freeSlots(snapshot, next.sessionMinutes)[0] ?? null
    fixes.push(`固定时段 ${next.timeSlot ?? '未设'} → ${slot ?? '无空档，先不固定'}`)
    next.timeSlot = slot
  }
  if (book.retrieval && !RETRIEVAL.test([next.firstAction, ...next.steps.map((s) => s.title)].join(' '))) {
    next.steps = [{ title: '合上资料，自测回忆上次内容', minutes: 5 }, ...next.steps].slice(0, 6)
    fixes.push('补上一步“合上资料自测”')
  }
  if (!IF_THEN.test(next.ifThen)) {
    next.ifThen = `如果到了${next.timeSlot ?? '计划的时间'}，我就${next.firstAction}`.slice(0, 90)
    fixes.push('改写为如果-那么句式')
  }
  const allowed = new Set<RefKey>([...book.principles.map((p) => p.ref), ...GENERAL_REFS])
  const refs = next.refs.filter((ref) => allowed.has(ref))
  if (refs.length !== next.refs.length) fixes.push('移除不相关的依据')
  next.refs = refs.length ? refs : [book.principles[0].ref]
  if (daysFrom(snapshot.today, next.startDate) < 0 || daysFrom(snapshot.today, next.startDate) > 30) { next.startDate = snapshot.today; fixes.push('开始日期 → 今天') }
  if (next.deadline && daysFrom(next.startDate, next.deadline) < 0) { next.deadline = null; fixes.push('移除早于开始日期的截止日') }
  return { plan: next, fixes }
}

export function verifyRoute(route: Route): string[] {
  const errors: string[] = []
  if (route.confidence < 0.55 && !route.clarify) errors.push('confidence 低于 0.55 时，必须给出一个 clarify 问题和 2–4 个选项')
  if (route.clarify && route.confidence >= 0.8) errors.push('confidence ≥ 0.8 时不要再问澄清问题，把 clarify 设为 null')
  return errors
}

const NAME_TRIM = /^(我想|我要|想要|打算|准备|计划|希望|帮我)/

/** 从“12 月 20 日 / 12.20 / 两周后 / 3 天后 / 周五前”里抽出日期，供离线路由使用 */
export function parseDeadline(text: string, today: string): string | null {
  const md = text.match(/(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?/)
  if (md) {
    const year = Number(today.slice(0, 4))
    const pad = (n: number) => String(n).padStart(2, '0')
    let candidate = `${year}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`
    if (daysFrom(today, candidate) < 0) candidate = `${year + 1}-${pad(Number(md[1]))}-${pad(Number(md[2]))}`
    return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(candidate) ? candidate : null
  }
  const cn: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const rel = text.match(/(\d+|[一两二三四五六七八九十])\s*(天|周|个月|月)(后|内|以后)/)
  if (rel) {
    const n = Number(rel[1]) || cn[rel[1]] || 1
    return addDay(today, rel[2] === '天' ? n : rel[2] === '周' ? n * 7 : n * 30)
  }
  const week = text.match(/(这|本|下)?(周|星期)([一二三四五六日天])(前|之前)?/)
  if (week) {
    const target = '日一二三四五六天'.indexOf(week[3]) % 7
    const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay()
    let diff = (target - todayDow + 7) % 7
    if (week[1] === '下') diff += 7
    return addDay(today, diff || 7)
  }
  return null
}

export function ruleRoute(intent: string, today?: string): Route {
  const prior = keywordRoute(intent)
  const name = intent
    .replace(NAME_TRIM, '')
    .replace(/[，,、；;]?\s*(\d{1,2}\s*[月./-]\s*\d{1,2}\s*[日号]?|(\d+|[一两二三四五六七八九十])\s*(天|周|个月|月)(后|内|以后)|(这|本|下)?(周|星期)[一二三四五六日天](前|之前)?)[^，,。]*$/, '')
    .replace(/[。！!？?，,]+$/, '')
    .trim().slice(0, 40) || intent.slice(0, 40)
  return {
    archetype: prior.archetype,
    confidence: prior.score >= 2 ? 0.7 : prior.score === 1 ? 0.55 : 0.4,
    name: name.length >= 2 ? name : `${name}任务`,
    category: PLAYBOOKS[prior.archetype].label.slice(0, 20),
    deadline: today ? parseDeadline(intent, today) : null,
    reason: prior.score ? `关键词命中「${PLAYBOOKS[prior.archetype].label}」${prior.score} 处` : '没有明显关键词，按项目处理',
    clarify: null,
  }
}

export function rulePlan(route: Route, snapshot: Snapshot): Plan {
  const book = PLAYBOOKS[route.archetype]
  const slot = book.fixedSlot || book.itemType === 'routine' ? freeSlots(snapshot, book.session.default)[0] ?? null : null
  const learning = book.itemType === 'learning'
  const steps: Plan['steps'] = learning
    ? [{ title: '先过一遍材料，标出要记的点', minutes: Math.round(book.session.default * 0.5) }, { title: '合上资料，自测回忆要点', minutes: Math.round(book.session.default * 0.3) }, { title: '对答案，把错的单独记下', minutes: Math.round(book.session.default * 0.2) }]
    : route.archetype === 'project'
      ? [{ title: '写下这次要推进的一个具体产出', minutes: 5 }, { title: '只做这一个项目，整块推进', minutes: book.session.default - 15 }, { title: '收工前写下下一步', minutes: 5 }]
      : route.archetype === 'errand'
        ? [{ title: '准备好需要的材料或信息', minutes: 10 }, { title: '一次性办完', minutes: book.session.default - 10 }]
        : [{ title: '从最小的一步开始', minutes: Math.max(2, Math.round(book.session.default * 0.3)) }, { title: '按固定时段完成一次', minutes: Math.round(book.session.default * 0.7) }]
  return {
    name: route.name,
    category: route.category,
    method: book.method.slice(0, 40),
    rationale: book.principles.map((p) => p.text).slice(0, 2).join('；').slice(0, 160),
    sessionMinutes: book.session.default,
    sessionsPerWeek: book.itemType === 'routine' ? book.sessionsPerWeek!.default : null,
    firstIntervalDays: learning ? book.firstInterval!.default : null,
    timeSlot: slot,
    startDate: snapshot.today,
    deadline: route.deadline ?? null,
    firstAction: steps[0].title.slice(0, 44),
    ifThen: `如果到了${slot ?? '计划的时间'}，我就${steps[0].title}`.slice(0, 90),
    fallback: slot ? '如果错过这个时段，当天睡前补做 10 分钟最小版本' : '如果今天没做成，明天同一时间优先做它',
    steps,
    pitfalls: [learning ? '只重读不自测，会高估自己记住了多少' : '一次计划太多，第二周就断了'],
    refs: book.principles.slice(0, 3).map((p) => p.ref),
  }
}
