import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import type { CanonicalJsonValue } from '../../event-batch/canonical-json'
import type { VerifiedEventSource } from '../../event-batch/projection-source'
import { registerReportExportPreparedFacts } from '../report-export-projector'

function event(payload: Record<string, CanonicalJsonValue>): VerifiedEventSource {
  return {
    record: {
      type: 'EVENT',
      schema_version: 1,
      event_id: 'a4000000-0000-4000-8000-000000000001',
      aggregate_type: 'TASK_REPORT',
      aggregate_id: 'a5000000-0000-4000-8000-000000000001',
      event_type: 'REPORT_EXPORTED',
      event_sequence: 1,
      payload,
      checksum: 'report-export-projector-checksum',
      timestamp: '2026-07-30T12:00:00.000Z',
      actor_id: 'teacher-id'
    },
    relativePath: 'segments/seg_000000000001.jsonl',
    lineNumber: 2,
    byteOffset: 0
  } as unknown as VerifiedEventSource
}

function payload(): Record<string, CanonicalJsonValue> {
  const bytes = Buffer.from('<html>frozen</html>', 'utf8')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const reportId = 'a5000000-0000-4000-8000-000000000001'
  const assetId = 'a6000000-0000-4000-8000-000000000001'
  const exportPath = '/tmp/svets-m5b-projector/report.html'
  return {
    event_payload_version: 3,
    batch_context: {
      schema_version: 'batch-context-v1',
      plan_version: 'm5b.reports.export.plan.v1',
      result_recipe_version: 'm5b.reports:export.result.v1',
      root_command_type: 'reports:export',
      root_command_id: 'a7000000-0000-4000-8000-000000000001',
      child_ordinal: 0
    },
    actor_role: 'TEACHER',
    app_version: '1.0.0-alpha.1',
    correlation_id: 'report-export-projector-correlation',
    report_id: reportId,
    export_format: 'HTML',
    export_path: exportPath,
    exported_at: '2026-07-30T12:00:00.000Z',
    exported_by: 'teacher-id',
    file_asset_id: assetId,
    file_hash: hash,
    file_size_bytes: bytes.byteLength,
    mime_type: 'text/html',
    content_hash: 'a'.repeat(64),
    status_before: 'GENERATED',
    status_after: 'EXPORTED',
    artifact: {
      schema_version: 'report-export-artifact-v1',
      artifact_id: assetId,
      target_identity: {
        artifact_root: { path: '/tmp/svets-m5b-projector', device: '1', inode: '2' },
        target_parent: { path: '/tmp/svets-m5b-projector', device: '1', inode: '2' }
      },
      artifact_bytes_base64: bytes.toString('base64'),
      file_hash: hash,
      file_size_bytes: bytes.byteLength,
      mime_type: 'text/html'
    },
    root_result: {
      success: true,
      reportId,
      status: 'EXPORTED',
      exportPath,
      fileAssetId: assetId,
      fileHash: hash,
      fileSizeBytes: bytes.byteLength,
      canceled: false
    }
  }
}

describe('M5B-13 report export projector', () => {
  it('registers the v3 REPORT_EXPORTED event and result recipe', () => {
    const registry = registerReportExportPreparedFacts()
    expect(registry.projectorNames()).toEqual(['m5b-report-export-prepared-projector-v1'])
    expect(registry.retainedRecipeVersions('reports:export')).toEqual(['m5b.reports:export.result.v1'])
    expect(() => registry.eventRegistration(event(payload()))).not.toThrow()
  })

  it('rejects a prepared artifact whose encoded bytes do not match its frozen hash', () => {
    const invalid = payload()
    const artifact = invalid.artifact as Record<string, CanonicalJsonValue>
    artifact.artifact_bytes_base64 = Buffer.from('tampered bytes', 'utf8').toString('base64')

    expect(() => registerReportExportPreparedFacts().eventRegistration(event(invalid)))
      .toThrow(/artifact bytes do not match prepared facts/)
  })
})
