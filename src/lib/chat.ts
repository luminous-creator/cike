// 聊天：把 AppData 整理成给模型看的 ChatContext；提示词、聊天记录的本地存取；发请求（设备直连或服务端）。
import { useEffect, useState } from 'react'
import { DEFAULT_BUNDLE, parseBundle, type CardKind, type ChatAction, type ChatBundle, type ChatContext, type ChatMessage, type ChatReply } from '@contracts/chat'
import { describeAction } from '@contracts/chat'
import { dayDiff, shiftDay, weekStartOf, weekdayName, weekDraft, type HorizonFeed, type HorizonInput, type PlanTask } from '@contracts/horizon'
import type { TodayBrief } from '@contracts/today'
import { buildBackend, loadModel } from '@/lib/model'
import { localDate } from '@/lib/scheduler'
import type { AppData } from '@/types'

const shortDay = (d: string) => `${weekdayName(d)} ${Number(d.slice(5, 7))}/${Number(d.slice(8))}`

function planTask(t: PlanTask) {
  return { key: t.key, type: t.type, title: t.title, hint: t.hint, days_left: t.daysLeft, late_days: t.lateDays, lead: t.lead }
}

export function buildChatContext(data: AppData, brief: TodayBrief, feed: HorizonFeed, input: HorizonInput, now = new Date()): ChatContext {
  const today = localDate(now)
  const thisWeek = weekStartOf(today)
  const nextWeek = shiftDay(thisWeek, 7)
  const draft = weekDraft(input, nextWeek)
  const weekPlan = (ws: string) => {
    const p = input.state.weekPlans[ws]
    return p ? { focus: p.focus, fun: p.fun } : undefined
  }
  const tomorrow = shiftDay(today, 1)
  const names = new Map(data.items.map((i) => [i.id, i.name]))
  return {
    today,
    now: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    weekday: weekdayName(today),
    capacity_minutes_per_day: data.settings.capacityMinutesPerDay,
    now_pick: brief.now ? { item_id: brief.now.itemId, name: brief.now.name, minutes: brief.now.minutes, time_slot: brief.now.timeSlot, reasons: brief.now.reasons, first_action: brief.now.firstAction } : null,
    also: brief.also.map((a) => ({ item_id: a.itemId, name: a.name, minutes: a.minutes, reason: a.reasons[0] ?? '' })),
    later_today: brief.laterToday.map((l) => ({ item_id: l.itemId, name: l.name, time_slot: l.timeSlot, minutes: l.minutes })),
    plan_today: feed.today.map(planTask),
    plan_tomorrow: feed.tomorrow.map(planTask),
    happening: feed.happening.map((e) => e.name),
    upcoming: feed.upcoming.slice(0, 12).map((r) => ({
      id: r.event.id, name: r.event.name, date: r.event.date, weekday: weekdayName(r.event.date), kind: r.event.kind, days_left: r.daysLeft, source: r.event.source, note: r.event.note,
      checkpoints: r.checkpoints.map((c) => ({ lead: c.lead, date: c.date, state: c.state, key: `ev:${r.event.id}@${c.lead}` })),
    })),
    weeks: {
      this_week: { week_start: thisWeek, plan: weekPlan(thisWeek) },
      next_week: {
        week_start: nextWeek, plan: weekPlan(nextWeek),
        draft: {
          events: draft.events.map((e) => `${shortDay(e.date)} ${e.name}`),
          deadlines: draft.deadlines.map((e) => `${shortDay(e.date)} ${e.name}`),
          committed_hours: Math.round(draft.committedMinutes / 60),
          capacity_hours: Math.round(data.settings.capacityMinutesPerDay * 7 / 60),
          weekend_free: draft.weekendFree,
          suggestions: draft.suggestions,
        },
      },
    },
    tomorrow: {
      date: tomorrow,
      due: data.items.filter((i) => !i.paused && !i.completedAt && i.dueDate <= tomorrow).map((i) => i.name).slice(0, 8),
      note: input.state.dayNotes[tomorrow],
    },
    day_note: feed.dayNote,
    items: data.items.filter((i) => !i.completedAt).slice(0, 60).map((i) => ({
      id: i.id, name: i.name, type: i.type, category: i.category, due_date: i.dueDate, overdue_days: Math.max(0, dayDiff(i.dueDate, today)),
      deadline: i.deadline, time_slot: i.timeSlot, minutes: i.sessionMinutes, paused: i.paused,
    })),
    recent_checkins: data.checkIns.slice(-10).map((c) => ({ name: names.get(c.itemId) ?? '已删除的项目', at: c.doneAt.slice(0, 16).replace('T', ' '), minutes: c.duration, rating: c.rating })),
  }
}

