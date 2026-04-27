import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from './ui/button'
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react'
import {
  LLM_PRESETS,
  findPresetById,
  guessPresetFromSaved,
  type LlmPresetId,
} from '../config/llmPresets'
import { fetchLlmConfig, saveLlmConfig } from '../api/llmConfig'

export type LlmSettingsPageProps = {
  onBack: () => void
}

export function LlmSettingsPage({ onBack }: LlmSettingsPageProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [presetId, setPresetId] = useState<LlmPresetId>('minimax')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelName, setModelName] = useState('')
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null)

  const preset = useMemo(() => findPresetById(presetId), [presetId])

  const applyPresetDefaults = useCallback((id: LlmPresetId) => {
    const p = findPresetById(id)
    setBaseUrl(p.defaultBaseUrl)
    setModelName(p.suggestedModels[0] ?? '')
    setUseCustomModel(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const cfg = await fetchLlmConfig()
        if (cancelled) return
        const guessed = guessPresetFromSaved(cfg.llm_provider, cfg.base_url)
        setPresetId(guessed)
        if (cfg.base_url) setBaseUrl(cfg.base_url)
        else applyPresetDefaults(guessed)
        if (cfg.model_name) {
          const p = findPresetById(guessed)
          const inList = p.suggestedModels.includes(cfg.model_name)
          setModelName(cfg.model_name)
          setUseCustomModel(!inList)
        } else {
          applyPresetDefaults(guessed)
        }
        setApiKeyConfigured(cfg.api_key_configured)
        setApiKeyHint(cfg.api_key_hint)
        setApiKeyInput('')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载配置失败')
          applyPresetDefaults('minimax')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyPresetDefaults])

  const handlePresetChange = (id: LlmPresetId) => {
    setPresetId(id)
    applyPresetDefaults(id)
    setApiKeyInput('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const p = findPresetById(presetId)
      const body: Parameters<typeof saveLlmConfig>[0] = {
        llm_provider: p.llm_provider,
        base_url: baseUrl.trim(),
        model_name: modelName.trim(),
      }
      if (apiKeyInput.trim()) {
        body.api_key = apiKeyInput.trim()
      }
      const out = await saveLlmConfig(body)
      setApiKeyConfigured(out.api_key_configured)
      setApiKeyHint(out.api_key_hint)
      setApiKeyInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!confirm('确定清除已保存的 API Key？清除后将改用环境变量（若已配置）。')) return
    setSaving(true)
    setError(null)
    try {
      await saveLlmConfig({ clear_api_key: true })
      setApiKeyConfigured(false)
      setApiKeyHint(null)
      setApiKeyInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '清除失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="bg-card border-b px-6 py-4 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-2"
            onClick={onBack}
          >
            <ArrowLeft className="w-4 h-4" />
            返回对话
          </Button>
          <h1 className="text-lg font-semibold text-foreground">模型与 API 设置</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          <p className="text-sm text-muted-foreground">
            配置将保存在本机后端目录（<code className="text-xs bg-muted px-1 rounded">data/llm_config.json</code>
            ）。若未保存或已清除，则使用环境变量 / <code className="text-xs bg-muted px-1 rounded">.env</code>。
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中…
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-foreground">提供商</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {LLM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    presetId === p.id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="font-medium text-foreground">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{p.description}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="base-url">
              API Base URL
            </label>
            <input
              id="base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder={preset.defaultBaseUrl}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              当前预设默认：<span className="font-mono">{preset.defaultBaseUrl}</span>
            </p>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor="model-select">
                模型
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={useCustomModel}
                  onChange={(e) => {
                    setUseCustomModel(e.target.checked)
                    if (!e.target.checked) {
                      setModelName(preset.suggestedModels[0] ?? '')
                    }
                  }}
                />
                自定义模型 ID
              </label>
            </div>
            {useCustomModel ? (
              <input
                id="model-custom"
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="例如 gpt-4o"
                autoComplete="off"
              />
            ) : (
              <select
                id="model-select"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                {preset.suggestedModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </section>

          <section className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="api-key">
              API Key
            </label>
            <div className="flex gap-2">
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder={apiKeyConfigured ? '留空则保留已保存的 Key' : '粘贴 API Key'}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? '隐藏密钥' : '显示密钥'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
            {apiKeyConfigured ? (
              <p className="text-xs text-muted-foreground">
                已保存：<span className="font-mono">{apiKeyHint || '********'}</span> — 仅在新 Key 时填写上方框
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">首次保存必须填写 API Key。</p>
            )}
          </section>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="button" onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={saving || !apiKeyConfigured}
            >
              清除已保存的 Key
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
