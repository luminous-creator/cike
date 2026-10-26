import { useState } from 'react'
import { ArrowRightLeft, Bell, Check, ChevronDown, LoaderCircle, MoonStar, Plus, Sparkles } from 'lucide-react'
import type { TodayBrief, TodayPick } from '@contracts/today'
import { ItemRow } from '@/components/ItemRow'
import type { AiStatus } from '@/lib/harness'
import type { JudgeProps } from '@/components/Views'
import type { AppData, Item } from '@/types'

interface Props extends JudgeProps {
  data: AppData
  brief: TodayBrief
  restItems: Item[]
  ai: AiStatus | null
  arranging: boolean
  skippedCount: number
  onArrange: () => void
  onDone: (item: Item) => void
  onCheckIn: (item: Item, detailed?: boolean) => void
  onSwap: (itemId: string) => void
  onNotToday: (item: Item) => void
  onResetSkip: () => void
  onNew: () => void
}

export function TodayView({ data, brief, restItems, ai, arranging, skippedCount, onArrange, onDone, onCheckIn, onSwap, onNotToday, onResetSkip, onNew, ...judge }: Props) {
  const [showRest, setShowRest] = useState(false)
  const byId = new Map(data.items.map((item) => [item.id, item]))
  const nowItem = brief.now ? byId.get(brief.now.itemId) : undefined
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const title = nowItem ? '现在，做这件。' : brief.laterToday.length ? `下一件在 ${brief.laterToday[0].timeSlot}。` : '今天可以歇着。'

  return (
    <div className="view today-view">
      <header className="view-heading today-heading">
        <div>
          <p className="section-code">TODAY / {date}</p>
          <h1>{title}</h1>
        </div>
        {ai?.configured && (brief.now || brief.also.length > 0) && <div className="arrange">
          <button className="text-button" onClick={onArrange} disabled={arranging}>
            {arranging ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{arranging ? `${ai.label} 正在排` : brief.source === 'model' ? '重新排一下' : '让 AI 排一下'}
          </button>
          {brief.source === 'model' && brief.message && <p>{brief.message}</p>}
        </div>}
      </header>

      {nowItem && brief.now && <NowCard pick={brief.now} item={nowItem} source={brief.source} onDone={onDone} onSwap={onSwap} onNotToday={onNotToday} />}

      {!nowItem && <div className="today-empty">
        <span className="empty-check">{brief.laterToday.length ? <Bell size={24} /> : <MoonStar size={24} />}</span>
        <div>
          <h3>{brief.laterToday.length ? '现在没有要做的' : skippedCount ? '今天的都看过了' : '今天没有到期的事'}</h3>
          <p>{brief.laterToday.length ? '到了固定时段会提醒你。' : skippedCount ? `换掉的 ${skippedCount} 件今天不再出现。` : '想到什么就记下来，下次打开时不用从头想。'}</p>
        </div>
        {skippedCount > 0 ? <button className="button-secondary" onClick={onResetSkip}>再看一遍</button> : <button className="button-secondary" onClick={onNew}><Plus size={16} />加一件事</button>}
      </div>}

      {brief.also.length > 0 && <section className="today-block">
        <h2>也可以</h2>
        {brief.also.map((pick) => {
          const item = byId.get(pick.itemId)
          if (!item) return null
          return <div key={pick.itemId} className="also-row">
            <div><strong>{pick.name}</strong><span>{pick.minutes} 分钟 · {pick.reasons[0]}</span></div>
            <button className="button-secondary" onClick={() => onDone(item)}><Check size={15} />做完了</button>
          </div>
        })}
      </section>}

      {brief.laterToday.length > 0 && <section className="today-block">
        <h2>今天还有</h2>
        {brief.laterToday.map((l) => <div key={l.itemId} className="later-row">
          <time>{l.timeSlot}</time><strong>{l.name}</strong><span>{l.minutes} 分钟</span><Bell size={14} aria-label="到点提醒" />
        </div>)}
      </section>}

      {brief.tomorrow.length > 0 && <section className="today-block tomorrow">
        <h2>明天</h2>
        <ul>{brief.tomorrow.map((t) => <li key={t.itemId}><strong>{t.name}</strong><span>{t.timeSlot ?? t.reason}</span></li>)}</ul>
      </section>}

      {restItems.length > 0 && <section className="today-block rest">
        <button className="rest-toggle" onClick={() => setShowRest(!showRest)} aria-expanded={showRest}>
          今天还能做的其余 {restItems.length} 件<ChevronDown size={15} />
        </button>
        {showRest && <div className="item-list">
          {restItems.map((item) => <ItemRow key={item.id} item={item} checkIns={data.checkIns} onCheckIn={onCheckIn} onJudge={judge.onJudge} onApply={judge.onApply} onDismiss={judge.onDismiss} judging={judge.judgingId === item.id} compact />)}
        </div>}
      </section>}
    </div>
  )
}

function NowCard({ pick, item, source, onDone, onSwap, onNotToday }: { pick: TodayPick; item: Item; source: TodayBrief['source']; onDone: (item: Item) => void; onSwap: (id: string) => void; onNotToday: (item: Item) => void }) {
  return (
    <article className="now-card" aria-label="现在做这件">
      <div className="now-meta">
        <span>{item.category}</span>
        <span>{pick.minutes} 分钟{pick.timeSlot ? ` · ${pick.timeSlot}` : ''}</span>
        {source === 'model' && <span className="now-source"><Sparkles size={12} />AI 排的</span>}
      </div>
      <h2 className="now-name">{pick.name}</h2>
      <ul className="now-reasons">{pick.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <p className="now-first"><span>第一步</span>{pick.firstAction}</p>
      <div className="now-actions">
        <button className="button-primary" onClick={() => onDone(item)}><Check size={18} />{item.type === 'learning' ? '回忆完了' : '做完了'}</button>
        <button className="button-secondary" onClick={() => onSwap(item.id)}><ArrowRightLeft size={16} />换一件</button>
        <button className="text-button" onClick={() => onNotToday(item)}>今天不做</button>
      </div>
    </article>
  )
}
