// Smoke test: app:// 协议端到端验证（dev 模式）
//
// 用法：先启动 `npm run dev`，再 `node scripts/smoke-test-app-protocol.mjs`。
//
// 验证：
// 1. Electron 能起来（main process + renderer）
// 2. app://asset/<asset_id> 能 fetch 出真实字节（200 + content-type image/png + byteLength > 0）
// 3. 不存在的 asset_id 返回 404
// 4. 非法 asset_id（含 ../）返回 400
//
// 注意：会启动一个额外的 Electron 实例（连同一个 vite dev server），与 `npm run dev`
// 启动的实例并存。WAL 模式下 SQLite 多 reader OK。脚本结束自动 close。

import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173'

async function main() {
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

    const results = await window.evaluate(async () => {
      const out = {}

      // 1. 合法 asset：DRG-BG01 货架底图（已知在 DB 且 ACTIVE）
      try {
        const res = await fetch('app://asset/asset_img_drg_bg01_shelf_board_v001')
        const buf = await res.arrayBuffer()
        out.legalActiveAsset = {
          status: res.status,
          contentType: res.headers.get('content-type'),
          byteLength: buf.byteLength
        }
      } catch (e) {
        out.legalActiveAsset = { error: String(e) }
      }

      // 2. 合法 asset：零食盒子素材
      try {
        const res = await fetch('app://asset/asset_img_drg_obj02_snack_box_blue_v002')
        const buf = await res.arrayBuffer()
        out.legalDragItem = {
          status: res.status,
          contentType: res.headers.get('content-type'),
          byteLength: buf.byteLength
        }
      } catch (e) {
        out.legalDragItem = { error: String(e) }
      }

      // 3. 不存在的 asset_id → 期望 404
      try {
        const res = await fetch('app://asset/asset_does_not_exist_v999')
        out.unknownAsset = { status: res.status }
      } catch (e) {
        out.unknownAsset = { error: String(e) }
      }

      // 4. DEPRECATED 的 asset → 期望 404（v001 总览图已被我们标记 DEPRECATED）
      try {
        const res = await fetch('app://asset/asset_img_drg_obj02_goods_pack_v001')
        out.deprecatedAsset = { status: res.status }
      } catch (e) {
        out.deprecatedAsset = { error: String(e) }
      }

      // 5. 非法路径穿越 → 期望 400
      try {
        const res = await fetch('app://asset/..%2F..%2Fetc%2Fpasswd')
        out.invalidAssetId = { status: res.status }
      } catch (e) {
        out.invalidAssetId = { error: String(e) }
      }

      return out
    })

    console.log('[smoke] app:// protocol results:')
    console.log(JSON.stringify(results, null, 2))

    // 断言（简化为 console 报告，不抛错让脚本退出码可控）
    const legal = results.legalActiveAsset
    const dragItem = results.legalDragItem
    const unknown = results.unknownAsset
    const deprecated = results.deprecatedAsset
    const invalid = results.invalidAssetId

    const checks = [
      {
        name: 'DRG-BG01 底图 200 + image/png + bytes > 0',
        pass:
          legal?.status === 200 &&
          legal?.contentType === 'image/png' &&
          typeof legal?.byteLength === 'number' &&
          legal.byteLength > 0
      },
      {
        name: '零食盒子素材 200 + image/png',
        pass:
          dragItem?.status === 200 && dragItem?.contentType === 'image/png'
      },
      {
        name: '不存在的 asset_id → 404',
        pass: unknown?.status === 404
      },
      {
        name: 'DEPRECATED asset → 404',
        pass: deprecated?.status === 404
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
