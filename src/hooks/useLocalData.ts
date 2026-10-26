import { useCallback, useEffect, useState } from 'react'
import type { AppData, Item, Rating } from '@/types'

const STORAGE_KEY = 'cike.personal.v1'
const emptyData = (): AppData => ({ version: 2, items: [], checkIns: [] })
const ratings: Rating[] = ['forgot', 'hard', 'good', 'easy']

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('备份字段不正确')
  return value
}

function parseData(value: unknown): AppData {
  if (!value || typeof value !== 'object') throw new Error('备份格式不正确')
  const parsed = value as { version?: unknown; items?: unknown; checkIns?: unknown }
  if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.items) || !Array.isArray(parsed.checkIns)) {
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
  return { version: 2, items, checkIns }
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
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
