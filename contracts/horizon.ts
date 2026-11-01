// 「往前看」：提前规划。
// 今天页只回答“现在做什么”；这里回答“今天该为哪些未来的事做规划”。
//
// 每件要来的事（自己加的、节日、项目截止日）带几个提前量（默认 30 / 7 / 1 天），
// 每个提前量是一次规划检查点，规划的内容随距离变化：30 天定方向、7 天排进周里、1 天准备好。
// 另有两种固定的规划：每周规划下一周（主线 + 想玩的），以及晚上规划明天。
//
// 规则写死、纯函数、可测试；浏览器、通知、日历导出共用这一份。

export type HorizonKind = 'fun' | 'study' | 'work' | 'life'
export const HORIZON_KINDS: HorizonKind[] = ['fun', 'study', 'work', 'life']
export const kindLabels: Record<HorizonKind, string> = { fun: '玩', study: '学', work: '事', life: '生活' }
/** 可选的提前量（天） */
export const LEAD_CHOICES = [30, 14, 7, 3, 1] as const
export const DEFAULT_LEADS = [30, 7, 1]

export interface HorizonEvent {
  id: string
  name: string
  /** YYYY-MM-DD */
  date: string
  kind: HorizonKind
  /** 提前多少天规划，降序 */
  leads: number[]
  note?: string
  source: 'user' | 'festival' | 'deadline'
  /** source=deadline 时对应的项目 */
  itemId?: string
}

export interface WeekPlan {
  /** 周一 YYYY-MM-DD */
  weekStart: string
  /** 这周主要干什么 */
  focus: string
  /** 这周想玩什么 */
  fun: string
  savedAt: string
}

export interface HorizonState {
  /** 自己加的事（节日、截止日是推算出来的，不存） */
  events: HorizonEvent[]
  /** 规划任务 key → 完成日期 */
  done: Record<string, string>
  /** 不过的节日（实例 id） */
  dismissed: string[]
  /** 节日、截止日的规划笔记，按事件 id */
  notes: Record<string, string>
  weekPlans: Record<string, WeekPlan>
  /** 前一晚给这一天写的安排，按日期 */
  dayNotes: Record<string, string>
}

export interface HorizonSettings {
  /** 哪天规划下一周，0 = 周日 … 6 = 周六 */
  weekPlanDay: number
  /** 每天提醒的时间 HH:MM */
  reminderTime: string
  /** 晚上规划明天的时间 HH:MM */
  eveningTime: string
  /** 是否推算节日 */
  festivals: boolean
}

export const DEFAULT_HORIZON_SETTINGS: HorizonSettings = { weekPlanDay: 0, reminderTime: '08:30', eveningTime: '20:30', festivals: true }
export const emptyHorizon = (): HorizonState => ({ events: [], done: {}, dismissed: [], notes: {}, weekPlans: {}, dayNotes: {} })

/** 规划只需要项目的这几项 */
export interface HorizonItem {
  id: string
  name: string
  type: 'once' | 'routine' | 'learning'
  dueDate: string
  deadline?: string
  completedAt?: string
  paused: boolean
  intervalDays: number
  sessionMinutes?: number
  sessionsPerWeek?: number
}

export interface HorizonInput {
  today: string
  /** 当前分钟数（0–1439），决定晚上的“规划明天”是否出现 */
  nowMinutes: number
  state: HorizonState
  settings: HorizonSettings
  items: HorizonItem[]
  capacityMinutesPerDay: number
}

export type PlanTaskType = 'event' | 'week' | 'tomorrow'

export interface PlanTask {
  key: string
  type: PlanTaskType
  title: string
  /** 规划什么：随提前量和类别变化 */
  hint: string
  /** 这次规划原定在哪天 */
  date: string
  /** 为哪天规划：事件日期 / 下周一 / 明天 */
  target: string
  daysLeft: number
  /** 原定日期已过几天（补规划） */
  lateDays: number
  lead?: number
  kind?: HorizonKind
  event?: HorizonEvent
}

export interface UpcomingRow {
  event: HorizonEvent
  daysLeft: number
  checkpoints: { lead: number; date: string; state: 'done' | 'due' | 'skipped' | 'future' }[]
}

export interface HorizonFeed {
  date: string
  /** 今天可以规划 */
  today: PlanTask[]
  /** 明天可以规划 */
  tomorrow: PlanTask[]
  /** 今天就是这些事的日子 */
  happening: HorizonEvent[]
  /** 接下来 60 天 */
  upcoming: UpcomingRow[]
  /** 本周的规划 */
  week?: WeekPlan
  /** 昨晚给今天写的安排 */
  dayNote?: string
}

