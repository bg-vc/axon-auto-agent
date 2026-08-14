import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginDescriptor } from '@axon-auto-agent/contracts'
import { PINNED_HARNESS_VERSION } from './harness.js'

interface PackageManifest {
  name?: string
  version?: string
  type?: string
  main?: string
  module?: string
  exports?: string | Record<string, unknown>
  dsh?: { capabilities?: string[]; harnessVersion?: string }
}

const pluginIdPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function assertInsidePlugin(directoryPath: string, entryPath: string): void {
  const relative = path.relative(path.resolve(directoryPath), entryPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Plugin entry must stay inside the selected plugin directory.')
  }
}

export async function validateDevelopmentPlugin(directoryPath: string, execute = false): Promise<PluginDescriptor> {
  const packagePath = path.join(directoryPath, 'package.json')
  try {
    await access(packagePath)
    const manifest = JSON.parse(await readFile(packagePath, 'utf8')) as PackageManifest
    if (!manifest.name || !manifest.version) throw new Error('Plugin package.json requires name and version.')
    if (!pluginIdPattern.test(manifest.name)) throw new Error('Plugin name must be a valid lowercase package identifier.')
    if (!versionPattern.test(manifest.version)) throw new Error('Plugin version must be a valid semantic version.')
    if (manifest.dsh?.capabilities !== undefined && (
      !Array.isArray(manifest.dsh.capabilities)
      || manifest.dsh.capabilities.some((capability) => typeof capability !== 'string' || !capability.trim())
    )) throw new Error('Plugin capabilities must be an array of non-empty strings.')
    const expected = manifest.dsh?.harnessVersion
    if (expected && expected !== PINNED_HARNESS_VERSION) {
      return {
        id: manifest.name,
        name: manifest.name,
        version: manifest.version,
        source: 'development',
        state: 'incompatible',
        capabilities: manifest.dsh?.capabilities ?? [],
        path: directoryPath,
        error: `Requires Harness ${expected}; desktop pins ${PINNED_HARNESS_VERSION}.`,
      }
    }
    const entry = manifest.module ?? manifest.main
    if (!entry) throw new Error('Plugin package.json requires a module or main entry.')
    const entryPath = path.resolve(directoryPath, entry)
    assertInsidePlugin(directoryPath, entryPath)
    await access(entryPath)
    if (execute) await import(`${pathToFileURL(entryPath).href}?reload=${Date.now()}`)
    return {
      id: manifest.name,
      name: manifest.name,
      version: manifest.version,
      source: 'development',
      state: 'loaded',
      capabilities: manifest.dsh?.capabilities ?? [],
      path: directoryPath,
    }
  } catch (error) {
    return {
      id: `invalid:${path.basename(directoryPath)}`,
      name: path.basename(directoryPath),
      version: 'unknown',
      source: 'development',
      state: 'failed',
      capabilities: [],
      path: directoryPath,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
