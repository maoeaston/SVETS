import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  M5aContractScopeError,
  isM5aRestrictedContractPath,
  verifyM5aContractScope
} from '../lib/m5a-contract-scope.mjs'

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

function write(root, path, contents) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5a-scope-'))
  write(root, 'src/main/db/schema.sql', 'CREATE TABLE baseline(id TEXT);\n')
  write(root, 'src/main/db/migrations.ts', 'export const baseline = true\n')
  write(root, 'src/shared/types/ipc-api.ts', 'export type Api = {}\n')
  write(root, 'src/preload/index.ts', 'export const preload = true\n')
  write(root, 'src/renderer/src/main.ts', 'export const renderer = true\n')
  write(root, 'src/main/application/service.ts', 'export const allowed = true\n')
  write(root, 'package-lock.json', '{}\n')
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'M5A Scope Test'])
  git(root, ['config', 'user.email', 'm5a-scope@example.invalid'])
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'baseline'])
  return { root, base: git(root, ['rev-parse', 'HEAD']) }
}

function withFixture(run) {
  const context = fixture()
  try {
    return run(context)
  } finally {
    rmSync(context.root, { recursive: true, force: true })
  }
}

describe('M5A fixed-base contract scope', () => {
  it('recognizes the frozen restricted path families without blocking application code', () => {
    expect(isM5aRestrictedContractPath('src/main/db/schema.sql')).toBe(true)
    expect(isM5aRestrictedContractPath('src/main/db/migration-startup.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('src/main/db/report-migration.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('src/main/db/migration-backup.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('src/shared/types/event-payloads.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('src/preload/index.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('src/renderer/src/main.ts')).toBe(true)
    expect(isM5aRestrictedContractPath('package-lock.json')).toBe(true)
    expect(isM5aRestrictedContractPath('src/main/db/__tests__/migrations.test.ts')).toBe(false)
    expect(isM5aRestrictedContractPath('src/main/application/service.ts')).toBe(false)
  })

  it('passes allowed committed, index, working-tree and untracked changes while reporting every layer', () => withFixture(({ root, base }) => {
    write(root, 'src/main/application/committed.ts', 'export const committed = true\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-qm', 'allowed committed'])
    write(root, 'src/main/application/indexed.ts', 'export const indexed = true\n')
    git(root, ['add', 'src/main/application/indexed.ts'])
    write(root, 'src/main/application/service.ts', 'export const allowed = false\n')
    write(root, 'doc/allowed.md', '# allowed\n')

    const report = verifyM5aContractScope({ projectRoot: root, baseCommit: base })
    expect(report.violations).toEqual([])
    expect(report.layers.map((entry) => entry.name)).toEqual(['committed', 'index', 'working-tree', 'untracked'])
    expect(report.layers.find((entry) => entry.name === 'committed').paths).toContain('src/main/application/committed.ts')
    expect(report.layers.find((entry) => entry.name === 'index').paths).toContain('src/main/application/indexed.ts')
    expect(report.layers.find((entry) => entry.name === 'working-tree').paths).toContain('src/main/application/service.ts')
    expect(report.layers.find((entry) => entry.name === 'untracked').paths).toContain('doc/allowed.md')
  }))

  it('rejects a restricted change committed after the fixed base', () => withFixture(({ root, base }) => {
    write(root, 'src/main/db/schema.sql', 'CREATE TABLE changed(id TEXT);\n')
    git(root, ['add', 'src/main/db/schema.sql'])
    git(root, ['commit', '-qm', 'forbidden committed'])

    expect(() => verifyM5aContractScope({ projectRoot: root, baseCommit: base }))
      .toThrow(M5aContractScopeError)
    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
    } catch (error) {
      expect(error.report.violations).toContainEqual({ layer: 'committed', path: 'src/main/db/schema.sql' })
    }
  }))

  it('rejects a restricted staged change relative to the fixed base', () => withFixture(({ root, base }) => {
    write(root, 'src/shared/types/ipc-api.ts', 'export type Api = { changed: true }\n')
    git(root, ['add', 'src/shared/types/ipc-api.ts'])

    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
      throw new Error('expected scope failure')
    } catch (error) {
      expect(error).toBeInstanceOf(M5aContractScopeError)
      expect(error.report.violations).toContainEqual({ layer: 'index', path: 'src/shared/types/ipc-api.ts' })
    }
  }))

  it('rejects a restricted unstaged working-tree change relative to the fixed base', () => withFixture(({ root, base }) => {
    write(root, 'src/preload/index.ts', 'export const preload = false\n')

    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
      throw new Error('expected scope failure')
    } catch (error) {
      expect(error).toBeInstanceOf(M5aContractScopeError)
      expect(error.report.violations).toContainEqual({ layer: 'working-tree', path: 'src/preload/index.ts' })
    }
  }))

  it('rejects a restricted untracked file instead of silently ignoring it', () => withFixture(({ root, base }) => {
    write(root, 'src/renderer/src/new-api.ts', 'export const bypass = true\n')

    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
      throw new Error('expected scope failure')
    } catch (error) {
      expect(error).toBeInstanceOf(M5aContractScopeError)
      expect(error.report.violations).toContainEqual({ layer: 'untracked', path: 'src/renderer/src/new-api.ts' })
    }
  }))

  it('rejects a newly introduced production migration source', () => withFixture(({ root, base }) => {
    write(root, 'src/main/db/future-migration.ts', 'export const bypass = true\n')

    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
      throw new Error('expected scope failure')
    } catch (error) {
      expect(error).toBeInstanceOf(M5aContractScopeError)
      expect(error.report.violations).toContainEqual({ layer: 'untracked', path: 'src/main/db/future-migration.ts' })
    }
  }))

  it('rejects an ignored untracked restricted source', () => withFixture(({ root, base }) => {
    write(root, '.gitignore', 'src/renderer/src/ignored-api.ts\n')
    git(root, ['add', '.gitignore'])
    git(root, ['commit', '-qm', 'ignore restricted fixture'])
    write(root, 'src/renderer/src/ignored-api.ts', 'export const ignoredBypass = true\n')

    try {
      verifyM5aContractScope({ projectRoot: root, baseCommit: base })
      throw new Error('expected scope failure')
    } catch (error) {
      expect(error).toBeInstanceOf(M5aContractScopeError)
      expect(error.report.violations).toContainEqual({ layer: 'untracked', path: 'src/renderer/src/ignored-api.ts' })
      expect(error.report.layers.find((entry) => entry.name === 'untracked').status)
        .toContain('!!\tsrc/renderer/src/ignored-api.ts')
    }
  }))

  it('the repository CLI refuses a movable base override', () => {
    const result = spawnSync(process.execPath, ['scripts/verify-m5a-contract-scope.mjs', '--base', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      shell: false
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('base must remain fixed')
  })
})
