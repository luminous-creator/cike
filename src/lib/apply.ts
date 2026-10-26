import type { PlanResult, Proposal } from '@contracts/harness'
import { intervalFromSessions } from '@contracts/playbooks'
import { addDays, localDate } from '@/lib/scheduler'
import type { AppData, Item } from '@/types'

/** 把规划 harness 的方案落成一条任务 */
export function itemFromPlan(result: PlanResult, intent: string, overrides: { name?: string; category?: string } = {}): Item {
  const { plan, derived, route } = result
  const name = (overrides.name ?? plan.name).trim() || plan.name
  return {
    id: crypto.randomUUID(),
    name,
    category: (overrides.category ?? plan.category).trim() || '未分类',
    why: intent.trim() && intent.trim() !== name ? intent.trim().slice(0, 800) : undefined,
    type: derived.itemType,
    archetype: route.archetype,
    priority: 2,
    intervalDays: derived.intervalDays,
    currentInterval: derived.intervalDays,
    dueDate: plan.startDate,
    createdAt: new Date().toISOString(),
    paused: false,
    timeSlot: plan.timeSlot ?? undefined,
    sessionMinutes: plan.sessionMinutes,
    sessionsPerWeek: derived.itemType === 'routine' ? plan.sessionsPerWeek ?? undefined : undefined,
    deadline: plan.deadline ?? undefined,
    plan: { ...plan, archetype: route.archetype, source: result.source, generatedAt: new Date().toISOString() },
  }
}

const resolve = (item: Item): Item => (item.judgement ? { ...item, judgement: { ...item.judgement, resolved: 'applied' } } : item)

/** 采用一条提议。返回新数据和提示语；模型从不直接改数据，只有这里会改。 */
export function applyProposal(data: AppData, itemId: string, proposal: Proposal): { data: AppData; message: string } {
  const item = data.items.find((entry) => entry.id === itemId)
  if (!item) return { data, message: '找不到这件事了' }
  const replace = (next: Item, message: string, extra: Item[] = []) => ({
    data: { ...data, items: [...data.items.map((entry) => (entry.id === itemId ? resolve(next) : entry)), ...extra] },
    message,
  })
  switch (proposal.kind) {
    case 'set_interval':
      return replace({ ...item, intervalDays: proposal.days, currentInterval: proposal.days, sessionsPerWeek: undefined }, `已改为每 ${proposal.days} 天一次`)
    case 'set_session': {
      const interval = intervalFromSessions(proposal.sessionsPerWeek)
      return replace({ ...item, sessionMinutes: proposal.minutes, sessionsPerWeek: proposal.sessionsPerWeek, intervalDays: item.type === 'routine' ? interval : item.intervalDays }, `已改为每周 ${proposal.sessionsPerWeek} 次 × ${proposal.minutes} 分钟`)
    }
    case 'set_slot':
      return replace({ ...item, timeSlot: proposal.timeSlot }, `固定时段改为 ${proposal.timeSlot}`)
    case 'rename':
      return replace({ ...item, name: proposal.name }, '已重命名')
    case 'postpone':
      return replace({ ...item, dueDate: addDays(localDate(), proposal.days), overdueDecision: undefined }, `已顺延 ${proposal.days} 天`)
    case 'pause':
      return replace({ ...item, paused: true }, '已暂停')
    case 'archive':
      return replace({ ...item, completedAt: new Date().toISOString() }, '已归档')
    case 'split': {
      const now = new Date().toISOString()
      const subtasks: Item[] = proposal.subtasks.map((title, index) => ({
        id: crypto.randomUUID(), name: title, category: item.category, why: `拆自「${item.name}」`, type: 'once', archetype: 'errand',
        priority: item.priority, intervalDays: 1, currentInterval: 1, dueDate: addDays(localDate(), index), createdAt: now, paused: false,
        timeSlot: item.timeSlot, sessionMinutes: item.sessionMinutes,
      }))
      return replace({ ...item, paused: item.type !== 'once' ? item.paused : true }, `已拆出 ${subtasks.length} 个子任务`, subtasks)
    }
  }
}

export function describeProposal(p: Proposal): string {
  switch (p.kind) {
    case 'set_interval': return `改成每 ${p.days} 天一次`
    case 'set_session': return `每周 ${p.sessionsPerWeek} 次 × ${p.minutes} 分钟`
    case 'set_slot': return `固定到 ${p.timeSlot}`
    case 'split': return `拆成：${p.subtasks.join(' / ')}`
    case 'rename': return `改名为「${p.name}」`
    case 'postpone': return `顺延 ${p.days} 天`
    case 'pause': return '先暂停'
    case 'archive': return '归档'
  }
}
