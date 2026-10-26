import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckSquare2, Clock3, History, Home, Plus, ScanSearch, Settings } from 'lucide-react'
import type { ReviewResult } from '@contracts/harness'
import { ItemDialog } from '@/components/ItemDialog'
import { CheckInDialog } from '@/components/CheckInDialog'
import { OverdueDialog } from '@/components/OverdueDialog'
import { PlannerDialog } from '@/components/PlannerDialog'
import { ReviewView } from '@/components/ReviewView'
import { HistoryView, ItemsView, SettingsView, TodayView } from '@/components/Views'
import { useLocalData } from '@/hooks/useLocalData'
import { applyProposal } from '@/lib/apply'
import { buildSnapshot, requestReview, useAiStatus } from '@/lib/harness'
import { verdictLabels } from '@/lib/labels'
import { addDays, completeItem, isDue, isOverdue, localDate } from '@/lib/scheduler'
import type { CheckIn, Item, View } from '@/types'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'today', label: '今天', icon: Home },
  { id: 'items', label: '项目', icon: CheckSquare2 },
  { id: 'review', label: '复盘', icon: ScanSearch },
  { id: 'history', label: '记录', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
]

export default function App() {
  const { data, setData, exportData, importData } = useLocalData()
  const [view, setView] = useState<View>('today')
  const [itemDialog, setItemDialog] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [draft, setDraft] = useState<Partial<Item> | null>(null)
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [judgingId, setJudgingId] = useState<string | null>(null)
  const ai = useAiStatus()
  const [checkInItem, setCheckInItem] = useState<Item | null>(null)
  const [toast, setToast] = useState('')
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [notificationState, setNotificationState] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

  const dueCount = data.items.filter(isDue).length
  const weekCount = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0, 0, 0, 0)
    return data.checkIns.filter((entry) => new Date(entry.doneAt) >= cutoff).length
  }, [data.checkIns])
  const pendingOverdue = data.items.filter((item) => isOverdue(item) && item.overdueDecision !== item.dueDate)

  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (notificationState !== 'granted' || dueCount === 0) return
    const key = `cike.notified.${localDate()}`
    try {
      if (localStorage.getItem(key)) return
      new Notification('此刻 · 今天可以做这些', { body: `有 ${dueCount} 个项目到了建议时间。选一件开始就好。`, tag: 'cike-daily' })
      localStorage.setItem(key, '1')
    } catch { /* 存储不可用时不重复提醒也无妨 */ }
  }, [dueCount, notificationState])

  // 固定时段提醒：到点后一小时内提醒一次（应用开着时有效）
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const minutes = now.getHours() * 60 + now.getMinutes()
      for (const item of data.items) {
        if (!item.timeSlot || !isDue(item)) continue
        const [h, m] = item.timeSlot.split(':').map(Number)
        const late = minutes - (h * 60 + m)
        if (late < 0 || late > 60) continue
        const key = `cike.slot.${item.id}.${localDate()}`
        try {
          if (localStorage.getItem(key)) continue
          localStorage.setItem(key, '1')
        } catch { continue }
        setToast(`${item.timeSlot} · 该做「${item.name}」了`)
        if (notificationState === 'granted') new Notification(`此刻 · ${item.timeSlot}`, { body: `该做「${item.name}」了${item.plan ? `：${item.plan.firstAction}` : ''}`, tag: `cike-slot-${item.id}` })
      }
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [data.items, notificationState])

  function showToast(message: string) { setToast(message) }

  function openNew() {
    setPlannerOpen(true)
  }

  function openManual(prefill?: Partial<Item>) {
    setEditingItem(null)
    setDraft(prefill ?? null)
    setItemDialog(true)
  }

  function createFromPlan(item: Item) {
    setData((current) => ({ ...current, items: [...current.items, item] }))
    showToast(item.plan ? `已加入 · 现在就做：${item.plan.firstAction}` : '已加入行动队列')
  }

  function saveReview(result: ReviewResult) {
    setData((current) => {
      const byId = new Map(result.judgements.map((j) => [j.itemId, j]))
      return {
        ...current,
        review: result.mode === 'single' ? current.review : result,
        items: current.items.map((item) => {
          const j = byId.get(item.id)
          return j ? { ...item, judgement: { ...j, generatedAt: result.generatedAt } } : item
        }),
      }
    })
  }

  async function judgeItem(item: Item) {
    if (judgingId) return
    setJudgingId(item.id)
    try {
      await requestReview({ mode: 'single', itemId: item.id, snapshot: buildSnapshot(data) }, (event) => {
        if (event.type !== 'review') return
        saveReview(event.result)
        const j = event.result.judgements[0]
        showToast(j ? `「${item.name}」：${verdictLabels[j.verdict].label} · ${j.summary}` : '这件事暂时没有可评判的信号')
      })
    } catch {
      showToast('评判失败，请稍后再试')
    } finally {
      setJudgingId(null)
    }
  }

  function applyJudgement(itemId: string) {
    const proposal = data.items.find((item) => item.id === itemId)?.judgement?.proposal
    if (!proposal) return
    const { message } = applyProposal(data, itemId, proposal)
    setData((current) => applyProposal(current, itemId, proposal).data)
    showToast(message)
  }

  function dismissJudgement(itemId: string) {
    setData((current) => ({ ...current, items: current.items.map((item) => item.id === itemId && item.judgement ? { ...item, judgement: { ...item.judgement, resolved: 'dismissed' } } : item) }))
  }

  function setCapacity(minutes: number) {
    if (!Number.isFinite(minutes)) return
    setData((current) => ({ ...current, settings: { ...current.settings, capacityMinutesPerDay: Math.min(960, Math.max(15, Math.round(minutes))) } }))
  }

  function saveItem(item: Item) {
    setData((current) => ({ ...current, items: current.items.some((entry) => entry.id === item.id) ? current.items.map((entry) => entry.id === item.id ? item : entry) : [...current.items, item] }))
    showToast(editingItem ? '项目已更新' : '已加入行动队列')
  }

  function requestCheckIn(item: Item, detailed = false) {
    if (detailed) { setCheckInItem(item); return }
    const checkIn: CheckIn = { id: crypto.randomUUID(), itemId: item.id, doneAt: new Date().toISOString() }
    saveCheckIn(checkIn)
  }

  function saveCheckIn(checkIn: CheckIn) {
    setData((current) => {
      const item = current.items.find((entry) => entry.id === checkIn.itemId)
      if (!item) return current
      return { ...current, checkIns: [...current.checkIns, checkIn], items: current.items.map((entry) => entry.id === item.id ? completeItem(item, checkIn.rating, new Date(checkIn.doneAt)) : entry) }
    })
    setCheckInItem(null)
    showToast(checkIn.rating ? '已记录，下次复习间隔已调整' : '已完成，记录已经留下')
  }

  function togglePause(item: Item) {
    setData((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, paused: !entry.paused } : entry) }))
    showToast(item.paused ? '项目已恢复' : '项目已暂停')
  }

  function deleteItem(item: Item) {
    if (!window.confirm(`确定删除“${item.name}”及其打卡记录吗？`)) return
    setData((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id), checkIns: current.checkIns.filter((entry) => entry.itemId !== item.id) }))
    showToast('项目已删除')
  }

  function resolveOverdue(item: Item, postpone: boolean) {
    setData((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...item, dueDate: postpone ? addDays(localDate(), 1) : item.dueDate, overdueDecision: postpone ? undefined : item.dueDate } : entry) }))
    showToast(postpone ? '已顺延到明天' : '已保留在行动队列')
  }

  async function toggleNotifications() {
    if (typeof Notification === 'undefined') { showToast('当前浏览器不支持系统通知'); return }
    if (Notification.permission === 'granted') { showToast('通知已开启，可在浏览器站点设置中关闭'); return }
    if (Notification.permission === 'denied') { showToast('通知被浏览器阻止，请在站点设置中允许'); return }
    const permission = await Notification.requestPermission()
    setNotificationState(permission)
    showToast(permission === 'granted' ? '浏览器通知已开启' : '未开启通知，网页内提醒仍然有效')
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt()
      const result = await installPrompt.userChoice
      if (result.outcome === 'accepted') showToast('安装请求已确认')
      setInstallPrompt(null)
      return
    }
    showToast('请使用浏览器菜单中的“安装应用”或“添加到主屏幕”')
  }

  async function handleImport(file: File) {
    try { await importData(file); showToast('备份已恢复') } catch { showToast('无法导入：请选择有效的此刻备份文件') }
  }

  function resetData() {
    if (!window.confirm('确定清除所有项目和打卡记录吗？建议先导出备份。')) return
    setData((current) => ({ version: 3, items: [], checkIns: [], settings: current.settings }))
    setView('today')
    showToast('本地数据已清除')
  }

  const judgeProps = { onJudge: judgeItem, onApply: applyJudgement, onDismiss: dismissJudgement, judgingId }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-symbol" aria-hidden="true">＋<br />＋＋</span><div><strong>此刻</strong><small>CIKE / PERSONAL</small></div></div>
        <div className="sidebar-intro"><p>把想做的事放在这里。<br />有空时，不必再从头想起。</p></div>
        <nav className="side-nav" aria-label="主导航">
          {navItems.map((entry) => <button key={entry.id} className={view === entry.id ? 'active' : ''} onClick={() => setView(entry.id)}><entry.icon size={18} /><span>{entry.label}</span>{entry.id === 'today' && dueCount > 0 && <b>{dueCount}</b>}</button>)}
        </nav>
        <div className="sidebar-stats">
          <div><span>今日待做</span><strong>{String(dueCount).padStart(2, '0')}</strong></div>
          <div><span>近 7 天打卡</span><strong>{String(weekCount).padStart(2, '0')}</strong></div>
        </div>
        <button className="sidebar-add" onClick={openNew}><Plus size={19} />新建项目</button>
        <div className="local-status"><span /><div>本地自动保存<small>数据仅在这台设备</small></div></div>
      </aside>

      <header className="mobile-header"><div className="mobile-brand"><span>＋＋</span><strong>此刻</strong></div><button className="icon-button" onClick={openNew} aria-label="新建项目"><Plus size={21} /></button></header>

      <main className="main-content">
        {view === 'today' && <TodayView data={data} onCheckIn={requestCheckIn} onNew={openNew} {...judgeProps} />}
        {view === 'items' && <ItemsView data={data} onCheckIn={requestCheckIn} onNew={openNew} onEdit={(item) => { setDraft(null); setEditingItem(item); setItemDialog(true) }} onTogglePause={togglePause} onDelete={deleteItem} {...judgeProps} />}
        {view === 'review' && <ReviewView data={data} ai={ai} onSave={saveReview} onApply={applyJudgement} onDismiss={dismissJudgement} onCheckIn={requestCheckIn} />}
        {view === 'history' && <HistoryView data={data} />}
        {view === 'settings' && <SettingsView notificationState={notificationState} capacity={data.settings.capacityMinutesPerDay} ai={ai} onCapacity={setCapacity} onToggleNotifications={toggleNotifications} onExport={exportData} onImport={handleImport} onInstall={installApp} onReset={resetData} />}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">{navItems.map((entry) => <button key={entry.id} className={view === entry.id ? 'active' : ''} onClick={() => setView(entry.id)}><entry.icon size={20} /><span>{entry.label}</span>{entry.id === 'today' && dueCount > 0 && <b>{dueCount}</b>}</button>)}</nav>

      <PlannerDialog open={plannerOpen} onOpenChange={setPlannerOpen} data={data} ai={ai} onCreate={createFromPlan} onManual={openManual} />
      <ItemDialog open={itemDialog} onOpenChange={setItemDialog} item={editingItem} draft={draft} onSave={saveItem} />
      <CheckInDialog item={checkInItem} onOpenChange={(open) => { if (!open) setCheckInItem(null) }} onSave={saveCheckIn} />
      <OverdueDialog items={pendingOverdue} onKeep={(item) => resolveOverdue(item, false)} onPostpone={(item) => resolveOverdue(item, true)} />
      {toast && <div className="toast" role="status"><Clock3 size={17} />{toast}</div>}
      <div className="date-watermark" aria-hidden="true"><CalendarDays size={14} />{localDate().replaceAll('-', ' / ')}</div>
    </div>
  )
}
