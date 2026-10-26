import { useEffect, useRef, useState } from 'react'
import { BookMarked, Check, CircleAlert, LoaderCircle, PencilLine, RotateCcw, Sparkles, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HarnessTrace } from '@/components/HarnessTrace'
import type { HarnessEvent, PlanResult } from '@contracts/harness'
import { PLAYBOOKS, REFS } from '@contracts/playbooks'
import { itemFromPlan } from '@/lib/apply'
import { buildSnapshot, requestPlan, type AiStatus } from '@/lib/harness'
import { addDays, formatDate, localDate } from '@/lib/scheduler'
import type { AppData, Item } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: AppData
  ai: AiStatus | null
  onCreate: (item: Item) => void
  onManual: (draft?: Partial<Item>) => void
}

const EXAMPLES = ['背考研英语单词，12 月 20 日考试', '做比赛路演视频，两周后交', '每天早上跑步', '学 Python 能做数据分析', '周五前把实习材料交了']

type Phase = 'input' | 'running' | 'clarify' | 'result'

export function PlannerDialog({ open, onOpenChange, data, ai, onCreate, onManual }: Props) {
  const [intent, setIntent] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [result, setResult] = useState<PlanResult | null>(null)
  const [clarify, setClarify] = useState<{ question: string; options: string[] } | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  // 关闭即重置，下次打开是一张白纸
  function close(next: boolean) {
    if (!next) {
      controller.current?.abort()
      setIntent(''); setPhase('input'); setEvents([]); setResult(null); setClarify(null)
    }
    onOpenChange(next)
  }

  async function run(answer?: { question: string; answer: string }) {
    if (intent.trim().length < 2) return
    controller.current?.abort()
    const ctrl = new AbortController()
    controller.current = ctrl
    setPhase('running'); setResult(null); setClarify(null)
    if (!answer) setEvents([])
    let gotPlan = false
    let gotClarify = false
    try {
      await requestPlan({ intent: intent.trim(), answer, snapshot: buildSnapshot(data) }, (event) => {
        if (ctrl.signal.aborted) return
        setEvents((list) => [...list, event])
        if (event.type === 'plan') { gotPlan = true; setResult(event.result); setName(event.result.plan.name); setCategory(event.result.plan.category) }
        if (event.type === 'clarify') { gotClarify = true; setClarify({ question: event.question, options: event.options }) }
      }, ctrl.signal)
    } catch {
      return
    }
    if (ctrl.signal.aborted) return
    setPhase(gotPlan ? 'result' : gotClarify ? 'clarify' : 'input')
  }

  function create() {
    if (!result) return
    onCreate(itemFromPlan(result, intent, { name, category }))
    close(false)
  }

  function manual() {
    const draft = result ? itemFromPlan(result, intent, { name, category }) : { name: intent.trim().slice(0, 60) }
    close(false)
    onManual(draft)
  }

  const running = phase === 'running'
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="app-dialog planner-dialog">
        <DialogHeader>
          <p className="section-code">PLAN / 路由 → 专家 → 评审</p>
          <DialogTitle className="dialog-title">{result ? '这件事这样做' : '你想做什么？'}</DialogTitle>
          <DialogDescription>
            {result ? '方案已经过策略库逐条检查。可以直接加入，也可以先改。' : '说一句就行。它会判断这是哪类事、按研究证据给出做法，并避开你已占用的时段。'}
          </DialogDescription>
        </DialogHeader>

        {phase !== 'result' && <div className="planner-input">
          <textarea
            autoFocus value={intent} onChange={(e) => setIntent(e.target.value)} rows={3} maxLength={300} disabled={running}
            placeholder="例如：背考研英语单词，12 月 20 日考试"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run() }}
          />
          {phase === 'input' && <div className="example-chips" aria-label="示例">
            {EXAMPLES.map((example) => <button key={example} type="button" onClick={() => setIntent(example)}>{example}</button>)}
          </div>}
          <div className="planner-bar">
            <span className={`model-badge ${ai?.configured ? 'on' : ''}`}><i />{ai ? (ai.configured ? `${ai.label}${ai.model ? ` · ${ai.model}` : ''}` : ai.online ? '未接入模型 · 规则策略' : '离线 · 规则策略') : '检测模型…'}</span>
            <div>
              <button type="button" className="button-secondary" onClick={manual} disabled={running}><PencilLine size={16} />手动填写</button>
              <button type="button" className="button-primary" onClick={() => void run()} disabled={running || intent.trim().length < 2}>
                {running ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{running ? '规划中' : '开始规划'}
              </button>
            </div>
          </div>
        </div>}

        {phase === 'clarify' && clarify && <div className="clarify">
          <p><CircleAlert size={16} />{clarify.question}</p>
          <div>
            {clarify.options.map((option) => <button key={option} type="button" className="button-secondary" onClick={() => void run({ question: clarify.question, answer: option })}>{option}</button>)}
            <button type="button" className="text-button" onClick={() => void run({ question: clarify.question, answer: '你来判断' })}>你来判断</button>
          </div>
        </div>}

        <HarnessTrace key={phase === 'result' ? 'done' : 'live'} events={events} running={running} title="规划过程" defaultOpen={phase !== 'result'} />

        {phase === 'result' && result && <>
          <PlanCard result={result} name={name} category={category} onName={setName} onCategory={setCategory} />
          <div className="dialog-actions planner-actions">
            <button type="button" className="text-button" onClick={() => { setPhase('input'); setResult(null) }}><RotateCcw size={15} />重新描述</button>
            <button type="button" className="button-secondary" onClick={manual}><PencilLine size={16} />调整后加入</button>
            <button type="button" className="button-primary" onClick={create}><Check size={17} />加入行动队列</button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  )
}

