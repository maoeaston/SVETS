import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactStagePath, probeArtifactTarget, type PreparedArtifactPlan } from '../artifact-probe'
import { ArtifactPublishError, publishPreparedArtifact } from '../artifact-publisher'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function plan(name = 'report.html'): PreparedArtifactPlan {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-artifact-publisher-'))
  roots.push(root)
  const bytes = Buffer.from('<html>prepared report</html>', 'utf8')
  const artifactId = 'a2000000-0000-4000-8000-000000000001'
  const targetPath = join(root, name)
  const interaction = probeArtifactTarget({ artifactRoot: root, targetPath, artifactId })
  return {
    schema_version: 'report-export-artifact-v1',
    artifact_id: artifactId,
    target_path: targetPath,
    target_identity: interaction.targetIdentity,
    artifact_bytes_base64: bytes.toString('base64'),
    file_hash: createHash('sha256').update(bytes).digest('hex'),
    file_size_bytes: bytes.byteLength,
    mime_type: 'text/html'
  }
}

describe('artifact publisher', () => {
  it('stages, verifies, publishes, and removes only its owned stage file', () => {
    const prepared = plan()
    const result = publishPreparedArtifact(prepared)

    expect(result.status).toBe('PUBLISHED')
    expect(readFileSync(prepared.target_path).toString('base64')).toBe(prepared.artifact_bytes_base64)
    expect(existsSync(artifactStagePath(prepared.target_path, prepared.artifact_id))).toBe(false)
  })

  it('adopts matching bytes but never overwrites a conflicting external target', () => {
    const matching = plan('matching.html')
    writeFileSync(matching.target_path, Buffer.from(matching.artifact_bytes_base64, 'base64'))
    expect(publishPreparedArtifact(matching)).toMatchObject({ status: 'ADOPTED' })

    const conflicting = plan('conflicting.html')
    writeFileSync(conflicting.target_path, 'external bytes')
    expect(() => publishPreparedArtifact(conflicting)).toThrow(ArtifactPublishError)
    expect(readFileSync(conflicting.target_path, 'utf8')).toBe('external bytes')
  })

  it('does not use or delete a pre-existing external stage file', () => {
    const prepared = plan('stage-conflict.html')
    const stagePath = artifactStagePath(prepared.target_path, prepared.artifact_id)
    writeFileSync(stagePath, 'external stage with matching or unknown provenance')

    expect(publishPreparedArtifact(prepared)).toMatchObject({ status: 'PUBLISHED' })
    expect(readFileSync(stagePath, 'utf8')).toBe('external stage with matching or unknown provenance')
    expect(readFileSync(prepared.target_path).toString('base64')).toBe(prepared.artifact_bytes_base64)
  })

  it('refuses to publish when the frozen artifact root is replaced by a symlink', () => {
    const prepared = plan('identity-race.html')
    const originalRoot = dirname(prepared.target_path)
    const externalRoot = mkdtempSync(join(tmpdir(), 'svets-m5b-artifact-publisher-external-'))
    roots.push(externalRoot)
    rmSync(originalRoot, { recursive: true, force: true })
    symlinkSync(externalRoot, originalRoot)

    expect(() => publishPreparedArtifact(prepared)).toThrow(/directory identity changed|not a real directory/i)
    expect(existsSync(join(externalRoot, 'identity-race.html'))).toBe(false)
  })
})
