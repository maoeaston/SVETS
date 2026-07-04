import { existsSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'
import { getDatabase } from '../db/connection'

// asset_id 命名规则：asset_<小写字母数字下划线>。禁止 . / 等可被路径穿越利用的字符。
const ASSET_ID_RE = /^asset_[a-z0-9_]+$/i

/**
 * 解析 app://asset/<asset_id> URL。
 * 合法返回 { assetId }；非法（协议不匹配、host 错、asset_id 格式不合法）返回 null。
 * 抽成纯函数便于单测，不依赖 Electron runtime。
 */
export function parseAppAssetUrl(url: string): { assetId: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app:' || parsed.host !== 'asset') return null
  const assetId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  if (!ASSET_ID_RE.test(assetId)) return null
  return { assetId }
}

/**
 * 返回 asset_resource.local_path 的解析基准目录。
 *
 * - dev 模式：electron-vite 把 main 编译到 out/main/index.js 再运行，
 *   app.getAppPath() = <projectRoot>/out/main，上溯两级才是项目根（AIimages/ 所在位置）
 * - 打包模式（未来）：资源会放在 process.resourcesPath
 */
function getAssetsBasePath(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return resolve(app.getAppPath(), '..', '..')
}

/**
 * 注册 app:// 协议处理器。必须在 app.whenReady() 之后、createWindow 之前调用，
 * 且要求 getDatabase() 已初始化（依赖 initDatabase() 先跑）。
 *
 * 协议路径：app://asset/<asset_id>
 * 查 asset_resource WHERE asset_id = ? AND status = 'ACTIVE'，
 * 将 local_path 解析为绝对路径后用 net.fetch(file://...) 返回字节流。
 *
 * 安全：
 * 1. asset_id 必须匹配命名正则（防 ../ 注入）
 * 2. 解析后的绝对路径必须在基准目录之内（兜底防穿越）
 * 3. 只服务 status='ACTIVE' 的资产，DEPRECATED/MISSING/CORRUPTED 一律 404
 */
export function registerAppAssetProtocol(): void {
  protocol.handle('app', async (request) => {
    const parsed = parseAppAssetUrl(request.url)
    if (!parsed) {
      return new Response('bad request: invalid app:// URL', { status: 400 })
    }

    const db = getDatabase()
    const row = db
      .prepare(
        'SELECT local_path, mime_type, status FROM asset_resource WHERE asset_id = ?'
      )
      .get(parsed.assetId) as
      | { local_path: string; mime_type: string | null; status: string }
      | undefined

    if (!row || row.status !== 'ACTIVE') {
      return new Response('asset not found or not active', { status: 404 })
    }

    const basePath = getAssetsBasePath()
    const absPath = resolve(basePath, row.local_path)
    const rel = relative(basePath, absPath)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return new Response('forbidden: path escapes app root', { status: 403 })
    }
    if (!existsSync(absPath)) {
      return new Response('file missing on disk', { status: 404 })
    }

    return net.fetch(pathToFileURL(absPath).toString())
  })
}
