import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HarnessEvent } from '@contracts/harness'
import { PLAYBOOKS } from '@contracts/playbooks'
import { verdictLabels } from '@/lib/labels'

interface Line { kind: 'stage' | 'info' | 'ok' | 'reject' | 'error'; tag: string; text: string; sub?: string[] }

function toLine(event: HarnessEvent): Line | null {
  switch (event.type) {
    case 'stage': return { kind: 'stage', tag: event.label, text: event.detail ?? '' }
    case 'route': {
      const sub = event.prior.score && event.prior.archetype !== event.decided ? [`关键词先验倾向「${PLAYBOOKS[event.prior.archetype].label}」`] : []
      return { kind: 'ok', tag: '→', text: `${PLAYBOOKS[event.decided].label} · 置信 ${event.route.confidence.toFixed(2)} · ${event.route.reason}`, sub }
    }
    case 'clarify': return { kind: 'info', tag: '?', text: `没把握，先问一句：${event.question}` }
    case 'tool': return { kind: 'info', tag: '读', text: event.label }
    case 'rejected': return { kind: 'reject', tag: '退回', text: `${event.target} 未通过评审，退回修正`, sub: event.errors }
    case 'accepted': return { kind: 'ok', tag: '✓', text: `${event.target} · ${event.label}` }
    case 'agenda': return {
      kind: 'stage', tag: '议程',
      text: event.agenda.length ? `选出 ${event.agenda.length} 件需要评判${event.induce ? '，随后归纳' : ''}` : event.induce ? '只做归纳' : '没有需要评判的事项',
      sub: [...event.agenda.map((a) => `${a.name}：${a.reasons.join('，')}`), ...event.notes],
    }
    case 'judgement': return { kind: 'ok', tag: event.judgement.source === 'model' ? '✓' : '规', text: `评判 → ${verdictLabels[event.judgement.verdict].label} · ${event.judgement.summary}` }
    case 'synthesis': return { kind: 'ok', tag: event.synthesis.source === 'model' ? '✓' : '规', text: `归纳 · ${event.synthesis.headline}` }
    case 'error': return { kind: 'error', tag: '!', text: event.message }
    case 'done': return { kind: 'stage', tag: '完成', text: [event.steps ? `${event.steps} 步` : '', event.durationMs ? `${(event.durationMs / 1000).toFixed(1)} 秒` : '', event.model ?? '规则'].filter(Boolean).join(' · ') }
    default: return null
  }
}

export function HarnessTrace({ events, running, title = '运行过程', defaultOpen = true }: { events: HarnessEvent[]; running: boolean; title?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = events.map(toLine).filter((line): line is Line => line !== null)
  const rejected = events.filter((e) => e.type === 'rejected').length
  if (!lines.length && !running) return null
  return (
    <section className={`trace ${running ? 'is-running' : ''}`} aria-live="polite">
      <button type="button" className="trace-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="trace-pulse" aria-hidden="true" />
        <span>{title}</span>
        <span className="trace-count">{lines.length} 步{rejected ? ` · 退回 ${rejected} 次` : ''}</span>
        <ChevronDown size={15} className="trace-chevron" />
      </button>
      {open && <ol className="trace-lines">
        {lines.map((line, index) => (
          <li key={index} className={`trace-line ${line.kind}`}>
            <span className="trace-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="trace-tag">{line.tag}</span>
            <span className="trace-text">
              {line.text}
              {line.sub && line.sub.length > 0 && <ul>{line.sub.map((s, i) => <li key={i}>{s}</li>)}</ul>}
            </span>
          </li>
        ))}
        {running && <li className="trace-line pending"><span className="trace-index">··</span><span className="trace-tag" /><span className="trace-text">进行中</span></li>}
      </ol>}
    </section>
  )
}
