import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  M5aIsolatedDatabaseError,
  evidenceRootForDatabase,
  runM5aIsolatedDatabaseVerification
} from '../lib/m5a-isolated-db.mjs'

function parentFixture() {
  return mkdtempSync(join(tmpdir(), 'svets-m5a-isolated-parent-'))
}

function successfulPorts(calls) {
  return {
    sync(dbPath) {
      calls.push({ phase: 'sync', dbPath })
      mkdirSync(dirname(dbPath), { recursive: true })
      writeFileSync(dbPath, 'isolated fixture')
      return { dbPath }
    },
    verify(dbPath) {
      calls.push({ phase: 'verify', dbPath })
      return {
        ok: true,
        dbPath,
        schemaVersion: 'v0.1.17-multi-device-m4-safety-rekey',
        packVersion: 'test-pack',
        packHash: 'a'.repeat(64),
        counts: { BASE_ABILITY: 50 },
        approvedAssetCount: 0,
        issues: []
      }
    }
  }
}

describe('M5A isolated database verification', () => {
  it('passes one explicit absolute path to sync and verify, then removes only the successful temporary root', () => {
    const parentDir = parentFixture()
    const calls = []
    try {
      const result = runM5aIsolatedDatabaseVerification({ parentDir, ...successfulPorts(calls) })
      expect(calls.map((entry) => entry.phase)).toEqual(['sync', 'verify'])
      expect(calls[0].dbPath).toBe(calls[1].dbPath)
      expect(calls[0].dbPath).toBe(resolve(calls[0].dbPath))
      expect(evidenceRootForDatabase(calls[0].dbPath)).toBe(result.evidenceRoot)
      expect(result.evidenceRoot.startsWith(`${resolve(parentDir)}/svets-m5a-isolated-db-`)).toBe(true)
      expect(result.cleaned).toBe(true)
      expect(existsSync(result.evidenceRoot)).toBe(false)
    } finally {
      rmSync(parentDir, { recursive: true, force: true })
    }
  })

  it('uses a unique temporary root for each verification', () => {
    const parentDir = parentFixture()
    try {
      const first = runM5aIsolatedDatabaseVerification({ parentDir, ...successfulPorts([]) })
      const second = runM5aIsolatedDatabaseVerification({ parentDir, ...successfulPorts([]) })
      expect(first.evidenceRoot).not.toBe(second.evidenceRoot)
    } finally {
      rmSync(parentDir, { recursive: true, force: true })
    }
  })

  it('preserves the isolated evidence root when initialization fails and never calls verify', () => {
    const parentDir = parentFixture()
    let failedRoot = null
    let verifyCalled = false
    try {
      expect(() => runM5aIsolatedDatabaseVerification({
        parentDir,
        sync(dbPath) {
          failedRoot = evidenceRootForDatabase(dbPath)
          mkdirSync(dirname(dbPath), { recursive: true })
          writeFileSync(join(failedRoot, 'initialization-error.txt'), 'injected failure')
          throw new Error('injected initialization failure')
        },
        verify() {
          verifyCalled = true
        }
      })).toThrow(M5aIsolatedDatabaseError)
      expect(verifyCalled).toBe(false)
      expect(existsSync(failedRoot)).toBe(true)
      expect(readFileSync(join(failedRoot, 'initialization-error.txt'), 'utf8')).toBe('injected failure')
    } finally {
      rmSync(parentDir, { recursive: true, force: true })
    }
  })

  it('preserves the synchronized database when final verification fails', () => {
    const parentDir = parentFixture()
    let failedRoot = null
    try {
      expect(() => runM5aIsolatedDatabaseVerification({
        parentDir,
        sync(dbPath) {
          failedRoot = evidenceRootForDatabase(dbPath)
          mkdirSync(dirname(dbPath), { recursive: true })
          writeFileSync(dbPath, 'failed verification evidence')
          return { dbPath }
        },
        verify(dbPath) {
          return { ok: false, dbPath, issues: ['injected verification failure'] }
        }
      })).toThrow('injected verification failure')
      expect(existsSync(join(failedRoot, 'data', 'xc-career-guide.db'))).toBe(true)
    } finally {
      rmSync(parentDir, { recursive: true, force: true })
    }
  })

  it('does not import or call the default database path resolver', () => {
    const sources = [
      readFileSync(join(process.cwd(), 'scripts/lib/m5a-isolated-db.mjs'), 'utf8'),
      readFileSync(join(process.cwd(), 'scripts/verify-m5a-isolated-db.mjs'), 'utf8')
    ].join('\n')
    expect(sources).not.toContain('resolveDefaultDbPath')
    expect(sources).not.toContain('database-path.mjs')
    expect(sources).not.toContain('homedir')
  })
})
