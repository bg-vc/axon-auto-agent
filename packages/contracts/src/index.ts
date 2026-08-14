export type Identifier = string

export type RuntimeState = 'starting' | 'ready' | 'busy' | 'degraded' | 'stopped' | 'crashed'

export interface RuntimeStatus {
  state: RuntimeState
  version: string
  harnessVersion: string
  activeSessionIds: Identifier[]
  lastError?: string
  updatedAt: string
}

export interface WorkspaceRef {
  id: Identifier
  name: string
  path: string
  selectedAt: string
  writable: boolean
}

export type SessionState = 'idle' | 'running' | 'waiting_for_decision' | 'stopped' | 'failed'

export interface SessionSummary {
  id: Identifier
  title: string
  workspaceId?: Identifier
  state: SessionState
  modelId: string
  providerId: string
  createdAt: string
  updatedAt: string
  lastMessage?: string
  eventCount: number
  inputTokens?: number
  outputTokens?: number
}

export type ConversationEventType =
  | 'session/created'
  | 'user/message'
  | 'assistant/delta'
  | 'assistant/message'
  | 'assistant/thinking'
  | 'tool/requested'
  | 'tool/started'
  | 'tool/completed'
  | 'tool/failed'
  | 'decision/requested'
  | 'decision/resolved'
  | 'artifact/created'
  | 'run/started'
  | 'run/stopped'
  | 'run/failed'
  | 'run/completed'

export interface ConversationEvent<TPayload = unknown> {
  id: Identifier
  sessionId: Identifier
  seq: number
  timestamp: string
  type: ConversationEventType
  payload: TPayload
  transient?: boolean
}

export type DecisionRisk = 'workspace_write' | 'outside_workspace' | 'command' | 'network' | 'destructive'

export interface DecisionRequest {
  id: Identifier
  sessionId: Identifier
  title: string
  reason: string
  risk: DecisionRisk
  proposedAction: string
  createdAt: string
  expiresAt?: string
  status: 'pending' | 'approved' | 'denied'
}

export interface ArtifactDescriptor {
  id: Identifier
  sessionId: Identifier
  name: string
  path: string
  mediaType: string
  size: number
  createdAt: string
  previewable: boolean
}

export type ProviderKind = 'deepseek' | 'openai-compatible'

export interface ProviderConfiguration {
  id: Identifier
  kind: ProviderKind
  name: string
  endpoint: string
  model: string
  hasCredential: boolean
  enabled: boolean
  updatedAt: string
}

export interface ProviderConfigurationInput extends Omit<ProviderConfiguration, 'hasCredential' | 'updatedAt'> {
  apiKey?: string
}

export interface PluginDescriptor {
  id: Identifier
  name: string
  version: string
  source: 'builtin' | 'development'
  state: 'loaded' | 'disabled' | 'incompatible' | 'failed'
  capabilities: string[]
  path?: string
  error?: string
}

export interface AppSettings {
  language: 'zh-CN' | 'en-US'
  theme: 'dark' | 'system'
  launchAtLogin: boolean
  closeToTray: boolean
  defaultWorkspaceId?: Identifier
  activeProviderId: Identifier
  developerMode: boolean
  allowNetwork: boolean
  confirmWorkspaceWrites: boolean
  confirmCommands: boolean
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  dataPath: string
}

export interface ConversationSnapshot {
  session: SessionSummary
  events: ConversationEvent[]
  decisions: DecisionRequest[]
  artifacts: ArtifactDescriptor[]
}

export interface SendMessageInput {
  sessionId: Identifier
  content: string
  attachments?: string[]
}

export interface CreateSessionInput {
  title?: string
  workspaceId?: Identifier
  providerId?: Identifier
  modelId?: string
}

export interface RuntimeHealth {
  status: RuntimeStatus
  persistencePath: string
  pluginCount: number
  sessionCount: number
}

export interface DiagnosticsExport {
  path: string
  createdAt: string
}

export interface RuntimeRequest<T = unknown> {
  id: Identifier
  method: string
  params?: T
}

export interface RuntimeResponse<T = unknown> {
  id: Identifier
  ok: boolean
  result?: T
  error?: { code: string; message: string }
}

export interface RuntimePushEvent {
  channel: 'status' | 'conversation'
  payload: RuntimeStatus | ConversationEvent
}

export interface AxonAutoAgentBridge {
  app: {
    getInfo(): Promise<AppInfo>
    checkForUpdates(): Promise<{ currentVersion: string; availableVersion?: string; message: string }>
    quit(): Promise<boolean>
    subscribeStatus(listener: (status: RuntimeStatus) => void): () => void
  }
  workspace: {
    choose(): Promise<WorkspaceRef | null>
    chooseFiles(): Promise<string[]>
    listRecent(): Promise<WorkspaceRef[]>
    reveal(workspaceId: Identifier): Promise<boolean>
  }
  session: {
    list(): Promise<SessionSummary[]>
    create(input: CreateSessionInput): Promise<ConversationSnapshot>
    open(sessionId: Identifier): Promise<ConversationSnapshot>
    send(input: SendMessageInput): Promise<void>
    stop(sessionId: Identifier): Promise<void>
    resume(sessionId: Identifier): Promise<void>
    subscribe(listener: (event: ConversationEvent) => void): () => void
  }
  decision: { resolve(decisionId: Identifier, approved: boolean): Promise<void> }
  artifact: {
    open(artifactId: Identifier): Promise<boolean>
    reveal(artifactId: Identifier): Promise<boolean>
    saveAs(artifactId: Identifier): Promise<string | null>
    getPreviewUrl(artifactId: Identifier): Promise<string | null>
  }
  model: {
    list(): Promise<ProviderConfiguration[]>
    configure(input: ProviderConfigurationInput): Promise<ProviderConfiguration>
    test(providerId: Identifier): Promise<{ ok: boolean; message: string }>
  }
  plugin: {
    list(): Promise<PluginDescriptor[]>
    loadDevelopment(): Promise<PluginDescriptor | null>
    reloadDevelopment(pluginId: Identifier): Promise<PluginDescriptor>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  runtime: {
    getHealth(): Promise<RuntimeHealth>
    restart(): Promise<RuntimeStatus>
    exportDiagnostics(): Promise<DiagnosticsExport>
  }
}
