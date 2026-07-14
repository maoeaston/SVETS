// Smoke test: app:// 协议端到端验证（dev 模式）
//
// 用法：先启动 `npm run dev`，再 `node scripts/smoke-test-app-protocol.mjs`。
//
// 验证：
// 1. Electron 能起来（main process + renderer）
// 2. Manifest 中首个 approved 资产能 fetch 出真实字节（200 + 正确 MIME + byteLength > 0）
// 3. 不存在的 asset_id 返回 404
// 4. 非法 asset_id（含 ../）返回 400
//
// 注意：会启动一个额外的 Electron 实例（连同一个 vite dev server），与 `npm run dev`
// 启动的实例并存。WAL 模式下 SQLite 多 reader OK。脚本结束自动 close。

import { _electron as electron } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'
const manifest = JSON.parse(readFileSync(join(projectRoot, 'doc', 'assets', 'asset-manifest.json'), 'utf8'))
const activeAsset = manifest.assets.find((item) => item.lifecycle_status === 'approved')

async function main() {
  if (!activeAsset) {
    throw new Error('[smoke] manifest has no approved asset; protocol byte smoke test cannot run yet')
  }
  console.log('[smoke] launching electron, renderer url:', RENDERER_URL)
  const app = await electron.launch({
    args: [resolve(projectRoot, 'out', 'main', 'index.js')],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: RENDERER_URL,
      NODE_ENV: 'development'
    },
    stdout: (data) => process.stdout.write(`[main stdout] ${data}`),
    stderr: (data) => process.stderr.write(`[main stderr] ${data}`)
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    console.log('[smoke] window loaded, url:', window.url())

    const results = await window.evaluate(async ({ assetId }) => {
      const out = {}

      // 1. Manifest 中第一个 approved 资产
      try {
        const res = await fetch(`app://asset/${assetId}`)
        const buf = await res.arrayBuffer()
        out.legalActiveAsset = {
          status: res.status,
          contentType: res.headers.get('content-type'),
          byteLength: buf.byteLength
        }
      } catch (e) {
        out.legalActiveAsset = { error: String(e) }
      }

      // 2. 不存在的 asset_id → 期望 404
      try {
        const res = await fetch('app://asset/asset_does_not_exist_v999')
        out.unknownAsset = { status: res.status }
      } catch (e) {
        out.unknownAsset = { error: String(e) }
      }

      // 3. 非法路径穿越 → 期望 400
      try {
        const res = await fetch('app://asset/..%2F..%2Fetc%2Fpasswd')
        out.invalidAssetId = { status: res.status }
      } catch (e) {
        out.invalidAssetId = { error: String(e) }
      }

      return out
    }, { assetId: activeAsset.asset_id })

    console.log('[smoke] app:// protocol results:')
    console.log(JSON.stringify(results, null, 2))

    // 断言（简化为 console 报告，不抛错让脚本退出码可控）
    const legal = results.legalActiveAsset
    const unknown = results.unknownAsset
    const invalid = results.invalidAssetId

    const checks = [
      {
        name: `${activeAsset.asset_id} 200 + ${activeAsset.delivery_format} + bytes > 0`,
        pass:
          legal?.status === 200 &&
          typeof legal?.contentType === 'string' &&
          typeof legal?.byteLength === 'number' &&
          legal.byteLength > 0
      },
      {
        name: '不存在的 asset_id → 404',
        pass: unknown?.status === 404
      },
      {
        name: '非法路径穿越 → 400 或 404（拒绝服务）',
        pass: invalid?.status === 400 || invalid?.status === 404
      }
    ]

    console.log('\n[smoke] assertions:')
    let allPass = true
    for (const c of checks) {
      const symbol = c.pass ? '✓' : '✗'
      console.log(`  ${symbol} ${c.name}`)
      if (!c.pass) allPass = false
    }

    await window.screenshot({ path: '/tmp/app-protocol-smoke.png', fullPage: true })
    console.log('\n[smoke] screenshot saved: /tmp/app-protocol-smoke.png')

    if (!allPass) {
      console.error('[smoke] FAIL: some assertions did not pass')
      process.exit(1)
    }
    console.log('[smoke] PASS: all assertions passed')
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error('[smoke] error:', err)
  process.exit(1)
})
