import { ridgelineCap } from '@contracts/playbooks'
import type { CheckIn, Item, Rating } from '@/types'

export const DAY_MS = 86_400_000

export function localDate(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localDate(date)
}

export function daysBetween(from: string, to = localDate()): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / DAY_MS)
}

export function formatDate(dateString?: string): string {
  if (!dateString) return '尚未打卡'
  const diff = daysBetween(localDate(), dateString)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  if (diff < 0) return `已过 ${Math.abs(diff)} 天`
  const [, m, d] = dateString.split('-')
  return `${Number(m)} 月 ${Number(d)} 日`
}

export function nextInterval(current: number, rating: Rating): number {
  if (rating === 'forgot') return 1
  if (rating === 'hard') return Math.max(1, Math.round(current * 1.25))
  if (rating === 'good') return Math.max(current + 1, Math.round(current * 2))
  return Math.max(current + 2, Math.round(current * 3))
}

/**
 * 学习类的下一次间隔：
 * - 记得 / 轻松时按"实际隔了多久"计，拖了 10 天还记得，说明记忆比计划更稳；
 * - 有考试日期时，按 Cepeda 2008 的时间山脊收紧上限，越临近越密。
 */
export function learningInterval(item: Item, rating: Rating, today: string): number {
  const elapsed = item.lastDoneAt ? daysBetween(localDate(new Date(item.lastDoneAt)), today) : item.currentInterval
  const base = rating === 'good' || rating === 'easy' ? Math.max(item.currentInterval, elapsed) : item.currentInterval
  let next = Math.min(365, nextInterval(base, rating))
  if (item.deadline) {
    const left = daysBetween(today, item.deadline)
    if (left > 0) next = Math.min(next, ridgelineCap(left))
  }
  return Math.max(1, next)
}

export function completeItem(item: Item, rating?: Rating, at = new Date()): Item {
  if (item.type === 'once') {
    return { ...item, lastDoneAt: at.toISOString(), completedAt: at.toISOString(), overdueDecision: undefined }
  }
  const today = localDate(at)
  const interval = item.type === 'learning' && rating
    ? learningInterval(item, rating, today)
    : item.intervalDays
  return {
    ...item,
    currentInterval: interval,
    lastDoneAt: at.toISOString(),
    dueDate: addDays(today, interval),
    overdueDecision: undefined,
  }
}

export function isDue(item: Item): boolean {
  return !item.paused && !item.completedAt && daysBetween(item.dueDate) >= 0
}

export function isOverdue(item: Item): boolean {
  return !item.paused && !item.completedAt && daysBetween(item.dueDate) > 0
}

export function itemStatus(item: Item): { label: string; tone: string } {
  if (item.completedAt) return { label: '已完成', tone: 'muted' }
  if (item.paused) return { label: '已暂停', tone: 'muted' }
  const days = daysBetween(item.dueDate)
  if (days > 0) return { label: `已过 ${days} 天`, tone: 'overdue' }
  if (days === 0) return { label: '现在可做', tone: 'due' }
  if (days === -1) return { label: '明天', tone: 'soon' }
  return { label: formatDate(item.dueDate), tone: 'scheduled' }
}

export function recommendedItems(items: Item[]): Item[] {
  return items
    .filter((item) => !item.paused && !item.completedAt)
    .sort((a, b) => {
      const aDue = isDue(a) ? 0 : 1
      const bDue = isDue(b) ? 0 : 1
      if (aDue !== bDue) return aDue - bDue
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.priority !== b.priority) return a.priority - b.priority
      const aLast = a.lastDoneAt ?? a.createdAt
      const bLast = b.lastDoneAt ?? b.createdAt
      return aLast.localeCompare(bLast)
    })
}

export function streakFor(itemId: string, checkIns: CheckIn[]): number {
  const days = [...new Set(checkIns.filter((entry) => entry.itemId === itemId).map((entry) => localDate(new Date(entry.doneAt))))]
    .sort().reverse()
  if (!days.length) return 0
  const firstGap = daysBetween(days[0])
  if (firstGap > 1) return 0
  let streak = 1
  for (let i = 1; i < days.length; i += 1) {
    if (daysBetween(days[i], days[i - 1]) !== 1) break
    streak += 1
  }
  return streak
}

export const ratingLabels: Record<Rating, { title: string; description: string }> = {
  forgot: { title: '忘记', description: '明天再来一次' },
  hard: { title: '模糊', description: '小幅拉长间隔' },
  good: { title: '记得', description: '约两倍间隔' },
  easy: { title: '轻松', description: '约三倍间隔' },
}
