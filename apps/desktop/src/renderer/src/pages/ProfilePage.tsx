import { Bot, Database, FolderOpen, KeyRound, Laptop, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../store'

export function ProfilePage() {
  const { appInfo, health, providers, sessions, workspaces, openSettings } = useAppStore()
  const configured = providers.filter((provider) => provider.hasCredential)
  const tokenUsage = sessions.reduce((total, session) => total + (session.inputTokens ?? 0) + (session.outputTokens ?? 0), 0)
  return (
    <main className="page-scroll profile-page">
      <header className="compact-header"><span className="eyebrow">LOCAL-FIRST</span><h1>我的</h1><p>你的模型密钥、任务记录和工作区留在这台电脑上。</p></header>
      <section className="profile-hero panel">
        <div className="avatar">A</div>
        <div className="profile-copy"><h2>本地使用者</h2><p>Axon Auto Agent 不要求登录账号。API Key 由系统钥匙串加密保存。</p><div className="tag-row"><span><ShieldCheck size={15} />BYOK</span><span><Laptop size={15} />{appInfo?.platform} · {appInfo?.arch}</span></div></div>
        <button className="secondary-button" onClick={() => openSettings()}>管理配置</button>
      </section>
      <section className="metric-grid">
        <article className="metric-card"><KeyRound /><span>已配置模型</span><strong>{configured.length}</strong><small>{configured.map((item) => item.name).join(' · ') || '尚未配置'}</small></article>
        <article className="metric-card"><Bot /><span>本地会话</span><strong>{sessions.length}</strong><small>{sessions.filter((item) => item.state === 'running').length} 个正在运行</small></article>
        <article className="metric-card"><FolderOpen /><span>本地 Token 用量</span><strong>{tokenUsage.toLocaleString()}</strong><small>来自本地事件的累计估算</small></article>
        <article className="metric-card"><Database /><span>Runtime 插件</span><strong>{health?.pluginCount ?? 0}</strong><small>Harness {health?.status.harnessVersion}</small></article>
      </section>
      <section className="panel data-panel"><div><h2>本地数据</h2><p>会话使用 JSONL 追加事件保存，重启后会从同一事实记录恢复。</p></div><code>{health?.persistencePath ?? appInfo?.dataPath}</code></section>
    </main>
  )
}
