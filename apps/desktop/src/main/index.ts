import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol,
  session, shell, Tray, type IpcMainInvokeEvent,
} from 'electron'
import type {
  AppSettings, ArtifactDescriptor, CreateSessionInput, DiagnosticsExport,
  ProviderConfigurationInput, RuntimeHealth, RuntimeStatus, SendMessageInput,
} from '@axon-auto-agent/contracts'
import { autoUpdater } from 'electron-updater'
import { ConfigStore } from './config-store.js'
import { RuntimeSupervisor } from './runtime-supervisor.js'

protocol.registerSchemesAsPrivileged([
  { scheme: 'axon-artifact', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

app.setName('Axon Auto Agent')

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let runtime: RuntimeSupervisor
let config: ConfigStore
let isQuitting = false
let syncing = false

const trustedSender = (event: IpcMainInvokeEvent): void => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Rejected IPC call outside the main renderer frame.')
  }
  const url = event.senderFrame?.url ?? ''
  const builtRenderer = pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString()
  if (url === builtRenderer || url.startsWith(`${builtRenderer}#`)) return
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    try {
      if (new URL(url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin) return
    } catch { /* rejected below */ }
  }
  throw new Error('Rejected IPC call from an untrusted renderer.')
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    trustedSender(event)
    return await listener(event, ...args)
  })
}

function createTrayImage(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="white" stroke-width="1.8"/><path d="M6 15 10.2 6h1.7L16 15h-2l-1-2.4H9L8 15H6Zm3.7-4h2.6L11 7.8 9.7 11Z" fill="white"/></svg>`
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  image.setTemplateImage(true)
  return image
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1120, minHeight: 720,
    backgroundColor: '#171919', show: false,
    title: 'Axon Auto Agent', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('did-fail-load', (_event, code, description) => console.error(`Renderer failed to load (${code}): ${description}`))
  if (!app.isPackaged) window.webContents.on('console-message', (details) => { if (details.level === 'error') console.error(`[renderer] ${details.message}`) })
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== window.webContents.getURL()) event.preventDefault()
  })
  window.on('close', (event) => {
    if (!isQuitting && config.getSettings().closeToTray) { event.preventDefault(); window.hide() }
  })
  window.once('ready-to-show', () => window.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  return window
}

function createTray(): Tray {
  const item = new Tray(createTrayImage())
  item.setToolTip('Axon Auto Agent')
  item.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Axon Auto Agent', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: '退出', click: () => { void requestQuit() } },
  ]))
  item.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
  return item
}

async function syncRuntimeConfiguration(): Promise<void> {
  if (syncing || !runtime || runtime.status.state === 'starting' || runtime.status.state === 'stopped') return
  syncing = true
  try {
    const providers = config.getProviders().map((provider) => ({ ...provider, apiKey: config.getCredential(provider.id) }))
    await runtime.request('runtime.configure', { settings: config.getSettings(), providers, workspaces: config.getWorkspaces() })
    if (config.getSettings().developerMode) {
      for (const pluginPath of config.getDevelopmentPluginPaths()) {
        try { await runtime.request('plugin.load', { path: pluginPath }) } catch { /* shown in plugin inventory */ }
      }
    }
  } finally { syncing = false }
}

async function resolveArtifact(artifactId: string): Promise<string | null> {
  return await runtime.request<string | null>('artifact.resolve', { artifactId })
}

async function requestQuit(): Promise<boolean> {
  const active = runtime?.status.activeSessionIds ?? []
  if (active.length) {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: 'warning', buttons: ['取消', '停止任务并退出'], defaultId: 0, cancelId: 0,
      title: '仍有任务正在运行',
      message: `${active.length} 个 Agent 任务仍在运行。`,
      detail: '退出会停止运行时并保存已有事件；重新打开后可以恢复任务。',
    })
    if (result.response === 0) return false
  }
  isQuitting = true
  await runtime?.stop()
  app.quit()
  return true
}

function registerIpc(): void {
  handle('app:getInfo', () => ({ name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch, dataPath: app.getPath('userData') }))
  handle('app:checkForUpdates', async () => {
    if (!app.isPackaged) return { currentVersion: app.getVersion(), message: '开发版本不检查远程更新。' }
    try {
      const result = await autoUpdater.checkForUpdates()
      const availableVersion = result?.updateInfo.version
      return {
        currentVersion: app.getVersion(),
        availableVersion: availableVersion === app.getVersion() ? undefined : availableVersion,
        message: availableVersion === app.getVersion() ? '当前已是最新版本。' : `发现新版本 ${availableVersion}`,
      }
    } catch (error) {
      return { currentVersion: app.getVersion(), message: `暂时无法检查更新：${error instanceof Error ? error.message : String(error)}` }
    }
  })
  handle('app:quit', () => requestQuit())

  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择 Agent 工作区' })
    if (result.canceled || !result.filePaths[0]) return null
    const workspace = await config.addWorkspace(result.filePaths[0])
    await config.updateSettings({ defaultWorkspaceId: workspace.id })
    await syncRuntimeConfiguration()
    return workspace
  })
  handle('workspace:chooseFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'], title: '添加任务资料' })
    return result.canceled ? [] : result.filePaths
  })
  handle('workspace:listRecent', () => config.getWorkspaces())
  handle('workspace:reveal', async (_event, workspaceId) => {
    const workspace = config.getWorkspaces().find((item) => item.id === workspaceId)
    if (!workspace) return false
    shell.showItemInFolder(workspace.path)
    return true
  })

  handle('session:list', () => runtime.request('session.list'))
  handle('session:create', async (_event, rawInput) => {
    const input = rawInput as CreateSessionInput
    const settings = config.getSettings()
    const workspaceId = input.workspaceId ?? settings.defaultWorkspaceId
    const workspace = config.getWorkspaces().find((item) => item.id === workspaceId)
    const providerId = input.providerId ?? settings.activeProviderId
    const provider = config.getProviders().find((item) => item.id === providerId)
    const enriched = { ...input, workspaceId, providerId, workspace, provider: provider ? { ...provider, apiKey: config.getCredential(provider.id) } : undefined }
    return await runtime.request('session.create', enriched)
  })
  handle('session:open', (_event, sessionId) => runtime.request('session.open', { sessionId }))
  handle('session:send', (_event, input) => runtime.request('session.send', input as SendMessageInput))
  handle('session:stop', (_event, sessionId) => runtime.request('session.stop', { sessionId }))
  handle('session:resume', (_event, sessionId) => runtime.request('session.resume', { sessionId }))
  handle('decision:resolve', (_event, decisionId, approved) => runtime.request('decision.resolve', { decisionId, approved }))

  handle('artifact:open', async (_event, artifactId) => {
    const artifactPath = await resolveArtifact(String(artifactId)); if (!artifactPath) return false
    return (await shell.openPath(artifactPath)) === ''
  })
  handle('artifact:reveal', async (_event, artifactId) => {
    const artifactPath = await resolveArtifact(String(artifactId)); if (!artifactPath) return false
    shell.showItemInFolder(artifactPath); return true
  })
  handle('artifact:saveAs', async (_event, artifactId) => {
    const artifactPath = await resolveArtifact(String(artifactId)); if (!artifactPath) return null
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: path.basename(artifactPath) })
    if (result.canceled || !result.filePath) return null
    await copyFile(artifactPath, result.filePath); return result.filePath
  })
  handle('artifact:getPreviewUrl', async (_event, artifactId) => (await resolveArtifact(String(artifactId))) ? `axon-artifact://preview/${artifactId}` : null)

  handle('model:list', () => config.getProviders())
  handle('model:configure', async (_event, input) => {
    const provider = await config.configureProvider(input as ProviderConfigurationInput)
    await config.updateSettings({ activeProviderId: provider.id })
    await syncRuntimeConfiguration(); return provider
  })
  handle('model:test', async (_event, providerId) => { await syncRuntimeConfiguration(); return await runtime.request('model.test', { providerId }, 40_000) })

  handle('plugin:list', () => runtime.request('plugin.list'))
  handle('plugin:loadDevelopment', async () => {
    if (!config.getSettings().developerMode) throw new Error('请先在设置中启用开发者模式。')
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: '选择 DSH 插件目录' })
    if (result.canceled || !result.filePaths[0]) return null
    const plugin = await runtime.request('plugin.load', { path: result.filePaths[0] })
    await config.addDevelopmentPluginPath(result.filePaths[0]); return plugin
  })
  handle('plugin:reloadDevelopment', (_event, pluginId) => runtime.request('plugin.reload', { pluginId }))

  handle('settings:get', () => config.getSettings())
  handle('settings:update', async (_event, patch) => {
    const settings = await config.updateSettings(patch as Partial<AppSettings>)
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
    await syncRuntimeConfiguration(); return settings
  })
  handle('runtime:getHealth', () => runtime.request<RuntimeHealth>('runtime.health'))
  handle('runtime:restart', async () => { const status = await runtime.restart(); await syncRuntimeConfiguration(); return status })
  handle('runtime:exportDiagnostics', () => runtime.request<DiagnosticsExport>('runtime.exportDiagnostics'))
}

