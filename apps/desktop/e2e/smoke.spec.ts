import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('launches the production renderer and reaches the isolated Runtime', async () => {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'axon-auto-agent-e2e-'))
  const electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataPath}`],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window).toHaveTitle('Axon Auto Agent')
    await expect(window.getByRole('button', { name: '首页' })).toBeVisible()
    await expect(window.getByRole('heading', { name: /把目标交给 Agent/ })).toBeVisible()

    await expect.poll(async () => await window.evaluate(async () => {
      const [info, health] = await Promise.all([
        window.axonAutoAgent.app.getInfo(),
        window.axonAutoAgent.runtime.getHealth(),
      ])
      return { name: info.name, state: health.status.state, harnessVersion: health.status.harnessVersion }
    })).toMatchObject({ name: 'Axon Auto Agent', harnessVersion: '0.1.0-rc.6' })
    await expect.poll(async () => await window.evaluate(async () => (await window.axonAutoAgent.runtime.getHealth()).status.state))
      .toMatch(/ready|degraded/)
  } finally {
    await electronApp.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})

test('launches the packaged application bundle when supplied', async () => {
  const executablePath = process.env.AXON_PACKAGED_EXECUTABLE
  test.skip(!executablePath, 'Set AXON_PACKAGED_EXECUTABLE after package:mac to verify the app bundle.')

  const userDataPath = await mkdtemp(path.join(tmpdir(), 'axon-auto-agent-packaged-e2e-'))
  const electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataPath}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window).toHaveTitle('Axon Auto Agent')
    await expect(window.getByRole('heading', { name: /把目标交给 Agent/ })).toBeVisible()
    await expect.poll(async () => await window.evaluate(async () => {
      const [info, health] = await Promise.all([
        window.axonAutoAgent.app.getInfo(),
        window.axonAutoAgent.runtime.getHealth(),
      ])
      return { version: info.version, harnessVersion: health.status.harnessVersion }
    })).toEqual({ version: '0.1.0', harnessVersion: '0.1.0-rc.6' })
  } finally {
    await electronApp.close()
    await rm(userDataPath, { recursive: true, force: true })
  }
})
