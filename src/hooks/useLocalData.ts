import { useCallback, useEffect, useState } from 'react'
import { ARCHETYPES } from '@contracts/playbooks'
import type { AppData, Item, Rating } from '@/types'

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

export function parseData(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('备份格式不正确')
  const parsed = value as { version?: unknown; items?: unknown; checkIns?: unknown; settings?: { capacityMinutesPerDay?: unknown }; review?: unknown }
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
  const capacity = positiveInt(parsed.settings?.capacityMinutesPerDay, 960)
  return {
    version: 3,
    items,
    checkIns,
    settings: { capacityMinutesPerDay: capacity && capacity >= 15 ? capacity : DEFAULT_SETTINGS.capacityMinutesPerDay },
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