// ---------- 日期 ----------

const DAY_MS = 86_400_000
const at = (day: string) => new Date(`${day}T12:00:00`)
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function shiftDay(day: string, days: number): string {
  const date = at(day)
  date.setDate(date.getDate() + days)
  return ymd(date)
}
export function dayDiff(from: string, to: string): number {
  return Math.round((at(to).getTime() - at(from).getTime()) / DAY_MS)
}
/** 0 = 周日 */
export const weekday = (day: string) => at(day).getDay()
/** 所在周的周一 */
export function weekStartOf(day: string): string {
  return shiftDay(day, -((weekday(day) + 6) % 7))
}
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export const weekdayName = (day: string | number) => WEEKDAY_NAMES[typeof day === 'number' ? day : weekday(day)]
export function shortDate(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${m} 月 ${d} 日`
}

// ---------- 节日 ----------

// 农历节日的公历日期（2026–2029），超出范围的年份不推算
const LUNAR: Record<string, Record<number, string>> = {
  spring: { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13' },
  lantern: { 2026: '03-03', 2027: '02-20', 2028: '02-09', 2029: '02-27' },
  qingming: { 2026: '04-05', 2027: '04-05', 2028: '04-04', 2029: '04-04' },
  dragon: { 2026: '06-19', 2027: '06-09', 2028: '05-28', 2029: '06-16' },
  qixi: { 2026: '08-19', 2027: '08-08', 2028: '08-26', 2029: '08-16' },
  midautumn: { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22' },
}

/** 某年某月第 n 个星期 dow */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  const first = new Date(year, month - 1, 1, 12)
  const offset = (dow - first.getDay() + 7) % 7
  return ymd(new Date(year, month - 1, 1 + offset + (n - 1) * 7, 12))
}

interface FestivalDef { key: string; name: string; kind: HorizonKind; leads: number[]; date: (year: number) => string | undefined }
const fixed = (md: string) => (year: number) => `${year}-${md}`
const lunar = (key: string) => (year: number) => LUNAR[key][year] ? `${year}-${LUNAR[key][year]}` : undefined

/** 长假提前 30 天（要订票、请假），小节日提前一周 */
export const FESTIVALS: FestivalDef[] = [
  { key: 'spring', name: '春节', kind: 'fun', leads: [30, 7, 1], date: lunar('spring') },
  { key: 'lantern', name: '元宵节', kind: 'fun', leads: [3], date: lunar('lantern') },
  { key: 'valentine', name: '情人节', kind: 'fun', leads: [7, 1], date: fixed('02-14') },
  { key: 'qingming', name: '清明假期', kind: 'fun', leads: [14, 3], date: lunar('qingming') },
  { key: 'labor', name: '五一假期', kind: 'fun', leads: [30, 7, 1], date: fixed('05-01') },
  { key: 'mother', name: '母亲节', kind: 'life', leads: [7, 1], date: (y) => nthWeekday(y, 5, 0, 2) },
  { key: 'father', name: '父亲节', kind: 'life', leads: [7, 1], date: (y) => nthWeekday(y, 6, 0, 3) },
  { key: 'dragon', name: '端午假期', kind: 'fun', leads: [14, 3], date: lunar('dragon') },
  { key: 'qixi', name: '七夕', kind: 'fun', leads: [7, 1], date: lunar('qixi') },
  { key: 'midautumn', name: '中秋', kind: 'fun', leads: [14, 3], date: lunar('midautumn') },
  { key: 'national', name: '国庆假期', kind: 'fun', leads: [30, 7, 1], date: fixed('10-01') },
  { key: 'halloween', name: '万圣节', kind: 'fun', leads: [7, 1], date: fixed('10-31') },
  { key: 'christmas', name: '圣诞节', kind: 'fun', leads: [14, 3], date: fixed('12-25') },
  { key: 'newyear', name: '跨年', kind: 'fun', leads: [14, 3], date: fixed('12-31') },
]

/** [from, to] 之间的节日实例 */
export function festivalsBetween(from: string, to: string): HorizonEvent[] {
  const out: HorizonEvent[] = []
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const f of FESTIVALS) {
      const date = f.date(year)
      if (!date || date < from || date > to) continue
      out.push({ id: `fest:${f.key}:${year}`, name: f.name, date, kind: f.kind, leads: f.leads, source: 'festival' })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ---------- 每个提前量规划什么 ----------

const HINTS: Record<HorizonKind, [string, string, string, string, string]> = {
  //     30 天            14 天                 7 天                     3 天                  1 天
  fun: ['定下去哪、和谁；要订的票和住处现在订', '约好人和时间，查路线和预算', '确认人和时间，排进那天的日程', '订位买票，想好要带什么', '定好出发时间，东西今晚备好'],
  study: ['定目标和总量，拆到每周', '排出每周要完成的部分', '把剩下的内容排到具体哪几天', '只留回顾和查漏，不再开新内容', '写下明天第一步，资料放好'],
  work: ['列出要交的东西，倒排几个里程碑', '确认最难的那部分已经动手', '排好最后一周每天做什么', '收尾，留出半天缓冲', '检查一遍，要交的放在手边'],
  life: ['想清楚要准备什么，需要预约的先约', '列清单，缺的东西下单', '把要办的排进这周', '核对清单', '今晚准备好'],
}
export function leadHint(kind: HorizonKind, lead: number): string {
  const i = lead >= 21 ? 0 : lead >= 8 ? 1 : lead >= 4 ? 2 : lead >= 2 ? 3 : 4
  return HINTS[kind][i]
}
export function leadLabel(lead: number): string {
  return lead === 1 ? '前一天' : `提前 ${lead} 天`
}

// ---------- 事件汇总 ----------

const HORIZON_DAYS = 60

/** 当前所有要来的事：自己加的 + 节日 + 项目截止日 */
export function collectEvents(input: HorizonInput, days = HORIZON_DAYS): HorizonEvent[] {
  const { today, state, settings, items } = input
  const until = shiftDay(today, days)
  const dismissed = new Set(state.dismissed)
  const user = state.events.filter((e) => e.date >= today && e.date <= until)
  const fest = settings.festivals
    ? festivalsBetween(today, until).filter((e) => !dismissed.has(e.id)).map((e) => ({ ...e, note: state.notes[e.id] }))
    : []
  const deadlines: HorizonEvent[] = items
    .filter((i) => i.deadline && !i.completedAt && !i.paused && i.deadline >= today && i.deadline <= until)
    .map((i) => {
      const id = `item:${i.id}:${i.deadline}`
      return { id, name: `${i.name}截止`, date: i.deadline!, kind: i.type === 'learning' ? 'study' : 'work', leads: DEFAULT_LEADS, note: state.notes[id], source: 'deadline', itemId: i.id }
    })
  return [...user, ...fest, ...deadlines]
    .map((e) => ({ ...e, leads: [...new Set(e.leads)].filter((l) => l >= 1).sort((a, b) => b - a) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
}

export const eventTaskKey = (eventId: string, lead: number) => `ev:${eventId}@${lead}`
export const weekTaskKey = (weekStart: string) => `week:${weekStart}`
export const dayTaskKey = (day: string) => `day:${day}`

function eventTask(e: HorizonEvent, lead: number, today: string): PlanTask {
  const date = shiftDay(e.date, -lead)
  const daysLeft = dayDiff(today, e.date)
  return {
    key: eventTaskKey(e.id, lead), type: 'event', title: e.name, hint: leadHint(e.kind, lead),
    date, target: e.date, daysLeft, lateDays: Math.max(0, dayDiff(date, today)), lead, kind: e.kind, event: e,
  }
}

/**
 * 某件事今天该做的规划：已到期的检查点里取最近的那个（错过的大提前量合并进来，不一个个补）；
 * 它已经做过就没有。
 */
export function dueEventTask(e: HorizonEvent, today: string, done: Record<string, string>): PlanTask | null {
  const left = dayDiff(today, e.date)
  if (left <= 0) return null
  const reached = e.leads.filter((l) => l >= left)
  if (!reached.length) return null
  const current = Math.min(...reached)
  return done[eventTaskKey(e.id, current)] ? null : eventTask(e, current, today)
}

/** 下周规划原定在哪天（下周一往前推） */
export function weekPlanDate(nextWeekStart: string, weekPlanDay: number): string {
  const offset = ((1 - weekPlanDay + 7) % 7) || 7
  return shiftDay(nextWeekStart, -offset)
}

function weekTask(weekStart: string, today: string, planDate: string): PlanTask {
  const end = shiftDay(weekStart, 6)
  const thisWeek = weekStart <= today
  return {
    key: weekTaskKey(weekStart), type: 'week', title: thisWeek ? '这周还没规划' : '规划下周',
    hint: `${shortDate(weekStart)}–${shortDate(end)}：这周主要干什么，想玩点什么`,
    date: planDate, target: weekStart, daysLeft: dayDiff(today, weekStart), lateDays: Math.max(0, dayDiff(planDate, today)),
  }
}

const hasWeekPlan = (state: HorizonState, weekStart: string) => Boolean(state.weekPlans[weekStart] || state.done[weekTaskKey(weekStart)])

/** 今天要不要规划某一周：下周的规划日到了；或者这周开头两天还没规划（补一个） */
export function dueWeekTask(input: HorizonInput, day = input.today): PlanTask | null {
  const { state, settings } = input
  const thisWeek = weekStartOf(day)
  const nextWeek = shiftDay(thisWeek, 7)
  const planDate = weekPlanDate(nextWeek, settings.weekPlanDay)
  if (day >= planDate && !hasWeekPlan(state, nextWeek)) return weekTask(nextWeek, day, planDate)
  const thisPlanDate = weekPlanDate(thisWeek, settings.weekPlanDay)
  if (dayDiff(thisWeek, day) <= 1 && !hasWeekPlan(state, thisWeek)) return weekTask(thisWeek, day, thisPlanDate)
  return null
}

function itemsDueOn(items: HorizonItem[], day: string): HorizonItem[] {
  return items.filter((i) => !i.paused && !i.completedAt && i.dueDate === day)
}

/** 晚上规划明天：明天有到期的事或要来的事才出现 */
function tomorrowTask(input: HorizonInput, events: HorizonEvent[]): PlanTask | null {
  const { today, nowMinutes, state, settings, items } = input
  if (nowMinutes < toMinutes(settings.eveningTime)) return null
  const tomorrow = shiftDay(today, 1)
  if (state.done[dayTaskKey(tomorrow)] || state.dayNotes[tomorrow]) return null
  const due = itemsDueOn(items, tomorrow)
  const coming = events.filter((e) => e.date === tomorrow)
  if (!due.length && !coming.length) return null
  const names = [...coming.map((e) => e.name), ...due.map((i) => i.name)]
  const learning = due.some((i) => i.type === 'learning')
  return {
    key: dayTaskKey(tomorrow), type: 'tomorrow', title: '规划明天',
    hint: `明天有：${names.slice(0, 3).join('、')}${names.length > 3 ? ` 等 ${names.length} 件` : ''}。${learning ? '学的东西今晚定好先复习哪块，资料放好' : '写下明天先做哪件、第一步是什么'}`,
    date: today, target: tomorrow, daysLeft: 1, lateDays: 0,
  }
}

/** [from, to] 之间按原定日期排好的规划（不含补规划），用于“明天可以规划”和日历导出 */
export function scheduledTasks(input: HorizonInput, from: string, to: string, events = collectEvents(input, dayDiff(input.today, to) + 31)): PlanTask[] {
  const { state, settings } = input
  const out: PlanTask[] = []
  for (const e of events) {
    for (const lead of e.leads) {
      const date = shiftDay(e.date, -lead)
      if (date < from || date > to || state.done[eventTaskKey(e.id, lead)]) continue
      out.push({ ...eventTask(e, lead, date), lateDays: 0, daysLeft: lead })
    }
  }
  for (let ws = shiftDay(weekStartOf(from), 7); ws <= shiftDay(to, 7); ws = shiftDay(ws, 7)) {
    const date = weekPlanDate(ws, settings.weekPlanDay)
    if (date < from || date > to || hasWeekPlan(state, ws)) continue
    out.push(weekTask(ws, date, date))
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.lead ?? 0) - (b.lead ?? 0))
}

const typeOrder: Record<PlanTaskType, number> = { tomorrow: 0, event: 1, week: 2 }

export function buildHorizon(input: HorizonInput): HorizonFeed {
  const { today, state } = input
  const events = collectEvents(input)
  const tomorrowDay = shiftDay(today, 1)

  const todayTasks: PlanTask[] = []
  for (const e of events) {
    const task = dueEventTask(e, today, state.done)
    if (task) todayTasks.push(task)
  }
  const week = dueWeekTask(input)
  if (week) todayTasks.push(week)
  const evening = tomorrowTask(input, events)
  if (evening) todayTasks.push(evening)
  // 越近越先：离目标天数少的在前；同一天的，补规划的在前
  todayTasks.sort((a, b) => a.daysLeft - b.daysLeft || b.lateDays - a.lateDays || typeOrder[a.type] - typeOrder[b.type])

  const shownToday = new Set(todayTasks.map((t) => t.event?.id ?? t.key))
  const tomorrowTasks = scheduledTasks(input, tomorrowDay, tomorrowDay, events)
    // 今天已经在补的那件事，明天的检查点就不重复列
    .filter((t) => !(t.event && shownToday.has(t.event.id)) && !shownToday.has(t.key))
    .map((t) => ({ ...t, daysLeft: dayDiff(today, t.target) }))

  const upcoming: UpcomingRow[] = events
    .filter((e) => e.date > today)
    .map((e) => {
      const left = dayDiff(today, e.date)
      const reached = e.leads.filter((l) => l >= left)
      const current = reached.length ? Math.min(...reached) : null
      return {
        event: e, daysLeft: left,
        checkpoints: e.leads.map((lead) => ({
          lead, date: shiftDay(e.date, -lead),
          state: state.done[eventTaskKey(e.id, lead)] ? 'done' as const
            : lead === current ? 'due' as const
              : lead >= left ? 'skipped' as const : 'future' as const,
        })),
      }
    })

  return {
    date: today,
    today: todayTasks,
    tomorrow: tomorrowTasks,
    happening: events.filter((e) => e.date === today),
    upcoming,
    week: state.weekPlans[weekStartOf(today)],
    dayNote: state.dayNotes[today],
  }
}

/** 把一次规划标记为完成；事件的大提前量一起算完成，避免之后又冒出来 */
export function markDone(state: HorizonState, task: Pick<PlanTask, 'key' | 'event' | 'lead'>, today: string): HorizonState {
  const done = { ...state.done, [task.key]: today }
  if (task.event && task.lead) for (const lead of task.event.leads) if (lead >= task.lead) done[eventTaskKey(task.event.id, lead)] = today
  return { ...state, done: pruneDone(done, today) }
}

/** 完成记录只留近 120 天 */
export function pruneDone(done: Record<string, string>, today: string): Record<string, string> {
  const cutoff = shiftDay(today, -120)
  return Object.fromEntries(Object.entries(done).filter(([, day]) => day >= cutoff))
}

// ---------- 周规划的草稿 ----------

export interface WeekDraft {
  weekStart: string
  weekEnd: string
  events: HorizonEvent[]
  /** 这周到期、或下周就截止的项目 */
  deadlines: HorizonEvent[]
  /** 一周可支配 − 周期性项目已占用（分钟） */
  freeMinutes: number
  committedMinutes: number
  weekendFree: boolean
  suggestions: string[]
}

export function weekDraft(input: HorizonInput, weekStart: string): WeekDraft {
  const weekEnd = shiftDay(weekStart, 6)
  const all = collectEvents({ ...input, today: input.today < weekStart ? input.today : weekStart }, dayDiff(input.today, weekEnd) + 14)
  const inWeek = all.filter((e) => e.date >= weekStart && e.date <= weekEnd)
  const events = inWeek.filter((e) => e.source !== 'deadline')
  const deadlines = all.filter((e) => e.source === 'deadline' && e.date >= weekStart && e.date <= shiftDay(weekEnd, 7))
  const committedMinutes = input.items
    .filter((i) => !i.paused && !i.completedAt && i.type !== 'once')
    .reduce((sum, i) => sum + (i.sessionMinutes ?? 30) * (i.sessionsPerWeek ?? Math.max(1, Math.round(7 / Math.max(1, i.intervalDays)))), 0)
  const freeMinutes = Math.max(0, input.capacityMinutesPerDay * 7 - committedMinutes)
  const saturday = shiftDay(weekStart, 5)
  const weekendFree = !inWeek.some((e) => e.kind === 'fun' && (e.date === saturday || e.date === weekEnd))

  const suggestions: string[] = []
  for (const d of deadlines) suggestions.push(`${d.name}（${weekdayName(d.date)} ${shortDate(d.date)}），把要做的排进前几天`)
  for (const e of events.filter((e) => e.kind === 'fun')) suggestions.push(`${weekdayName(e.date)}是${e.name}，想想怎么过`)
  if (weekendFree) {
    const next = all.find((e) => e.kind === 'fun' && e.date > weekEnd)
    suggestions.push(next ? `周末还空着；下一个能玩的是${next.name}（${shortDate(next.date)}）` : '周末还空着，给自己安排一件想玩的')
  }
  if (freeMinutes < input.capacityMinutesPerDay) suggestions.push('周期性的事已经占满大部分时间，这周别再加大块任务')
  return { weekStart, weekEnd, events, deadlines, freeMinutes, committedMinutes, weekendFree, suggestions }
}

// ---------- 通知摘要 ----------

/** 一句话：今天可以规划什么 */
export function planLine(tasks: PlanTask[]): string {
  return tasks.slice(0, 3).map((t) => t.type === 'event' ? `${t.title}（还有 ${t.daysLeft} 天）` : t.title).join('、')
}

export interface DigestEntry {
  id: string
  date: string
  /** 何时提醒 HH:MM */
  at: string
  title: string
  body: string
}

/**
 * 未来几天每天的提醒内容（早上一条；晚上有“规划明天”时再一条）。
 * 存进 Service Worker 能读到的缓存，应用没开着时也能按天弹出。
 */
export function buildDigests(input: HorizonInput, days = 14): DigestEntry[] {
  const out: DigestEntry[] = []
  for (let i = 0; i < days; i += 1) {
    const day = shiftDay(input.today, i)
    const morning = buildHorizon({ ...input, today: day, nowMinutes: toMinutes(input.settings.reminderTime) })
    const due = input.items.filter((it) => !it.paused && !it.completedAt && it.dueDate <= day)
    const parts: string[] = []
    if (morning.happening.length) parts.push(`今天是${morning.happening.map((e) => e.name).join('、')}`)
    if (morning.today.length) parts.push(`今天可以规划：${planLine(morning.today)}`)
    if (morning.tomorrow.length) parts.push(`明天：${planLine(morning.tomorrow)}`)
    if (due.length) parts.push(`要做的 ${due.length} 件：${due.slice(0, 2).map((it) => it.name).join('、')}${due.length > 2 ? '…' : ''}`)
    if (parts.length) {
      const title = morning.happening.length ? `此刻 · 今天是${morning.happening[0].name}` : morning.today.length ? `此刻 · 今天可以规划「${morning.today[0].title}」` : '此刻 · 今天'
      out.push({ id: `${day}-morning`, date: day, at: input.settings.reminderTime, title, body: parts.join('\n') })
    }
    const evening = tomorrowTask({ ...input, today: day, nowMinutes: toMinutes(input.settings.eveningTime) }, collectEvents({ ...input, today: day }, 2))
    if (evening) out.push({ id: `${day}-evening`, date: day, at: input.settings.eveningTime, title: '此刻 · 规划一下明天', body: evening.hint })
  }
  return out
}

// ---------- 导出到手机日历（.ics） ----------

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/** 按 75 字节折行（中文一个字 3 字节） */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length
    if (bytes + size > 73) { out.push(current); current = ' '; bytes = 1 }
    current += ch
    bytes += size
  }
  out.push(current)
  return out.join('\r\n')
}

const compact = (day: string) => day.replaceAll('-', '')

/**
 * 接下来 days 天的规划提醒（到点响铃）和事件当天（全天），导入手机日历后不开应用也会提醒。
 * UID 固定，重新导入会覆盖旧的。
 */
export function buildIcs(input: HorizonInput, days = 90, now = new Date()): string {
  const to = shiftDay(input.today, days)
  const events = collectEvents(input, days + 31)
  const tasks = scheduledTasks(input, input.today, to, events)
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const [h, m] = input.settings.reminderTime.split(':')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cike//horizon//ZH', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:此刻 · 规划提醒']
  for (const t of tasks) {
    const start = `${compact(t.date)}T${h}${m}00`
    const endMin = toMinutes(input.settings.reminderTime) + 15
    const end = `${compact(t.date)}T${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}00`
    const summary = t.type === 'event' ? `规划：${t.title}（还有 ${t.lead} 天）` : t.title
    lines.push('BEGIN:VEVENT', `UID:${t.key}@cike`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`,
      fold(`SUMMARY:${icsEscape(summary)}`), fold(`DESCRIPTION:${icsEscape(t.hint)}`),
      'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsEscape(summary)}`), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT')
  }
  for (const e of events.filter((e) => e.date <= to)) {
    lines.push('BEGIN:VEVENT', `UID:day-${e.id}@cike`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(shiftDay(e.date, 1))}`,
      fold(`SUMMARY:${icsEscape(e.name)}`), ...(e.note ? [fold(`DESCRIPTION:${icsEscape(e.note)}`)] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
