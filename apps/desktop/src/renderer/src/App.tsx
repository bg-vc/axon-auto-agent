import { useEffect } from 'react'
import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { SettingsModal } from './components/SettingsModal'
import { AgentPage } from './pages/AgentPage'
import { HomePage } from './pages/HomePage'
import { ProfilePage } from './pages/ProfilePage'
import { useAppStore } from './store'

export function App() {
  const { initialize, initialized, loading, view, error, clearError } = useAppStore()
  useEffect(() => { void initialize() }, [initialize])
  if (!initialized && loading) return <div className="boot-screen"><div className="brand-mark large">A</div><LoaderCircle className="spin" /><span>正在启动 Runtime…</span></div>
  return <div className="app-shell"><Sidebar /><section className="app-content">{view === 'home' && <HomePage />}{view === 'agent' && <AgentPage />}{view === 'profile' && <ProfilePage />}</section><SettingsModal />{error && <div className="error-toast"><AlertCircle size={18} /><span>{error}</span><button onClick={clearError}><X size={16} /></button></div>}</div>
}
