import { getApiBase, joinUrl } from '../hooks/useWebSocket'
import type { LlmProvider } from '../config/llmPresets'

export type LlmConfigPublic = {
  llm_provider: string | null
  base_url: string | null
  model_name: string | null
  api_key_configured: boolean
  api_key_hint: string | null
}

export type LlmConfigUpdate = {
  clear_api_key?: boolean
  llm_provider?: LlmProvider
  base_url?: string
  model_name?: string
  api_key?: string
}

export async function fetchLlmConfig(): Promise<LlmConfigPublic> {
  const r = await fetch(joinUrl(getApiBase(), '/api/llm-config'))
  if (!r.ok) {
    throw new Error((await r.json().catch(() => ({})))?.detail || r.statusText)
  }
  return r.json()
}

export async function saveLlmConfig(body: LlmConfigUpdate): Promise<LlmConfigPublic> {
  const r = await fetch(joinUrl(getApiBase(), '/api/llm-config'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    const detail = err?.detail
    throw new Error(
      typeof detail === 'string' ? detail : Array.isArray(detail) ? JSON.stringify(detail) : r.statusText
    )
  }
  return r.json()
}
