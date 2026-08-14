import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowUp, Bot, Brain, Check, ChevronDown, CircleStop, Copy,
  Download, File, FileText, FolderOpen, Image, Paperclip, Play, Plus,
  RefreshCw, Search, Terminal, X,
} from 'lucide-react'
import type { ArtifactDescriptor, ConversationEvent, DecisionRequest } from '@axon-auto-agent/contracts'
import { useAppStore } from '../store'

const basename = (value: string) => value.split(/[\\/]/).pop() ?? value
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

function EventRow({ event, decisions }: { event: ConversationEvent; decisions: DecisionRequest[] }) {
  const payload = event.payload as Record<string, unknown>
  if (event.type === 'user/message') return <div className="message-row user-message"><div className="message-bubble"><p>{String(payload.content ?? '')}</p>{Array.isArray(payload.attachments) && payload.attachments.length > 0 && <div className="message-attachments">{payload.attachments.map((item, index) => { const attachment = typeof item === 'string' ? { name: basename(item), path: item } : item as { name?: string; path?: string }; return <span key={attachment.path ?? `${attachment.name}-${index}`}><File size={14} />{attachment.name ?? '附件'}</span> })}</div>}<time>{formatTime(event.timestamp)}</time></div></div>
  if (event.type === 'assistant/message' && payload.content) return <div className="message-row assistant-message"><div className="agent-avatar"><Bot size={18} /></div><div className="message-content"><div className="message-label">Axon Auto Agent <time>{formatTime(event.timestamp)}</time></div><div className="assistant-copy">{String(payload.content)}</div></div></div>
  if (event.type === 'assistant/thinking' && payload.content) return <details className="thinking-card"><summary><Brain size={16} />思考过程<ChevronDown size={15} /></summary><p>{String(payload.content)}</p></details>
  if (event.type === 'tool/completed' || event.type === 'tool/failed') return <div className={event.type === 'tool/failed' ? 'tool-card failed' : 'tool-card'}><span className="tool-icon">{String(payload.name).includes('command') ? <Terminal size={16} /> : <FileText size={16} />}</span><div><strong>{String(payload.name)}</strong><p>{String(payload.result ?? payload.message ?? '')}</p></div>{event.type === 'tool/completed' ? <Check size={16} /> : <AlertCircle size={16} />}</div>
  if (event.type === 'decision/requested') {
    const decision = decisions.find((item) => item.id === String(payload.id)) ?? event.payload as DecisionRequest
    return <DecisionCard decision={decision} />
  }
  if (event.type === 'run/failed') return <div className="run-error"><AlertCircle size={19} /><div><strong>任务没有完成</strong><p>{String(payload.message ?? 'Runtime execution failed.')}</p></div></div>
  if (event.type === 'run/interrupted') return <div className="system-note"><CircleStop size={15} />上次运行意外中断，已保留会话记录，可以继续恢复。</div>
  if (event.type === 'run/stopped') return <div className="system-note"><CircleStop size={15} />任务已停止，可以从当前事件记录恢复。</div>
  return null
}

function DecisionCard({ decision }: { decision: DecisionRequest }) {
  const resolveDecision = useAppStore((state) => state.resolveDecision)
  return <div className={`decision-card decision-${decision.status}`}><div className="decision-head"><span><AlertCircle size={18} /></span><div><strong>{decision.title}</strong><small>{decision.risk}</small></div></div><p>{decision.reason}</p><code>{decision.proposedAction}</code>{decision.status === 'pending' ? <div className="decision-actions"><button onClick={() => void resolveDecision(decision.id, false)}>拒绝</button><button className="approve" onClick={() => void resolveDecision(decision.id, true)}>允许这一次</button></div> : <div className="decision-result">{decision.status === 'approved' ? <><Check size={15} />已允许</> : <><X size={15} />已拒绝</>}</div>}</div>
}

