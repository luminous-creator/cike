// 同步到“自己的服务端”（可以就是手机上跑的 Node）：
//   打开 / 回到前台 / 每分钟拉一次；本机一改动 1.5 秒后推上去。
//   推的时候带上次看到的版本号，服务端发现版本变了就返回 409 和它的数据，这边合并后再推。
// 只在应用是从这台服务端打开时可用（同源），本机访问不用口令，其他设备填 SYNC_TOKEN。
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseData } from '@/hooks/useLocalData'
import { mergeData } from '@/lib/syncMerge'
import type { AppData } from '@/types'

const KEY = 'cike.sync.v1'

/** pending：本机有还没推上去的改动（关掉应用也记得） */
interface SyncConfig { enabled: boolean; token?: string; rev: number; lastSyncAt?: string; device: string; pending?: boolean }

function loadConfig(): SyncConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SyncConfig> | null
    if (raw && typeof raw.device === 'string') return { enabled: Boolean(raw.enabled), token: raw.token, rev: Number(raw.rev) || 0, lastSyncAt: raw.lastSyncAt, device: raw.device, pending: Boolean(raw.pending) }
  } catch { /* 用默认 */ }
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const device = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? '安卓手机' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows 电脑' : '这台设备'
  return { enabled: false, rev: 0, device }
}
function saveConfig(config: SyncConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(config)) } catch { /* 忽略 */ }
}

export interface ServerStatus { available: boolean; authorized: boolean; needsToken?: boolean; tokenConfigured?: boolean; rev?: number; updatedAt?: string | null; device?: string | null; backups?: number; latestBackup?: string | null; dataDir?: string }
export interface SyncState {
  server: ServerStatus | null
  enabled: boolean
  token: string
  phase: 'idle' | 'syncing' | 'ok' | 'error'
  message?: string
  lastSyncAt?: string
  rev: number
}

const headers = (token?: string): Record<string, string> => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) })

export async function fetchStatus(token?: string): Promise<ServerStatus | null> {
  try {
    const res = await fetch('api/sync/status', { headers: headers(token), cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json()
    return body && body.available ? body as ServerStatus : null
  } catch { return null }
}

export function useSync(data: AppData, setData: (next: AppData) => void) {
  const [config, setConfig] = useState(loadConfig)
  const [server, setServer] = useState<ServerStatus | null>(null)
  const [phase, setPhase] = useState<SyncState['phase']>('idle')
  const [message, setMessage] = useState<string>()
  const dataRef = useRef(data)
  const configRef = useRef(config)
  const busy = useRef(false)
  /** 刚从服务端拿来的数据写进本地时，不要再当成本机改动推回去 */
  const fromServer = useRef<AppData | null>(null)
  const firstRender = useRef(true)
  useEffect(() => { dataRef.current = data }, [data])

  const update = useCallback((patch: Partial<SyncConfig>) => {
    const next = { ...configRef.current, ...patch }
    configRef.current = next
    saveConfig(next)
    setConfig(next)
  }, [])

  const refreshStatus = useCallback(async () => {
    const status = await fetchStatus(configRef.current.token)
    setServer(status)
    return status
  }, [])

  const apply = useCallback((next: AppData) => {
    fromServer.current = next
    setData(next)
  }, [setData])

  /** 推：409 时合并再推，最多 3 次 */
  const push = useCallback(async (): Promise<boolean> => {
    let local = dataRef.current
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { token, rev, device } = configRef.current
      const res = await fetch('api/sync', { method: 'PUT', headers: headers(token), body: JSON.stringify({ baseRev: rev, data: local, device }) })
      if (res.ok) {
        const body = await res.json() as { rev: number; updatedAt: string }
        // 推的过程中又改了就继续标着
        update({ rev: body.rev, lastSyncAt: body.updatedAt, pending: dataRef.current !== local })
        return true
      }
      if (res.status !== 409) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      const remote = await res.json() as { rev: number; data: unknown }
      const merged = remote.data ? mergeData(local, parseData(remote.data)) : local
      update({ rev: remote.rev })
      apply(merged)
      local = merged
    }
    throw new Error('别的设备一直在改，稍后再同步')
  }, [apply, update])

  /** 拉：服务端更新且本机没改动就直接用；本机也改了就合并后推 */
  const pull = useCallback(async () => {
    const { token, rev } = configRef.current
    const res = await fetch('api/sync', { headers: headers(token), cache: 'no-store' })
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
    const remote = await res.json() as { rev: number; updatedAt: string; data: unknown }
    if (remote.rev === 0 || !remote.data) { await push(); return }
    if (remote.rev === rev) { if (configRef.current.pending) await push(); else update({ lastSyncAt: new Date().toISOString() }); return }
    const parsed = parseData(remote.data)
    if (configRef.current.pending || rev === 0) {
      // 第一次连上：本机已有数据就合并，不直接覆盖
      apply(mergeData(dataRef.current, parsed))
      update({ rev: remote.rev })
      await push()
    } else {
      apply(parsed)
      update({ rev: remote.rev, lastSyncAt: new Date().toISOString() })
    }
  }, [apply, push, update])

  const run = useCallback(async (job: () => Promise<unknown>) => {
    if (busy.current || !configRef.current.enabled) return
    busy.current = true
    setPhase('syncing')
    try {
      await job()
      setPhase('ok')
      setMessage(undefined)
    } catch (error) {
      setPhase('error')
      setMessage(error instanceof TypeError ? '连不上服务端' : (error as Error).message)
    } finally {
      busy.current = false
    }
  }, [])

  // 启动：看看这台服务端支不支持同步；开着就拉一次
  useEffect(() => { void refreshStatus().then((s) => { if (s?.authorized) void run(pull) }) }, [refreshStatus, run, pull])

  // 本机改动 → 1.5 秒后推
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    if (fromServer.current === data) { fromServer.current = null; return }
    if (!configRef.current.pending) update({ pending: true })
    if (!config.enabled) return
    const timer = window.setTimeout(() => void run(push).then(() => void refreshStatus()), 1500)
    return () => window.clearTimeout(timer)
  }, [data, config.enabled, run, push, refreshStatus])

  // 回到前台、每分钟：拉一次
  useEffect(() => {
    if (!config.enabled) return
    const tick = () => { if (document.visibilityState === 'visible') void run(pull) }
    const timer = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [config.enabled, run, pull])

  const enable = useCallback(async (on: boolean) => {
    update({ enabled: on })
    if (!on) { setPhase('idle'); return }
    const status = await refreshStatus()
    if (!status?.authorized) { setPhase('error'); setMessage(status ? '需要口令（服务端 .env 里的 SYNC_TOKEN）' : '这里没有可同步的服务端'); return }
    await run(pull)
    void refreshStatus()
  }, [refreshStatus, run, pull, update])

  const setToken = useCallback((token: string) => { update({ token: token.trim() || undefined }); void refreshStatus() }, [update, refreshStatus])
  const syncNow = useCallback(async () => { await run(pull); void refreshStatus() }, [run, pull, refreshStatus])

  const state: SyncState = { server, enabled: config.enabled, token: config.token ?? '', phase, message, lastSyncAt: config.lastSyncAt, rev: config.rev }
  return { state, enable, setToken, syncNow }
}
