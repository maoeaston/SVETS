import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeArtifactTarget, type PreparedArtifactPlan } from '../artifact-probe'
import { ArtifactPublishError, publishPreparedArtifact } from '../artifact-publisher'
import { recoverPreparedArtifact } from '../artifact-recovery'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function preparedArtifact(): PreparedArtifactPlan {
  const root = mkdtempSync(join(tmpdir(), 'svets-m5b-artifact-recovery-'))
  roots.push(root)
  const bytes = Buffer.from('<html>recovery proof</html>', 'utf8')
  const artifactId = 'a3000000-0000-4000-8000-000000000001'
  const targetPath = join(root, 'report.html')
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

describe('artifact recovery', () => {
  it('rebuilds a missing artifact from frozen bytes and adopts it on replay', () => {
    const prepared = preparedArtifact()
    publishPreparedArtifact(prepared)
    unlinkSync(prepared.target_path)
    expect(existsSync(prepared.target_path)).toBe(false)

    expect(recoverPreparedArtifact(prepared)).toMatchObject({ status: 'PUBLISHED' })
    expect(readFileSync(prepared.target_path).toString('base64')).toBe(prepared.artifact_bytes_base64)
    expect(recoverPreparedArtifact(prepared)).toMatchObject({ status: 'ADOPTED' })
  })

  it('keeps an external conflicting target intact during recovery', () => {
    const prepared = preparedArtifact()
    writeFileSync(prepared.target_path, 'external conflicting target')

    expect(() => recoverPreparedArtifact(prepared)).toThrow(ArtifactPublishError)
    expect(readFileSync(prepared.target_path, 'utf8')).toBe('external conflicting target')
  })
})
