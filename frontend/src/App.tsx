import { useState } from 'react'
import { ChatTreeView } from './components/ChatTreeView'
import { LlmSettingsPage } from './components/LlmSettingsPage'
import './index.css'

function App() {
  const [screen, setScreen] = useState<'tree' | 'settings'>('tree')
  if (screen === 'settings') {
    return <LlmSettingsPage onBack={() => setScreen('tree')} />
  }
  return <ChatTreeView onOpenSettings={() => setScreen('settings')} />
}

export default App
