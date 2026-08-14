import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type { AppSettings, ProviderConfiguration, ProviderConfigurationInput, WorkspaceRef } from '@axon-auto-agent/contracts'

interface StoredCredential { providerId: string; encrypted: string }

interface DesktopConfig {
  settings: AppSettings
  workspaces: WorkspaceRef[]
  providers: ProviderConfiguration[]
  credentials: StoredCredential[]
  developmentPluginPaths: string[]
}

const now = () => new Date().toISOString()

function defaults(): DesktopConfig {
  return {
    settings: {
      language: 'zh-CN',
      theme: 'dark',
      launchAtLogin: false,
      closeToTray: true,
      activeProviderId: 'deepseek',
      developerMode: false,
      allowNetwork: true,
      confirmWorkspaceWrites: true,
      confirmCommands: true,
    },
    workspaces: [],
    providers: [
      {
        id: 'deepseek', kind: 'deepseek', name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
        hasCredential: false, enabled: true, updatedAt: now(),
      },
      {
        id: 'openai-compatible', kind: 'openai-compatible', name: 'OpenAI Compatible',
        endpoint: 'https://api.openai.com/v1', model: 'gpt-5.1',
        hasCredential: false, enabled: true, updatedAt: now(),
      },
    ],
    credentials: [],
    developmentPluginPaths: [],
  }
}

export class ConfigStore {
  private config: DesktopConfig = defaults()
  private readonly configPath: string

  constructor(private readonly dataPath: string) {
    this.configPath = path.join(dataPath, 'desktop-config.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataPath, { recursive: true })
    try {
      const stored = JSON.parse(await readFile(this.configPath, 'utf8')) as Partial<DesktopConfig>
      const initial = defaults()
      this.config = {
        ...initial,
        ...stored,
        settings: { ...initial.settings, ...stored.settings },
        providers: stored.providers?.length ? stored.providers : initial.providers,
        workspaces: stored.workspaces ?? [],
        credentials: stored.credentials ?? [],
        developmentPluginPaths: stored.developmentPluginPaths ?? [],
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        await rename(this.configPath, `${this.configPath}.corrupt-${Date.now()}`).catch(() => undefined)
        this.config = defaults()
      }
      await this.persist()
    }
  }

  getSettings(): AppSettings { return structuredClone(this.config.settings) }
  getWorkspaces(): WorkspaceRef[] { return structuredClone(this.config.workspaces) }
  getProviders(): ProviderConfiguration[] { return structuredClone(this.config.providers) }
  getDevelopmentPluginPaths(): string[] { return [...this.config.developmentPluginPaths] }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...this.config.settings }
    if (patch.language !== undefined) {
      if (patch.language !== 'zh-CN' && patch.language !== 'en-US') throw new Error('Unsupported language setting.')
      next.language = patch.language
    }
    if (patch.theme !== undefined) {
      if (patch.theme !== 'dark' && patch.theme !== 'system') throw new Error('Unsupported theme setting.')
      next.theme = patch.theme
    }
    for (const key of ['launchAtLogin', 'closeToTray', 'developerMode', 'allowNetwork', 'confirmWorkspaceWrites', 'confirmCommands'] as const) {
      if (patch[key] !== undefined) {
        if (typeof patch[key] !== 'boolean') throw new Error(`Invalid boolean setting: ${key}`)
        next[key] = patch[key]
      }
    }
    if (patch.defaultWorkspaceId !== undefined) {
      if (!this.config.workspaces.some((workspace) => workspace.id === patch.defaultWorkspaceId)) throw new Error('Unknown default workspace.')
      next.defaultWorkspaceId = patch.defaultWorkspaceId
    }
    if (patch.activeProviderId !== undefined) {
      if (!this.config.providers.some((provider) => provider.id === patch.activeProviderId)) throw new Error('Unknown model provider.')
      next.activeProviderId = patch.activeProviderId
    }
    this.config.settings = next
    await this.persist()
    return this.getSettings()
  }

  async addWorkspace(workspacePath: string): Promise<WorkspaceRef> {
    const existing = this.config.workspaces.find((workspace) => workspace.path === workspacePath)
    if (existing) {
      existing.selectedAt = now()
      await this.persist()
      return structuredClone(existing)
    }
    const workspace: WorkspaceRef = {
      id: randomUUID(), name: path.basename(workspacePath), path: workspacePath,
      selectedAt: now(), writable: true,
    }
    this.config.workspaces.unshift(workspace)
    this.config.workspaces = this.config.workspaces.slice(0, 12)
    await this.persist()
    return structuredClone(workspace)
  }

  async configureProvider(input: ProviderConfigurationInput): Promise<ProviderConfiguration> {
    if (!input.id?.trim() || !input.name?.trim() || !input.model?.trim()) throw new Error('Provider name, ID, and model are required.')
    const providerId = input.id.trim()
    if (input.kind !== 'deepseek' && input.kind !== 'openai-compatible') throw new Error('Unsupported provider kind.')
    let endpoint: URL
    try { endpoint = new URL(input.endpoint) } catch { throw new Error('Provider endpoint is not a valid URL.') }
    const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)
    if (endpoint.protocol !== 'https:' && !localHttp) throw new Error('Provider endpoint must use HTTPS, except for a local development endpoint.')
    if (endpoint.username || endpoint.password) throw new Error('Provider endpoint cannot contain credentials.')
    const current = this.config.providers.find((provider) => provider.id === providerId)
    const provider: ProviderConfiguration = {
      id: providerId,
      kind: input.kind,
      name: input.name.trim().slice(0, 80),
      endpoint: endpoint.toString().replace(/\/+$/, ''),
      model: input.model.trim().slice(0, 160),
      enabled: input.enabled === true,
      hasCredential: Boolean(input.apiKey) || current?.hasCredential === true,
      updatedAt: now(),
    }
    this.config.providers = [...this.config.providers.filter((item) => item.id !== providerId), provider]
    if (input.apiKey) this.storeCredential(providerId, input.apiKey)
    await this.persist()
    return structuredClone(provider)
  }

  getCredential(providerId: string): string | undefined {
    const stored = this.config.credentials.find((credential) => credential.providerId === providerId)
    if (!stored) return undefined
    if (!safeStorage.isEncryptionAvailable()) return undefined
    try { return safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')) } catch { return undefined }
  }

  async addDevelopmentPluginPath(pluginPath: string): Promise<void> {
    this.config.developmentPluginPaths = [pluginPath, ...this.config.developmentPluginPaths.filter((item) => item !== pluginPath)]
    await this.persist()
  }

  private storeCredential(providerId: string, apiKey: string): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential encryption is unavailable.')
    const encrypted = safeStorage.encryptString(apiKey).toString('base64')
    this.config.credentials = [...this.config.credentials.filter((item) => item.providerId !== providerId), { providerId, encrypted }]
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.configPath)
  }
}
