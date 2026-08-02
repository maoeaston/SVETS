import type { DBAdapter } from '../../db/interface'
import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedProjectorContext } from '../event-batch/result-registry'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PreviewContractError } from '../preview/preview-errors'
import { PREVIEW_CONTRACT_REGISTRY } from '../preview/preview-contract-registry'
import { previewContractMigrationState } from '../../db/preview-contract-migration'

export function projectPreviewEvent(context: PreparedProjectorContext): void {
  const event = context.event.record
  if (event.payload.contract_version !== PREVIEW_CONTRACT_VERSION || event.payload.allowed_shell_kind !== 'PREVIEW_SHELL') {
    throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview event does not carry the PREVIEW_CONTRACT_V1 preview shell')
  }
  const payloadJson = canonicalJson(event.payload)
  const existing = context.database.prepare(
    'SELECT event_id, contract_registry_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_batch_id, source_batch_hash FROM preview_event_projection WHERE event_id = ?'
  ).get(event.event_id) as Record<string, unknown> | undefined
  if (existing) {
    const expected: Record<string, unknown> = {
      event_id: event.event_id,
      contract_registry_id: 'PREVIEW_CONTRACT_V1',
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      event_type: event.event_type,
      event_sequence: event.event_sequence,
      payload_json: payloadJson,
      checksum: event.checksum,
      source_batch_id: context.batch.prepared.batch_id,
      source_batch_hash: context.batch.prepared.batch_hash
    }
    for (const [field, value] of Object.entries(expected)) {
      if (existing[field] !== value) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', `preview event projection conflict at ${field}`)
    }
    return
  }
  context.database.prepare(
    `INSERT INTO preview_event_projection (
       event_id, contract_registry_id, aggregate_type, aggregate_id, event_type,
       event_sequence, payload_json, checksum, source_batch_id, source_batch_hash, created_at
     ) VALUES (?, 'PREVIEW_CONTRACT_V1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.event_id,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.event_sequence,
    payloadJson,
    event.checksum,
    context.batch.prepared.batch_id,
    context.batch.prepared.batch_hash,
    event.timestamp
  )
}

export function assertPreviewEventProjected(context: PreparedProjectorContext): void {
  const event = context.event.record
  const row = context.database.prepare(
    'SELECT event_id, contract_registry_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_batch_id, source_batch_hash, created_at FROM preview_event_projection WHERE event_id = ?'
  ).get(event.event_id) as Record<string, unknown> | undefined
  if (!row) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', `preview event projection is missing ${event.event_id}`)
  const expected: Record<string, unknown> = {
    event_id: event.event_id,
    contract_registry_id: 'PREVIEW_CONTRACT_V1',
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    event_type: event.event_type,
    event_sequence: event.event_sequence,
    payload_json: canonicalJson(event.payload),
    checksum: event.checksum,
    source_batch_id: context.batch.prepared.batch_id,
    source_batch_hash: context.batch.prepared.batch_hash,
    created_at: event.timestamp
  }
  for (const [field, value] of Object.entries(expected)) {
    if (row[field] !== value) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', `preview event projection mismatch at ${field}`)
  }
}

export function previewPayloadRecord(value: CanonicalJsonValue, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} must be an object`, field)
  }
  return value as Record<string, CanonicalJsonValue>
}

export function assertPreviewProjectionStatus(database: DBAdapter): void {
  if (previewContractMigrationState(database) !== 'CURRENT') {
    throw new PreviewContractError('PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'preview contract migration is not current')
  }
  const row = database.prepare(
    `SELECT status, event_registry_digest, projection_digest, query_digest,
            recovery_digest, error_map_digest
       FROM preview_contract_registry
      WHERE registry_id = 'PREVIEW_CONTRACT_V1'`
  ).get() as { status?: string; event_registry_digest?: string; projection_digest?: string; query_digest?: string; recovery_digest?: string; error_map_digest?: string } | undefined
  if (row?.status !== 'READY') throw new PreviewContractError('PREVIEW_CONTRACT_MIGRATION_REQUIRED', 'preview contract registry is not READY')
  const expected = PREVIEW_CONTRACT_REGISTRY.readiness('READY')
  if (row.event_registry_digest !== expected.event_registry_digest || row.projection_digest !== expected.projection_digest || row.query_digest !== expected.query_digest || row.recovery_digest !== expected.recovery_digest || row.error_map_digest !== expected.error_map_digest) {
    throw new PreviewContractError('PREVIEW_CONTRACT_REGISTRY_INVALID', 'preview contract registry digest does not match the installed application registry')
  }
}
