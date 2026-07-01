#!/usr/bin/env node
/**
 * Smoke：验证 Electron 在 WSLg 下能启动 + better-sqlite3 ABI 不崩 + renderer 加载登录页。
 *
 * 用法：node scripts/e2e/smoke.mjs
 */
import { _electron as electron } from 'playwright'

console.log('[smoke] 启动 Electron...')
const app = await electron.launch({
  args: ['out/main/index.js'],
  timeout: 30000
})

let window
try {
  // main 进程 stdout 自动转发到当前 shell；renderer console 走事件
  window = await app.firstWindow()

  window.on('console', (msg) => {
    console.log(`[renderer:${msg.type()}]`, msg.text())
  })
  window.on('pageerror', (err) => {
    console.log('[renderer:error]', err.message)
  })

  // 等 Vue mount → 登录表单出现（loadFile 不是 URL，networkidle 不触发，用 selector 兜底）
  await window.waitForSelector('#username', { timeout: 15000 })
  await window.waitForSelector('#password', { timeout: 5000 })

  const url   = window.url()
  const title = await window.title()
  console.log('[smoke] URL:', url)
  console.log('[smoke] Title:', title)

  const hasApi = await window.evaluate(() => typeof window.api === 'object')
  console.log('[smoke] window.api injected:', hasApi)

  await window.screenshot({ path: '/tmp/e2e-smoke.png', fullPage: true })
  console.log('[smoke] Screenshot: /tmp/e2e-smoke.png')

  console.log('[smoke] ✅ SMOKE OK')
} catch (err) {
  console.error('[smoke] ❌ FAILED:', err.message)
  try {
    if (window) await window.screenshot({ path: '/tmp/e2e-smoke-fail.png' })
  } catch {}
  process.exitCode = 1
} finally {
  await app.close()
}