async function bootstrap(): Promise<void> {
  config = new ConfigStore(app.getPath('userData'))
  await config.initialize()
  runtime = new RuntimeSupervisor(path.join(app.getPath('userData'), 'runtime'))
  runtime.on('status', (status: RuntimeStatus) => {
    mainWindow?.webContents.send('axon:status', status)
    if (status.state === 'ready' || status.state === 'degraded') void syncRuntimeConfiguration()
  })
  runtime.on('conversation', (event) => mainWindow?.webContents.send('axon:conversation', event))
  await runtime.start()

  protocol.handle('axon-artifact', async (request) => {
    const artifactId = new URL(request.url).pathname.split('/').filter(Boolean).at(-1)
    if (!artifactId) return new Response('Not found', { status: 404 })
    const artifactPath = await resolveArtifact(artifactId)
    if (!artifactPath) return new Response('Not found', { status: 404 })
    return await net.fetch(pathToFileURL(artifactPath).toString())
  })
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptPolicy = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? "script-src 'self' 'unsafe-inline';" : "script-src 'self';"
    let connectPolicy = "connect-src 'self';"
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      const devUrl = new URL(process.env.ELECTRON_RENDERER_URL)
      const websocketOrigin = `${devUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${devUrl.host}`
      connectPolicy = `connect-src 'self' ${websocketOrigin};`
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [`default-src 'self'; ${scriptPolicy} img-src 'self' data: axon-artifact:; media-src 'self' axon-artifact:; frame-src 'self' axon-artifact:; style-src 'self' 'unsafe-inline'; ${connectPolicy}`] } })
  })
  registerIpc()
  mainWindow = createWindow()
  tray = createTray()
  await syncRuntimeConfiguration()
}

app.whenReady().then(bootstrap).catch((error) => {
  dialog.showErrorBox('Axon Auto Agent 无法启动', error instanceof Error ? error.message : String(error))
  app.quit()
})

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  else { mainWindow.show(); mainWindow.focus() }
})

app.on('before-quit', () => { isQuitting = true })
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !config?.getSettings().closeToTray) void requestQuit() })
