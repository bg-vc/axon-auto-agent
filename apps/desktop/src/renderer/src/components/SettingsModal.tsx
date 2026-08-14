import { useEffect, useState } from 'react'
import {
  Bot, CheckCircle2, Database, Download, Globe2, Info, KeyRound, Languages,
  LoaderCircle, Package, PlugZap, RefreshCw, ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react'
import type { ProviderConfigurationInput } from '@axon-auto-agent/contracts'
import { useAppStore } from '../store'

type SettingsTab = 'general' | 'models' | 'permissions' | 'runtime' | 'plugins' | 'data' | 'about'
const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Bot }> = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'models', label: '模型与密钥', icon: KeyRound },
  { id: 'permissions', label: '权限', icon: ShieldCheck },
  { id: 'runtime', label: 'Runtime', icon: PlugZap },
  { id: 'plugins', label: '插件', icon: Package },
  { id: 'data', label: '数据', icon: Database },
  { id: 'about', label: '关于', icon: Info },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange(checked: boolean): void }) {
  return <button type="button" className={checked ? 'toggle active' : 'toggle'} onClick={() => onChange(!checked)}><span /></button>
}

function SettingRow({ icon: Icon, title, description, children }: { icon: typeof Bot; title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><span className="setting-icon"><Icon size={20} /></span><div className="setting-copy"><strong>{title}</strong><p>{description}</p></div><div className="setting-control">{children}</div></div>
}

export function SettingsModal() {
  const { settingsOpen, openSettings, settings, providers, plugins, health, appInfo, updateSettings, saveProvider, testProvider, restartRuntime, loadPlugin, reloadPlugin } = useAppStore()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [providerId, setProviderId] = useState(settings?.activeProviderId ?? 'deepseek')
  const selected = providers.find((provider) => provider.id === providerId) ?? providers[0]
  const [endpoint, setEndpoint] = useState(selected?.endpoint ?? '')
  const [model, setModel] = useState(selected?.model ?? '')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  useEffect(() => { setEndpoint(selected?.endpoint ?? ''); setModel(selected?.model ?? ''); setApiKey('') }, [selected?.id])
  if (!settingsOpen || !settings) return null

  const saveModel = async () => {
    if (!selected) return
    setBusy(true); setNotice(undefined)
    try {
      const input: ProviderConfigurationInput = { id: selected.id, kind: selected.kind, name: selected.name, endpoint, model, enabled: true, apiKey: apiKey || undefined }
      await saveProvider(input); setApiKey(''); setNotice('模型配置已安全保存。')
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  const runTest = async () => {
    setBusy(true); setNotice(undefined)
    try { const result = await testProvider(providerId); setNotice(result.ok ? `连接成功：${result.message}` : `连接失败：${result.message}`) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) openSettings(false) }}>
    <section className="settings-modal">
      <header><div><span className="eyebrow">AXON AUTO AGENT</span><h2>系统设置</h2></div><button className="modal-close" onClick={() => openSettings(false)}><X size={21} /></button></header>
      <div className="settings-body">
        <nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setNotice(undefined) }}><Icon size={18} />{label}</button>)}</nav>
        <div className="settings-content">
          {tab === 'general' && <><div className="settings-heading"><h3>通用</h3><p>控制界面语言与桌面应用行为。</p></div><SettingRow icon={Languages} title="显示语言" description="英文界面仍在补齐，当前版本固定使用简体中文。"><select value="zh-CN" disabled><option value="zh-CN">简体中文</option><option value="en-US">English（开发中）</option></select></SettingRow><SettingRow icon={Globe2} title="关闭到托盘" description="关闭主窗口后，让正在运行的任务继续执行。"><Toggle checked={settings.closeToTray} onChange={(checked) => void updateSettings({ closeToTray: checked })} /></SettingRow><SettingRow icon={RefreshCw} title="开机启动" description="登录系统后自动启动 Axon Auto Agent。"><Toggle checked={settings.launchAtLogin} onChange={(checked) => void updateSettings({ launchAtLogin: checked })} /></SettingRow></>}

          {tab === 'models' && <><div className="settings-heading"><h3>模型与密钥</h3><p>密钥由 macOS Keychain 加密，永远不会写入会话事件。</p></div><div className="provider-tabs">{providers.map((provider) => <button key={provider.id} className={provider.id === providerId ? 'active' : ''} onClick={() => setProviderId(provider.id)}><span className={provider.hasCredential ? 'configured' : ''} />{provider.name}</button>)}</div><div className="model-form"><label><span>API Endpoint</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com/v1" /></label><label><span>模型名称</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-name" /></label><label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected?.hasCredential ? '已安全保存，留空保持不变' : '输入 API Key'} /></label><div className="form-actions"><button className="secondary-button" disabled={busy || !selected?.hasCredential} onClick={() => void runTest()}>测试连接</button><button className="primary-button" disabled={busy || !endpoint || !model} onClick={() => void saveModel()}>{busy ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}保存配置</button></div></div></>}

          {tab === 'permissions' && <><div className="settings-heading"><h3>权限边界</h3><p>读取限于选定工作区；写入和命令可以逐次确认。</p></div><SettingRow icon={ShieldCheck} title="工作区写入确认" description="Agent 创建或覆盖文件前要求你的明确允许。"><Toggle checked={settings.confirmWorkspaceWrites} onChange={(checked) => void updateSettings({ confirmWorkspaceWrites: checked })} /></SettingRow><SettingRow icon={Bot} title="命令执行确认" description="Shell 命令不等同于文件沙箱，默认逐次确认。"><Toggle checked={settings.confirmCommands} onChange={(checked) => void updateSettings({ confirmCommands: checked })} /></SettingRow><SettingRow icon={Globe2} title="允许模型网络" description="允许 Runtime 连接你配置的模型 API。"><Toggle checked={settings.allowNetwork} onChange={(checked) => void updateSettings({ allowNetwork: checked })} /></SettingRow></>}

          {tab === 'runtime' && <><div className="settings-heading"><h3>Runtime</h3><p>Harness 在隔离 Utility Process 中运行，崩溃不会带走桌面窗口。</p></div><div className="runtime-card"><div className={`runtime-orb runtime-${health?.status.state}`}><PlugZap size={25} /></div><div><strong>{health?.status.state === 'degraded' ? '兼容层需要检查' : 'Runtime 正常'}</strong><p>Desktop {appInfo?.version} · Harness {health?.status.harnessVersion}</p>{health?.status.lastError && <small>{health.status.lastError}</small>}</div></div><div className="form-actions left"><button className="secondary-button" onClick={() => void restartRuntime()}><RefreshCw size={17} />重启 Runtime</button><button className="secondary-button" onClick={() => void window.axonAutoAgent.runtime.exportDiagnostics().then((result) => setNotice(`诊断文件已导出：${result.path}`))}><Download size={17} />导出诊断</button></div></>}

          {tab === 'plugins' && <><div className="settings-heading"><h3>插件</h3><p>内置插件固定随应用发布；本地插件只在开发者模式下加载。</p></div><SettingRow icon={Package} title="开发者模式" description="本地插件属于可信代码，可以在 Runtime 进程执行。"><Toggle checked={settings.developerMode} onChange={(checked) => void updateSettings({ developerMode: checked })} /></SettingRow><div className="plugin-list">{plugins.map((plugin) => <article key={plugin.id}><span className={`plugin-state plugin-${plugin.state}`}><Package size={18} /></span><div><strong>{plugin.name}<small>{plugin.version}</small></strong><p>{plugin.capabilities.join(' · ') || '未声明能力'}</p>{plugin.error && <em>{plugin.error}</em>}</div>{plugin.source === 'development' && <button onClick={() => void reloadPlugin(plugin.id)}><RefreshCw size={15} /></button>}</article>)}</div><button className="secondary-button" disabled={!settings.developerMode} onClick={() => void loadPlugin()}><Package size={17} />从本地目录加载</button></>}

          {tab === 'data' && <><div className="settings-heading"><h3>本地数据</h3><p>事件记录和产物只保存在本地路径，不进行云同步。</p></div><div className="path-card"><span>会话事件</span><code>{health?.persistencePath}</code></div><div className="path-card"><span>应用数据</span><code>{appInfo?.dataPath}</code></div><p className="settings-footnote">清理和导入导出将在形成稳定迁移格式后开放，当前版本不会用“删除目录”冒充数据管理。</p></>}

          {tab === 'about' && <><div className="settings-heading"><h3>关于 Axon Auto Agent</h3><p>面向长期复杂任务的开源桌面 Agent 工作台。</p></div><div className="about-logo">A</div><div className="about-copy"><strong>Axon Auto Agent {appInfo?.version}</strong><span>Electron · React · DeepSeek Harness</span><p>Apache-2.0 licensed. DeepSeek Harness is pinned behind an explicit compatibility boundary.</p><button className="secondary-button about-update" onClick={() => void window.axonAutoAgent.app.checkForUpdates().then((result) => setNotice(result.message))}><RefreshCw size={16} />检查更新</button></div></>}
          {notice && <div className="settings-notice">{notice}</div>}
        </div>
      </div>
    </section>
  </div>
}
