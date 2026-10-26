import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { intervalFromSessions } from '@contracts/playbooks'
import { localDate } from '@/lib/scheduler'
import type { Item } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: Item | null
  /** 新建时的预填（来自规划方案的"调整后加入"） */
  draft?: Partial<Item> | null
  onSave: (item: Item) => void
}

const typeLabels = { once: '一次完成', routine: '周期行动', learning: '学习复习' }

export function ItemDialog({ open, onOpenChange, item, draft, onSave }: Props) {
  const source = item ?? draft ?? null
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [why, setWhy] = useState('')
  const [type, setType] = useState<Item['type']>('once')
  const [priority, setPriority] = useState<Item['priority']>(2)
  const [intervalDays, setIntervalDays] = useState(3)
  const [sessionsPerWeek, setSessionsPerWeek] = useState('')
  const [sessionMinutes, setSessionMinutes] = useState('')
  const [timeSlot, setTimeSlot] = useState('')
  const [deadline, setDeadline] = useState('')
  const [dueDate, setDueDate] = useState(localDate())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(source?.name ?? '')
    setCategory(source?.category ?? '')
    setWhy(source?.why ?? '')
    setType(source?.type ?? 'once')
    setPriority(source?.priority ?? 2)
    setIntervalDays(source?.type === 'learning' ? source.currentInterval ?? 1 : source?.intervalDays ?? 3)
    setSessionsPerWeek(source?.sessionsPerWeek ? String(source.sessionsPerWeek) : '')
    setSessionMinutes(source?.sessionMinutes ? String(source.sessionMinutes) : '')
    setTimeSlot(source?.timeSlot ?? '')
    setDeadline(source?.deadline ?? '')
    setDueDate(source?.dueDate ?? localDate())
    setError('')
  }, [open, source])

  function chooseType(next: Item['type']) {
    setType(next)
    setIntervalDays(next === 'learning' ? 1 : 3)
    if (next !== 'routine') setSessionsPerWeek('')
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError('给这件事起一个名字吧'); return }
    const perWeek = type === 'routine' && sessionsPerWeek ? Math.min(7, Math.max(1, Number(sessionsPerWeek))) : undefined
    const interval = perWeek ? intervalFromSessions(perWeek) : Math.max(1, intervalDays)
    onSave({
      id: item?.id ?? crypto.randomUUID(),
      name: name.trim(),
      category: category.trim() || '未分类',
      why: why.trim() || undefined,
      type,
      archetype: source?.archetype,
      priority,
      intervalDays: interval,
      currentInterval: type === 'learning' ? Math.max(1, intervalDays) : item?.currentInterval ?? interval,
      dueDate,
      createdAt: item?.createdAt ?? new Date().toISOString(),
      lastDoneAt: item?.lastDoneAt,
      completedAt: type === 'once' ? item?.completedAt : undefined,
      paused: item?.paused ?? false,
      overdueDecision: item?.overdueDecision,
      timeSlot: timeSlot || undefined,
      sessionMinutes: sessionMinutes ? Math.max(1, Number(sessionMinutes)) : undefined,
      sessionsPerWeek: perWeek,
      deadline: deadline || undefined,
      plan: source?.plan,
      judgement: item?.judgement,
      analysis: item?.analysis,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <p className="section-code">{item ? 'EDIT / 调整任务' : 'MANUAL / 手动记下'}</p>
          <DialogTitle className="dialog-title">{item ? '调整这件事' : '手动填写'}</DialogTitle>
          <DialogDescription>日期只是行动建议，不是截止日期。固定时段会用于提醒和避开冲突。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label className="field-label">任务名称
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：整理作品集的登陆页" maxLength={60} />
          </label>
          <label className="field-label">为什么想做？（可选）
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="例如：想让第一次访问的人更快看懂我做了什么" rows={2} maxLength={800} />
          </label>
          <div className="form-grid">
            <label className="field-label">分类
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="个人项目 / 学业" maxLength={30} />
            </label>
            <label className="field-label">优先级
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Item['priority'])}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
          </div>
          <fieldset className="field-label">怎样完成这件事？
            <div className="segmented three-options">
              {(Object.keys(typeLabels) as Item['type'][]).map((entry) => <button key={entry} type="button" className={type === entry ? 'selected' : ''} onClick={() => chooseType(entry)}>{typeLabels[entry]}</button>)}
            </div>
          </fieldset>
          <div className="form-grid">
            {type === 'routine' && <label className="field-label">每周几次
              <input type="number" min={1} max={7} value={sessionsPerWeek} onChange={(e) => setSessionsPerWeek(e.target.value)} placeholder={`或每 ${intervalDays} 天`} />
            </label>}
            {type === 'routine' && !sessionsPerWeek && <label className="field-label">每隔几天
              <input type="number" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} required />
            </label>}
            {type === 'learning' && <label className="field-label">首次复习间隔（天）
              <input type="number" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))} required />
            </label>}
            <label className="field-label">每次多少分钟
              <input type="number" min={1} max={600} value={sessionMinutes} onChange={(e) => setSessionMinutes(e.target.value)} placeholder="可不填" />
            </label>
            <label className="field-label">固定开始时间
              <input type="time" value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} />
            </label>
          </div>
          <div className="form-grid">
            <label className="field-label">{type === 'once' ? '建议行动日期' : '首次 / 下次建议日期'}
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </label>
            {type !== 'once' && <label className="field-label">考试 / 截止日（可选）
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} min={localDate()} />
            </label>}
          </div>
          {type === 'once' && <p className="form-hint">打卡一次后就完成归档，不再进入行动队列；记录仍会保留。</p>}
          {type === 'learning' && <p className="form-hint">打卡时选择回忆结果，间隔会自动拉长或缩短；有考试日期时，越临近复习越密。</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={() => onOpenChange(false)}>取消</button>
            <button type="submit" className="button-primary">{item ? '保存修改' : '加入行动队列'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
