import { useState } from 'react'
import { ArrowRight, Bell, BellOff, Check, Download, HardDrive, Info, Plus, Search, Sparkles, Upload } from 'lucide-react'
import { ItemRow } from '@/components/ItemRow'
import { formatDate, isDue, localDate, recommendedItems } from '@/lib/scheduler'
import type { AppData, Item } from '@/types'

interface CommonProps {
  data: AppData
  onCheckIn: (item: Item, detailed?: boolean) => void
}

export function TodayView({ data, onCheckIn, onNew }: CommonProps & { onNew: () => void }) {
  const queue = recommendedItems(data.items)
  const due = queue.filter(isDue)
  const upcoming = queue.filter((item) => !isDue(item)).slice(0, 3)
  const active = data.items.filter((item) => !item.paused && !item.completedAt).length

  return (
    <div className="view today-view">
      <header className="view-heading today-heading">
        <div>
          <p className="section-code">TODAY / {new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
          <h1>现在可以<br />做这些。</h1>
        </div>
        <p className="heading-note">不必一次做完所有事。<br />选一件，开始就好。</p>
      </header>

      <section className="queue-section" aria-labelledby="queue-title">
        <div className="section-heading">
          <div><span className="live-dot" /><h2 id="queue-title">今日行动队列</h2></div>
          <span>{due.length} 项待做</span>
        </div>
        <div className="item-list">
          {due.map((item) => <ItemRow key={item.id} item={item} checkIns={data.checkIns} onCheckIn={onCheckIn} compact />)}
          {!due.length && (
            <div className="empty-state">
              <span className="empty-check"><Check size={28} /></span>
              <h3>{active ? '今天没有到期项目' : '从一件想坚持的事开始'}</h3>
              <p>{active ? '可以看下面的近期安排，或提前完成任何项目。' : '记下一次任务、周期行动或学习内容，下一次打开时，不必再从头想起。'}</p>
              <button className="button-primary" onClick={onNew}><Plus size={18} />{active ? '新建项目' : '创建第一个项目'}</button>
            </div>
          )}
        </div>
      </section>

      {upcoming.length > 0 && <section className="upcoming-section">
        <div className="section-heading"><h2>接下来</h2><span>按建议日期排列</span></div>
        <div className="upcoming-list">
          {upcoming.map((item) => <button key={item.id} onClick={() => onCheckIn(item, item.type === 'learning')}>
            <span><strong>{item.name}</strong><small>{item.category} · {{ once: '一次完成', routine: '周期行动', learning: '学习复习' }[item.type]}</small></span>
            <span>{formatDate(item.dueDate)}<ArrowRight size={17} /></span>
          </button>)}
        </div>
      </section>}
    </div>
  )
}

interface ItemsProps extends CommonProps {
  onNew: () => void
  onEdit: (item: Item) => void
  onTogglePause: (item: Item) => void
  onDelete: (item: Item) => void
}

export function ItemsView({ data, onCheckIn, onNew, onEdit, onTogglePause, onDelete }: ItemsProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部分类')
  const categories = ['全部分类', ...new Set(data.items.map((item) => item.category))]
  const filtered = [
    ...recommendedItems(data.items),
    ...data.items.filter((item) => item.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
  ].filter((item) =>
    (category === '全部分类' || item.category === category) &&
    `${item.name}${item.category}${item.why ?? ''}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="view">
      <header className="view-heading standard-heading"><div><p className="section-code">LIBRARY / 所有行动</p><h1>你的行动清单</h1></div><button className="button-primary" onClick={onNew}><Plus size={18} />新建项目</button></header>
      <div className="filter-bar">
        <label className="search-field"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目" aria-label="搜索项目" /></label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="按分类筛选">{categories.map((entry) => <option key={entry}>{entry}</option>)}</select>
        <span>{filtered.length} 个项目</span>
      </div>
      <div className="item-list all-items-list">
        {filtered.map((item) => <ItemRow key={item.id} item={item} checkIns={data.checkIns} onCheckIn={onCheckIn} onEdit={onEdit} onTogglePause={onTogglePause} onDelete={onDelete} />)}
        {!filtered.length && <div className="empty-state"><h3>{data.items.length ? '没有匹配的项目' : '清单还是空的'}</h3><p>{data.items.length ? '换个关键词或分类试试。' : '先记下一件想做的事，一次完成也可以。'}</p><button className="button-primary" onClick={onNew}><Plus size={18} />新建项目</button></div>}
      </div>
    </div>
  )
}

export function HistoryView({ data }: { data: AppData }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index))
    const key = localDate(date)
    const entries = data.checkIns.filter((entry) => localDate(new Date(entry.doneAt)) === key)
    return { key, label: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date), count: entries.length, minutes: entries.reduce((sum, entry) => sum + (entry.duration ?? 0), 0) }
  })
  const max = Math.max(1, ...days.map((day) => day.count))
  const totalMinutes = data.checkIns.reduce((sum, entry) => sum + (entry.duration ?? 0), 0)
  const logs = [...data.checkIns].sort((a, b) => b.doneAt.localeCompare(a.doneAt))
  return (
    <div className="view">
      <header className="view-heading standard-heading"><div><p className="section-code">TRACE / 行动痕迹</p><h1>做过，就会留下</h1></div><p className="heading-note">不追求完美连续，<br />只看见真实积累。</p></header>
      <section className="history-summary">
        <div><strong>{data.checkIns.length}</strong><span>累计打卡</span></div>
        <div><strong>{totalMinutes}</strong><span>记录分钟</span></div>
        <div><strong>{new Set(data.checkIns.map((entry) => localDate(new Date(entry.doneAt)))).size}</strong><span>行动天数</span></div>
      </section>
      <section className="week-section">
        <div className="section-heading"><h2>最近七天</h2><span>打卡次数</span></div>
        <div className="week-chart" aria-label="最近七天打卡次数柱状图">
          {days.map((day) => <div className="day-column" key={day.key}><span className="bar-value">{day.count || ''}</span><div className="bar-track"><i style={{ transform: `scaleY(${day.count / max})` }} /></div><span>{day.label}</span></div>)}
        </div>
      </section>
      <section className="log-section">
        <div className="section-heading"><h2>打卡记录</h2><span>{logs.length} 条</span></div>
        {logs.length ? <div className="log-list">{logs.map((entry) => {
          const item = data.items.find((candidate) => candidate.id === entry.itemId)
          return <article key={entry.id}><time>{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.doneAt))}</time><div><strong>{item?.name ?? '已删除项目'}</strong>{entry.note && <p>{entry.note}</p>}<span>{entry.duration ? `${entry.duration} 分钟` : '已打卡'}{entry.rating ? ` · ${{ forgot: '忘记', hard: '模糊', good: '记得', easy: '轻松' }[entry.rating]}` : ''}</span></div></article>
        })}</div> : <div className="empty-state compact"><h3>还没有打卡记录</h3><p>完成一次行动后，记录会出现在这里。</p></div>}
      </section>
    </div>
  )
}

interface SettingsProps {
  notificationState: string
  onToggleNotifications: () => void
  onExport: () => void
  onImport: (file: File) => void
  onInstall: () => void
  onReset: () => void
}

export function SettingsView({ notificationState, onToggleNotifications, onExport, onImport, onInstall, onReset }: SettingsProps) {
  return (
    <div className="view settings-view">
      <header className="view-heading standard-heading"><div><p className="section-code">SETTINGS / 偏好与数据</p><h1>让工具适应你</h1></div></header>
      <section className="settings-section">
        <div className="settings-copy"><Bell size={21} /><div><h2>到点提醒</h2><p>应用运行时显示浏览器通知；重新打开时补看遗漏项目。</p></div></div>
        <button className="button-secondary" onClick={onToggleNotifications}>{notificationState === 'granted' ? <BellOff size={17} /> : <Bell size={17} />}{notificationState === 'granted' ? '通知已开启' : '开启浏览器通知'}</button>
      </section>
      <section className="settings-section">
        <div className="settings-copy"><Download size={21} /><div><h2>安装到桌面</h2><p>像普通应用一样打开，支持离线查看与本地打卡。</p></div></div>
        <button className="button-secondary" onClick={onInstall}>安装 / 查看方法</button>
      </section>
      <section className="settings-section vertical">
        <div className="settings-copy"><HardDrive size={21} /><div><h2>本地数据与备份</h2><p>数据只保存在当前浏览器。清除浏览器数据前，请先导出备份。</p></div></div>
        <div className="backup-actions"><button className="button-secondary" onClick={onExport}><Download size={17} />导出备份</button><label className="button-secondary file-button"><Upload size={17} />导入备份<input type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file); e.target.value = '' }} /></label></div>
      </section>
      <section className="learning-note"><Sparkles size={20} /><div><h2>AI 分析与隐私</h2><p>只有点击“分析这件事”时，当前表单中的任务名称、动机、分类和类型才会由服务端发送给模型。AI 只提供三条建议，不会替你打卡或修改间隔；调用可能消耗站点所有者的模型额度，失败也不影响本地使用。</p></div></section>
      <section className="learning-note"><Info size={20} /><div><h2>复习规则为什么不是固定表格？</h2><p>间隔学习让记忆在“快要想不起来”时得到加强；主动回忆则让每次复习成为一次真实提取。这里从短间隔开始，再按你每次的掌握反馈动态调整，而不是机械增加复习次数。</p></div></section>
      <button className="text-danger" onClick={onReset}>清除全部本地数据</button>
    </div>
  )
}
