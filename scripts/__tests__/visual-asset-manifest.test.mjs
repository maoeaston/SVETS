import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import {
  approvedAssetsToResourceRows,
  buildVisualAssetResourceSql,
  validateVisualAssetManifest
} from '../lib/visual-asset-manifest.mjs'

const projectRoot = process.cwd()
const manifest = JSON.parse(readFileSync('doc/assets/asset-manifest.json', 'utf8'))

describe('visual asset manifest contract', () => {
  it('完整覆盖 v1.2.4 明确列出的 231 个交付资产和 6 个核心参考资产', () => {
    const result = validateVisualAssetManifest(manifest, { projectRoot })
    expect(result.errors).toEqual([])
    expect(result.summary).toEqual({ total: 237, approved: 0, planned: 237 })
  })

  it('运行时 ID 全部兼容 app://asset 协议，路径全小写', () => {
    for (const item of manifest.assets) {
      expect(item.asset_id).toMatch(/^asset_[a-z0-9_]+$/)
      expect(item.asset_id).toBe(`asset_${item.plan_key}`)
      expect(item.runtime_path).toBe(item.runtime_path.toLowerCase())
    }
  })

  it('未批准资产不会生成 asset_resource 行', () => {
    expect(approvedAssetsToResourceRows(manifest, projectRoot)).toEqual([])
  })

  it('静态 AI 资产优先 gpt-image-2，official 仅作为受控兜底', () => {
    const images = manifest.assets.filter((item) =>
      item.asset_type !== 'video'
      && ['ai_direct', 'ai_plus_overlay', 'composite'].includes(item.production_method)
    )
    expect(images.length).toBeGreaterThan(0)
    for (const item of images) {
      expect(item.model).toBe('gpt-image-2')
      expect(item.route).toBe('/v1/images/generations')
      expect(item.fallback_model).toBe('gpt-image-2-official')
      expect(item.fallback_route).toBe('/v1/images/generations')
      expect(item.fallback_allowed_when).toEqual(['primary_unavailable', 'manual_override'])
      expect(item.fallback_used).toBe(false)
      expect(item.fallback_reason).toBeNull()
      expect(Object.keys(item.generation_params).sort()).toEqual(['n', 'resolution', 'size'])
    }
  })

  it('74 个视频使用 Seedance 2.0、720p、静音视频接口', () => {
    const videos = manifest.assets.filter((item) => item.asset_type === 'video')
    expect(videos).toHaveLength(74)
    for (const item of videos) {
      expect(item.model).toBe('doubao-seedance-2.0')
      expect(item.route).toBe('/v1/videos/generations')
      expect(item.fallback_model).toBeNull()
      expect(item.fallback_allowed_when).toEqual([])
      expect(item.generation_params.size).toBe('16:9')
      expect(item.generation_params.resolution).toBe('720p')
      expect(item.generation_params.generate_audio).toBe(false)
      expect(item.generation_params.duration).toBe(item.category === 'A' ? 5 : 8)
      expect(Object.keys(item.generation_params).sort()).toEqual([
        'duration', 'generate_audio', 'resolution', 'size'
      ])
    }
  })

  it('A 类与 G 类视频分别使用测评和训练视频模板', () => {
    const assessmentVideos = manifest.assets.filter((item) => item.category === 'A')
    const trainingVideos = manifest.assets.filter((item) => item.category === 'G' && item.asset_type === 'video')
    expect(assessmentVideos).toHaveLength(68)
    expect(trainingVideos).toHaveLength(6)
    expect(assessmentVideos.every((item) =>
      item.prompt_template_id === 'video-action' && item.prompt_version === 'v1.2.4'
    )).toBe(true)
    expect(trainingVideos.every((item) =>
      item.prompt_template_id === 'offline-video' && item.prompt_version === 'v1.2.4'
    )).toBe(true)
  })

  it('AI 资产没有逐资产 prompt_text 时不能离开 planned', () => {
    const broken = structuredClone(manifest)
    const image = broken.assets.find((item) =>
      item.asset_type !== 'video'
      && ['ai_direct', 'ai_plus_overlay', 'composite'].includes(item.production_method)
    )
    image.lifecycle_status = 'generated'
    const result = validateVisualAssetManifest(broken, { projectRoot, checkFiles: false })
    expect(result.errors).toContain(
      `${image.asset_id}: AI/composite asset requires prompt_text before leaving planned`
    )
  })

  it('拒绝 official 主模型、图片模型视频、1080p 视频和无原因兜底', () => {
    const broken = structuredClone(manifest)
    const image = broken.assets.find((item) =>
      item.asset_type !== 'video'
      && ['ai_direct', 'ai_plus_overlay', 'composite'].includes(item.production_method)
    )
    const video = broken.assets.find((item) => item.asset_type === 'video')
    image.model = 'gpt-image-2-official'
    image.fallback_used = true
    video.model = 'gpt-image-2'
    video.generation_params.resolution = '1080p'

    const result = validateVisualAssetManifest(broken, { projectRoot, checkFiles: false })
    expect(result.errors).toContain(`${image.asset_id}: primary image model must be gpt-image-2`)
    expect(result.errors).toContain(`${image.asset_id}: fallback_used requires an allowed fallback_reason`)
    expect(result.errors).toContain(`${video.asset_id}: video model must be doubao-seedance-2.0`)
    expect(result.errors).toContain(`${video.asset_id}: video resolution must be 720p`)
  })

  it('approved 资产必须通过门禁、版权和文件 hash 校验', () => {
    const tempDir = join(projectRoot, '.tmp-visual-asset-test')
    const relativePath = '.tmp-visual-asset-test/demo.svg'
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(projectRoot, relativePath), '<svg></svg>', 'utf8')
    const hash = createHash('sha256').update('<svg></svg>').digest('hex')
    const approved = structuredClone(manifest.assets.find((item) => item.production_method === 'programmatic'))
    approved.category = 'REFERENCE'
    approved.priority = 'REFERENCE'
    approved.asset_type = 'reference'
    approved.asset_role = 'OTHER'
    approved.usage_mode = 'production'
    approved.reference_asset_ids = []
    approved.lifecycle_status = 'approved'
    approved.source_path = relativePath
    approved.runtime_path = relativePath
    approved.file_hash = hash
    approved.rights.commercial_use_cleared = true
    for (const gate of Object.values(approved.gate_reviews)) {
      if (gate.required) {
        gate.status = 'passed'
        gate.reviewer_name = gate.reviewer_kind === 'script' ? 'asset-validator' : '测试审核员'
        gate.reviewed_at = '2026-07-14'
      }
    }
    const testManifest = { ...manifest, assets: [approved] }
    try {
      const result = validateVisualAssetManifest(testManifest, {
        projectRoot,
        enforceBaselineCounts: false
      })
      expect(result.errors).toEqual([])
      const rows = approvedAssetsToResourceRows(testManifest, projectRoot)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        asset_id: approved.asset_id,
        app_uri: `app://asset/${approved.asset_id}`,
        status: 'ACTIVE'
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('SQL 只激活 approved 行，并将未列出的受管视觉资产降为 DEPRECATED', () => {
    const sql = buildVisualAssetResourceSql([
      {
        asset_id: 'asset_demo', asset_type: 'IMAGE', asset_role: 'QUESTION_MEDIA',
        app_uri: 'app://asset/asset_demo', local_path: 'resources/assets/demo.png',
        mime_type: 'image/png', file_hash: 'a'.repeat(64), file_size_bytes: 12,
        duration_ms: null, width_px: 10, height_px: 10, status: 'ACTIVE'
      }
    ], '2026-07-14T00:00:00Z')
    expect(sql).toContain("SET status = 'DEPRECATED'")
    expect(sql).toContain("asset_id NOT IN ('asset_demo')")
    expect(sql).toContain("'ACTIVE'")
  })

  it('生成 SQL 可在 SQLite 执行并正确替换受管视觉资产投影', async () => {
    const SQL = await initSqlJs({
      locateFile: (file) => join(projectRoot, 'node_modules', 'sql.js', 'dist', file)
    })
    const db = new SQL.Database()
    db.run(`CREATE TABLE asset_resource (
      asset_id TEXT PRIMARY KEY,
      asset_type TEXT NOT NULL,
      asset_role TEXT,
      app_uri TEXT NOT NULL UNIQUE,
      local_path TEXT NOT NULL,
      mime_type TEXT,
      file_hash TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      duration_ms INTEGER,
      width_px INTEGER,
      height_px INTEGER,
      status TEXT NOT NULL,
      last_verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`)
    db.run(`INSERT INTO asset_resource (
      asset_id, asset_type, asset_role, app_uri, local_path, mime_type,
      file_hash, file_size_bytes, status
    ) VALUES (
      'asset_legacy', 'IMAGE', 'QUESTION_MEDIA', 'app://asset/asset_legacy',
      'legacy.png', 'image/png', '${'b'.repeat(64)}', 1, 'ACTIVE'
    )`)
    const rows = [{
      asset_id: 'asset_demo', asset_type: 'IMAGE', asset_role: 'QUESTION_MEDIA',
      app_uri: 'app://asset/asset_demo', local_path: 'resources/assets/demo.png',
      mime_type: 'image/png', file_hash: 'a'.repeat(64), file_size_bytes: 12,
      duration_ms: null, width_px: 10, height_px: 10, status: 'ACTIVE'
    }]
    db.run(buildVisualAssetResourceSql(rows, '2026-07-14T00:00:00Z'))
    const result = db.exec('SELECT asset_id, status FROM asset_resource ORDER BY asset_id')[0].values
    expect(result).toEqual([
      ['asset_demo', 'ACTIVE'],
      ['asset_legacy', 'DEPRECATED']
    ])
    db.close()
  })
})
