import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import {
  artifactTargetIdentity,
  type PreparedArtifactPlan
} from '../event-batch/artifact-probe'
import { recoverPreparedArtifact } from '../event-batch/artifact-recovery'
import { preparedArtifactBytes } from '../event-batch/artifact-publisher'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { applyReportEvent, markReportEventApplied } from '../report-reducer'
import { parseF7EventPayload } from '../report-contract'
import {
  REPORT_EXPORT_EVENT_PAYLOAD_VERSION,
  REPORT_EXPORT_PLAN_VERSION,
  REPORT_EXPORT_PRE_APPLY_EFFECT,
  REPORT_EXPORT_RESULT_RECIPE_VERSION
} from '../../application/planners/report-export-planner'
import { preparedActionLogEntry } from './report-projector'

export const REPORT_EXPORT_PROJECTOR_NAME = 'm5b-report-export-prepared-projector-v1'

const PAYLOAD_KEYS = Object.freeze([
  'actor_role',
  'app_version',
  'artifact',
  'batch_context',
  'content_hash',
  'correlation_id',
  'event_payload_version',
  'export_format',
  'export_path',
  'exported_at',
  'exported_by',
  'file_asset_id',
  'file_hash',
  'file_size_bytes',
  'mime_type',
  'report_id',
  'root_result',
  'status_after',
  'status_before'
])

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${field} is invalid`)
  return value as number
}

function exactKeys(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  const actual = Object.keys(payload).sort()
  const expected = [...PAYLOAD_KEYS].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`payload field set mismatch: ${actual.join(',')}`)
  }
}

function validateBatchMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (payload.event_payload_version !== REPORT_EXPORT_EVENT_PAYLOAD_VERSION || payload.actor_role !== 'TEACHER') {
    throw new Error('prepared report export metadata is invalid')
  }
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  const context = record(payload.batch_context, 'batch_context')
  if (
    context.schema_version !== 'batch-context-v1'
    || context.plan_version !== REPORT_EXPORT_PLAN_VERSION
    || context.result_recipe_version !== REPORT_EXPORT_RESULT_RECIPE_VERSION
    || context.root_command_type !== 'reports:export'
  ) throw new Error('prepared report export batch context is invalid')
  text(context.root_command_id, 'batch_context.root_command_id')
  integer(context.child_ordinal, 'batch_context.child_ordinal')
}

function artifactPlan(payload: Readonly<Record<string, CanonicalJsonValue>>): PreparedArtifactPlan {
  const artifact = record(payload.artifact, 'artifact')
  const plan: PreparedArtifactPlan = {
    schema_version: artifact.schema_version === 'report-export-artifact-v1'
      ? 'report-export-artifact-v1'
      : (() => { throw new Error('artifact schema version is invalid') })(),
    artifact_id: text(artifact.artifact_id, 'artifact.artifact_id'),
    target_path: text(payload.export_path, 'export_path'),
    target_identity: artifactTargetIdentity(artifact.target_identity),
    artifact_bytes_base64: text(artifact.artifact_bytes_base64, 'artifact.artifact_bytes_base64'),
    file_hash: text(artifact.file_hash, 'artifact.file_hash'),
    file_size_bytes: integer(artifact.file_size_bytes, 'artifact.file_size_bytes'),
    mime_type: artifact.mime_type === 'text/html'
      ? 'text/html'
      : (() => { throw new Error('artifact MIME type is invalid') })()
  }
  if (
    plan.artifact_id !== payload.file_asset_id
    || plan.file_hash !== payload.file_hash
    || plan.file_size_bytes !== payload.file_size_bytes
    || plan.mime_type !== payload.mime_type
  ) throw new Error('artifact facts conflict with report export facts')
  return plan
}

function validateRootResult(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  const result = record(payload.root_result, 'root_result')
  if (
    result.success !== true
    || result.canceled !== false
    || result.reportId !== payload.report_id
    || result.status !== payload.status_after
    || result.exportPath !== payload.export_path
    || result.fileAssetId !== payload.file_asset_id
    || result.fileHash !== payload.file_hash
    || result.fileSizeBytes !== payload.file_size_bytes
  ) throw new Error('root result conflicts with report export facts')
}

function validatePayload(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  exactKeys(payload)
  validateBatchMetadata(payload)
  const parsed = parseF7EventPayload('REPORT_EXPORTED', payload)
  if (!parsed.valid) throw new Error(`REPORT_EXPORTED business payload is invalid: ${parsed.errors.map((error) => error.path).join(',')}`)
  preparedArtifactBytes(artifactPlan(payload))
  validateRootResult(payload)
}

function project(context: PreparedProjectorContext): void {
  const entry = preparedActionLogEntry(context.event)
  applyReportEvent(context.database, entry)
  markReportEventApplied(context.database, entry)
  // The frozen F7 marker is scoped to legacy payload schema v2. M5B-13 keeps
  // the business reducer but records a v3 prepared envelope.
  context.database.prepare(
    `UPDATE domain_event_projection
        SET applied_to_snapshot = 1, applied_at = COALESCE(applied_at, ?)
      WHERE event_id = ? AND schema_version = 3`
  ).run(context.event.record.timestamp, context.event.record.event_id)
}

function assertProjected(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const row = context.database.prepare(
    `SELECT status, file_asset_id, file_path, file_hash, last_applied_event_id
       FROM task_report WHERE report_id = ?`
  ).get(payload.report_id) as Record<string, unknown> | undefined
  if (
    !row
    || row.status !== payload.status_after
    || row.file_asset_id !== payload.file_asset_id
    || row.file_path !== payload.export_path
    || row.file_hash !== payload.file_hash
    || row.last_applied_event_id !== context.event.record.event_id
  ) throw new Error('prepared report export projection is missing')
  const event = context.database.prepare(
    'SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as Record<string, unknown> | undefined
  if (!event || event.applied_to_snapshot !== 1 || event.applied_at !== context.event.record.timestamp) {
    throw new Error('prepared report export EVENT was not marked applied')
  }
}

function ensureArtifact(context: PreparedProjectorContext): void {
  recoverPreparedArtifact(artifactPlan(context.event.record.payload))
}

export function registerReportExportPreparedFacts(registry = new PreparedFactRegistry()): PreparedFactRegistry {
  registry.registerEvent({
    eventType: 'REPORT_EXPORTED',
    eventPayloadVersion: REPORT_EXPORT_EVENT_PAYLOAD_VERSION,
    projectorName: REPORT_EXPORT_PROJECTOR_NAME,
    validatePayload,
    project,
    assertProjected,
    operationalEffects: [],
    preApplyEffects: [{
      effectType: REPORT_EXPORT_PRE_APPLY_EFFECT.effectType,
      effectVersion: REPORT_EXPORT_PRE_APPLY_EFFECT.effectVersion,
      ensurePrepared: ensureArtifact,
      assertPrepared: ensureArtifact
    }]
  })
  registry.registerResult({
    commandType: 'reports:export',
    resultRecipeVersion: REPORT_EXPORT_RESULT_RECIPE_VERSION,
    fromPrepared: ({ batch }) => {
      if (batch.events.length !== 1 || batch.events[0]?.record.event_type !== 'REPORT_EXPORTED') {
        throw new Error('report export requires one prepared REPORT_EXPORTED event')
      }
      return record(batch.events[0].record.payload.root_result, 'root_result')
    }
  })
  return registry
}
