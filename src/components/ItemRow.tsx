import { BookOpen, Check, CheckCheck, MoreHorizontal, Pencil, Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import { formatDate, itemStatus, streakFor } from '@/lib/scheduler'
import type { CheckIn, Item } from '@/types'

interface Props {
  item: Item
  checkIns: CheckIn[]
  onCheckIn: (item: Item, detailed?: boolean) => void
  onEdit?: (item: Item) => void
  onTogglePause?: (item: Item) => void
  onDelete?: (item: Item) => void
  compact?: boolean
}

const priorityLabels = { 1: '高优先级', 2: '中优先级', 3: '低优先级' }
const typeLabels = { once: '一次完成', routine: '周期行动', learning: '学习复习' }

export function ItemRow({ item, checkIns, onCheckIn, onEdit, onTogglePause, onDelete, compact = false }: Props) {
  const status = itemStatus(item)
  const streak = streakFor(item.id, checkIns)
  const Icon = item.completedAt ? CheckCheck : item.type === 'learning' ? BookOpen : item.type === 'once' ? Check : RotateCcw
  return (
    <article className={`item-row ${item.paused ? 'is-paused' : ''} ${item.completedAt ? 'is-completed' : ''}`}>
      <div className="item-marker" aria-hidden="true"><Icon size={19} /></div>
      <div className="item-main">
        <div className="item-eyebrow"><span>{item.category}</span><span>{typeLabels[item.type]}</span></div>
        <h3>{item.name}</h3>
        {item.why && <p className="item-why">{item.why}</p>}
        <div className="item-meta">
          <span>{priorityLabels[item.priority]}</span>
          <span>上次 {item.lastDoneAt ? formatDate(item.lastDoneAt.slice(0, 10)) : '尚未打卡'}</span>
          {!compact && !item.completedAt && <span>{item.type === 'once' ? '建议' : '下次'} {formatDate(item.dueDate)}</span>}
          {streak > 1 && <span>连续 {streak} 天</span>}
        </div>
        {!compact && item.analysis && <section className="item-analysis" aria-label={`${item.name}的 AI 任务分析`}>
          <h4>AI 任务分析 <span>建议可按实际情况调整</span></h4>
          <dl><div><dt>任务定义</dt><dd>{item.analysis.definition}</dd></div><div><dt>建议下一步</dt><dd>{item.analysis.nextAction}</dd></div><div><dt>节奏建议</dt><dd>{item.analysis.cadence}</dd></div></dl>
        </section>}
      </div>
      <div className="item-side">
        <span className={`status-tag ${status.tone}`}><i />{status.label}</span>
        <div className="item-actions">
          {!item.paused && !item.completedAt && <button className="check-button" onClick={() => onCheckIn(item, item.type === 'learning')}><Check size={18} />{item.type === 'learning' ? '回忆并打卡' : item.type === 'once' ? '完成' : '打卡'}</button>}
          {!item.paused && !item.completedAt && item.type !== 'learning' && <button className="icon-button" aria-label={`为${item.name}补充打卡记录`} title="补充时长或备注" onClick={() => onCheckIn(item, true)}><MoreHorizontal size={19} /></button>}
          {onEdit && <button className="icon-button" aria-label={`编辑${item.name}`} onClick={() => onEdit(item)}><Pencil size={17} /></button>}
          {onTogglePause && item.type !== 'once' && !item.completedAt && <button className="icon-button" aria-label={item.paused ? `恢复${item.name}` : `暂停${item.name}`} onClick={() => onTogglePause(item)}>{item.paused ? <Play size={17} /> : <Pause size={17} />}</button>}
          {onDelete && <button className="icon-button danger" aria-label={`删除${item.name}`} onClick={() => onDelete(item)}><Trash2 size={17} /></button>}
        </div>
      </div>
    </article>
  )
}
