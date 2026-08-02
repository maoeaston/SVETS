import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userDataDir = mkdtempSync(join(tmpdir(), 'svets-m5b-ui-'))
let app
let passed = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  assert(existsSync('out/main/index.js'), 'out/main/index.js missing; run npm run build first')
  app = await electron.launch({
    args: ['--no-sandbox', 'out/main/index.js'],
    env: {
      ...process.env,
      SVETS_E2E: '1',
      SVETS_E2E_ACTIVATION_BYPASS: '1',
      SVETS_USER_DATA_DIR: userDataDir
    },
    timeout: 30000
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.waitForSelector('#username', { timeout: 15000 })
  const health = await page.evaluate(() => window.api.runtime.getHealth())
  assert(health.state === 'OPEN' && health.blockingCode === null, `unexpected runtime health ${JSON.stringify(health)}`)
  assert(await page.locator('.runtime-health-banner').count() === 0, 'read-only health banner is visible while runtime is OPEN')
  await page.locator('#username').fill('teacher')
  await page.locator('#password').fill('Teacher@123')
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/teacher/, { timeout: 10000 })
  const postLoginHealth = await page.evaluate(() => window.api.runtime.getHealth())
  assert(postLoginHealth.state === 'OPEN', 'runtime left OPEN after gate-only login')
  await page.evaluate(() => { window.location.hash = '#/teacher/students/new' })
  await page.waitForURL(/#\/teacher\/students\/new$/, { timeout: 10000 })
  const studentInputs = page.locator('.student-form input')
  await studentInputs.nth(0).fill('m5b_ui_smoke_student')
  await studentInputs.nth(1).fill('M5bSmoke@123')
  await studentInputs.nth(2).fill('M5bSmoke@123')
  await studentInputs.nth(3).fill('M5B 冒烟学生')
  await page.getByRole('button', { name: '创建档案' }).click()
  await page.waitForURL(/#\/teacher\/students$/, { timeout: 10000 })
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.waitForSelector('#username', { timeout: 10000 })
  assert(errors.length === 0, `renderer errors: ${errors.join('\n')}`)
  passed = true
  console.log('[m5b-ui] PASS health=OPEN login=PASS student-create=PASS logout=PASS')
} finally {
  await app?.close()
  if (passed) rmSync(userDataDir, { recursive: true, force: true })
  else console.error(`[m5b-ui] evidence preserved at ${userDataDir}`)
}
