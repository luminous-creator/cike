import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, CalendarRange, Check, LoaderCircle, Settings2, Sparkles, X } from 'lucide-react'
import { describeAction, type CardKind, type ChatAction } from '@contracts/chat'
import { shiftDay, shortDate, weekStartOf, type HorizonFeed, type PlanTask } from '@contracts/horizon'
import type { TodayBrief } from '@contracts/today'
import { HorizonNotes, PlanBlock, weekTaskFor } from '@/components/HorizonView'
import { NowCard } from '@/components/TodayView'
import { buildChatContext, loadChat, requestChat, saveChat, toModelMessages, useBundle, type ChatEntry } from '@/lib/chat'
import type { AiStatus } from '@/lib/harness'
import type { HorizonInput } from '@contracts/horizon'
import { localDate } from '@/lib/scheduler'
import type { AppData, Item } from '@/types'

interface Props {
  data: AppData
  brief: TodayBrief
  feed: HorizonFeed
  input: HorizonInput
  ai: AiStatus | null
  onApply: (action: ChatAction) => string | null
  onPlan: (task: PlanTask) => void
  onDone: (item: Item) => void
  onSwap: (itemId: string) => void
  onNotToday: (item: Item) => void
  onOpenToday: () => void
  onOpenHorizon: () => void
  onOpenSettings: () => void
}

const newId = () => crypto.randomUUID()
const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

