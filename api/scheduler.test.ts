import { describe, expect, it } from 'vitest'
import { addDays, completeItem, isDue, isOverdue, learningInterval, localDate, recommendedItems } from '../src/lib/scheduler'
import type { Item } from '@/types'

const today = localDate()
const item = (overrides: Partial<Item> = {}): Item => ({
  id: crypto.randomUUID(), name: '任务', category: '测试', type: 'once', priority: 2,
  intervalDays: 3, currentInterval: 3, dueDate: today, createdAt: new Date().toISOString(), paused: false,
  ...overrides,
})

describe('灵活任务调度', () => {
  it('一次任务完成后归档，不再到期或逾期', () => {
    const original = item({ dueDate: '2020-01-01' })
    expect(isOverdue(original)).toBe(true)
    const completed = completeItem(original)
    expect(completed.completedAt).toBeTruthy()
    expect(completed.lastDoneAt).toBe(completed.completedAt)
    expect(isDue(completed)).toBe(false)
    expect(isOverdue(completed)).toBe(false)
  })

  it('周期任务仍按原间隔安排下一次', () => {
    const completed = completeItem(item({ type: 'routine', intervalDays: 3 }))
    expect(completed.completedAt).toBeUndefined()
    expect(completed.dueDate).not.toBe(today)
  })

  it('接下来按建议日期排序，已完成任务不进入推荐', () => {
    const later = item({ name: '后天', dueDate: '2099-01-03', priority: 1 })
    const sooner = item({ name: '明天', dueDate: '2099-01-02', priority: 3 })
    const done = item({ completedAt: new Date().toISOString() })
    expect(recommendedItems([later, done, sooner]).map((entry) => entry.name)).toEqual(['明天', '后天'])
  })

  it('学习复习按实际间隔计：拖了 10 天仍记得，下次至少 20 天', () => {
    const learned = item({ type: 'learning', currentInterval: 3, lastDoneAt: new Date(`${addDays(today, -10)}T09:00:00`).toISOString() })
    expect(learningInterval(learned, 'good', today)).toBe(20)
    expect(learningInterval(learned, 'forgot', today)).toBe(1)
  })

  it('有考试日期时，复习间隔受时间山脊上限约束', () => {
    const learned = item({ type: 'learning', currentInterval: 8, deadline: addDays(today, 10), lastDoneAt: new Date(`${addDays(today, -8)}T09:00:00`).toISOString() })
    expect(learningInterval(learned, 'easy', today)).toBe(2)
  })
})
