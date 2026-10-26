import { useEffect, useState } from 'react'
import { offlinePlan, offlineReview } from '@contracts/fallback'
import type { HarnessEvent, ReviewMode, Snapshot } from '@contracts/harness'
import { localDate } from '@/lib/scheduler'
import type { AppData } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')
/** ISO → 浏览器本地 'YYYY-MM-DDTHH:mm'，服务端只做字符串运算，不受时区影响 */
const local = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 16) : `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function buildSnapshot(data: AppData): Snapshot {
  const now = new Date()
  const items = [...data.items].sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt))).slice(0, 400)
  return {
    today: localDate(now),
    now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    capacityMinutesPerDay: data.settings.capacityMinutesPerDay,
    items: items.map((item) => ({
      id: item.id, name: item.name.slice(0, 80), category: item.category.slice(0, 40), why: item.why?.slice(0, 400),
      type: item.type, archetype: item.archetype, priority: item.priority,
      intervalDays: Math.min(365, Math.max(1, item.intervalDays)), currentInterval: Math.min(365, Math.max(1, item.currentInterval)),
      dueDate: item.dueDate, createdAt: local(item.createdAt), lastDoneAt: item.lastDoneAt ? local(item.lastDoneAt) : undefined,
      completedAt: item.completedAt ? local(item.completedAt) : undefined, paused: item.paused,
      timeSlot: item.timeSlot, sessionMinutes: item.sessionMinutes, sessionsPerWeek: item.sessionsPerWeek, deadline: item.deadline,
    })),
    checkIns: data.checkIns.slice(-1200).map((entry) => ({
      itemId: entry.itemId, doneAt: local(entry.doneAt), duration: entry.duration, rating: entry.rating, note: entry.note?.slice(0, 300),
    })),
  }
}

/** 读 NDJSON 事件流；网络不通 / 服务端不在时抛出，由调用方切到本地规则 */
async function stream(path: string, body: unknown, onEvent: (event: HarnessEvent) => void, signal?: AbortSignal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) onEvent(JSON.parse(line) as HarnessEvent)
      newline = buffer.indexOf('\n')
    }
  }
}

export async function requestPlan(input: { intent: string; answer?: { question: string; answer: string }; snapshot: Snapshot }, onEvent: (event: HarnessEvent) => void, signal?: AbortSignal) {
  try {
    await stream('/api/plan', input, onEvent, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    offlinePlan(input, onEvent, '服务端不可用，在本机按策略库规划')
    onEvent({ type: 'done', durationMs: 0, steps: 0, model: null })
  }
}

export async function requestReview(input: { mode: ReviewMode; itemId?: string; snapshot: Snapshot }, onEvent: (event: HarnessEvent) => void, signal?: AbortSignal) {
  try {
    await stream('/api/review', input, onEvent, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    offlineReview(input, onEvent, '服务端不可用，在本机按规则评判')
    onEvent({ type: 'done', durationMs: 0, steps: 0, model: null })
  }
}

export interface AiStatus { configured: boolean; label: string; model: string | null; online: boolean }

export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/ai/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: Omit<AiStatus, 'online'>) => alive && setStatus({ ...s, online: true }))
      .catch(() => alive && setStatus({ configured: false, label: '离线', model: null, online: false }))
    return () => { alive = false }
  }, [])
  return status
}
