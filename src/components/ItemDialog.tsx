import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { localDate } from '@/lib/scheduler'
import type { Item, TaskAnalysis } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: Item | null
  onSave: (item: Item) => void
}

const typeLabels = { once: '一次完成', routine: '周期行动', learning: '学习复习' }

export function ItemDialog({ open, onOpenChange, item, onSave }: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [why, setWhy] = useState('')
  const [type, setType] = useState<Item['type']>('once')
  const [priority, setPriority] = useState<Item['priority']>(2)
  const [intervalDays, setIntervalDays] = useState(3)
  const [dueDate, setDueDate] = useState(localDate())
  const [analysis, setAnalysis] = useState<TaskAnalysis | undefined>()
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const analysisRequest = useRef(0)

  useEffect(() => {
    analysisRequest.current += 1
    if (!open) return
    setName(item?.name ?? '')
    setCategory(item?.category ?? '')
    setWhy(item?.why ?? '')
    setType(item?.type ?? 'once')
    setPriority(item?.priority ?? 2)
    setIntervalDays(item?.type === 'learning' ? item.currentInterval : item?.intervalDays ?? 3)
    setDueDate(item?.dueDate ?? localDate())
    setAnalysis(item?.analysis)
    setAnalyzing(false)
    setError('')
  }, [open, item])

  function chooseType(next: Item['type']) {
    setType(next)
    setIntervalDays(next === 'learning' ? 1 : 3)
    setAnalysis(undefined)
    setError('')
  }

  async function analyze() {
    if (!name.trim()) {
      setError('先写下你想做什么，再进行 AI 分析')
      return
    }
    setAnalyzing(true)
    setError('')
    const requestId = ++analysisRequest.current
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), category: category.trim() || '未分类', why: why.trim(), type, intervalDays: Math.max(1, intervalDays) }),
        signal: AbortSignal.timeout(50_000),
      })
      const result = await response.json().catch(() => ({})) as { analysis?: Omit<TaskAnalysis, 'generatedAt'>; error?: string }
      if (requestId !== analysisRequest.current) return
      if (!response.ok || !result.analysis) throw new Error(result.error || '分析暂时失败，请稍后手动重试')
      const { definition, nextAction, cadence } = result.analysis
      setAnalysis({ definition, nextAction, cadence, generatedAt: new Date().toISOString() })
    } catch (cause) {
      if (requestId === analysisRequest.current) setError(cause instanceof Error ? cause.message : '分析暂时失败，请稍后手动重试')
    } finally {
      if (requestId === analysisRequest.current) setAnalyzing(false)
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('给这件事起一个名字吧')
      return
    }
    const now = new Date().toISOString()
    onSave({
      id: item?.id ?? crypto.randomUUID(),
      name: name.trim(),
      category: category.trim() || '未分类',
      why: why.trim() || undefined,
      type,
      priority,
      intervalDays: Math.max(1, intervalDays),
      currentInterval: type === 'learning' ? Math.max(1, intervalDays) : item?.currentInterval ?? Math.max(1, intervalDays),
      dueDate,
      createdAt: item?.createdAt ?? now,
      lastDoneAt: item?.lastDoneAt,
      completedAt: type === 'once' ? item?.completedAt : undefined,
      paused: item?.paused ?? false,
      overdueDecision: item?.overdueDecision,
      analysis,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-dialog">
        <DialogHeader>
          <p className="section-code">{item ? 'EDIT / 调整任务' : 'NEW / 记下一件事'}</p>
          <DialogTitle className="dialog-title">{item ? '调整这件事' : '现在想做什么？'}</DialogTitle>
          <DialogDescription>项目、学业或一个突发想法都可以。日期只是行动建议，不是截止日期。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          <label className="field-label">任务名称
            <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setAnalysis(undefined) }} placeholder="例如：整理作品集的登陆页" maxLength={60} />
          </label>
          <label className="field-label">为什么想做？（可选，帮助 AI 理解你）
            <textarea value={why} onChange={(e) => { setWhy(e.target.value); setAnalysis(undefined) }} placeholder="例如：想让第一次访问的人更快看懂我做了什么" rows={3} maxLength={800} />
          </label>
          <label className="field-label">分类（可自己创建）
            <input value={category} onChange={(e) => { setCategory(e.target.value); setAnalysis(undefined) }} placeholder="例如：个人项目 / 学业 / 灵感" maxLength={30} />
          </label>
          <fieldset className="field-label">怎样完成这件事？
            <div className="segmented three-options">
              {(Object.keys(typeLabels) as Item['type'][]).map((entry) => <button key={entry} type="button" className={type === entry ? 'selected' : ''} onClick={() => chooseType(entry)}>{typeLabels[entry]}</button>)}
            </div>
          </fieldset>
          <div className="form-grid">
            <label className="field-label">优先级
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Item['priority'])}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
            {type !== 'once' && <label className="field-label">{type === 'learning' ? '首次复习间隔（天）' : '每隔几天做一次'}
              <input type="number" min={1} max={365} value={intervalDays} onChange={(e) => { setIntervalDays(Number(e.target.value)); setAnalysis(undefined) }} required />
            </label>}
          </div>
          <label className="field-label">{type === 'once' ? '建议行动日期' : '首次 / 下次建议日期'}
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          </label>
          {type === 'once' && <p className="form-hint">打卡一次后就完成归档，不再进入行动队列；记录仍会保留。</p>}
          {type === 'learning' && <p className="form-hint">打卡时选择掌握程度，系统会自动缩短或拉长后续间隔。</p>}

          <section className="ai-assist" aria-labelledby="ai-assist-title">
            <div className="ai-assist-heading"><div><Sparkles size={17} /><h3 id="ai-assist-title">AI 任务分析</h3></div><span>可选</span></div>
            <p>只发送此处的任务文字，返回固定的三条简短建议；不会替你修改任务。</p>
            <button type="button" className="button-secondary analyze-button" onClick={analyze} disabled={analyzing}>
              {analyzing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{analyzing ? '正在整理…' : analysis ? '重新分析' : '分析这件事'}
            </button>
            {analysis && <dl className="analysis-preview">
              <div><dt>任务定义</dt><dd>{analysis.definition}</dd></div>
              <div><dt>建议下一步</dt><dd>{analysis.nextAction}</dd></div>
              <div><dt>节奏建议</dt><dd>{analysis.cadence}</dd></div>
            </dl>}
          </section>
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
