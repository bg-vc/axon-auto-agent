import { createRequire } from 'node:module'

export const PINNED_HARNESS_VERSION = '0.1.0-rc.6'

export interface HarnessCompatibility {
  installed: boolean
  compatible: boolean
  expected: string
  actual: string
  packagePath?: string
  error?: string
}

export function inspectHarnessCompatibility(): HarnessCompatibility {
  try {
    const require = createRequire(import.meta.url)
    const packagePath = require.resolve('@deepseek-ai/dsh/package.json')
    const packageJson = require(packagePath) as { version?: string }
    const actual = packageJson.version ?? 'unknown'
    return {
      installed: true,
      compatible: actual === PINNED_HARNESS_VERSION,
      expected: PINNED_HARNESS_VERSION,
      actual,
      packagePath,
    }
  } catch (error) {
    return {
      installed: false,
      compatible: false,
      expected: PINNED_HARNESS_VERSION,
      actual: 'missing',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
