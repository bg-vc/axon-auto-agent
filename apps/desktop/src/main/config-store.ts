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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.persist()
    }
  }

  getSettings(): AppSettings { return structuredClone(this.config.settings) }
  getWorkspaces(): WorkspaceRef[] { return structuredClone(this.config.workspaces) }
  getProviders(): ProviderConfiguration[] { return structuredClone(this.config.providers) }
  getDevelopmentPluginPaths(): string[] { return [...this.config.developmentPluginPaths] }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.config.settings = { ...this.config.settings, ...patch }
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
    const current = this.config.providers.find((provider) => provider.id === input.id)
    const provider: ProviderConfiguration = {
      id: input.id,
      kind: input.kind,
      name: input.name,
      endpoint: input.endpoint.replace(/\/+$/, ''),
      model: input.model,
      enabled: input.enabled,
      hasCredential: Boolean(input.apiKey) || current?.hasCredential === true,
      updatedAt: now(),
    }
    this.config.providers = [...this.config.providers.filter((item) => item.id !== input.id), provider]
    if (input.apiKey) this.storeCredential(input.id, input.apiKey)
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
