import { useState } from 'react'
import { CloudDownload, RefreshCw, Server } from 'lucide-react'
import type { SyncState } from '@/lib/sync'

interface Props {
  state: SyncState
  onEnable: (on: boolean) => void
  onToken: (token: string) => void
  onSyncNow: () => void
}

const time = (iso?: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** 同步到你自己的服务端（可以就是手机），服务端每 10 分钟留一份快照 */
export function SyncSettings({ state, onEnable, onToken, onSyncNow }: Props) {
  const [token, setToken] = useState(state.token)
  const { server } = state

  async function downloadLatest() {
    const auth: Record<string, string> = state.token ? { Authorization: `Bearer ${state.token}` } : {}
    const list = await fetch('api/sync/backups', { headers: auth }).then((r) => r.ok ? r.json() : []).catch(() => []) as { name: string }[]
    if (!list.length) return
    const blob = await fetch(`api/sync/backups/${list[0].name}`, { headers: auth }).then((r) => r.blob())
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cike-${list[0].name}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="settings-section vertical sync-settings">
      <div className="settings-copy"><Server size={21} /><div>
        <h2>同步与自动备份</h2>
        {!server && <p>要同步，应用得从你自己的服务端打开，比如手机上跑的「此刻」服务端（打开 http://localhost:3000）。GitHub Pages 上的版本是纯网页，没有服务端，数据只在这个浏览器里，记得常导出备份。做法见仓库里的 <code>docs/手机当服务器.md</code>。</p>}
        {server && !server.authorized && <p>这台服务端需要口令才能同步（它 .env 里的 SYNC_TOKEN）。在服务端本机打开不需要口令。</p>}
        {server?.authorized && <p>开启后，每次改动都会存到这台服务端；服务端每 10 分钟最多留一份快照，2 天内的全留，之后每天留一份，保留 90 天。别的设备从同一个地址打开、开启同步，就能看到同一份数据。</p>}
      </div></div>

      {server && !server.authorized && <div className="sync-row">
        <label className="field-label sync-token">口令
          <input id="sync-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="SYNC_TOKEN" autoComplete="off" />
        </label>
        <button className="button-secondary" onClick={() => onToken(token)}>连接</button>
      </div>}

      {server?.authorized && <>
        <label className="horizon-toggle sync-toggle"><input type="checkbox" checked={state.enabled} onChange={(e) => onEnable(e.target.checked)} />同步到这台服务端</label>
        <dl className="sync-status">
          <div><dt>状态</dt><dd className={state.phase}>{!state.enabled ? '没开' : state.phase === 'syncing' ? '同步中…' : state.phase === 'error' ? state.message ?? '出错了' : '已同步'}</dd></div>
          <div><dt>上次同步</dt><dd>{time(state.lastSyncAt)}</dd></div>
          <div><dt>服务端版本</dt><dd>第 {server.rev ?? 0} 版{server.device ? `（${server.device}）` : ''}</dd></div>
          <div><dt>快照</dt><dd>{server.backups ?? 0} 份 · 最新 {time(server.latestBackup)}</dd></div>
          {server.dataDir && <div><dt>存放位置</dt><dd><code>{server.dataDir}</code></dd></div>}
        </dl>
        <div className="backup-actions">
          <button className="button-secondary" onClick={onSyncNow} disabled={!state.enabled || state.phase === 'syncing'}><RefreshCw size={16} />立即同步</button>
          <button className="button-secondary" onClick={() => void downloadLatest()} disabled={!server.backups}><CloudDownload size={16} />下载最新快照</button>
        </div>
      </>}
    </section>
  )
}