export function ChatView({ data, brief, feed, input, ai, onApply, onPlan, onDone, onSwap, onNotToday, onOpenToday, onOpenHorizon, onOpenSettings }: Props) {
  const { bundle, custom } = useBundle()
  const [entries, setEntries] = useState<ChatEntry[]>(loadChat)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const today = localDate()
  const name = bundle.name ?? '大肥鱼'
  const ready = Boolean(ai?.configured)

  // 每天第一次打开：插一条日期分隔，下面是今天的卡片（今天页变成对话里的一张卡）
  useEffect(() => {
    setEntries((current) => current.some((e) => e.role === 'day' && e.at.slice(0, 10) === today) ? current : [...current, { id: newId(), role: 'day', at: `${today}T00:00` }])
  }, [today])
  useEffect(() => { saveChat(entries) }, [entries])
  // 新消息滚到底；每天第一次打开时停在今天卡片的开头
  useEffect(() => {
    if (entries.at(-1)?.role === 'day' && !busy) document.querySelector('.chat-day:last-of-type')?.scrollIntoView({ block: 'start' })
    else endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, busy])

  const chips = useMemo(() => {
    const out: string[] = []
    if (brief.now) out.push('现在先做什么？')
    const event = feed.today.find((t) => t.type === 'event')
    if (event) out.push(`帮我规划${event.title}`)
    if (feed.today.some((t) => t.type === 'week')) out.push('规划一下下周')
    if (feed.today.some((t) => t.type === 'tomorrow') || new Date().getHours() >= 19) out.push('明天怎么安排？')
    out.push('这周末玩点什么？')
    return out.slice(0, 4)
  }, [brief.now, feed.today])

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy || !ready) return
    const user: ChatEntry = { id: newId(), role: 'user', at: new Date().toISOString(), text: content }
    const history = [...entries, user]
    setEntries(history)
    setDraft('')
    setBusy(true)
    try {
      const context = buildChatContext(data, brief, feed, input)
      const { reply, error } = await requestChat({ bundle, context, messages: toModelMessages(history) })
      const entry: ChatEntry = reply
        ? { id: newId(), role: 'assistant', at: new Date().toISOString(), text: reply.text, cards: reply.cards, actions: reply.actions.map((action) => ({ action, status: 'pending' as const })) }
        : { id: newId(), role: 'assistant', at: new Date().toISOString(), text: error ?? '没连上', error: true }
      setEntries((current) => [...current, entry])
    } finally {
      setBusy(false)
    }
  }

  function decide(entryId: string, index: number, apply: boolean) {
    const entry = entries.find((e) => e.id === entryId)
    const target = entry?.actions?.[index]
    if (!target || target.status !== 'pending') return
    const failed = apply ? onApply(target.action) : null
    setEntries((current) => current.map((e) => e.id !== entryId ? e : {
      ...e, actions: e.actions!.map((a, i) => i === index ? { ...a, status: failed ? 'dismissed' : apply ? 'applied' : 'dismissed' } : a),
    }))
  }

  function clearChat() {
    if (!window.confirm('清空聊天记录吗？项目和规划不受影响。')) return
    setEntries([{ id: newId(), role: 'day', at: `${today}T00:00` }])
  }

  const card = (kind: CardKind, key: string) => kind === 'today'
    ? <TodayCard key={key} data={data} brief={brief} feed={feed} onPlan={onPlan} onDone={onDone} onSwap={onSwap} onNotToday={onNotToday} onOpenToday={onOpenToday} />
    : kind === 'week' ? <WeekCard key={key} feed={feed} weekPlans={input.state.weekPlans} onPlan={onPlan} />
      : <UpcomingCard key={key} feed={feed} onOpen={onOpenHorizon} />

  return (
    <div className="view chat-view">
      <header className="chat-head">
        <div><p className="section-code">CHAT / {name}{custom ? ' · 自定义提示词' : ''}</p><h1>{name}</h1></div>
        <div className="chat-head-actions">
          <button className="text-button" onClick={onOpenSettings} title="编辑提示词、接入模型"><Settings2 size={15} />设定</button>
          {entries.length > 1 && <button className="text-button" onClick={clearChat}>清空</button>}
        </div>
      </header>

      <div className="chat-log" aria-live="polite">
        {entries.map((e) => {
          if (e.role === 'day') {
            const isToday = e.at.slice(0, 10) === today
            return <div key={e.id} className="chat-day">
              <span>{isToday ? `今天 · ${shortDate(today)}` : shortDate(e.at.slice(0, 10))}</span>
              {isToday && card('today', `${e.id}-today`)}
            </div>
          }
          if (e.role === 'user') return <div key={e.id} className="msg me"><p>{e.text}</p><time>{hm(e.at)}</time></div>
          return <div key={e.id} className={`msg bot${e.error ? ' error' : ''}`}>
            {e.text && <p>{e.text}</p>}
            {e.cards?.map((k) => card(k, `${e.id}-${k}`))}
            {e.actions?.map((a, i) => {
              const { title, detail } = describeAction(a.action)
              return <div key={i} className={`proposal-card ${a.status}`}>
                <div><strong>{title}</strong>{detail && <span>{detail}</span>}</div>
                {a.status === 'pending'
                  ? <div className="proposal-buttons"><button className="button-primary" onClick={() => decide(e.id, i, true)}><Check size={15} />采用</button><button className="text-button" onClick={() => decide(e.id, i, false)}><X size={14} />不要</button></div>
                  : <em>{a.status === 'applied' ? '已采用' : '没采用'}</em>}
              </div>
            })}
            <time>{hm(e.at)}</time>
          </div>
        })}
        {busy && <div className="msg bot typing"><LoaderCircle className="spin" size={15} />{name}在想…</div>}
        <div ref={endRef} className="chat-end" />
      </div>

      {!ready && <div className="chat-setup">
        <Sparkles size={20} />
        <div><strong>{name}需要先接入模型才能聊天</strong><span>在「设置」里选一个服务商、填密钥（只存在这台设备）；或者在你自己的服务端 .env 里填 DEEPSEEK_API_KEY。今天的卡片和规划不受影响。</span></div>
        <button className="button-secondary" onClick={onOpenSettings}>去设置</button>
      </div>}

      <form className="chat-composer" onSubmit={(ev) => { ev.preventDefault(); void send(draft) }}>
        {ready && entries.filter((e) => e.role === 'user').length < 40 && <div className="chat-chips">
          {chips.map((c) => <button key={c} type="button" onClick={() => void send(c)} disabled={busy}>{c}</button>)}
        </div>}
        <div className="chat-input">
          <textarea id="chat-input" value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={1} maxLength={1000} disabled={!ready}
            placeholder={ready ? `跟${name}说说：想做什么、要来什么事、今天先干嘛…` : '接入模型后就能聊'}
            onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void send(draft) } }} />
          <button type="submit" className="chat-send" disabled={!ready || busy || !draft.trim()} aria-label="发送"><ArrowUp size={18} /></button>
        </div>
      </form>
    </div>
  )
}

