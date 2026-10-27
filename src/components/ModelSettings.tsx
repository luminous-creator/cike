import { useState } from 'react'
import { Cpu, ExternalLink, LoaderCircle } from 'lucide-react'
import type { AiStatus } from '@/lib/harness'
import { PRESETS, loadModel, saveModel, testModel, type ModelConfig } from '@/lib/model'

const presetOf = (baseURL: string) => PRESETS.find((p) => p.baseURL && p.baseURL === baseURL)?.id ?? 'custom'

/** 设置页的"模型接入"：地址 / 密钥 / 模型，存在本设备，填好即用 */
export function ModelSettings({ ai }: { ai: AiStatus | null }) {
  const saved = loadModel()
  const [form, setForm] = useState<ModelConfig>(saved ?? { baseURL: PRESETS[0].baseURL, apiKey: '', model: PRESETS[0].model })
  const [preset, setPreset] = useState(saved ? presetOf(saved.baseURL) : PRESETS[0].id)
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({})
  const current = PRESETS.find((p) => p.id === preset)
  const ready = Boolean(form.baseURL.trim() && form.apiKey.trim() && form.model.trim())
  const set = (patch: Partial<ModelConfig>) => { setForm((f) => ({ ...f, ...patch })); setState({}) }

  function pick(id: string) {
    setPreset(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p && p.id !== 'custom') set({ baseURL: p.baseURL, model: p.model })
  }

  async function test() {
    setState({ busy: true })
    const result = await testModel(form)
    setState(result)
  }

  async function save() {
    setState({ busy: true })
    const result = await testModel(form)
    if (result.ok) saveModel(form)
    setState(result.ok ? { ok: true, message: `已保存，${result.message}` } : result)
  }

  const status = ai?.onDevice ? `已接入 ${ai.label}（${ai.model}），本设备直连。`
    : ai?.configured ? `正在用服务端的 ${ai.label}${ai.model ? `（${ai.model}）` : ''}。在这里填一个，就改成本设备直连，不再依赖电脑。`
    : '还没接入模型：规划与复盘按策略库规则运行，仍然可用。填一个 OpenAI 兼容接口即可接入。'

  return (
    <section className="settings-section vertical model-settings">
      <div className="settings-copy"><Cpu size={21} /><div><h2>模型接入</h2><p>{status}密钥只存在这台设备上，请求从这里直接发给服务商。</p></div></div>
      <div className="model-form">
        <label><span>服务商</span>
          <select value={preset} onChange={(e) => pick(e.target.value)}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        <label><span>API 地址</span><input value={form.baseURL} onChange={(e) => { set({ baseURL: e.target.value }); setPreset(presetOf(e.target.value)) }} placeholder="https://…/v1" inputMode="url" autoCapitalize="off" spellCheck={false} /></label>
        <label><span>密钥{current?.keyUrl && <a href={current.keyUrl} target="_blank" rel="noreferrer">去申请<ExternalLink size={11} /></a>}</span><input type="password" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="sk-…" autoComplete="off" spellCheck={false} /></label>
        <label><span>模型</span><input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="模型 id" autoCapitalize="off" spellCheck={false} /></label>
        {state.message && <p className={`model-result ${state.ok ? 'ok' : 'bad'}`}>{state.message}</p>}
        <div className="backup-actions">
          <button className="button-primary" disabled={!ready || state.busy} onClick={save}>{state.busy && <LoaderCircle className="spin" size={16} />}测试并保存</button>
          <button className="button-secondary" disabled={!ready || state.busy} onClick={test}>只测试</button>
          {saved && <button className="button-secondary" onClick={() => { saveModel(null); setForm((f) => ({ ...f, apiKey: '' })); setState({ message: '已从本设备移除' }) }}>移除</button>}
        </div>
      </div>
    </section>
  )
}
