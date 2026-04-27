/** 与后端 get_llm_env / .env.example 对齐：MiniMax 与 OpenAI 走 openai_compat，Claude 走 anthropic */

export type LlmPresetId = 'minimax' | 'openai' | 'claude'

export type LlmProvider = 'openai_compat' | 'anthropic'

export type LlmPreset = {
  id: LlmPresetId
  label: string
  description: string
  llm_provider: LlmProvider
  defaultBaseUrl: string
  suggestedModels: string[]
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'OpenAI 兼容接口（api.minimaxi.com）',
    llm_provider: 'openai_compat',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    suggestedModels: ['MiniMax-M2.5', 'MiniMax-Text-01'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'ChatGPT 系列（官方 API）',
    llm_provider: 'openai_compat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedModels: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1',
      'o3-mini',
    ],
  },
  {
    id: 'claude',
    label: 'Claude',
    description: 'Anthropic Messages API',
    llm_provider: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    suggestedModels: [
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4.5-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
  },
]

export function findPresetById(id: LlmPresetId): LlmPreset {
  const p = LLM_PRESETS.find((x) => x.id === id)
  if (!p) return LLM_PRESETS[0]
  return p
}

/** 根据已保存的 base_url / provider 猜测当前预设 */
export function guessPresetFromSaved(
  llm_provider: string | null | undefined,
  base_url: string | null | undefined
): LlmPresetId {
  const base = (base_url || '').toLowerCase().replace(/\/$/, '')
  const prov = (llm_provider || '').toLowerCase()
  if (prov === 'anthropic') return 'claude'
  if (base.includes('minimax')) return 'minimax'
  if (base.includes('openai.com')) return 'openai'
  return 'minimax'
}
