import { useCallback, useEffect, useState } from 'react'
import { ARCHETYPES } from '@contracts/playbooks'
import { DEFAULT_HORIZON_SETTINGS, HORIZON_KINDS, emptyHorizon, type HorizonEvent, type HorizonState, type WeekPlan } from '@contracts/horizon'
import type { AppData, Item, Rating, Settings } from '@/types'

const STORAGE_KEY = 'cike.personal.v1'
export const DEFAULT_SETTINGS = { capacityMinutesPerDay: 180 }
export const emptyData = (): AppData => ({ version: 3, items: [], checkIns: [], settings: { ...DEFAULT_SETTINGS } })
const ratings: Rating[] = ['forgot', 'hard', 'good', 'easy']

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('备份字段不正确')
  return value
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const positiveInt = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.min(max, Math.round(value)) : undefined
// 方案与评判是模型产物，只做"形状大致对"的宽松检查，坏了就丢弃，不影响任务本身
const looseObject = <T>(value: unknown, keys: string[]): T | undefined =>
  value && typeof value === 'object' && keys.every((key) => key in (value as object)) ? value as T : undefined

const str = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 往前看的数据：逐条宽松检查，坏的丢掉，不影响其余 */
export function parseHorizon(value: unknown): HorizonState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const horizon = emptyHorizon()
  for (const entry of Array.isArray(raw.events) ? raw.events : []) {
    const e = record(entry)
    const leads = Array.isArray(e.leads) ? [...new Set(e.leads.filter((l): l is number => Number.isInteger(l) && l >= 1 && l <= 365))].sort((a, b) => b - a) : []
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || !e.name.trim() || typeof e.date !== 'string' || !DAY.test(e.date) || !leads.length) continue
    horizon.events.push({
      id: e.id, name: e.name.slice(0, 60), date: e.date, leads, source: 'user',
      kind: HORIZON_KINDS.includes(e.kind as HorizonEvent['kind']) ? e.kind as HorizonEvent['kind'] : 'life',
      note: str(e.note, 800),
    })
  }
  for (const [key, day] of Object.entries(record(raw.done))) if (typeof day === 'string' && DAY.test(day)) horizon.done[key] = day
  horizon.dismissed = Array.isArray(raw.dismissed) ? raw.dismissed.filter((id): id is string => typeof id === 'string') : []
  for (const [key, note] of Object.entries(record(raw.notes))) if (typeof note === 'string') horizon.notes[key] = note.slice(0, 800)
  for (const [key, note] of Object.entries(record(raw.dayNotes))) if (DAY.test(key) && typeof note === 'string') horizon.dayNotes[key] = note.slice(0, 800)
  for (const [key, entry] of Object.entries(record(raw.weekPlans))) {
    const w = record(entry)
    if (!DAY.test(key)) continue
    horizon.weekPlans[key] = { weekStart: key, focus: str(w.focus, 800) ?? '', fun: str(w.fun, 800) ?? '', savedAt: str(w.savedAt, 40) ?? '' } satisfies WeekPlan
  }
  return horizon
}

function parseSettings(value: unknown): Settings {
  const raw = record(value)
  const capacity = positiveInt(raw.capacityMinutesPerDay, 960)
  const day = Number(raw.weekPlanDay)
  return {
    capacityMinutesPerDay: capacity && capacity >= 15 ? capacity : DEFAULT_SETTINGS.capacityMinutesPerDay,
    weekPlanDay: Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_HORIZON_SETTINGS.weekPlanDay,
    reminderTime: typeof raw.reminderTime === 'string' && HHMM.test(raw.reminderTime) ? raw.reminderTime : DEFAULT_HORIZON_SETTINGS.reminderTime,
    eveningTime: typeof raw.eveningTime === 'string' && HHMM.test(raw.eveningTime) ? raw.eveningTime : DEFAULT_HORIZON_SETTINGS.eveningTime,
    festivals: typeof raw.festivals === 'boolean' ? raw.festivals : DEFAULT_HORIZON_SETTINGS.festivals,
  }
}

