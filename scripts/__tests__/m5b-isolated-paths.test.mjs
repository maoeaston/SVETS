import { describe, expect, it } from 'vitest'
import {
  linkSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import {
  M5bIsolatedPathError,
  createM5bTempPaths,
  validateM5bIsolatedPaths,
  validateThenOpenM5bPaths
} from '../lib/m5b-isolated-paths.mjs'

function withPaths(run) {
  const paths = createM5bTempPaths()
  try {
    return run(paths)
  } finally {
    rmSync(paths.runRoot, { recursive: true, force: true })
  }
}

describe('M5B isolated path guard', () => {
  it('accepts one exact paired temporary root without opening adapters', () => withPaths((paths) => {
    expect(validateM5bIsolatedPaths(paths)).toEqual(paths)
  }))

  it('rejects missing, relative, non-normalized and unpaired paths', () => withPaths((paths) => {
    for (const input of [
      { ...paths, dbPath: undefined },
      { ...paths, dbPath: 'relative.db' },
      { ...paths, dbPath: `${paths.dataRoot}/../data-root/xc-career-guide.db` },
      { ...paths, evidenceRoot: paths.exportRoot },
      { ...paths, runRoot: join(paths.runRoot, 'nested') }
    ]) {
      expect(() => validateM5bIsolatedPaths(input)).toThrow(M5bIsolatedPathError)
    }
  }))

  it('rejects symlink components before any open callback', () => withPaths((paths) => {
    const realData = join(paths.runRoot, 'real-data')
    rmSync(paths.dataRoot, { recursive: true, force: true })
    mkdirSync(realData)
    symlinkSync(realData, paths.dataRoot)
    let opens = 0
    expect(() => validateThenOpenM5bPaths(paths, () => { opens += 1 }))
      .toThrow(/symlink/)
    expect(opens).toBe(0)
  }))

  it('rejects a hard-linked DB before any open callback', () => withPaths((paths) => {
    writeFileSync(paths.dbPath, 'not-a-real-db')
    linkSync(paths.dbPath, join(paths.dataRoot, 'db-alias'))
    let opens = 0
    expect(() => validateThenOpenM5bPaths(paths, () => { opens += 1 }))
      .toThrow(/hard-link/)
    expect(opens).toBe(0)
  }))

  it('rejects non-file DB/log targets', () => withPaths((paths) => {
    mkdirSync(paths.dbPath)
    expect(() => validateM5bIsolatedPaths(paths)).toThrow(/regular file/)
  }))

  it('calls the adapter opener exactly once only after successful validation', () => withPaths((paths) => {
    let opens = 0
    const result = validateThenOpenM5bPaths(paths, (validated) => {
      opens += 1
      expect(validated.dbPath).toBe(paths.dbPath)
      return 'OPENED_TEST_ADAPTER'
    })
    expect(result).toBe('OPENED_TEST_ADAPTER')
    expect(opens).toBe(1)
  }))
})