// ---------- 提示词：默认值来自 prompts/chat.json，改过的存在这台设备 ----------

const BUNDLE_KEY = 'cike.prompts.v1'
const BUNDLE_EVENT = 'cike-prompts-change'

export function loadBundleText(): string | null {
  try { return localStorage.getItem(BUNDLE_KEY) } catch { return null }
}

export function loadBundle(): { bundle: ChatBundle; custom: boolean } {
  const text = loadBundleText()
  const parsed = text ? parseBundle(text) : null
  return parsed?.bundle ? { bundle: parsed.bundle, custom: true } : { bundle: DEFAULT_BUNDLE, custom: false }
}

/** 传 null 恢复默认 */
export function saveBundleText(text: string | null): string | undefined {
  if (text !== null) {
    const { error } = parseBundle(text)
    if (error) return error
  }
  try {
    if (text === null) localStorage.removeItem(BUNDLE_KEY)
    else localStorage.setItem(BUNDLE_KEY, text)
  } catch { return '这台设备不能保存（存储被禁用）' }
  window.dispatchEvent(new Event(BUNDLE_EVENT))
  return undefined
}

export function useBundle() {
  const [state, setState] = useState(loadBundle)
  useEffect(() => {
    const sync = () => setState(loadBundle())
    window.addEventListener(BUNDLE_EVENT, sync)
    return () => window.removeEventListener(BUNDLE_EVENT, sync)
  }, [])
  return state
}

// ---------- 聊天记录（只在这台设备，留最近 150 条） ----------

export type ActionStatus = 'pending' | 'applied' | 'dismissed'
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'day'
  at: string
  text?: string
  cards?: CardKind[]
  actions?: { action: ChatAction; status: ActionStatus }[]
  error?: boolean
}

const CHAT_KEY = 'cike.chat.v1'

export function loadChat(): ChatEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === 'string' && typeof e.role === 'string') : []
  } catch { return [] }
}

export function saveChat(entries: ChatEntry[]): void {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(entries.slice(-150))) } catch { /* 存不下就只在本次有效 */ }
}

/** 给模型的历史：文字 + 提议结果，让它记得哪些被采用了 */
export function toModelMessages(entries: ChatEntry[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const e of entries) {
    if (e.role === 'day' || e.error) continue
    let content = e.text ?? ''
    if (e.actions?.length) {
      const state = { pending: '待用户决定', applied: '用户已采用', dismissed: '用户没要' }
      content += `\n（提议：${e.actions.map((a) => `${describeAction(a.action).title}——${state[a.status]}`).join('；')}）`
    }
    if (content.trim()) out.push({ role: e.role, content })
  }
  // 模型要求第一条是用户消息
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

// ---------- 发请求 ----------

export async function requestChat(input: { bundle: ChatBundle; context: ChatContext; messages: ChatMessage[] }, signal?: AbortSignal): Promise<{ reply?: ChatReply; error?: string; code?: string }> {
  const device = loadModel()
  if (device) {
    const [{ runChat }, { friendly }] = await Promise.all([import('../../api/chat/engine'), import('../../api/harness/engine')])
    try {
      return { reply: await runChat(input, buildBackend(device), signal) }
    } catch (error) {
      if (error instanceof TypeError) return { error: '连不上模型：检查网络，或这个服务商不允许浏览器直连', code: 'network' }
      return { error: friendly(error).message.replace('，已改用规则结果。', ''), code: 'model' }
    }
  }
  try {
    const response = await fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal })
    const body = await response.json().catch(() => null) as (ChatReply & { error?: string; code?: string }) | null
    if (!response.ok || !body) return { error: body?.error ?? (response.status === 404 ? '这里没有服务端：在设置里接入模型后就能聊' : `服务端出错（${response.status}）`), code: body?.code ?? 'server' }
    return { reply: body }
  } catch (error) {
    if (signal?.aborted) throw error
    return { error: '连不上服务端：在设置里接入模型（设备直连）后就能聊', code: 'offline' }
  }
}
