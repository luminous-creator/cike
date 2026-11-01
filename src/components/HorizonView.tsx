import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarDays, CalendarRange, Check, Download, Moon, NotebookPen, PartyPopper, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DEFAULT_LEADS, HORIZON_KINDS, LEAD_CHOICES, kindLabels, leadLabel, shiftDay, shortDate, weekDraft, weekStartOf, weekTaskKey, weekdayName,
  type HorizonEvent, type HorizonFeed, type HorizonInput, type HorizonKind, type PlanTask, type WeekPlan,
} from '@contracts/horizon'
import { localDate } from '@/lib/scheduler'

// ---------- 今天 / 明天可以规划（今天页与规划页共用） ----------

function taskBadge(task: PlanTask): string {
  if (task.type === 'week') return '周'
  if (task.type === 'tomorrow') return '晚'
  return task.lead === 1 ? '1 天' : `${task.lead} 天`
}

function taskMeta(task: PlanTask): string {
  if (task.type === 'tomorrow') return task.hint
  const when = task.type === 'event' ? `${weekdayName(task.target)} ${shortDate(task.target)} · 还有 ${task.daysLeft} 天` : ''
  const late = task.lateDays > 0 ? `原定 ${task.lateDays} 天前，现在补上` : ''
  return [when, late, task.hint].filter(Boolean).join(' · ')
}

interface PlanBlockProps {
  feed: HorizonFeed
  onPlan: (task: PlanTask) => void
  /** 今天页：没有要规划的就整块不显示 */
  hideWhenEmpty?: boolean
}

export function PlanBlock({ feed, onPlan, hideWhenEmpty }: PlanBlockProps) {
  if (hideWhenEmpty && !feed.today.length && !feed.tomorrow.length) return null
  return (
    <section className="today-block plan-ahead" aria-label="可以规划的事">
      <h2>今天可以规划<span>往前看 30 · 7 · 1 天</span></h2>
      {feed.today.length === 0 && <p className="plan-none">今天没有要规划的。</p>}
      {feed.today.map((task) => (
        <div key={task.key} className={`plan-row${task.lateDays > 0 ? ' late' : ''}`}>
          <span className={`plan-badge ${task.type}`}>{taskBadge(task)}</span>
          <div><strong>{task.title}</strong><span>{taskMeta(task)}</span></div>
          <button className="button-secondary" onClick={() => onPlan(task)}><NotebookPen size={15} />去规划</button>
        </div>
      ))}
      {feed.tomorrow.length > 0 && <div className="plan-tomorrow">
        <span>明天可以规划</span>
        <ul>{feed.tomorrow.map((task) => <li key={task.key}><strong>{task.title}</strong><small>{task.type === 'event' ? `还有 ${task.daysLeft} 天` : shortDate(task.target) + ' 起'}</small></li>)}</ul>
      </div>}
    </section>
  )
}

/** 今天页顶部的小提示：今天是什么日子、昨晚写的安排、本周主线 */
export function HorizonNotes({ feed }: { feed: HorizonFeed }) {
  if (!feed.happening.length && !feed.dayNote && !feed.week) return null
  return (
    <div className="horizon-notes">
      {feed.happening.length > 0 && <p><PartyPopper size={15} /><span>今天是{feed.happening.map((e) => e.name).join('、')}{feed.happening.find((e) => e.note) ? `：${feed.happening.find((e) => e.note)!.note}` : ''}</span></p>}
      {feed.dayNote && <p><Moon size={15} /><span>昨晚你写的：{feed.dayNote}</span></p>}
      {feed.week && (feed.week.focus || feed.week.fun) && <p><CalendarRange size={15} /><span>本周{feed.week.focus ? ` · 主线：${feed.week.focus.split('\n')[0]}` : ''}{feed.week.fun ? ` · 想玩：${feed.week.fun.split('\n')[0]}` : ''}</span></p>}
    </div>
  )
}

// ---------- 规划页 ----------

interface HorizonViewProps {
  feed: HorizonFeed
  weekPlans: Record<string, WeekPlan>
  onPlan: (task: PlanTask) => void
  onNote: (event: HorizonEvent) => void
  onNewEvent: () => void
  onEditEvent: (event: HorizonEvent) => void
  onDeleteEvent: (event: HorizonEvent) => void
  onDismiss: (event: HorizonEvent) => void
  onExportIcs: () => void
}