function ArtifactPreview({ artifact }: { artifact: ArtifactDescriptor }) {
  const [url, setUrl] = useState<string>()
  const [text, setText] = useState<string>()
  useEffect(() => {
    let active = true
    void window.axonAutoAgent.artifact.getPreviewUrl(artifact.id).then(async (nextUrl) => {
      if (!active || !nextUrl) return
      setUrl(nextUrl)
      if (artifact.mediaType.startsWith('text/') || artifact.mediaType === 'application/json') {
        try { const response = await fetch(nextUrl); if (active) setText(await response.text()) } catch { /* native open remains available */ }
      }
    })
    return () => { active = false }
  }, [artifact])
  if (!artifact.previewable) return <div className="preview-empty"><File size={32} /><p>此格式暂不支持内嵌预览。</p></div>
  if (artifact.mediaType.startsWith('image/') && url) return <img className="artifact-image" src={url} alt={artifact.name} />
  if (artifact.mediaType === 'application/pdf' && url) return <iframe className="artifact-frame" src={url} title={artifact.name} />
  if (text !== undefined) return <pre className="artifact-text">{text}</pre>
  return <div className="preview-empty"><RefreshCw className="spin" size={22} /><p>正在载入预览…</p></div>
}

function ArtifactRail() {
  const current = useAppStore((state) => state.current)
  const [selectedId, setSelectedId] = useState<string>()
  const artifacts = current?.artifacts ?? []
  const selected = artifacts.find((item) => item.id === selectedId) ?? artifacts.at(-1)
  useEffect(() => { if (artifacts.length && !artifacts.some((item) => item.id === selectedId)) setSelectedId(artifacts.at(-1)?.id) }, [artifacts, selectedId])
  return <aside className="artifact-rail"><header><div><FolderOpen size={18} /><strong>任务产物</strong></div><span>{artifacts.length}</span></header>{selected ? <><div className="artifact-preview-head"><div><strong>{selected.name}</strong><span>{(selected.size / 1024).toFixed(1)} KB · {selected.mediaType}</span></div><div><button title="在系统中打开" onClick={() => void window.axonAutoAgent.artifact.open(selected.id)}><Play size={15} /></button><button title="另存为" onClick={() => void window.axonAutoAgent.artifact.saveAs(selected.id)}><Download size={15} /></button></div></div><div className="artifact-preview"><ArtifactPreview artifact={selected} /></div><div className="artifact-list">{artifacts.map((artifact) => <button key={artifact.id} className={artifact.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(artifact.id)}><span>{artifact.mediaType.startsWith('image/') ? <Image size={17} /> : <FileText size={17} />}</span><div><strong>{artifact.name}</strong><small>{formatTime(artifact.createdAt)}</small></div></button>)}</div></> : <div className="preview-empty grow"><FolderOpen size={32} /><h3>还没有产物</h3><p>Agent 写入的文件会出现在这里，可以直接预览、打开或另存为。</p></div>}</aside>
}