export function parseData(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('备份格式不正确')
  const parsed = value as { version?: unknown; items?: unknown; checkIns?: unknown; settings?: unknown; review?: unknown }
  if ((parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || !Array.isArray(parsed.items) || !Array.isArray(parsed.checkIns)) {
    throw new Error('备份格式不正确')
  }
  const items: Item[] = parsed.items.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('项目格式不正确')
    const raw = entry as Partial<Item>
    if (!['once', 'routine', 'learning'].includes(raw.type ?? '')) throw new Error('项目类型不正确')
    if (typeof raw.priority !== 'number' || ![1, 2, 3].includes(raw.priority)) throw new Error('优先级不正确')
    if (typeof raw.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate)) throw new Error('日期不正确')
    const intervalDays = Number(raw.intervalDays)
    const currentInterval = Number(raw.currentInterval)
    if (!Number.isFinite(intervalDays) || !Number.isFinite(currentInterval)) throw new Error('间隔不正确')
    return {
      id: requiredString(raw.id),
      name: requiredString(raw.name).slice(0, 60),
      category: typeof raw.category === 'string' && raw.category.trim() ? raw.category : '未分类',
      why: typeof raw.why === 'string' ? raw.why.slice(0, 800) : undefined,
      type: raw.type as Item['type'],
      archetype: ARCHETYPES.includes(raw.archetype as never) ? raw.archetype : undefined,
      timeSlot: typeof raw.timeSlot === 'string' && HHMM.test(raw.timeSlot) ? raw.timeSlot : undefined,
      sessionMinutes: positiveInt(raw.sessionMinutes, 600),
      sessionsPerWeek: positiveInt(raw.sessionsPerWeek, 7),
      deadline: typeof raw.deadline === 'string' && DAY.test(raw.deadline) ? raw.deadline : undefined,
      plan: looseObject<Item['plan']>(raw.plan, ['method', 'steps', 'archetype']),
      judgement: looseObject<Item['judgement']>(raw.judgement, ['verdict', 'summary', 'evidence']),
      take: typeof raw.take?.text === 'string' && typeof raw.take.generatedAt === 'string' ? { text: raw.take.text.slice(0, 400), generatedAt: raw.take.generatedAt } : undefined,
      priority: raw.priority,
      intervalDays: Math.max(1, Math.min(365, Math.round(intervalDays))),
      currentInterval: Math.max(1, Math.min(365, Math.round(currentInterval))),
      dueDate: raw.dueDate,
      createdAt: requiredString(raw.createdAt),
      lastDoneAt: typeof raw.lastDoneAt === 'string' ? raw.lastDoneAt : undefined,
      completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
      paused: Boolean(raw.paused),
      overdueDecision: typeof raw.overdueDecision === 'string' ? raw.overdueDecision : undefined,
      analysis: raw.analysis && typeof raw.analysis.definition === 'string' && typeof raw.analysis.nextAction === 'string' && typeof raw.analysis.cadence === 'string' && typeof raw.analysis.generatedAt === 'string'
        ? { definition: raw.analysis.definition, nextAction: raw.analysis.nextAction, cadence: raw.analysis.cadence, generatedAt: raw.analysis.generatedAt }
        : undefined,
    }
  })
  const checkIns = parsed.checkIns.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('打卡格式不正确')
    const raw = entry as AppData['checkIns'][number]
    if (raw.rating !== undefined && !ratings.includes(raw.rating)) throw new Error('复习反馈不正确')
    return {
      id: requiredString(raw.id), itemId: requiredString(raw.itemId), doneAt: requiredString(raw.doneAt),
      duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? Math.max(0, raw.duration) : undefined,
      note: typeof raw.note === 'string' ? raw.note : undefined,
      rating: raw.rating,
    }
  })
  return {
    version: 3,
    items,
    checkIns,
    settings: parseSettings(parsed.settings),
    horizon: parseHorizon((parsed as { horizon?: unknown }).horizon),
    deleted: (() => { const raw = (parsed as { deleted?: unknown }).deleted; const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(-2000) : []; return ids.length ? ids : undefined })(),
    review: looseObject<AppData['review']>(parsed.review, ['judgements', 'balance', 'generatedAt']),
    todayBrief: looseObject<AppData['todayBrief']>((parsed as { todayBrief?: unknown }).todayBrief, ['date', 'now', 'also', 'laterToday', 'tomorrow']),
  }
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseData(JSON.parse(raw)) : emptyData()
  } catch {
    return emptyData()
  }
}

export function useLocalData() {
  const [data, setData] = useState<AppData>(loadData)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* 存储已满或被禁用时，内存中的数据仍可用 */ }
  }, [data])

  const exportData = useCallback(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `此刻备份-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [data])

  const importData = useCallback(async (file: File) => {
    setData(parseData(JSON.parse(await file.text())))
  }, [])

  return { data, setData, exportData, importData }
}