export function weekTaskFor(weekStart: string, today = localDate()): PlanTask {
  return {
    key: weekTaskKey(weekStart), type: 'week', title: weekStart <= today ? '规划这周' : '规划下周',
    hint: `${shortDate(weekStart)}–${shortDate(shiftDay(weekStart, 6))}`, date: today, target: weekStart, daysLeft: 0, lateDays: 0,
  }
}

const sourceLabels = { user: '', festival: '节日', deadline: '截止' }

export function HorizonView({ feed, weekPlans, onPlan, onNote, onNewEvent, onEditEvent, onDeleteEvent, onDismiss, onExportIcs }: HorizonViewProps) {
  const thisWeek = weekStartOf(feed.date)
  const nextWeek = shiftDay(thisWeek, 7)
  const months = useMemo(() => {
    const groups = new Map<string, HorizonFeed['upcoming']>()
    for (const row of feed.upcoming) {
      const key = row.event.date.slice(0, 7)
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    return [...groups.entries()]
  }, [feed.upcoming])
  const title = feed.today.length ? `今天可以规划 ${feed.today.length} 件。` : '今天不用规划。'

  return (
    <div className="view horizon-view">
      <header className="view-heading standard-heading">
        <div><p className="section-code">AHEAD / 提前 30 · 7 · 1 天</p><h1>{title}</h1></div>
        <div className="horizon-actions">
          <button className="button-primary" onClick={onNewEvent}><Plus size={17} />加一件要来的事</button>
          <button className="button-secondary" onClick={onExportIcs} title="导入手机日历后，不开应用也会到点提醒"><Download size={16} />导出到日历</button>
        </div>
      </header>

      <PlanBlock feed={feed} onPlan={onPlan} />

      <section className="today-block">
        <h2>每周规划</h2>
        <div className="week-cards">
          {[thisWeek, nextWeek].map((ws) => {
            const plan = weekPlans[ws]
            return <article key={ws} className={plan ? 'week-card' : 'week-card empty'}>
              <header><strong>{ws === thisWeek ? '本周' : '下周'}</strong><span>{shortDate(ws)}–{shortDate(shiftDay(ws, 6))}</span></header>
              {plan ? <dl>
                <div><dt>主线</dt><dd>{plan.focus || '—'}</dd></div>
                <div><dt>想玩</dt><dd>{plan.fun || '—'}</dd></div>
              </dl> : <p>还没规划。</p>}
              <button className="text-button" onClick={() => onPlan(weekTaskFor(ws, feed.date))}>{plan ? <><Pencil size={14} />改一下</> : <><NotebookPen size={14} />现在规划</>}</button>
            </article>
          })}
        </div>
      </section>

      <section className="today-block">
        <h2>接下来 60 天</h2>
        {months.length === 0 && <p className="plan-none">60 天内没有要来的事。想到要玩的、要考的、要交的，加进来，到点会提醒你提前规划。</p>}
        {months.map(([month, rows]) => (
          <div key={month} className="horizon-month">
            <h3>{Number(month.slice(5))} 月</h3>
            {rows.map(({ event, daysLeft, checkpoints }) => (
              <div key={event.id} className="horizon-row">
                <time><b>{Number(event.date.slice(8))}</b><small>{weekdayName(event.date)}</small></time>
                <div className="horizon-main">
                  <strong>{event.name}<em className={`kind ${event.kind}`}>{kindLabels[event.kind]}</em>{sourceLabels[event.source] && <em>{sourceLabels[event.source]}</em>}</strong>
                  <span>还有 {daysLeft} 天</span>
                  <ol className="checkpoints" aria-label="规划检查点">
                    {checkpoints.map((c) => <li key={c.lead} className={c.state} title={`${leadLabel(c.lead)}（${shortDate(c.date)}）`}>{c.state === 'done' && <Check size={11} />}{c.lead === 1 ? '前一天' : `${c.lead} 天`}</li>)}
                  </ol>
                  {event.note && <p className="horizon-note">{event.note}</p>}
                </div>
                <div className="horizon-row-actions">
                  {event.source === 'user'
                    ? <><button className="text-button" onClick={() => onEditEvent(event)} aria-label={`编辑${event.name}`}><Pencil size={14} />编辑</button>
                      <button className="text-button" onClick={() => onDeleteEvent(event)} aria-label={`删除${event.name}`}><Trash2 size={14} /></button></>
                    : <><button className="text-button" onClick={() => onNote(event)}><NotebookPen size={14} />记一笔</button>
                      {event.source === 'festival' && <button className="text-button" onClick={() => onDismiss(event)}>不过了</button>}</>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="learning-note horizon-help">
        <CalendarClock size={20} />
        <div>
          <h2>提醒怎么来</h2>
          <p>每件事在提前 30 天、7 天、前一天各提醒一次规划：30 天定方向、订票，7 天排进那一周，前一天把东西备好。加得晚了，错过的几次会合并成一次补上。每周在你选的那天规划下一周；晚上会提醒你规划明天。</p>
          <p>手机上：先在「设置」里开启通知并安装到桌面。应用开着时到点弹通知；安卓 Chrome 装到桌面后，应用关着也会被系统定时唤醒来提醒（时间不一定准）。想要准点、iPhone 也有，点「导出到日历」导入手机日历，每次规划都会准时响铃；计划变了重新导入一次即可。</p>
        </div>
      </section>
    </div>
  )
}

// ---------- 规划对话框 ----------

export interface PlanPayload { note?: string; focus?: string; fun?: string }

interface PlanDialogProps {
  task: PlanTask | null
  /** 只记笔记，不算完成一次规划 */
  noteOnly?: boolean
  input: HorizonInput
  /** 明天到期的项目名 */
  tomorrowNames: string[]
  onOpenChange: (open: boolean) => void
  onSave: (task: PlanTask, payload: PlanPayload, complete: boolean) => void
  onDismiss: (event: HorizonEvent) => void
}

export function PlanTaskDialog({ task, noteOnly, input, tomorrowNames, onOpenChange, onSave, onDismiss }: PlanDialogProps) {
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState('')
  const [fun, setFun] = useState('')
  const draft = useMemo(() => task?.type === 'week' ? weekDraft(input, task.target) : null, [task, input])

  useEffect(() => {
    if (!task) return
    const week = task.type === 'week' ? input.state.weekPlans[task.target] : undefined
    setFocus(week?.focus ?? '')
    setFun(week?.fun ?? '')
    setNote(task.type === 'tomorrow' ? input.state.dayNotes[task.target] ?? '' : task.event?.note ?? '')
    // 只在打开时取一次已有内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])

  if (!task) return null
  const code = task.type === 'week' ? 'WEEK / 每周规划' : task.type === 'tomorrow' ? 'TOMORROW / 规划明天' : noteOnly ? 'NOTE / 记一笔' : `PLAN AHEAD / ${task.lead ? leadLabel(task.lead) : ''}`
  const title = task.type === 'week' ? `${task.target <= input.today ? '这周' : '下周'}干什么、玩什么` : task.type === 'tomorrow' ? '明天怎么安排' : task.title
  const description = task.type === 'week'
    ? `${shortDate(task.target)}（周一）到 ${shortDate(shiftDay(task.target, 6))}（周日）`
    : task.type === 'tomorrow' ? `${shortDate(task.target)} ${weekdayName(task.target)}` : `${shortDate(task.target)} ${weekdayName(task.target)} · 还有 ${task.daysLeft} 天`

  function submit(event: React.FormEvent) {
    event.preventDefault()
    onSave(task!, { note: note.trim() || undefined, focus: focus.trim(), fun: fun.trim() }, !noteOnly)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <p className="section-code">{code}</p>
          <DialogTitle className="dialog-title">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          {task.type === 'event' && !noteOnly && <p className="form-hint plan-hint"><b>这次规划</b>{task.hint}{task.lateDays > 0 ? `（原定 ${task.lateDays} 天前，现在补上也来得及）` : ''}</p>}

          {draft && <div className="week-draft">
            {(draft.events.length > 0 || draft.deadlines.length > 0) && <ul>
              {draft.events.map((e) => <li key={e.id}><CalendarDays size={13} />{weekdayName(e.date)} {e.name}</li>)}
              {draft.deadlines.map((e) => <li key={e.id} className="deadline"><CalendarClock size={13} />{weekdayName(e.date)} {shortDate(e.date)} {e.name}</li>)}
            </ul>}
            <p>周期性的事每周约占 {Math.round(draft.committedMinutes / 60)} 小时，还能空出约 <b>{Math.round(draft.freeMinutes / 60)} 小时</b>。</p>
            {draft.suggestions.length > 0 && <ul className="week-suggest">{draft.suggestions.map((s) => <li key={s}>{s}</li>)}</ul>}
          </div>}

          {task.type === 'week' ? <>
            <label className="field-label">这周主要干什么（一两件就够）
              <textarea autoFocus value={focus} onChange={(e) => setFocus(e.target.value)} rows={3} maxLength={800} placeholder="例如：写完论文第三章；把作品集首页上线" />
            </label>
            <label className="field-label">这周想玩点什么
              <textarea value={fun} onChange={(e) => setFun(e.target.value)} rows={2} maxLength={800} placeholder={draft?.weekendFree ? '周末还空着：去哪、和谁？' : '例如：周六晚上和朋友去看展'} />
            </label>
          </> : task.type === 'tomorrow' ? <>
            {tomorrowNames.length > 0 && <p className="form-hint">明天到期：{tomorrowNames.join('、')}</p>}
            <label className="field-label">明天先做什么、第一步是什么
              <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={800} placeholder="例如：起床先复习第 3 单元的错题，资料已放在桌上" />
            </label>
          </> : <label className="field-label">打算怎么安排（明早和下次规划时都能看到）
            <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={800} placeholder={task.kind === 'fun' ? '去哪、和谁、几点、要订什么' : '要做哪些、分到哪几天'} />
          </label>}

          <div className="dialog-actions">
            {task.event?.source === 'festival' && !noteOnly && <button type="button" className="text-button dialog-left" onClick={() => { onDismiss(task.event!); onOpenChange(false) }}>这个不过了</button>}
            <button type="button" className="button-secondary" onClick={() => onOpenChange(false)}>取消</button>
            <button type="submit" className="button-primary">{noteOnly ? '保存' : task.type === 'week' ? '定下来' : '规划好了'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- 加一件要来的事 ----------

interface EventDialogProps {
  open: boolean
  event: HorizonEvent | null
  onOpenChange: (open: boolean) => void
  onSave: (event: HorizonEvent) => void
}

export function EventDialog({ open, event, onOpenChange, onSave }: EventDialogProps) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [kind, setKind] = useState<HorizonKind>('fun')
  const [leads, setLeads] = useState<number[]>(DEFAULT_LEADS)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(event?.name ?? '')
    setDate(event?.date ?? shiftDay(localDate(), 7))
    setKind(event?.kind ?? 'fun')
    setLeads(event?.leads ?? DEFAULT_LEADS)
    setNote(event?.note ?? '')
    setError('')
  }, [open, event])

  function toggleLead(lead: number) {
    setLeads((current) => current.includes(lead) ? current.filter((l) => l !== lead) : [...current, lead].sort((a, b) => b - a))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('给这件事起个名字'); return }
    if (!date || date < localDate()) { setError('日期要在今天之后'); return }
    if (!leads.length) { setError('至少选一个提前规划的时间'); return }
    onSave({ id: event?.id ?? crypto.randomUUID(), name: name.trim(), date, kind, leads, note: note.trim() || undefined, source: 'user' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <p className="section-code">{event ? 'EDIT / 调整' : 'AHEAD / 要来的事'}</p>
          <DialogTitle className="dialog-title">{event ? '调整这件事' : '加一件要来的事'}</DialogTitle>
          <DialogDescription>想玩的、要考的、要交的、要见的人。到了提前规划的日子会提醒你。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label className="field-label">是什么
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="例如：和朋友去海边 / 英语六级 / 妈妈生日" />
          </label>
          <div className="form-grid">
            <label className="field-label">哪天
              <input type="date" value={date} min={localDate()} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <fieldset className="field-label">哪一类
              <div className="segmented four-options">
                {HORIZON_KINDS.map((k) => <button key={k} type="button" className={kind === k ? 'selected' : ''} onClick={() => setKind(k)}>{kindLabels[k]}</button>)}
              </div>
            </fieldset>
          </div>
          <fieldset className="field-label">提前多久规划（可多选）
            <div className="lead-choices">
              {LEAD_CHOICES.map((lead) => <button key={lead} type="button" className={leads.includes(lead) ? 'selected' : ''} aria-pressed={leads.includes(lead)} onClick={() => toggleLead(lead)}>{leadLabel(lead)}</button>)}
            </div>
          </fieldset>
          <label className="field-label">已经想到的安排（可选）
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={800} placeholder="去哪、和谁、要准备什么" />
          </label>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={() => onOpenChange(false)}>取消</button>
            <button type="submit" className="button-primary">{event ? '保存' : '加进来'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
