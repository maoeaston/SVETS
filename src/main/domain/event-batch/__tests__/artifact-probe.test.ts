import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactStagePath, probeArtifactTarget } from '../artifact-probe'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'svets-m5b-artifact-probe-'))
  roots.push(value)
  return value
}

describe('artifact probe', () => {
  it('checks an explicit temporary target without leaving a file behind', () => {
    const artifactRoot = root()
    const targetPath = join(artifactRoot, 'report.html')
    const artifactId = 'a1000000-0000-4000-8000-000000000001'

    const result = probeArtifactTarget({ artifactRoot, targetPath, artifactId })

    expect(result.targetPath).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(false)
    expect(existsSync(artifactStagePath(targetPath, artifactId))).toBe(false)
  })

  it('rejects targets outside the explicit root and preserves an occupied stage path', () => {
    const artifactRoot = root()
    const otherRoot = root()
    const artifactId = 'a1000000-0000-4000-8000-000000000002'
    expect(() => probeArtifactTarget({ artifactRoot, targetPath: join(otherRoot, 'report.html'), artifactId }))
      .toThrow(/child of the explicit artifact root/)

    const targetPath = join(artifactRoot, 'report.html')
    const stagePath = artifactStagePath(targetPath, artifactId)
    writeFileSync(stagePath, 'external-stage')
    expect(() => probeArtifactTarget({ artifactRoot, targetPath, artifactId })).toThrow(/stage path is unexpectedly occupied/)
    expect(existsSync(stagePath)).toBe(true)
  })

  it('rejects a nested target whose parent resolves through a symlink outside the root', () => {
    const artifactRoot = root()
    const externalRoot = root()
    const nestedLink = join(artifactRoot, 'nested')
    const externalChild = join(externalRoot, 'child')
    const artifactId = 'a1000000-0000-4000-8000-000000000003'
    mkdirSync(externalChild, { recursive: true })
    symlinkSync(externalRoot, nestedLink)

    expect(() => probeArtifactTarget({
      artifactRoot,
      targetPath: join(nestedLink, 'child', 'report.html'),
      artifactId
    })).toThrow(/resolves outside the explicit artifact root/)
    expect(existsSync(join(externalChild, 'report.html'))).toBe(false)
  })
})
