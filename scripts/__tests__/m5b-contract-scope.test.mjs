import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  M5bContractScopeError,
  allowedM5bPathsForStep,
  compareM5bWorktreeSnapshot,
  verifyM5bContractScope
} from '../lib/m5b-contract-scope.mjs'

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: root, encoding, shell: false })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).toString())
  return result.stdout
}

function write(root, path, contents) {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
}

function hashFile(root, path) {
  const bytes = readFileSync(join(root, path))
  return { path, source_kind: 'TRACKED', file_type: 'FILE', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function indexEntries(root) {
  return git(root, ['ls-files', '-s', '-z'], 'buffer').toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const match = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/.exec(entry)
    return { path: match[4], mode: match[1], blob: match[2], stage: Number(match[3]) }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-scope-test-'))
  write(root, 'package.json', '{}\n')
  write(root, 'safe.txt', 'baseline\n')
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'M5B Scope Test'])
  git(root, ['config', 'user.email', 'm5b-scope@example.invalid'])
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'baseline'])
  const head = git(root, ['rev-parse', 'HEAD']).trim()
  const branch = git(root, ['branch', '--show-current']).trim()
  const start = {
    schema_version: 'm5b-implementation-start-v1',
    base_commit: head,
    head_commit: head,
    branch,
    m5a_active_inventory_digest: 'f97ef382ab9a9678ab20f06310e6906e811cdd765526d69a4fcc11bca6939527',
    status_porcelain_sha256: 'fixture',
    excluded_step1_paths: [],
    index_entries: indexEntries(root),
    entries: [hashFile(root, 'package.json'), hashFile(root, 'safe.txt')]
  }
  write(root, 'scripts/fixtures/m5b-implementation-start-v1.json', `${JSON.stringify(start, null, 2)}\n`)
  return root
}