function PlanCard({ result, name, category, onName, onCategory }: { result: PlanResult; name: string; category: string; onName: (v: string) => void; onCategory: (v: string) => void }) {
  const { plan, derived, route, checks, autoFixed } = result
  const book = PLAYBOOKS[route.archetype]
  const passed = checks.filter((c) => c.ok).length
  const loadPct = Math.min(100, Math.round((derived.loadAfter / Math.max(1, derived.capacityWeek)) * 100))
  const beforePct = Math.min(100, Math.round((derived.loadBefore / Math.max(1, derived.capacityWeek)) * 100))
  const today = localDate()
  return (
    <article className="plan-card">
      <header className="plan-head">
        <span className="plan-archetype">{book.label}</span>
        <span className="plan-source">{result.source === 'model' ? '模型方案' : '策略库模板'} · 评审 {passed}/{checks.length}</span>
      </header>
      <div className="plan-name">
        <input value={name} onChange={(e) => onName(e.target.value)} maxLength={60} aria-label="任务名称" />
        <input value={category} onChange={(e) => onCategory(e.target.value)} maxLength={30} aria-label="分类" className="plan-category" />
      </div>
      <p className="plan-method">{plan.method}</p>
      <p className="plan-rationale">{plan.rationale}</p>

      <dl className="plan-schedule">
        {derived.itemType === 'routine' && <div><dt>频率</dt><dd>{plan.sessionsPerWeek && plan.sessionsPerWeek >= 7 ? '每天' : `每周 ${plan.sessionsPerWeek} 次`}</dd></div>}
        {derived.itemType === 'learning' && <div><dt>复习</dt><dd>{derived.reviewOffsets.length ? derived.reviewOffsets.slice(0, 4).map((d) => addDays(today, d).slice(5).replace('-', '/').replace(/^0/, '')).join(' · ') : `${plan.firstIntervalDays} 天后`}</dd></div>}
        {derived.itemType === 'once' && <div><dt>哪天</dt><dd>{formatDate(plan.startDate)}</dd></div>}
        <div><dt>每次</dt><dd>{plan.sessionMinutes} 分钟</dd></div>
        {(plan.timeSlot || book.fixedSlot) && <div><dt>时段</dt><dd>{plan.timeSlot ?? '待定'}</dd></div>}
        {plan.deadline && <div><dt>截止</dt><dd>{formatDate(plan.deadline)}</dd></div>}
      </dl>

      <div className="plan-now"><span>现在就做</span><strong>{plan.firstAction}</strong></div>
      <p className="plan-ifthen">{plan.ifThen}</p>

      <ol className="plan-steps">
        {plan.steps.map((step, index) => <li key={index}><span>{step.title}</span>{step.minutes ? <em>{step.minutes}′</em> : null}</li>)}
      </ol>

      <div className="plan-grid">
        <div><h4>错过了怎么办</h4><p>{plan.fallback}</p></div>
        <div><h4>常见的坑</h4><ul>{plan.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
      </div>

      {derived.itemType !== 'once' && <div className="load-meter" aria-label="每周时间占用">
        <div className="load-track"><i style={{ width: `${beforePct}%` }} /><b style={{ left: `${beforePct}%`, width: `${Math.max(0, loadPct - beforePct)}%` }} /></div>
        <span>加入后每周 {derived.loadAfter} / {derived.capacityWeek} 分钟</span>
      </div>}

      <details className="plan-checks">
        <summary>评审 {passed}/{checks.length} 项通过{autoFixed.length ? ` · 自动修正 ${autoFixed.length} 处` : ''}</summary>
        <ul>
          {checks.map((c) => <li key={c.id} className={c.ok ? 'ok' : 'bad'}>{c.ok ? <Check size={13} /> : <X size={13} />}<span>{c.label}</span><small>{c.detail}</small></li>)}
          {autoFixed.map((fix) => <li key={fix} className="fix"><RotateCcw size={13} /><span>自动修正</span><small>{fix}</small></li>)}
        </ul>
      </details>

      <footer className="plan-refs">
        <BookMarked size={14} />
        {plan.refs.map((key) => <a key={key} href={REFS[key].url} target="_blank" rel="noreferrer" title={REFS[key].finding}>{REFS[key].short}</a>)}
      </footer>
    </article>
  )
}
