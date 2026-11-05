import { useState } from 'react'
import { Braces, RotateCcw, Save } from 'lucide-react'
import { DEFAULT_BUNDLE, parseBundle } from '@contracts/chat'
import { loadBundleText, saveBundleText } from '@/lib/chat'

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

/** 大肥鱼的结构化提示词：默认值来自仓库里的 prompts/chat.json，改过的只存在这台设备 */
export function PromptSettings() {
  const stored = loadBundleText()
  const [text, setText] = useState(() => {
    if (!stored) return pretty(DEFAULT_BUNDLE)
    try { return pretty(JSON.parse(stored)) } catch { return stored }
  })
  const [custom, setCustom] = useState(Boolean(stored))
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function check(value: string) {
    setText(value)
    const { error } = parseBundle(value)
    setMessage(error ? { ok: false, text: error } : null)
  }

  function save() {
    const error = saveBundleText(text)
    if (error) { setMessage({ ok: false, text: error }); return }
    setCustom(true)
    setMessage({ ok: true, text: '已保存，下一条消息开始生效' })
  }

  function reset() {
    if (custom && !window.confirm('恢复成默认提示词吗？你改的内容会丢掉。')) return
    saveBundleText(null)
    setText(pretty(DEFAULT_BUNDLE))
    setCustom(false)
    setMessage({ ok: true, text: '已恢复默认' })
  }

  return (
    <section className="settings-section vertical prompt-settings">
      <div className="settings-copy"><Braces size={21} /><div>
        <h2>大肥鱼的提示词（JSON）{custom && <small className="prompt-badge">已自定义</small>}</h2>
        <p>聊天时，这段 JSON 和你此刻的数据一起发给模型。persona 是性格，rules 是必须遵守的规则，intents 是每种情况怎么做、能用哪些工具，style 是说话方式。可以随意加字段（比如你的作息、偏好），会原样交给模型。默认值在仓库的 <code>prompts/chat.json</code>，这里改的只存在这台设备。</p>
      </div></div>
      <textarea id="prompt-json" className="prompt-editor" value={text} onChange={(e) => check(e.target.value)} spellCheck={false} rows={18} aria-label="提示词 JSON" />
      {message && <p className={`model-result ${message.ok ? 'ok' : 'bad'}`} role="status">{message.text}</p>}
      <div className="backup-actions">
        <button className="button-primary" onClick={save} disabled={Boolean(parseBundle(text).error)}><Save size={16} />保存</button>
        <button className="button-secondary" onClick={reset}><RotateCcw size={16} />恢复默认</button>
      </div>
    </section>
  )
}
