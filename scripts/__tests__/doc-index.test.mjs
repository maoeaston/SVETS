import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectDocInventory,
  renderDocInventory,
  updateDocIndexContent
} from '../lib/doc-index.mjs'

const projectRoot = process.cwd()
const indexPath = join(projectRoot, 'doc', 'index.md')

describe('doc index generated inventory', () => {
  it('doc/index.md 与当前文件系统清单同步', () => {
    const current = readFileSync(indexPath, 'utf8')
    const expected = updateDocIndexContent(current, renderDocInventory(projectRoot))
    expect(current).toBe(expected)
  })

  it('自动清单收集的文件都存在，且不把 feature archive 内容混入活跃 feature', () => {
    const inventory = collectDocInventory(projectRoot)
    for (const paths of Object.values(inventory)) {
      for (const path of paths) expect(existsSync(path)).toBe(true)
    }
    expect(inventory.features.every((path) => !path.includes('/archive/'))).toBe(true)
    expect(inventory.archiveReadmes.length).toBeGreaterThan(0)
  })

  it('所有 Prompt 模板都声明 TEMPLATE_ID 和 VERSION', () => {
    const inventory = collectDocInventory(projectRoot)
    for (const path of inventory.promptTemplates) {
      const content = readFileSync(path, 'utf8')
      expect(content).toMatch(/^\[TEMPLATE_ID:\s*[^\]]+\]$/m)
      expect(content).toMatch(/^\[VERSION:\s*[^\]]+\]$/m)
    }
  })
})
