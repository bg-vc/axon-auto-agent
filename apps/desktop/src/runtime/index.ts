import type { RuntimePushEvent, RuntimeRequest, RuntimeResponse } from '@axon-auto-agent/contracts'
import { RuntimeService } from './service.js'

interface ParentPort {
  on(event: 'message', listener: (message: { data: RuntimeRequest }) => void): void
  postMessage(message: RuntimeResponse | RuntimePushEvent): void
}

async function start(): Promise<void> {
  const parentPort = (process as typeof process & { parentPort?: ParentPort }).parentPort
  if (!parentPort) throw new Error('Axon runtime must be launched as an Electron utility process.')
  const dataPathIndex = process.argv.indexOf('--data-path')
  const dataPath = dataPathIndex >= 0 ? process.argv[dataPathIndex + 1] : undefined
  if (!dataPath) throw new Error('Runtime data path is required.')
  const service = new RuntimeService(dataPath, (event) => parentPort.postMessage(event))
  await service.initialize()
  parentPort.on('message', async ({ data: request }) => {
    const response: RuntimeResponse = { id: request.id, ok: true }
    try {
      response.result = await service.handle(request.method, request.params)
    } catch (error) {
      response.ok = false
      response.error = { code: 'RUNTIME_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
    parentPort.postMessage(response)
    if (request.method === 'runtime.shutdown') setTimeout(() => process.exit(0), 20)
  })
}

void start().catch((error) => { console.error(error); process.exit(1) })
