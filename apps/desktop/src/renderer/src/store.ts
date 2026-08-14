import { create } from 'zustand'
import type {
  AppInfo, AppSettings, ConversationEvent, ConversationSnapshot, PluginDescriptor,
  ProviderConfiguration, ProviderConfigurationInput, RuntimeHealth, RuntimeStatus,
  SessionSummary, WorkspaceRef,
} from '@axon-auto-agent/contracts'

export type AppView = 'home' | 'agent' | 'profile'

interface AppState {
  initialized: boolean
  loading: boolean
  error?: string
  view: AppView
  settingsOpen: boolean
  appInfo?: AppInfo
  settings?: AppSettings
  runtime?: RuntimeStatus
  health?: RuntimeHealth
  workspaces: WorkspaceRef[]
  providers: ProviderConfiguration[]
  plugins: PluginDescriptor[]
  sessions: SessionSummary[]
  current?: ConversationSnapshot
  streamText: string
  thinkingText: string
  attachments: string[]
  initialize(): Promise<void>
  navigate(view: AppView): void
  openSettings(open?: boolean): void
  chooseWorkspace(): Promise<WorkspaceRef | null>
  chooseAttachments(): Promise<void>
  removeAttachment(path: string): void
  createSession(title?: string): Promise<void>
  openSession(sessionId: string): Promise<void>
  sendMessage(content: string): Promise<void>
  stopSession(): Promise<void>
  resumeSession(): Promise<void>
  resolveDecision(id: string, approved: boolean): Promise<void>
  saveProvider(input: ProviderConfigurationInput): Promise<ProviderConfiguration>
  testProvider(providerId: string): Promise<{ ok: boolean; message: string }>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  restartRuntime(): Promise<void>
  loadPlugin(): Promise<void>
  reloadPlugin(id: string): Promise<void>
  refresh(): Promise<void>
  clearError(): void
}

