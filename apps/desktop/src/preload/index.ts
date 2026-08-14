import { contextBridge, ipcRenderer } from 'electron'
import type { AxonAutoAgentBridge, ConversationEvent, RuntimeStatus } from '@axon-auto-agent/contracts'

const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const bridge: AxonAutoAgentBridge = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    quit: () => ipcRenderer.invoke('app:quit'),
    subscribeStatus: (listener: (status: RuntimeStatus) => void) => subscribe('axon:status', listener),
  },
  workspace: {
    choose: () => ipcRenderer.invoke('workspace:choose'),
    chooseFiles: () => ipcRenderer.invoke('workspace:chooseFiles'),
    listRecent: () => ipcRenderer.invoke('workspace:listRecent'),
    reveal: (workspaceId) => ipcRenderer.invoke('workspace:reveal', workspaceId),
  },
  session: {
    list: () => ipcRenderer.invoke('session:list'),
    create: (input) => ipcRenderer.invoke('session:create', input),
    open: (sessionId) => ipcRenderer.invoke('session:open', sessionId),
    send: (input) => ipcRenderer.invoke('session:send', input),
    stop: (sessionId) => ipcRenderer.invoke('session:stop', sessionId),
    resume: (sessionId) => ipcRenderer.invoke('session:resume', sessionId),
    subscribe: (listener: (event: ConversationEvent) => void) => subscribe('axon:conversation', listener),
  },
  decision: { resolve: (decisionId, approved) => ipcRenderer.invoke('decision:resolve', decisionId, approved) },
  artifact: {
    open: (artifactId) => ipcRenderer.invoke('artifact:open', artifactId),
    reveal: (artifactId) => ipcRenderer.invoke('artifact:reveal', artifactId),
    saveAs: (artifactId) => ipcRenderer.invoke('artifact:saveAs', artifactId),
    getPreviewUrl: (artifactId) => ipcRenderer.invoke('artifact:getPreviewUrl', artifactId),
  },
  model: {
    list: () => ipcRenderer.invoke('model:list'),
    configure: (input) => ipcRenderer.invoke('model:configure', input),
    test: (providerId) => ipcRenderer.invoke('model:test', providerId),
  },
  plugin: {
    list: () => ipcRenderer.invoke('plugin:list'),
    loadDevelopment: () => ipcRenderer.invoke('plugin:loadDevelopment'),
    reloadDevelopment: (pluginId) => ipcRenderer.invoke('plugin:reloadDevelopment', pluginId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  runtime: {
    getHealth: () => ipcRenderer.invoke('runtime:getHealth'),
    restart: () => ipcRenderer.invoke('runtime:restart'),
    exportDiagnostics: () => ipcRenderer.invoke('runtime:exportDiagnostics'),
  },
}

contextBridge.exposeInMainWorld('axonAutoAgent', bridge)
