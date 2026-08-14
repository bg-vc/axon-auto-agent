import { Bot, Home, LogOut, Settings, UserRound } from 'lucide-react'
import { useAppStore, type AppView } from '../store'

const items: Array<{ id: AppView; label: string; icon: typeof Home }> = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'profile', label: '我的', icon: UserRound },
]

export function Sidebar() {
  const { view, navigate, openSettings, runtime } = useAppStore()
  return (
    <aside className="sidebar">
      <div className="sidebar-drag" />
      <div className="brand">
        <div className="brand-mark">A</div>
        <div><strong>Axon Auto Agent</strong><span>Autonomy workbench</span></div>
      </div>
      <div className={`runtime-pill runtime-${runtime?.state ?? 'starting'}`}>
        <span className="status-dot" />
        <div><strong>{runtime?.state === 'busy' ? 'Agent 正在工作' : runtime?.state === 'degraded' ? 'Runtime 兼容警告' : runtime?.state === 'ready' ? 'Runtime 已就绪' : 'Runtime 启动中'}</strong><span>Harness {runtime?.harnessVersion ?? '0.1.0-rc.6'}</span></div>
      </div>
      <nav className="sidebar-nav">
        {items.slice(0, 2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}><Icon size={21} /><span>{label}</span></button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <nav className="sidebar-nav sidebar-bottom">
        {items.slice(2).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}><Icon size={21} /><span>{label}</span></button>
        ))}
        <button className="nav-item" onClick={() => openSettings()}><Settings size={21} /><span>设置</span></button>
        <button className="nav-item danger" onClick={() => void window.axonAutoAgent.app.quit()}><LogOut size={21} /><span>退出</span></button>
      </nav>
    </aside>
  )
}
