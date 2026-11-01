/* 此刻 · 后台提醒（由 Workbox 生成的 Service Worker 通过 importScripts 引入）
 *
 * 应用每次数据变化时，把未来 14 天每天的提醒写进缓存 cike-digest/cike-digest.json。
 * 系统定时唤醒（periodicsync，安卓 Chrome 装到桌面后可用）时，
 * 这里取出今天已到点、还没弹过的那条弹出来。应用关着也能提醒。
 */
const DIGEST_CACHE = 'cike-digest'
const digestUrl = () => new URL('cike-digest.json', self.registration.scope).href
const shownUrl = () => new URL('cike-digest-shown.json', self.registration.scope).href
const pad = (n) => String(n).padStart(2, '0')

async function showDueDigest() {
  const cache = await caches.open(DIGEST_CACHE)
  const res = await cache.match(digestUrl())
  if (!res) return
  const { entries = [] } = await res.json()
  const shownRes = await cache.match(shownUrl())
  const shown = shownRes ? await shownRes.json() : []
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const due = entries.filter((e) => e.date === today && e.at <= hm && !shown.includes(e.id))
  if (!due.length) return
  // 一次只弹最新的一条，早上的错过了就不补
  const latest = due[due.length - 1]
  await self.registration.showNotification(latest.title, {
    body: latest.body, tag: 'cike-daily', icon: 'icon-192.png', badge: 'icon-192.png', lang: 'zh-CN', data: { url: self.registration.scope },
  })
  const next = [...new Set([...shown, ...due.map((e) => e.id)])].slice(-60)
  await cache.put(shownUrl(), new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }))
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cike-daily') event.waitUntil(showDueDigest())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((client) => client.url.startsWith(self.registration.scope))
    return open ? open.focus() : self.clients.openWindow(url)
  }))
})
