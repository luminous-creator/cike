import { BookOpen, Check, CheckCheck, Clock3, Crosshair, LoaderCircle, MoreHorizontal, Pencil, Pause, Play, RotateCcw, ScanSearch, Trash2 } from 'lucide-react'
import { REFS } from '@contracts/playbooks'
import { describeProposal } from '@/lib/apply'
import { archetypeLabel, scheduleText, verdictLabels } from '@/lib/labels'
import { formatDate, itemStatus, streakFor } from '@/lib/scheduler'
import type { CheckIn, Item } from '@/types'

interface Props {
  item: Item
  checkIns: CheckIn[]
  onCheckIn: (item: Item, detailed?: boolean) => void
  onEdit?: (item: Item) => void
  onTogglePause?: (item: Item) => void
  onDelete?: (item: Item) => void
  onJudge?: (item: Item) => void
  onApply?: (itemId: string) => void
  onDismiss?: (itemId: string) => void
  judging?: boolean
  focus?: boolean
  compact?: boolean
}

const priorityLabels = { 1: '高优先级', 2: '中优先级', 3: '低优先级' }
const typeLabels = { once: '一次完成', routine: '周期行动', learning: '学习复习' }

export function ItemRow({ item, checkIns, onCheckIn, onEdit, onTogglePause, onDelete, onJudge, onApply, onDismiss, judging = false, focus = false, compact = false }: Props) {
  const status = itemStatus(item)
  const streak = streakFor(item.id, checkIns)
  const Icon = item.completedAt ? CheckCheck : item.type === 'learning' ? BookOpen : item.type === 'once' ? Check : RotateCcw
  const schedule = scheduleText(item)
  const judgement = item.judgement
  const verdict = judgement ? verdictLabels[judgement.verdict] : null
  return (
    <article className={`item-row ${item.paused ? 'is-paused' : ''} ${item.completedAt ? 'is-completed' : ''}`}>
      <div className="item-marker" aria-hidden="true"><Icon size={19} /></div>
      <div className="item-main">
        <div className="item-eyebrow">
          <span>{item.category}</span>
          <span>{item.archetype ? archetypeLabel(item.archetype) : typeLabels[item.type]}</span>
          {focus && <span className="focus-tag"><Crosshair size={11} />焦点</span>}
        </div>
        <h3>{item.name}</h3>
        {item.why && !item.plan && <p className="item-why">{item.why}</p>}
        <div className="item-meta">
          {schedule && <span className="item-schedule"><Clock3 size={12} />{schedule}</span>}
          <span>{priorityLabels[item.priority]}</span>
          <span>上次 {item.lastDoneAt ? formatDate(item.lastDoneAt.slice(0, 10)) : '尚未打卡'}</span>
          {!compact && !item.completedAt && <span>{item.type === 'once' ? '建议' : '下次'} {formatDate(item.dueDate)}</span>}
          {item.deadline && !item.completedAt && <span>截止 {formatDate(item.deadline)}</span>}
          {streak > 1 && <span>连续 {streak} 天</span>}
        </div>

        {item.plan && !item.completedAt && <div className="item-plan">
          <p className="item-plan-method">{item.plan.method}</p>
          {!compact && <p className="item-plan-ifthen">{item.plan.ifThen}</p>}
          {!compact && <details>
            <summary>展开方案</summary>
            <ol>{item.plan.steps.map((step, i) => <li key={i}>{step.title}{step.minutes ? ` · ${step.minutes} 分钟` : ''}</li>)}</ol>
            <p><strong>错过时：</strong>{item.plan.fallback}</p>
            <p className="item-plan-refs">{item.plan.refs.map((key) => <a key={key} href={REFS[key]?.url} target="_blank" rel="noreferrer" title={REFS[key]?.finding}>{REFS[key]?.short}</a>)}</p>
          </details>}
        </div>}

        {judgement && verdict && !item.completedAt && <div className="item-judgement">
          <span className={`verdict ${verdict.tone}`}>{verdict.label}</span>
          <span className="item-judgement-text">{judgement.summary}{!compact && <> · <em>{judgement.nextAction}</em></>}</span>
          {judgement.proposal && !judgement.resolved && onApply && <span className="item-judgement-actions">
            <button className="text-button" onClick={() => onApply(item.id)}>{describeProposal(judgement.proposal)}</button>
            {onDismiss && <button className="text-button muted" onClick={() => onDismiss(item.id)} aria-label="忽略提议">忽略</button>}
          </span>}
        </div>}

        {!compact && !item.plan && item.analysis && <section className="item-analysis" aria-label={`${item.name}的 AI 任务分析`}>
          <h4>AI 任务分析 <span>建议可按实际情况调整</span></h4>
          <dl><div><dt>任务定义</dt><dd>{item.analysis.definition}</dd></div><div><dt>建议下一步</dt><dd>{item.analysis.nextAction}</dd></div><div><dt>节奏建议</dt><dd>{item.analysis.cadence}</dd></div></dl>
        </section>}
      </div>
      <div className="item-side">
        <span className={`status-tag ${status.tone}`}><i />{status.label}</span>
        <div className="item-actions">
          {!item.paused && !item.completedAt && <button className="check-button" onClick={() => onCheckIn(item, item.type === 'learning')}><Check size={18} />{item.type === 'learning' ? '回忆并打卡' : item.type === 'once' ? '完成' : '打卡'}</button>}
          {!item.paused && !item.completedAt && item.type !== 'learning' && <button className="icon-button" aria-label={`为${item.name}补充打卡记录`} title="补充时长或备注" onClick={() => onCheckIn(item, true)}><MoreHorizontal size={19} /></button>}
          {onJudge && !item.completedAt && <button className="icon-button" aria-label={`评判${item.name}`} title="评判这件事" onClick={() => onJudge(item)} disabled={judging}>{judging ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}</button>}
          {onEdit && <button className="icon-button" aria-label={`编辑${item.name}`} title="编辑" onClick={() => onEdit(item)}><Pencil size={17} /></button>}
          {onTogglePause && item.type !== 'once' && !item.completedAt && <button className="icon-button" aria-label={item.paused ? `恢复${item.name}` : `暂停${item.name}`} title={item.paused ? '恢复' : '暂停'} onClick={() => onTogglePause(item)}>{item.paused ? <Play size={17} /> : <Pause size={17} />}</button>}
          {onDelete && <button className="icon-button danger" aria-label={`删除${item.name}`} title="删除" onClick={() => onDelete(item)}><Trash2 size={17} /></button>}
        </div>
      </div>
    </article>
  )
}
