import { useEffect, useState } from 'react'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiBackend, Effort } from '../../api/ai/provider'

// 设备直连：密钥只存在这台设备的浏览器里，模型请求从设备直接发给服务商（服务商需放行浏览器跨域）。
// 填了就优先于服务端；没填时回到服务端 .env，再没有就走规则。

export interface ModelConfig { baseURL: string; apiKey: string; model: string; effort?: Effort }

export interface ModelPreset { id: string; label: string; baseURL: string; model: string; keyUrl?: string }

// 只列实测放行浏览器跨域的服务商；其他 OpenAI 兼容接口用"自定义"
export const PRESETS: ModelPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'moonshot', label: 'Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-latest', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'siliconflow', label: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseURL: '', model: '' },
]

const KEY = 'cike.model.v1'
const EVENT = 'cike-model-change'

export function loadModel(): ModelConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ModelConfig> | null
    if (!raw?.apiKey?.trim() || !raw.baseURL?.trim() || !raw.model?.trim()) return null
    return { baseURL: raw.baseURL.trim(), apiKey: raw.apiKey.trim(), model: raw.model.trim(), effort: raw.effort }
  } catch {
    return null
  }
}

export function saveModel(config: ModelConfig | null) {
  try {
    if (config) localStorage.setItem(KEY, JSON.stringify(config))
    else localStorage.removeItem(KEY)
  } catch { /* 存储被禁用时只在本次会话生效不了，忽略 */ }
  window.dispatchEvent(new Event(EVENT))
}

export function useModelConfig(): ModelConfig | null {
  const [config, setConfig] = useState(loadModel)
  useEffect(() => {
    const sync = () => setConfig(loadModel())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [])
  return config
}

const clean = (url: string) => url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')

export function providerLabel(baseURL: string): string {
  const preset = PRESETS.find((p) => p.baseURL && clean(p.baseURL) === clean(baseURL))
  if (preset) return preset.label.replace(/（.*）/, '')
  try { return new URL(baseURL).host } catch { return '自定义接口' }
}

/** 与服务端 api/ai/provider.ts 的 custom 分支同一套参数 */
export function buildBackend(config: ModelConfig): AiBackend {
  const baseURL = clean(config.baseURL)
  const provider = createOpenAICompatible({ name: 'cike', baseURL, apiKey: config.apiKey, includeUsage: true })
  const isDeepSeek = /deepseek\.com/i.test(baseURL)
  const sendsEffort = isDeepSeek || Boolean(config.effort)
  return {
    kind: 'custom',
    label: providerLabel(baseURL),
    modelId: config.model,
    model: provider(config.model),
    options: (effort) => (sendsEffort ? { cike: { reasoningEffort: effort } } : undefined),
    defaultEffort: config.effort ?? 'low',
  }
}

/** 发一条最短的对话，确认地址、密钥、模型名都对 */
export async function testModel(config: ModelConfig): Promise<{ ok: boolean; message: string }> {
  const [{ generateText }, { friendly }] = await Promise.all([import('ai'), import('../../api/harness/engine')])
  const backend = buildBackend(config)
  const started = Date.now()
  try {
    await generateText({ model: backend.model, providerOptions: backend.options('none'), prompt: '回复"好"', maxOutputTokens: 16, abortSignal: AbortSignal.timeout(30_000) })
    return { ok: true, message: `连通，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒` }
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, message: '连不上：地址不对，或这个服务商不允许浏览器直连' }
    return { ok: false, message: friendly(error).message.replace('，已改用规则结果。', '') }
  }
}