let subscribed = false
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const messageFromError = (error: unknown) => error instanceof Error ? error.message : String(error)

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  loading: false,
  view: 'home',
  settingsOpen: false,
  workspaces: [], providers: [], plugins: [], sessions: [],
  streamText: '', thinkingText: '', attachments: [],

  initialize: async () => {
    if (get().initialized) return
    set({ loading: true })
    try {
      const [appInfo, settings, workspaces, providers, plugins, sessions, health] = await Promise.all([
        window.axonAutoAgent.app.getInfo(), window.axonAutoAgent.settings.get(),
        window.axonAutoAgent.workspace.listRecent(), window.axonAutoAgent.model.list(),
        window.axonAutoAgent.plugin.list(), window.axonAutoAgent.session.list(),
        window.axonAutoAgent.runtime.getHealth(),
      ])
      set({ appInfo, settings, workspaces, providers, plugins, sessions, health, runtime: health.status, initialized: true, loading: false })
      if (!subscribed) {
        subscribed = true
        window.axonAutoAgent.app.subscribeStatus((runtime) => set({ runtime }))
        window.axonAutoAgent.session.subscribe((event) => {
          const state = get()
          if (event.sessionId === state.current?.session.id) {
            const payload = event.payload as { content?: string }
            if (event.transient && event.type === 'assistant/delta') set({ streamText: get().streamText + (payload.content ?? '') })
            else if (event.transient && event.type === 'assistant/thinking') set({ thinkingText: get().thinkingText + (payload.content ?? '') })
            else {
              if (event.type === 'assistant/message') set({ streamText: '', thinkingText: '' })
              if (refreshTimer) clearTimeout(refreshTimer)
              refreshTimer = setTimeout(() => { void get().openSession(event.sessionId); void get().refresh() }, 60)
            }
          } else if (!event.transient) void get().refresh()
        })
      }
    } catch (error) { set({ error: messageFromError(error), loading: false }) }
  },

  navigate: (view) => set({ view }),
  openSettings: (open = true) => set({ settingsOpen: open }),
  clearError: () => set({ error: undefined }),

  refresh: async () => {
    try {
      const [workspaces, providers, plugins, sessions, health, settings] = await Promise.all([
        window.axonAutoAgent.workspace.listRecent(), window.axonAutoAgent.model.list(),
        window.axonAutoAgent.plugin.list(), window.axonAutoAgent.session.list(),
        window.axonAutoAgent.runtime.getHealth(), window.axonAutoAgent.settings.get(),
      ])
      set({ workspaces, providers, plugins, sessions, health, runtime: health.status, settings })
    } catch (error) { set({ error: messageFromError(error) }) }
  },

  chooseWorkspace: async () => {
    try {
      const workspace = await window.axonAutoAgent.workspace.choose()
      if (workspace) await get().refresh()
      return workspace
    } catch (error) { set({ error: messageFromError(error) }); return null }
  },

  chooseAttachments: async () => {
    try {
      const files = await window.axonAutoAgent.workspace.chooseFiles()
      set({ attachments: [...new Set([...get().attachments, ...files])] })
    } catch (error) { set({ error: messageFromError(error) }) }
  },
  removeAttachment: (filePath) => set({ attachments: get().attachments.filter((item) => item !== filePath) }),

  createSession: async (title) => {
    set({ loading: true })
    try {
      let settings = get().settings
      if (!settings?.defaultWorkspaceId) {
        const workspace = await get().chooseWorkspace()
        if (!workspace) { set({ loading: false }); return }
        settings = await window.axonAutoAgent.settings.get()
      }
      const snapshot = await window.axonAutoAgent.session.create({ title, workspaceId: settings?.defaultWorkspaceId, providerId: settings?.activeProviderId })
      set({ current: snapshot, view: 'agent', streamText: '', thinkingText: '', loading: false })
      await get().refresh()
    } catch (error) { set({ error: messageFromError(error), loading: false }) }
  },

  openSession: async (sessionId) => {
    try {
      const snapshot = await window.axonAutoAgent.session.open(sessionId)
      set({ current: snapshot, view: 'agent' })
    } catch (error) { set({ error: messageFromError(error) }) }
  },

  sendMessage: async (content) => {
    const text = content.trim()
    if (!text) return
    try {
      if (!get().current) await get().createSession(text.slice(0, 42))
      const sessionId = get().current?.session.id
      if (!sessionId) return
      const attachments = get().attachments
      set({ attachments: [], streamText: '', thinkingText: '' })
      await window.axonAutoAgent.session.send({ sessionId, content: text, attachments })
      await get().openSession(sessionId)
    } catch (error) { set({ error: messageFromError(error) }) }
  },

  stopSession: async () => { const id = get().current?.session.id; if (id) await window.axonAutoAgent.session.stop(id) },
  resumeSession: async () => { const id = get().current?.session.id; if (id) await window.axonAutoAgent.session.resume(id) },
  resolveDecision: async (id, approved) => { try { await window.axonAutoAgent.decision.resolve(id, approved) } catch (error) { set({ error: messageFromError(error) }) } },

  saveProvider: async (input) => {
    const provider = await window.axonAutoAgent.model.configure(input)
    await get().refresh(); return provider
  },
  testProvider: async (providerId) => await window.axonAutoAgent.model.test(providerId),
  updateSettings: async (patch) => { try { const settings = await window.axonAutoAgent.settings.update(patch); set({ settings }) } catch (error) { set({ error: messageFromError(error) }) } },
  restartRuntime: async () => { try { const runtime = await window.axonAutoAgent.runtime.restart(); set({ runtime }); await get().refresh() } catch (error) { set({ error: messageFromError(error) }) } },
  loadPlugin: async () => { try { await window.axonAutoAgent.plugin.loadDevelopment(); await get().refresh() } catch (error) { set({ error: messageFromError(error) }) } },
  reloadPlugin: async (id) => { try { await window.axonAutoAgent.plugin.reloadDevelopment(id); await get().refresh() } catch (error) { set({ error: messageFromError(error) }) } },
}))
