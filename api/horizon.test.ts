import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HORIZON_SETTINGS, buildDigests, buildHorizon, buildIcs, emptyHorizon, festivalsBetween, markDone,
  weekDraft, weekPlanDate, type HorizonEvent, type HorizonInput, type HorizonItem,
} from '../contracts/horizon'

const input = (today: string, overrides: Partial<HorizonInput> = {}): HorizonInput => ({
  today, nowMinutes: 9 * 60, state: emptyHorizon(), settings: { ...DEFAULT_HORIZON_SETTINGS }, items: [], capacityMinutesPerDay: 180, ...overrides,
})
const userEvent = (overrides: Partial<HorizonEvent> = {}): HorizonEvent => ({
  id: 'e1', name: '去海边', date: '2026-12-05', kind: 'fun', leads: [30, 7, 1], source: 'user', ...overrides,
})
const item = (overrides: Partial<HorizonItem> = {}): HorizonItem => ({
  id: 'i1', name: '背单词', type: 'learning', dueDate: '2026-11-10', paused: false, intervalDays: 1, ...overrides,
})

describe('节日推算', () => {
  it('万圣节、春节、母亲节的日期', () => {
    const fest = festivalsBetween('2026-10-01', '2027-05-31')
    const date = (key: string) => fest.find((f) => f.id.startsWith(`fest:${key}:`))?.date
    expect(date('halloween')).toBe('2026-10-31')
    expect(date('spring')).toBe('2027-02-06')
    expect(date('mother')).toBe('2027-05-09')
  })

  it('万圣节前一周提醒规划，前一天“明天可以规划”里先看到', () => {
    const before = buildHorizon(input('2026-10-23'))
    expect(before.tomorrow.map((t) => t.title)).toContain('万圣节')
    const week = buildHorizon(input('2026-10-24'))
    const task = week.today.find((t) => t.title === '万圣节')
    expect(task?.lead).toBe(7)
    expect(task?.daysLeft).toBe(7)
    expect(task?.hint).toContain('确认人和时间')
  })

  it('不过的节日不再出现；关掉节日后也不出现', () => {
    const dismissed = { ...emptyHorizon(), dismissed: ['fest:halloween:2026'] }
    expect(buildHorizon(input('2026-10-24', { state: dismissed })).today.some((t) => t.title === '万圣节')).toBe(false)
    expect(buildHorizon(input('2026-10-24', { settings: { ...DEFAULT_HORIZON_SETTINGS, festivals: false } })).today.some((t) => t.title === '万圣节')).toBe(false)
  })

  it('长假提前 30 天就要规划（订票）', () => {
    const feed = buildHorizon(input('2027-01-07'))
    const spring = feed.today.find((t) => t.title === '春节')
    expect(spring?.lead).toBe(30)
    expect(spring?.hint).toContain('订')
  })
})

describe('30 / 7 / 1 天检查点', () => {
  it('30 天、7 天、1 天各出现一次，做完一次就不再出现，直到下一个检查点', () => {
    let state = { ...emptyHorizon(), events: [userEvent()] }
    const day30 = buildHorizon(input('2026-11-05', { state }))
    const t30 = day30.today.find((t) => t.event?.id === 'e1')!
    expect(t30.lead).toBe(30)
    state = markDone(state, t30, '2026-11-05')
    expect(buildHorizon(input('2026-11-06', { state })).today.some((t) => t.event?.id === 'e1')).toBe(false)
    expect(buildHorizon(input('2026-11-27', { state })).tomorrow.find((t) => t.event?.id === 'e1')?.lead).toBe(7)
    const t7 = buildHorizon(input('2026-11-28', { state })).today.find((t) => t.event?.id === 'e1')!
    expect(t7.lead).toBe(7)
    state = markDone(state, t7, '2026-11-28')
    expect(buildHorizon(input('2026-12-04', { state })).today.find((t) => t.event?.id === 'e1')?.lead).toBe(1)
    expect(buildHorizon(input('2026-12-05', { state })).happening.map((e) => e.id)).toEqual(['e1'])
  })

  it('加得晚了：错过的大提前量合并成一次补规划，不一件件补', () => {
    const state = { ...emptyHorizon(), events: [userEvent()] }
    const feed = buildHorizon(input('2026-11-30', { state }))
    const tasks = feed.today.filter((t) => t.event?.id === 'e1')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].lead).toBe(7)
    expect(tasks[0].lateDays).toBe(2)
    const row = feed.upcoming.find((r) => r.event.id === 'e1')!
    expect(row.checkpoints.map((c) => c.state)).toEqual(['skipped', 'due', 'future'])
  })

  it('项目的截止日自动变成要来的事', () => {
    const feed = buildHorizon(input('2026-11-24', { items: [item({ deadline: '2026-12-01', type: 'once', name: '交报告' })] }))
    const task = feed.today.find((t) => t.event?.source === 'deadline')
    expect(task?.title).toBe('交报告截止')
    expect(task?.lead).toBe(7)
  })
})

