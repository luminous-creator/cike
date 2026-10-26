import type { Verdict } from '@contracts/harness'
import { PLAYBOOKS, type Archetype } from '@contracts/playbooks'

export const archetypeLabel = (a?: Archetype) => (a ? PLAYBOOKS[a].label : '')

export const verdictLabels: Record<Verdict, { label: string; tone: 'good' | 'warn' | 'bad' | 'calm' }> = {
  on_track: { label: '顺利', tone: 'good' },
  mastered: { label: '已掌握', tone: 'good' },
  stalled: { label: '停滞', tone: 'bad' },
  too_big: { label: '太大', tone: 'warn' },
  too_vague: { label: '不清楚', tone: 'warn' },
  rhythm_off: { label: '节奏不合', tone: 'warn' },
  struggling: { label: '吃力', tone: 'warn' },
  overinvested: { label: '投入过多', tone: 'warn' },
  underinvested: { label: '投入不足', tone: 'bad' },
  drop_candidate: { label: '可以放下', tone: 'calm' },
}

export function scheduleText(item: { type: string; sessionsPerWeek?: number | null; sessionMinutes?: number | null; timeSlot?: string | null; intervalDays?: number }): string {
  const parts: string[] = []
  if (item.type === 'routine') parts.push(item.sessionsPerWeek ? (item.sessionsPerWeek >= 7 ? '每天' : `每周 ${item.sessionsPerWeek} 次`) : `每 ${item.intervalDays ?? 1} 天`)
  if (item.type === 'learning') parts.push('间隔复习')
  if (item.sessionMinutes) parts.push(`${item.sessionMinutes} 分钟`)
  if (item.timeSlot) parts.push(item.timeSlot)
  return parts.join(' · ')
}
