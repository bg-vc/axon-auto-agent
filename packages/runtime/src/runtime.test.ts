import { describe, expect, it } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { inspectHarnessCompatibility, resolveWorkspacePath, resolveWorkspacePathSecure, validateDevelopmentPlugin } from './index.js'

describe('runtime boundary', () => {
  it('rejects paths outside the workspace', () => {
    const root = path.resolve('/tmp/axon-workspace')
    expect(() => resolveWorkspacePath(root, '../secret.txt')).toThrow(/outside/)
    expect(resolveWorkspacePath(root, 'report.md')).toBe(path.join(root, 'report.md'))
  })

  it('pins a real Harness release', () => {
    const compatibility = inspectHarnessCompatibility()
    expect(compatibility.expected).toBe('0.1.0-rc.6')
  })

  it.skipIf(process.platform === 'win32')('rejects symbolic-link escapes for reads and new files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'axon-workspace-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'axon-outside-'))
    try {
      await mkdir(path.join(root, 'safe'))
      await writeFile(path.join(outside, 'secret.txt'), 'not available to the workspace')
      await symlink(outside, path.join(root, 'safe', 'escape'))

      await expect(resolveWorkspacePathSecure(root, 'safe/escape/secret.txt')).rejects.toThrow(/symbolic link/)
      await expect(resolveWorkspacePathSecure(root, 'safe/escape/new.txt', { allowMissing: true })).rejects.toThrow(/symbolic link/)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('validates development plugin identity, compatibility, capabilities, and entry boundary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'axon-plugin-'))
    try {
      await writeFile(path.join(root, 'index.mjs'), 'export default {}\n')
      await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: '@axon/example-plugin', version: '1.2.3', type: 'module', main: 'index.mjs',
        dsh: { harnessVersion: '0.1.0-rc.6', capabilities: ['evaluator'] },
      }))
      await expect(validateDevelopmentPlugin(root)).resolves.toMatchObject({
        id: '@axon/example-plugin', state: 'loaded', capabilities: ['evaluator'],
      })

      await writeFile(path.join(root, 'package.json'), JSON.stringify({
        name: 'escape-plugin', version: '1.0.0', main: '../outside.mjs', dsh: { capabilities: [] },
      }))
      await expect(validateDevelopmentPlugin(root)).resolves.toMatchObject({ state: 'failed', error: expect.stringMatching(/inside/) })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