describe('每周规划', () => {
  it('规划日：周日规划下周，周一意味着提前一整周', () => {
    expect(weekPlanDate('2026-11-02', 0)).toBe('2026-11-01')
    expect(weekPlanDate('2026-11-02', 5)).toBe('2026-10-30')
    expect(weekPlanDate('2026-11-02', 1)).toBe('2026-10-26')
  })

  it('周六“明天可以规划下周”，周日出现，写了就消失', () => {
    expect(buildHorizon(input('2026-10-31')).tomorrow.some((t) => t.type === 'week')).toBe(true)
    const sunday = buildHorizon(input('2026-11-01'))
    const week = sunday.today.find((t) => t.type === 'week')
    expect(week?.target).toBe('2026-11-02')
    const state = { ...emptyHorizon(), weekPlans: { '2026-11-02': { weekStart: '2026-11-02', focus: '写完第三章', fun: '周六爬山', savedAt: '' } } }
    expect(buildHorizon(input('2026-11-01', { state })).today.some((t) => t.type === 'week')).toBe(false)
    expect(buildHorizon(input('2026-11-04', { state })).week?.fun).toBe('周六爬山')
  })

  it('这周没规划：周一、周二提示补一个，之后不再催', () => {
    expect(buildHorizon(input('2026-11-03')).today.find((t) => t.type === 'week')?.title).toBe('这周还没规划')
    expect(buildHorizon(input('2026-11-04')).today.some((t) => t.type === 'week')).toBe(false)
  })

  it('周规划草稿：列出这周的节日和截止，周末空着会提醒', () => {
    const draft = weekDraft(input('2026-10-25', { items: [item({ deadline: '2026-10-29', type: 'once', name: '交报告' })] }), '2026-10-26')
    expect(draft.events.map((e) => e.name)).toContain('万圣节')
    expect(draft.deadlines.map((e) => e.name)).toContain('交报告截止')
    expect(draft.weekendFree).toBe(false)
    expect(weekDraft(input('2026-11-01'), '2026-11-02').weekendFree).toBe(true)
  })
})

describe('晚上规划明天', () => {
  it('到了晚上、明天有要做的事才出现；写了明天的安排就消失', () => {
    const items = [item({ dueDate: '2026-11-11' })]
    expect(buildHorizon(input('2026-11-10', { items, nowMinutes: 12 * 60 })).today.some((t) => t.type === 'tomorrow')).toBe(false)
    const evening = buildHorizon(input('2026-11-10', { items, nowMinutes: 21 * 60 })).today.find((t) => t.type === 'tomorrow')
    expect(evening?.hint).toContain('背单词')
    const state = { ...emptyHorizon(), dayNotes: { '2026-11-11': '先复习第 3 单元' } }
    expect(buildHorizon(input('2026-11-10', { items, state, nowMinutes: 21 * 60 })).today.some((t) => t.type === 'tomorrow')).toBe(false)
    expect(buildHorizon(input('2026-11-11', { items, state })).dayNote).toBe('先复习第 3 单元')
  })
})

describe('提醒与日历', () => {
  it('每日提醒摘要里有“今天可以规划”', () => {
    const digests = buildDigests(input('2026-10-24'), 3)
    const first = digests.find((d) => d.id === '2026-10-24-morning')
    expect(first?.title).toContain('万圣节')
    expect(first?.at).toBe('08:30')
  })

  it('导出的 .ics 带响铃，行宽不超过 75 字节', () => {
    const state = { ...emptyHorizon(), events: [userEvent({ name: '去海边, 看日出; 带上相机' })] }
    const ics = buildIcs(input('2026-11-01', { state }), 60, new Date('2026-11-01T00:00:00Z'))
    expect(ics).toContain('BEGIN:VALARM')
    expect(ics).toContain('UID:ev:e1@30@cike')
    expect(ics).toContain('DTSTART:20261105T083000')
    expect(ics).toContain('去海边\\, 看日出\\; 带上相机')
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })
})