// ---------- 对话里的卡片 ----------

function TodayCard({ data, brief, feed, onPlan, onDone, onSwap, onNotToday, onOpenToday }: { data: AppData; brief: TodayBrief; feed: HorizonFeed; onPlan: (task: PlanTask) => void; onDone: (item: Item) => void; onSwap: (id: string) => void; onNotToday: (item: Item) => void; onOpenToday: () => void }) {
  const byId = new Map(data.items.map((i) => [i.id, i]))
  const nowItem = brief.now ? byId.get(brief.now.itemId) : undefined
  return (
    <section className="chat-card today-card">
      <HorizonNotes feed={feed} />
      <PlanBlock feed={feed} onPlan={onPlan} hideWhenEmpty />
      {nowItem && brief.now
        ? <NowCard pick={brief.now} item={nowItem} source={brief.source} onDone={onDone} onSwap={onSwap} onNotToday={onNotToday} />
        : <p className="chat-card-empty">{brief.laterToday.length ? `下一件在 ${brief.laterToday[0].timeSlot}：${brief.laterToday[0].name}` : '今天没有到期的事。'}</p>}
      {brief.also.length > 0 && <p className="chat-card-also">也可以：{brief.also.map((a) => a.name).join('、')}</p>}
      <button className="text-button" onClick={onOpenToday}>看完整的今天</button>
    </section>
  )
}

function WeekCard({ feed, weekPlans, onPlan }: { feed: HorizonFeed; weekPlans: Record<string, { focus: string; fun: string }>; onPlan: (task: PlanTask) => void }) {
  const thisWeek = weekStartOf(feed.date)
  const weeks = [thisWeek, shiftDay(thisWeek, 7)]
  return (
    <section className="chat-card week-mini">
      {weeks.map((ws, i) => {
        const plan = weekPlans[ws]
        return <div key={ws}>
          <header><strong>{i === 0 ? '本周' : '下周'}</strong><span>{shortDate(ws)}–{shortDate(shiftDay(ws, 6))}</span></header>
          {plan ? <p>主线：{plan.focus || '—'}<br />想玩：{plan.fun || '—'}</p> : <p className="muted">还没规划</p>}
          <button className="text-button" onClick={() => onPlan(weekTaskFor(ws, feed.date))}><CalendarRange size={13} />{plan ? '改一下' : '规划'}</button>
        </div>
      })}
    </section>
  )
}

function UpcomingCard({ feed, onOpen }: { feed: HorizonFeed; onOpen: () => void }) {
  const rows = feed.upcoming.slice(0, 5)
  return (
    <section className="chat-card upcoming-mini">
      {rows.length === 0 && <p className="muted">60 天内没有要来的事。</p>}
      {rows.map(({ event, daysLeft, checkpoints }) => {
        const next = checkpoints.find((c) => c.state === 'due') ?? checkpoints.find((c) => c.state === 'future')
        return <div key={event.id}><strong>{event.name}</strong><span>{shortDate(event.date)} · 还有 {daysLeft} 天{next ? ` · ${next.state === 'due' ? '今天该规划' : `${shortDate(next.date)} 规划`}` : ''}</span></div>
      })}
      <button className="text-button" onClick={onOpen}>打开规划页</button>
    </section>
  )
}
