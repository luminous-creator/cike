import { useRef, useState } from 'react'
import { Check, Crosshair, LoaderCircle, Scale, ScanSearch } from 'lucide-react'
import type { BalanceRow, HarnessEvent, ReviewMode, ReviewResult } from '@contracts/harness'
import { HarnessTrace } from '@/components/HarnessTrace'
import { describeProposal } from '@/lib/apply'
import { buildSnapshot, requestReview, type AiStatus } from '@/lib/harness'
import { verdictLabels } from '@/lib/labels'
import type { AppData, Item } from '@/types'

interface Props {
  data: AppData
  ai: AiStatus | null
  onSave: (result: ReviewResult) => void
  onApply: (itemId: string) => void
  onDismiss: (itemId: string) => void
  onCheckIn: (item: Item, detailed?: boolean) => void
}

const MODES: { id: Exclude<ReviewMode, 'single'>; label: string; hint: string }[] = [
  { id: 'full', label: '全面复盘', hint: '评判 + 归纳' },
  { id: 'judge', label: '只评判', hint: '逐件给结论' },
  { id: 'induce', label: '只归纳', hint: '看整体规律' },
]

export function ReviewView({ data, ai, onSave, onApply, onDismiss, onCheckIn }: Props) {
  const [mode, setMode] = useState<Exclude<ReviewMode, 'single'>>('full')
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const review = data.review
  const byId = new Map(data.items.map((item) => [item.id, item]))
  const active = data.items.filter((item) => !item.completedAt && !item.paused).length

  async function run() {
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    setEvents([]); setRunning(true)
    try {
      await requestReview({ mode, snapshot: buildSnapshot(data) }, (event) => {
        if (ctrl.signal.aborted) return
        setEvents((list) => [...list, event])
        if (event.type === 'review') onSave(event.result)
      }, ctrl.signal)
    } finally {
      if (!ctrl.signal.aborted) setRunning(false)
    }
  }

  return (
    <div className="view review-view">
      <header className="view-heading standard-heading">
        <div><p className="section-code">REVIEW / 评判与归纳</p><h1>看清楚，再出发</h1></div>
        <p className="heading-note">先由数据挑出值得看的事，<br />再交给模型评判，最后逐条核对。</p>
      </header>

      <section className="review-controls">
        <div className="segmented review-modes" role="radiogroup" aria-label="复盘方式">
          {MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'selected' : ''} onClick={() => setMode(m.id)} disabled={running}><strong>{m.label}</strong><small>{m.hint}</small></button>)}
        </div>
        <div className="review-run">
          <span className={`model-badge ${ai?.configured ? 'on' : ''}`}><i />{ai?.configured ? `${ai.label}${ai.model ? ` · ${ai.model}` : ''}` : '规则评判'}</span>
          <button className="button-primary" onClick={() => void run()} disabled={running || active === 0}>
            {running ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}{running ? '复盘中' : '开始复盘'}
          </button>
        </div>
      </section>

      <HarnessTrace key={running ? 'live' : 'done'} events={events} running={running} title="复盘过程" defaultOpen={running} />

      {!review && !running && <div className="empty-state review-empty">
        <span className="empty-check"><ScanSearch size={26} /></span>
        <h3>{active ? '还没有复盘' : '先加几件事'}</h3>
        <p>{active ? '复盘会先用打卡数据算出逾期、完成率、遗忘率和投入平衡，只把信号强的事交给模型评判；每条结论都要和数据对得上，对不上就退回重写。' : '至少需要一件进行中的事，复盘才有内容。'}</p>
      </div>}

      {review && <>
        <p className="review-meta">
          {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(review.generatedAt))}
          {' · '}{review.stats.model ?? '规则'}{review.stats.steps ? ` · ${review.stats.steps} 步` : ''}{review.stats.rejected ? ` · 退回修正 ${review.stats.rejected} 次` : ''}
        </p>

        {review.synthesis && <section className="synthesis">
          <h2 className="synthesis-headline">{review.synthesis.headline}</h2>
          <p className="synthesis-narrative">{review.synthesis.narrative}</p>
          {review.synthesis.focus.length > 0 && <div className="focus-list">
            <h3><Crosshair size={15} />此刻焦点</h3>
            {review.synthesis.focus.map((f) => {
              const item = byId.get(f.itemId)
              if (!item) return null
              return <div key={f.itemId} className="focus-row">
                <div><strong>{item.name}</strong><span>{f.reason}</span></div>
                {!item.completedAt && !item.paused && <button className="check-button" onClick={() => onCheckIn(item, item.type === 'learning')}><Check size={16} />{item.type === 'once' ? '完成' : '打卡'}</button>}
              </div>
            })}
          </div>}
          {(review.synthesis.themes.length > 0 || review.synthesis.patterns.length > 0) && <div className="synthesis-grid">
            {review.synthesis.themes.length > 0 && <div><h4>主题</h4><ul className="themes">{review.synthesis.themes.map((t) => <li key={t.name}><strong>{t.name}</strong><span>{t.itemIds.map((id) => byId.get(id)?.name).filter(Boolean).join('、')}</span>{t.note && <small>{t.note}</small>}</li>)}</ul></div>}
            {review.synthesis.patterns.length > 0 && <div><h4>规律</h4><ul className="patterns">{review.synthesis.patterns.map((p, i) => <li key={i}><strong>{p.observation}</strong><small>{p.evidence}</small></li>)}</ul></div>}
          </div>}
        </section>}

        {review.balance.length > 0 && <BalanceChart rows={review.balance} note={review.synthesis?.balance} />}

        {review.judgements.length > 0 && <section className="judgement-section">
          <div className="section-heading"><h2>逐件评判</h2><span>{review.judgements.length} 件</span></div>
          {review.judgements.map((j) => {
            const item = byId.get(j.itemId)
            if (!item) return null
            const resolved = item.judgement?.generatedAt === review.generatedAt ? item.judgement.resolved : undefined
            const tone = verdictLabels[j.verdict]
            return <article key={j.itemId} className="judgement-card">
              <header>
                <span className={`verdict ${tone.tone}`}>{tone.label}</span>
                <strong>{item.name}</strong>
                <small>{j.source === 'model' ? '模型' : '规则'}</small>
              </header>
              <p className="judgement-summary">{j.summary}</p>
              <ul className="judgement-evidence">{j.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p className="judgement-next"><span>下一步</span>{j.nextAction}</p>
              {j.proposal && <div className={`proposal ${resolved ?? ''}`}>
                <span>提议：{describeProposal(j.proposal)}</span>
                {resolved ? <em>{resolved === 'applied' ? '已采用' : '已忽略'}</em> : <div>
                  <button className="text-button" onClick={() => onDismiss(j.itemId)}>忽略</button>
                  <button className="button-secondary" onClick={() => onApply(j.itemId)}>采用</button>
                </div>}
              </div>}
            </article>
          })}
        </section>}
      </>}
    </div>
  )
}

function BalanceChart({ rows, note }: { rows: BalanceRow[]; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.targetMinutes, r.actualMinutes)))
  const label = { over: '偏多', under: '不足', idle: '没动', ok: '正常' }
  return (
    <section className="balance-section">
      <div className="section-heading"><div><Scale size={15} /><h2>投入平衡</h2></div><span>近 7 天 · 实际 / 预算（分钟）</span></div>
      {note && <p className="balance-note">{note}</p>}
      <ul className="balance-chart">
        {rows.map((row) => <li key={row.itemId} className={row.state}>
          <span className="balance-name">{row.name}</span>
          <span className="balance-bar" aria-label={`${row.name} 实际 ${row.actualMinutes} 分钟，预算 ${row.targetMinutes} 分钟`}>
            <i style={{ transform: `scaleX(${row.actualMinutes / max})` }} />
            <b style={{ left: `${(row.targetMinutes / max) * 100}%` }} />
          </span>
          <span className="balance-num">{row.actualMinutes}<small>/{row.targetMinutes}</small></span>
          <span className="balance-state">{label[row.state]}</span>
        </li>)}
      </ul>
    </section>
  )
}