export function AgentPage() {
  const { sessions, current, providers, settings, streamText, thinkingText, attachments, openSession, createSession, sendMessage, stopSession, resumeSession, chooseAttachments, removeAttachment, openSettings } = useAppStore()
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleSessions = useMemo(() => sessions.filter((session) => session.title.toLowerCase().includes(search.toLowerCase())), [sessions, search])
  const provider = providers.find((item) => item.id === (current?.session.providerId ?? settings?.activeProviderId))
  const running = current?.session.state === 'running' || current?.session.state === 'waiting_for_decision'
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [current?.events.length, streamText, thinkingText])
  const submit = async () => {
    const content = input
    if (!content.trim() || submitting) return
    setSubmitting(true)
    try { if (await sendMessage(content)) setInput('') } finally { setSubmitting(false) }
  }
  return <main className="agent-page">
    <aside className="session-rail"><header><div><span>任务会话</span><strong>{sessions.length}</strong></div><button onClick={() => void createSession()} title="新建任务"><Plus size={18} /></button></header><label className="session-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会话" /></label><div className="session-list">{visibleSessions.map((session) => <button key={session.id} className={current?.session.id === session.id ? 'active' : ''} onClick={() => void openSession(session.id)}><span className={`session-dot state-${session.state}`} /><div><strong>{session.title}</strong><small>{session.lastMessage || session.modelId}</small></div><time>{formatTime(session.updatedAt)}</time></button>)}</div></aside>
    <section className="conversation-panel">
      <header className="conversation-header"><div><div className="agent-avatar large"><Bot size={20} /></div><div><strong>{current?.session.title ?? 'Agent 助手'}</strong><span>{current ? `${current.session.state === 'running' ? '正在执行' : current.session.state === 'waiting_for_decision' ? '等待确认' : current.session.state === 'failed' ? '执行失败' : '准备就绪'} · ${provider?.model ?? ''}` : '描述目标，创建你的第一个任务'}</span></div></div>{provider?.hasCredential ? <span className="connected"><span />模型已连接</span> : <button className="warning-button" onClick={() => openSettings()}>配置模型</button>}</header>
      <div className="conversation-scroll" ref={scrollRef}>{current ? <>{current.events.map((event) => <EventRow key={event.id} event={event} decisions={current.decisions} />)}{(streamText || thinkingText) && <div className="message-row assistant-message streaming"><div className="agent-avatar"><Bot size={18} /></div><div className="message-content"><div className="message-label">Axon Auto Agent <span className="typing"><i /><i /><i /></span></div>{thinkingText && <details className="thinking-card live"><summary><Brain size={16} />正在思考<ChevronDown size={15} /></summary><p>{thinkingText}</p></details>}<div className="assistant-copy">{streamText}<span className="cursor" /></div></div></div>}</> : <div className="agent-welcome"><div className="welcome-orb"><Bot size={32} /></div><span className="eyebrow">AGENT WORKBENCH</span><h1>今天想完成什么？</h1><p>选择工作区后，用一句话描述结果。Agent 可以读取资料、调用工具并把产物保存回本地。</p><div className="suggestion-grid"><button onClick={() => setInput('分析工作区中的资料，整理出一份结构清晰的 Markdown 报告。')}>分析资料并生成报告</button><button onClick={() => setInput('检查这个项目，找出最值得优先修复的问题并说明证据。')}>检查项目并定位问题</button><button onClick={() => setInput('读取现有内容，生成一个可以直接交付的网页文件。')}>生成可交付网页</button></div></div>}</div>
      <div className="composer-wrap">{attachments.length > 0 && <div className="attachment-strip">{attachments.map((filePath) => <span key={filePath}><File size={14} />{basename(filePath)}<button onClick={() => removeAttachment(filePath)}><X size={13} /></button></span>)}</div>}<div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() } }} placeholder="描述你想完成的任务…" rows={3} /><footer><div><button className="icon-button" title="添加资料" onClick={() => void chooseAttachments()}><Paperclip size={19} /></button><button className="model-chip" onClick={() => openSettings()}><span className={provider?.hasCredential ? 'online' : ''} />{provider?.model ?? '配置模型'}<ChevronDown size={14} /></button></div>{running ? <button className="send-button stop" onClick={() => void stopSession()} title="停止任务"><CircleStop size={19} /></button> : current?.session.state === 'stopped' || current?.session.state === 'failed' ? <div className="composer-actions"><button className="resume-button" onClick={() => void resumeSession()}><RefreshCw size={16} />恢复</button><button className="send-button" disabled={!input.trim() || submitting} onClick={() => void submit()}><ArrowUp size={20} /></button></div> : <button className="send-button" disabled={!input.trim() || submitting} onClick={() => void submit()}><ArrowUp size={20} /></button>}</footer></div></div>
    </section>
    <ArtifactRail />
  </main>
}
