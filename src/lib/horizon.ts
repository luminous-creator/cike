// 往前看：把 AppData 接到 contracts/horizon 的纯函数上，外加通知、后台提醒和日历导出。
import { DEFAULT_HORIZON_SETTINGS, buildDigests, buildIcs, emptyHorizon, type DigestEntry, type HorizonInput, type HorizonSettings } from '@contracts/horizon'
import { localDate } from '@/lib/scheduler'
import type { AppData } from '@/types'

export function horizonSettings(settings: AppData['settings']): HorizonSettings {
  return {
    weekPlanDay: settings.weekPlanDay ?? DEFAULT_HORIZON_SETTINGS.weekPlanDay,
    reminderTime: settings.reminderTime ?? DEFAULT_HORIZON_SETTINGS.reminderTime,
    eveningTime: settings.eveningTime ?? DEFAULT_HORIZON_SETTINGS.eveningTime,
    festivals: settings.festivals ?? DEFAULT_HORIZON_SETTINGS.festivals,
  }
}

export function horizonInput(data: AppData, now = new Date()): HorizonInput {
  return {
    today: localDate(now),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
    state: data.horizon ?? emptyHorizon(),
    settings: horizonSettings(data.settings),
    items: data.items,
    capacityMinutesPerDay: data.settings.capacityMinutesPerDay,
  }
}

export const nowHHMM = (now = new Date()) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

// ---------- 通知 ----------

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  try { return 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() ?? undefined : undefined } catch { return undefined }
}

/**
 * 优先用 Service Worker 弹通知：安卓 Chrome 不允许页面里 new Notification()，
 * 装到桌面后也只有这种通知点了能回到应用。
 */
export async function notify(title: string, options: NotificationOptions = {}): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const opts: NotificationOptions = { icon: 'icon-192.png', badge: 'icon-192.png', lang: 'zh-CN', ...options }
  const reg = await registration()
  try {
    if (reg) { await reg.showNotification(title, opts); return }
  } catch { /* 退回页面通知 */ }
  try { new Notification(title, opts) } catch { /* 不支持就算了，页内提示仍在 */ }
}

// ---------- 后台提醒：Service Worker 按天读这份摘要 ----------

const DIGEST_CACHE = 'cike-digest'
const cacheUrl = (reg: ServiceWorkerRegistration | undefined, name: string) => new URL(name, reg?.scope ?? location.href).href

/** 把未来 14 天的提醒写进缓存，Service Worker 被系统唤醒时按天取用 */
export async function syncDigests(data: AppData): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const reg = await registration()
    const entries = buildDigests(horizonInput(data))
    const cache = await caches.open(DIGEST_CACHE)
    await cache.put(cacheUrl(reg, 'cike-digest.json'), new Response(JSON.stringify({ entries, updatedAt: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } }))
  } catch { /* 缓存不可用时只靠应用开着时的提醒 */ }
}

async function readShown(reg: ServiceWorkerRegistration | undefined): Promise<string[]> {
  try {
    const res = await (await caches.open(DIGEST_CACHE)).match(cacheUrl(reg, 'cike-digest-shown.json'))
    return res ? await res.json() : []
  } catch { return [] }
}

/** 页面和 Service Worker 共用“已提醒”记录，同一条不弹两次 */
export async function markShown(ids: string[]): Promise<void> {
  if (typeof caches === 'undefined' || !ids.length) return
  try {
    const reg = await registration()
    const shown = [...new Set([...(await readShown(reg)), ...ids])].slice(-60)
    await (await caches.open(DIGEST_CACHE)).put(cacheUrl(reg, 'cike-digest-shown.json'), new Response(JSON.stringify(shown), { headers: { 'Content-Type': 'application/json' } }))
  } catch { /* 忽略 */ }
}

export async function wasShown(id: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  return (await readShown(await registration())).includes(id)
}

/** 应用开着时：到了提醒时间且还没提醒过的条目 */
export function dueDigests(entries: DigestEntry[], now = new Date()): DigestEntry[] {
  const today = localDate(now)
  const hm = nowHHMM(now)
  return entries.filter((e) => e.date === today && e.at <= hm)
}

type PeriodicSyncManager = { register: (tag: string, options: { minInterval: number }) => Promise<void> }

/**
 * 申请后台定时唤醒（安卓 Chrome 装到桌面后可用）：系统每隔几小时唤醒一次 Service Worker，
 * 它读上面的摘要，把今天还没弹的提醒弹出来。不支持的浏览器静默跳过。
 */
export async function registerBackgroundReminders(): Promise<boolean> {
  try {
    const reg = await registration()
    const periodic = (reg as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }) | undefined)?.periodicSync
    if (!reg || !periodic) return false
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName })
    if (status.state !== 'granted') return false
    await periodic.register('cike-daily', { minInterval: 4 * 60 * 60 * 1000 })
    return true
  } catch { return false }
}

// ---------- 导出到手机日历 ----------

export function downloadIcs(data: AppData): void {
  const blob = new Blob([buildIcs(horizonInput(data))], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `此刻规划提醒-${localDate()}.ics`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