function withFixture(run) {
  const root = createFixture()
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('M5B implementation-start scope gate', () => {
  it('distinguishes preserved, allowed M5B changes and unrelated drift', () => {
    const baseline = [{ path: 'safe.txt', source_kind: 'TRACKED', file_type: 'FILE', size: 1, sha256: 'a' }]
    const allowed = new Set(['allowed.txt'])
    expect(compareM5bWorktreeSnapshot({ baselineEntries: baseline, currentEntries: baseline, allowedPaths: allowed }))
      .toMatchObject({ preserved: ['safe.txt'], m5bChanges: [], violations: [] })

    const changed = [{ ...baseline[0], sha256: 'b' }, { path: 'allowed.txt', source_kind: 'UNTRACKED', file_type: 'FILE', size: 1, sha256: 'c' }]
    const report = compareM5bWorktreeSnapshot({ baselineEntries: baseline, currentEntries: changed, allowedPaths: allowed })
    expect(report.m5bChanges).toEqual([{ path: 'allowed.txt', change: 'ADDED' }])
    expect(report.violations).toEqual([{ layer: 'working-tree', path: 'safe.txt', reason: 'BASELINE_DRIFT' }])
  })

  it('passes an unchanged start plus explicitly allowed Step M5B-1 files', () => withFixture((root) => {
    write(root, 'scripts/check-m5b-event-batch.mjs', 'export const check = true\n')
    const report = verifyM5bContractScope({ projectRoot: root, step: 'M5B-1' })
    expect(report.violations).toEqual([])
    expect(report.m5bChanges).toContainEqual({ path: 'scripts/check-m5b-event-batch.mjs', change: 'ADDED' })
  }))

  it('rejects unrelated modified and untracked paths', () => withFixture((root) => {
    write(root, 'safe.txt', 'drift\n')
    write(root, 'unexpected.txt', 'new\n')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-1' })).toThrow(M5bContractScopeError)
    try {
      verifyM5bContractScope({ projectRoot: root, step: 'M5B-1' })
    } catch (error) {
      expect(error.report.violations).toEqual(expect.arrayContaining([
        { layer: 'working-tree', path: 'safe.txt', reason: 'BASELINE_DRIFT' },
        { layer: 'working-tree', path: 'unexpected.txt', reason: 'UNEXPECTED_NEW_PATH' }
      ]))
    }
  }))

  it('rejects index changes even when the path is allowed', () => withFixture((root) => {
    write(root, 'package.json', '{"changed":true}\n')
    git(root, ['add', 'package.json'])
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-1' })).toThrow(/index/)
  }))

  it('rejects commits or branch drift after the frozen implementation start', () => withFixture((root) => {
    write(root, 'package.json', '{"changed":true}\n')
    git(root, ['add', 'package.json'])
    git(root, ['commit', '-qm', 'unexpected implementation commit'])
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-1' })).toThrow(/committed|HEAD/)
  }))

  it('allows only the exact M5B R3 review records introduced by each step', () => withFixture((root) => {
    const m5b6Review = 'doc/features/event-batch-v2.2-runtime-m5b6-r3-review.md'
    const m5b9Review = 'doc/features/event-batch-v2.2-runtime-m5b9-r3-review.md'
    write(root, m5b6Review, '# M5B-6 R3 review\n')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-6' })).not.toThrow()

    write(root, m5b9Review, '# M5B-9 R3 review\n')
    const report = verifyM5bContractScope({ projectRoot: root, step: 'M5B-9' })
    expect(report.m5bChanges).toEqual(expect.arrayContaining([
      { path: m5b6Review, change: 'ADDED' },
      { path: m5b9Review, change: 'ADDED' }
    ]))

    write(root, 'doc/features/event-batch-v2.2-runtime-m5b10-r3-review.md', '# not approved\n')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-9' })).toThrow(/UNEXPECTED_NEW_PATH/)
  }))

  it('allows only the exact predecessor gate repairs required by the M5B-9 checkpoint', () => withFixture((root) => {
    const repairs = [
      'doc/features/multi-device-m4-safety-sql-inventory-v1.json',
      'scripts/__tests__/m5a-command-boundary-inventory.test.mjs',
      'scripts/__tests__/multi-device-m4-safety-sql-inventory.test.mjs'
    ]
    for (const path of repairs) write(root, path, `${path}\n`)

    const report = verifyM5bContractScope({ projectRoot: root, step: 'M5B-9' })
    expect(report.m5bChanges).toEqual(expect.arrayContaining(
      repairs.map((path) => ({ path, change: 'ADDED' }))
    ))

    write(root, 'doc/features/multi-device-m4-unreviewed-change.md', '# unrelated\n')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-9' })).toThrow(M5bContractScopeError)
  }))

  it('opens only reviewed cumulative allowlists and still fails closed for later steps', () => withFixture((root) => {
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-2' })).not.toThrow()
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-3' })).not.toThrow()
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-4' })).not.toThrow()
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-5' })).not.toThrow()
    expect(allowedM5bPathsForStep('M5B-3')).toContain('scripts/lib/m5a-command-boundary-inventory.mjs')
    expect(allowedM5bPathsForStep('M5B-4')).toContain('src/main/application/command/durable-command-store.ts')
    expect(allowedM5bPathsForStep('M5B-5')).toContain('src/main/domain/event-batch/batch-coordinator.ts')
    expect(allowedM5bPathsForStep('M5B-5')).toContain('src/main/domain/event-batch/__tests__/command-differential-harness.test.ts')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-6' })).not.toThrow()
    expect(allowedM5bPathsForStep('M5B-6')).toContain('src/main/application/planners/report-planner.ts')
    expect(allowedM5bPathsForStep('M5B-6')).toContain('doc/features/event-batch-v2.2-runtime-m5b6-r3-review.md')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-7' })).not.toThrow()
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-8' })).not.toThrow()
    expect(allowedM5bPathsForStep('M5B-8')).toContain('src/main/application/planners/training-planner.ts')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-9' })).not.toThrow()
    expect(allowedM5bPathsForStep('M5B-9')).toContain('src/main/application/planners/assessment-planner.ts')
    expect(allowedM5bPathsForStep('M5B-9')).toContain('doc/features/event-batch-v2.2-runtime-m5b9-r3-review.md')
    expect(() => verifyM5bContractScope({ projectRoot: root, step: 'M5B-10' })).toThrow(/not implemented/)
  }))
})
