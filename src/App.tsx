import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CalendarRange, CheckSquare2, Clock3, History, Home, Plus, ScanSearch, Settings } from 'lucide-react'
import type { ReviewResult } from '@contracts/harness'
import { ItemDialog } from '@/components/ItemDialog'
import { CheckInDialog } from '@/components/CheckInDialog'
import { TodayView } from '@/components/TodayView'
import { PlannerDialog } from '@/components/PlannerDialog'
import { ReviewView } from '@/components/ReviewView'
import { HistoryView, ItemsView, SettingsView } from '@/components/Views'
import { EventDialog, HorizonView, PlanTaskDialog, type PlanPayload } from '@/components/HorizonView'
import { buildDigests, buildHorizon, emptyHorizon, markDone, shiftDay, type HorizonEvent, type HorizonSettings, type HorizonState, type PlanTask } from '@contracts/horizon'
import { downloadIcs, horizonInput, horizonSettings, markShown, notify, nowHHMM, registerBackgroundReminders, syncDigests, wasShown } from '@/lib/horizon'
import { useLocalData } from '@/hooks/useLocalData'
import { applyProposal } from '@/lib/apply'
import { buildSnapshot, firstActionsOf, requestReview, requestTake, requestToday, useAiStatus } from '@/lib/harness'
import { allPicks, buildBrief, type TodayBrief } from '@contracts/today'
import { verdictLabels } from '@/lib/labels'
import { addDays, completeItem, isDue, localDate } from '@/lib/scheduler'
import type { CheckIn, Item, View } from '@/types'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'today', label: '今天', icon: Home },
  { id: 'horizon', label: '规划', icon: CalendarRange },
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
  const [takingId, setTakingId] = useState<string | null>(null)
  const ai = useAiStatus()
  const [checkInItem, setCheckInItem] = useState<Item | null>(null)
  const [toast, setToast] = useState('')
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [notificationState, setNotificationState] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [planTask, setPlanTask] = useState<{ task: PlanTask; noteOnly?: boolean } | null>(null)
  const [eventDialog, setEventDialog] = useState(false)
  const [editingEvent, setEditingEvent] = useState<HorizonEvent | null>(null)

  const dueCount = data.items.filter(isDue).length
  const weekCount = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0, 0, 0, 0)
    return data.checkIns.filter((entry) => new Date(entry.doneAt) >= cutoff).length
  }, [data.checkIns])
  // ---- 今天：现在做哪一件（规则即时算；模型排过的当天优先）
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000))
  const [arranging, setArranging] = useState(false)
  const skipKey = `cike.skip.${localDate()}`
  const [skipToday, setSkipToday] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(skipKey) ?? '[]') } catch { return [] } })
  const updateSkip = useCallback((next: string[]) => { setSkipToday(next); try { localStorage.setItem(skipKey, JSON.stringify(next)) } catch { /* 仅本次有效 */ } }, [skipKey])
  // 「今天还有」里手动提上日程的事，当天有效
  const pullKey = `cike.pull.${localDate()}`
  const [pullToday, setPullToday] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(pullKey) ?? '[]') } catch { return [] } })
  const updatePull = useCallback((next: string[]) => { setPullToday(next); try { localStorage.setItem(pullKey, JSON.stringify(next)) } catch { /* 仅本次有效 */ } }, [pullKey])
  useEffect(() => { const timer = window.setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 30_000); return () => window.clearInterval(timer) }, [])
  const todayInput = useMemo(() => ({ snapshot: buildSnapshot(data), skip: skipToday, pull: pullToday, firstActions: firstActionsOf(data) }),
    // minute 让固定时段到点时重新排序
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, skipToday, pullToday, minute])
  const ruleBrief = useMemo(() => buildBrief(todayInput.snapshot, todayInput), [todayInput])
  const candidateIds = useMemo(() => new Set(allPicks(todayInput.snapshot, todayInput).map((p) => p.itemId)), [todayInput])
  const brief: TodayBrief = useMemo(() => {
    const model = data.todayBrief
    // 模型排的结果当天有效；它挑的“现在”做完、换掉或不再可做时，回到规则版
    if (!model || model.date !== localDate() || !model.now || !candidateIds.has(model.now.itemId)) return ruleBrief
    const also = model.also.filter((a) => candidateIds.has(a.itemId))
    return { ...model, also, laterToday: ruleBrief.laterToday, tomorrow: ruleBrief.tomorrow }
  }, [data.todayBrief, ruleBrief, candidateIds])
  const restItems = useMemo(() => {
    const shown = new Set([brief.now?.itemId, ...brief.also.map((a) => a.itemId), ...brief.laterToday.map((l) => l.itemId)])
    return data.items.filter((item) => candidateIds.has(item.id) && !shown.has(item.id))
  }, [brief, candidateIds, data.items])

  // ---- 往前看：今天 / 明天可以规划什么
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hInput = useMemo(() => horizonInput(data), [data, minute])
  const feed = useMemo(() => buildHorizon(hInput), [hInput])
  const tomorrowNames = useMemo(() => {
    const tomorrow = addDays(localDate(), 1)
    return data.items.filter((item) => !item.paused && !item.completedAt && item.dueDate === tomorrow).map((item) => item.name)
  }, [data.items])

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

  // 未来 14 天的提醒写给 Service Worker，应用关着时由系统定时唤醒弹出
  useEffect(() => { void syncDigests(data) }, [data])
  useEffect(() => { if (notificationState === 'granted') void registerBackgroundReminders() }, [notificationState])

  // 每日提醒（早上：今天可以规划什么、先做哪件；晚上：规划明天）。
  // 打开应用时已经过了提醒时间的，你正看着页面，只记为已提醒；开着应用到点了才弹通知。
  const [openedAt] = useState(() => ({ date: localDate(), hm: nowHHMM() }))
  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const entry of buildDigests(hInput, 1)) {
        if (entry.at > nowHHMM() || await wasShown(entry.id) || cancelled) continue
        try { if (localStorage.getItem(`cike.shown.${entry.id}`)) continue; localStorage.setItem(`cike.shown.${entry.id}`, '1') } catch { /* 用缓存里的记录 */ }
        await markShown([entry.id])
        const openedBefore = openedAt.date === entry.date && openedAt.hm >= entry.at
        if (openedBefore || notificationState !== 'granted') continue
        const first = entry.id.endsWith('morning') && brief.now ? `\n先做「${brief.now.name}」，第一步：${brief.now.firstAction}` : ''
        void notify(entry.title, { body: entry.body + first, tag: 'cike-daily' })
      }
    })()
    return () => { cancelled = true }
  }, [hInput, brief.now, notificationState, openedAt])

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
        if (notificationState === 'granted') void notify(`此刻 · ${item.timeSlot}`, { body: `该做「${item.name}」了${item.plan ? `：${item.plan.firstAction}` : ''}`, tag: `cike-slot-${item.id}` })
      }
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [data.items, notificationState])

  function showToast(message: string) { setToast(message) }

  // ---- 往前看
  function updateHorizon(fn: (h: HorizonState) => HorizonState) {
    setData((current) => ({ ...current, horizon: fn(current.horizon ?? emptyHorizon()) }))
  }

  function savePlan(task: PlanTask, payload: PlanPayload, complete: boolean) {
    const today = localDate()
    updateHorizon((h) => {
      let next = h
      if (task.type === 'week') {
        const cutoff = shiftDay(today, -120)
        const weekPlans = Object.fromEntries(Object.entries(h.weekPlans).filter(([key]) => key >= cutoff))
        next = { ...next, weekPlans: { ...weekPlans, [task.target]: { weekStart: task.target, focus: payload.focus ?? '', fun: payload.fun ?? '', savedAt: new Date().toISOString() } } }
      } else if (task.type === 'tomorrow') {
        const cutoff = shiftDay(today, -30)
        const dayNotes = Object.fromEntries(Object.entries(h.dayNotes).filter(([key]) => key >= cutoff))
        if (payload.note) dayNotes[task.target] = payload.note
        next = { ...next, dayNotes }
      } else if (task.event) {
        const event = task.event
        next = event.source === 'user'
          ? { ...next, events: next.events.map((e) => e.id === event.id ? { ...e, note: payload.note } : e) }
          : { ...next, notes: payload.note ? { ...next.notes, [event.id]: payload.note } : Object.fromEntries(Object.entries(next.notes).filter(([key]) => key !== event.id)) }
      }
      return complete ? markDone(next, task, today) : next
    })
    if (complete) showToast(task.type === 'week' ? '这周的规划定下来了' : task.type === 'tomorrow' ? '明天的安排记下了，明早打开就能看到' : `「${task.title}」规划好了`)
  }

  function saveEvent(event: HorizonEvent) {
    const isNew = !data.horizon?.events.some((e) => e.id === event.id)
    updateHorizon((h) => ({ ...h, events: isNew ? [...h.events, event] : h.events.map((e) => e.id === event.id ? event : e) }))
    const points = event.leads.map((lead) => addDays(event.date, -lead)).filter((d) => d >= localDate()).map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`)
    showToast(isNew ? `已加入「${event.name}」${points.length ? `，会在 ${points.join('、')} 提醒你规划` : ''}` : '已更新')
  }

  function deleteEvent(event: HorizonEvent) {
    if (!window.confirm(`删除「${event.name}」吗？`)) return
    updateHorizon((h) => ({ ...h, events: h.events.filter((e) => e.id !== event.id) }))
    showToast('已删除')
  }

  function dismissFestival(event: HorizonEvent) {
    updateHorizon((h) => ({ ...h, dismissed: [...new Set([...h.dismissed, event.id])] }))
    showToast(`今年的${event.name}不再提醒`)
  }

  function setHorizonSettings(patch: Partial<HorizonSettings>) {
    setData((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
  }

  function exportIcs() {
    downloadIcs(data)
    showToast('已导出：用手机打开这个文件，加入日历后会准点提醒')
  }

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
    const item = data.items.find((entry) => entry.id === checkIn.itemId)
    if (!item) return
    const next = { ...data, checkIns: [...data.checkIns, checkIn], items: data.items.map((entry) => entry.id === item.id ? completeItem(item, checkIn.rating, new Date(checkIn.doneAt)) : entry) }
    setData(next)
    setCheckInItem(null)
    // 做完一件，直接告诉下一件是什么
    const following = buildBrief(buildSnapshot(next), { skip: skipToday, pull: pullToday, firstActions: firstActionsOf(next) }).now
    const done = checkIn.rating ? '已记录，复习间隔已调整' : '做完了'
    showToast(following ? `${done} · 下一件：${following.name}` : `${done} · 今天的都做完了`)
  }

  function swapNow(itemId: string) {
    updateSkip([...skipToday, itemId])
  }

  function pullForward(item: Item) {
    updatePull([...pullToday.filter((id) => id !== item.id), item.id])
    if (skipToday.includes(item.id)) updateSkip(skipToday.filter((id) => id !== item.id))
    // 模型排过的“现在”会盖住规则版，提上日程后以用户的选择为准
    setData((current) => ({ ...current, todayBrief: undefined }))
    showToast(`「${item.name}」提上日程，现在就做`)
  }

  async function takeItem(item: Item) {
    if (takingId) return
    setTakingId(item.id)
    try {
      const plan = item.plan ? `${item.plan.method}；第一步：${item.plan.firstAction}；步骤：${item.plan.steps.map((step) => step.title).join(' → ')}`.slice(0, 600) : undefined
      const { text, error } = await requestTake({ itemId: item.id, snapshot: buildSnapshot(data), plan })
      if (text) setData((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, take: { text, generatedAt: new Date().toISOString() } } : entry) }))
      else showToast(error ?? '大肥鱼这次没想好')
    } finally {
      setTakingId(null)
    }
  }

  function notToday(item: Item) {
    setData((current) => ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, dueDate: addDays(localDate(), 1), overdueDecision: undefined } : entry) }))
    showToast(`「${item.name}」挪到明天`)
  }

  async function arrangeToday() {
    setArranging(true)
    try {
      const { brief: arranged, error } = await requestToday(todayInput)
      setData((current) => ({ ...current, todayBrief: arranged }))
      if (error) showToast(error)
      else if (arranged.source !== 'model') showToast('可选的事不多，按规则排就够了')
    } finally {
      setArranging(false)
    }
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

  async function toggleNotifications() {
    if (typeof Notification === 'undefined') { showToast('当前浏览器不支持系统通知'); return }
    if (Notification.permission === 'granted') { showToast('通知已开启，可在浏览器站点设置中关闭'); return }
    if (Notification.permission === 'denied') { showToast('通知被浏览器阻止，请在站点设置中允许'); return }
    const permission = await Notification.requestPermission()
    setNotificationState(permission)
    if (permission === 'granted') void registerBackgroundReminders()
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
        {view === 'today' && <TodayView data={data} feed={feed} onPlan={(task) => setPlanTask({ task })} brief={brief} restItems={restItems} ai={ai} arranging={arranging} skippedCount={skipToday.length} onArrange={() => void arrangeToday()} onDone={(item) => requestCheckIn(item, item.type === 'learning')} onCheckIn={requestCheckIn} onSwap={swapNow} onNotToday={notToday} onPull={pullForward} onResetSkip={() => updateSkip([])} onNew={openNew} {...judgeProps} />}
        {view === 'horizon' && <HorizonView feed={feed} weekPlans={data.horizon?.weekPlans ?? {}} onPlan={(task) => setPlanTask({ task })} onNote={(event) => setPlanTask({ task: { key: `note:${event.id}`, type: 'event', title: event.name, hint: '', date: localDate(), target: event.date, daysLeft: feed.upcoming.find((r) => r.event.id === event.id)?.daysLeft ?? 0, lateDays: 0, kind: event.kind, event }, noteOnly: true })} onNewEvent={() => { setEditingEvent(null); setEventDialog(true) }} onEditEvent={(event) => { setEditingEvent(event); setEventDialog(true) }} onDeleteEvent={deleteEvent} onDismiss={dismissFestival} onExportIcs={exportIcs} />}
        {view === 'items' && <ItemsView data={data} canTake={Boolean(ai?.configured)} onTake={(item) => void takeItem(item)} takingId={takingId} onCheckIn={requestCheckIn} onNew={openNew} onEdit={(item) => { setDraft(null); setEditingItem(item); setItemDialog(true) }} onTogglePause={togglePause} onDelete={deleteItem} {...judgeProps} />}
        {view === 'review' && <ReviewView data={data} ai={ai} onSave={saveReview} onApply={applyJudgement} onDismiss={dismissJudgement} onCheckIn={requestCheckIn} />}
        {view === 'history' && <HistoryView data={data} />}
        {view === 'settings' && <SettingsView horizon={horizonSettings(data.settings)} onHorizon={setHorizonSettings} notificationState={notificationState} capacity={data.settings.capacityMinutesPerDay} ai={ai} onCapacity={setCapacity} onToggleNotifications={toggleNotifications} onExport={exportData} onImport={handleImport} onInstall={installApp} onReset={resetData} />}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">{navItems.map((entry) => <button key={entry.id} className={view === entry.id ? 'active' : ''} onClick={() => setView(entry.id)}><entry.icon size={20} /><span>{entry.label}</span>{entry.id === 'today' && dueCount > 0 && <b>{dueCount}</b>}</button>)}</nav>

      <PlannerDialog open={plannerOpen} onOpenChange={setPlannerOpen} data={data} ai={ai} onCreate={createFromPlan} onManual={openManual} />
      <ItemDialog open={itemDialog} onOpenChange={setItemDialog} item={editingItem} draft={draft} onSave={saveItem} />
      <PlanTaskDialog task={planTask?.task ?? null} noteOnly={planTask?.noteOnly} input={hInput} tomorrowNames={tomorrowNames} onOpenChange={(open) => { if (!open) setPlanTask(null) }} onSave={savePlan} onDismiss={dismissFestival} />
      <EventDialog open={eventDialog} event={editingEvent} onOpenChange={setEventDialog} onSave={saveEvent} />
      <CheckInDialog item={checkInItem} onOpenChange={(open) => { if (!open) setCheckInItem(null) }} onSave={saveCheckIn} />
      {toast && <div className="toast" role="status"><Clock3 size={17} />{toast}</div>}
      <div className="date-watermark" aria-hidden="true"><CalendarDays size={14} />{localDate().replaceAll('-', ' / ')}</div>
    </div>
  )
}
