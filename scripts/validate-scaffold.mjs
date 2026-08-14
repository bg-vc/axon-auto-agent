import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'README.md',
  'README.zh-CN.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY.md',
  'LICENSE',
  'docs/ARCHITECTURE.md',
  'docs/ROADMAP.md',
  'docs/GUI-PRINCIPLES.md',
  'docs/assets/axon-auto-agent-hero.svg',
  'docs/assets/axon-auto-agent-hero.zh-CN.svg',
  'docs/assets/axon-auto-agent-architecture.svg',
  'docs/assets/axon-auto-agent-architecture.zh-CN.svg',
]

const missing = required.filter(path => !existsSync(resolve(root, path)))
if (missing.length) {
  throw new Error(`Missing required scaffold files:\n${missing.join('\n')}`)
}

const readmePairs = [
  ['README.md', 'docs/assets/axon-auto-agent-hero.svg'],
  ['README.md', 'docs/assets/axon-auto-agent-architecture.svg'],
  ['README.zh-CN.md', 'docs/assets/axon-auto-agent-hero.zh-CN.svg'],
  ['README.zh-CN.md', 'docs/assets/axon-auto-agent-architecture.zh-CN.svg'],
]

for (const [readme, asset] of readmePairs) {
  const content = readFileSync(resolve(root, readme), 'utf8')
  if (!content.includes(asset)) {
    throw new Error(`${readme} must reference ${asset}`)
  }
}

const english = readFileSync(resolve(root, 'README.md'), 'utf8')
const chinese = readFileSync(resolve(root, 'README.zh-CN.md'), 'utf8')
for (const marker of ['DeepSeek Harness', 'autoresearch', 'Apache-2.0']) {
  if (!english.includes(marker) || !chinese.includes(marker)) {
    throw new Error(`Both README files must contain ${marker}`)
  }
}

const roadmap = readFileSync(resolve(root, 'docs/ROADMAP.md'), 'utf8')
if (!roadmap.includes('- [ ]')) {
  throw new Error('docs/ROADMAP.md must contain concrete open work')
}

console.log(`Scaffold validation passed (${required.length} required files).`)
