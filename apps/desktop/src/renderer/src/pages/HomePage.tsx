import { ArrowRight, Bot, CheckCircle2, Clock3, FolderOpen, Plus, Sparkles, Workflow } from 'lucide-react'
import { useAppStore } from '../store'

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

export function HomePage() {
  const { sessions, workspaces, settings, providers, runtime, createSession, openSession, chooseWorkspace, navigate } = useAppStore()
  const currentWorkspace = workspaces.find((item) => item.id === settings?.defaultWorkspaceId) ?? workspaces[0]
  const provider = providers.find((item) => item.id === settings?.activeProviderId)
  const active = sessions.filter((session) => session.state === 'running' || session.state === 'waiting_for_decision')
  return (
    <main className="page-scroll home-page">
      <header className="page-header">
        <div><span className="eyebrow">AXON AUTO AGENT</span><h1>把目标交给 Agent，<br />把结果留在工作区。</h1><p>从一次真实任务开始。过程、权限、文件和失败都保持可见。</p></div>
        <button className="primary-button hero-action" onClick={() => void createSession()}><Plus size={20} />新建任务</button>
      </header>

      <section className="status-grid">
        <article className="status-card"><div className="icon-tile mint"><Workflow /></div><div><span>Runtime</span><strong>{runtime?.state === 'ready' ? '已就绪' : runtime?.state === 'busy' ? '执行中' : runtime?.state === 'degraded' ? '需要检查' : '启动中'}</strong><small>DeepSeek Harness {runtime?.harnessVersion}</small></div></article>
        <article className="status-card"><div className="icon-tile"><FolderOpen /></div><div><span>当前工作区</span><strong>{currentWorkspace?.name ?? '尚未选择'}</strong><button className="text-action" onClick={() => void chooseWorkspace()}>{currentWorkspace ? '更换目录' : '选择目录'} <ArrowRight size={14} /></button></div></article>
        <article className="status-card"><div className="icon-tile"><Sparkles /></div><div><span>当前模型</span><strong>{provider?.model ?? '尚未配置'}</strong><small>{provider?.hasCredential ? provider.name : '需要配置 API Key'}</small></div></article>
      </section>

      {active.length > 0 && <section className="section-block"><div className="section-title"><div><h2>正在进行</h2><p>窗口关闭后任务仍会留在托盘继续。</p></div><Clock3 /></div><div className="running-list">{active.map((session) => <button key={session.id} className="running-row" onClick={() => void openSession(session.id)}><span className="pulse-ring"><Bot size={18} /></span><div><strong>{session.title}</strong><span>{session.state === 'waiting_for_decision' ? '等待你的确认' : 'Agent 正在执行'}</span></div><ArrowRight size={18} /></button>)}</div></section>}

      <section className="section-block">
        <div className="section-title"><div><h2>最近任务</h2><p>从事件记录恢复，不依赖窗口是否一直打开。</p></div><button className="text-action" onClick={() => navigate('agent')}>全部会话 <ArrowRight size={14} /></button></div>
        {sessions.length ? <div className="recent-grid">{sessions.slice(0, 6).map((session) => <button key={session.id} className="recent-card" onClick={() => void openSession(session.id)}><div className="recent-top"><span className={`session-state state-${session.state}`}><span />{session.state === 'idle' ? '已完成' : session.state === 'failed' ? '失败' : session.state === 'waiting_for_decision' ? '待确认' : session.state === 'stopped' ? '已停止' : '运行中'}</span><small>{formatDate(session.updatedAt)}</small></div><h3>{session.title}</h3><p>{session.lastMessage || '尚未开始对话'}</p><footer><span>{session.modelId}</span><CheckCircle2 size={16} /></footer></button>)}</div> : <div className="empty-panel"><div className="empty-icon"><Bot /></div><h3>还没有任务</h3><p>新建任务后，Agent 的对话、工具执行和产物会保存在这里。</p><button className="secondary-button" onClick={() => void createSession()}><Plus size={18} />创建第一个任务</button></div>}
      </section>
    </main>
  )
}
