// 两份数据合并（本机改过、服务端也被别的设备改过时用）：
//   - 项目、打卡、要来的事按 id 取并集；同一个 id 两边都有时以本机为准（你刚改的）
//   - 删除过的 id 记在 deleted 里，合并时两边都剔除，不会“删了又回来”
//   - 规划完成记录、笔记、周规划、晚上写的安排按键合并，本机优先
//   - 设置以本机为准
import { emptyHorizon } from '@contracts/horizon'
import type { AppData } from '@/types'

function byId<T extends { id: string }>(local: T[], remote: T[], gone: Set<string>): T[] {
  const seen = new Set(local.map((x) => x.id))
  return [...local, ...remote.filter((x) => !seen.has(x.id))].filter((x) => !gone.has(x.id))
}

export function mergeData(local: AppData, remote: AppData): AppData {
  const deleted = [...new Set([...(local.deleted ?? []), ...(remote.deleted ?? [])])].slice(-2000)
  const gone = new Set(deleted)
  const lh = local.horizon ?? emptyHorizon()
  const rh = remote.horizon ?? emptyHorizon()
  const items = byId(local.items, remote.items, gone)
  const alive = new Set(items.map((i) => i.id))
  return {
    ...remote,
    ...local,
    items,
    checkIns: byId(local.checkIns, remote.checkIns, gone).filter((c) => alive.has(c.itemId)),
    horizon: {
      events: byId(lh.events, rh.events, gone),
      done: { ...rh.done, ...lh.done },
      dismissed: [...new Set([...rh.dismissed, ...lh.dismissed])],
      notes: { ...rh.notes, ...lh.notes },
      weekPlans: { ...rh.weekPlans, ...lh.weekPlans },
      dayNotes: { ...rh.dayNotes, ...lh.dayNotes },
    },
    settings: local.settings,
    review: local.review ?? remote.review,
    todayBrief: local.todayBrief ?? remote.todayBrief,
    deleted: deleted.length ? deleted : undefined,
  }
}
