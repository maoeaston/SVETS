import type { ActionLogEntry, AggregateType, ActorRole, EventType } from '../../../shared/types/event-payloads'
import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedBatchSource, VerifiedEventSource } from '../event-batch/projection-source'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { parseF7EventPayload } from '../report-contract'
import { applyReportEvent, markReportEventApplied } from '../report-reducer'
import { REPORT_RESULT_RECIPE_VERSIONS } from '../../application/planners/report-planner'

export const REPORT_PROJECTOR_NAME = 'm5b-report-projector-v1'

const METADATA_KEYS = [
  'actor_role',
  'app_version',
  'batch_context',
  'correlation_id',
  'event_payload_version'
] as const

const REPORT_GENERATED_KEYS = [
  ...METADATA_KEYS,
  'content_hash',
  'generated_at',
  'generated_by',
  'generation_key',
  'generation_reason',
  'incident_ids',
  'job_code',
  'lineage_key',
  'repair_of_report_id',
  'report_builder_version',
  'report_content',
  'report_id',
  'report_revision',
  'report_schema_version',
  'report_scope',
  'report_title',
  'report_type',
  'result_ids',
  'source_aggregate_id',
  'source_aggregate_type',
  'source_set_hash',
  'student_id',
  'superseded_report_ids',
  'task_closure_id',
  'task_code'
] as const

const PLACEMENT_REVIEW_KEYS = [
  ...METADATA_KEYS,
  'placement_advice_hash',
  'report_id',
  'result_status',
  'reviewed_at',
  'reviewed_by'
] as const

const REPORT_LOCKED_KEYS = [
  ...METADATA_KEYS,
  'content_hash',
  'lock_reason',
  'locked_at',
  'locked_by',
  'report_id',
  'status_after',
  'status_before'
] as const

function exactKeys(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  expected: readonly string[]
): void {
  const actual = Object.keys(payload).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`payload field set mismatch: ${actual.join(',')}`)
  }
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${field} must be a non-empty trimmed string`)
  }
  return value
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (payload.event_payload_version !== 2) throw new Error('event_payload_version must equal 2')
  if (payload.actor_role !== 'TEACHER' && payload.actor_role !== 'SYSTEM') {
    throw new Error('actor_role is invalid')
  }
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
}

function validateReportPayload(
  eventType: 'REPORT_GENERATED' | 'PLACEMENT_REVIEW_CONFIRMED' | 'REPORT_LOCKED',
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  keys: readonly string[]
): void {
  exactKeys(payload, keys)
  validateMetadata(payload)
  const parsed = parseF7EventPayload(eventType, payload)
  if (!parsed.valid) {
    throw new Error(`${eventType} business payload is invalid: ${parsed.errors.map((error) => error.path).join(',')}`)
  }
  if (eventType === 'PLACEMENT_REVIEW_CONFIRMED') {
    if (!['GENERATED', 'EXPORTED', 'LOCKED'].includes(String(payload.result_status))) {
      throw new Error('result_status is invalid')
    }
  }
}

export function preparedActionLogEntry(event: VerifiedEventSource): ActionLogEntry {
  const payload = event.record.payload
  const actorRole = payload.actor_role
  if (actorRole !== 'TEACHER' && actorRole !== 'SYSTEM') throw new Error('prepared actor_role is invalid')
  return {
    event_id: event.record.event_id,
    aggregate_type: event.record.aggregate_type as AggregateType,
    aggregate_id: event.record.aggregate_id,
    event_type: event.record.event_type as EventType,
    event_sequence: event.record.event_sequence,
    payload: payload as unknown as Record<string, unknown>,
    checksum: event.record.checksum,
    schema_version: 2,
    created_at: event.record.timestamp,
    actor_id: event.record.actor_id,
    actor_role: actorRole as ActorRole,
    app_version: text(payload.app_version, 'app_version'),
    correlation_id: text(payload.correlation_id, 'correlation_id')
  }
}

function assertProjectionMarked(context: PreparedProjectorContext): void {
  const row = context.database.prepare(
    'SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as {
    applied_to_snapshot: number
    applied_at: string | null
  } | undefined
  if (!row || row.applied_to_snapshot !== 1 || row.applied_at !== context.event.record.timestamp) {
    throw new Error(`report EVENT ${context.event.record.event_id} was not marked applied`)
  }
}

function assertStatuses(
  context: PreparedProjectorContext,
  reportIds: CanonicalJsonValue | undefined,
  status: 'SUPERSEDED' | 'ARCHIVED'
): void {
  if (!Array.isArray(reportIds)) throw new Error('report ID list is invalid')
  for (const reportId of reportIds) {
    const row = context.database.prepare(
      'SELECT status, last_applied_event_id FROM task_report WHERE report_id = ?'
    ).get(reportId) as { status: string; last_applied_event_id: string | null } | undefined
    if (!row || row.status !== status || row.last_applied_event_id !== context.event.record.event_id) {
      throw new Error(`report ${String(reportId)} was not projected as ${status}`)
    }
  }
}

function projectReport(context: PreparedProjectorContext): void {
  const entry = preparedActionLogEntry(context.event)
  applyReportEvent(context.database, entry)
  markReportEventApplied(context.database, entry)
}

function assertReportGenerated(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const reportId = text(payload.report_id, 'report_id')
  const row = context.database.prepare(
    `SELECT report_id, student_id, report_type, source_aggregate_type, source_aggregate_id,
            source_result_ids_json, report_title, report_content_json, generated_event_id,
            generated_by, generated_at, task_closure_id, repair_of_report_id, lineage_key,
            source_set_hash, generation_key, content_hash, report_revision,
            report_schema_version, report_builder_version, generation_reason,
            contract_validation_status, last_applied_event_id, status
       FROM task_report WHERE report_id = ?`
  ).get(reportId) as Record<string, unknown> | undefined
  if (!row) throw new Error(`report ${reportId} was not projected`)
  const scalarExpectations: Record<string, unknown> = {
    report_id: reportId,
    student_id: payload.student_id,
    report_type: payload.report_type,
    source_aggregate_type: payload.source_aggregate_type,
    source_aggregate_id: payload.source_aggregate_id,
    report_title: payload.report_title,
    generated_event_id: context.event.record.event_id,
    generated_by: payload.generated_by,
    generated_at: payload.generated_at,
    task_closure_id: payload.task_closure_id,
    repair_of_report_id: payload.repair_of_report_id,
    lineage_key: payload.lineage_key,
    source_set_hash: payload.source_set_hash,
    generation_key: payload.generation_key,
    content_hash: payload.content_hash,
    report_revision: payload.report_revision,
    report_schema_version: payload.report_schema_version,
    report_builder_version: payload.report_builder_version,
    generation_reason: payload.generation_reason,
    contract_validation_status: 'VALID',
    last_applied_event_id: context.event.record.event_id,
    status: 'GENERATED'
  }
  for (const [field, expected] of Object.entries(scalarExpectations)) {
    if (row[field] !== expected) throw new Error(`report ${reportId}.${field} conflicts with prepared EVENT`)
  }
  if (
    canonicalJson(JSON.parse(String(row.source_result_ids_json))) !== canonicalJson(payload.result_ids)
    || canonicalJson(JSON.parse(String(row.report_content_json))) !== canonicalJson(payload.report_content)
  ) throw new Error(`report ${reportId} JSON fields conflict with prepared EVENT`)
  assertStatuses(context, payload.superseded_report_ids, 'SUPERSEDED')
  assertProjectionMarked(context)
}

function assertPlacementReview(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const reportId = text(payload.report_id, 'report_id')
  const row = context.database.prepare(
    'SELECT placement_review_by, placement_review_at, status, last_applied_event_id FROM task_report WHERE report_id = ?'
  ).get(reportId) as Record<string, unknown> | undefined
  if (
    !row
    || row.placement_review_by !== payload.reviewed_by
    || row.placement_review_at !== payload.reviewed_at
    || row.status !== payload.result_status
    || row.last_applied_event_id !== context.event.record.event_id
  ) throw new Error(`placement review projection conflicts for ${reportId}`)
  assertProjectionMarked(context)
}

function assertReportLocked(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const reportId = text(payload.report_id, 'report_id')
  const row = context.database.prepare(
    'SELECT status, content_hash, last_applied_event_id FROM task_report WHERE report_id = ?'
  ).get(reportId) as Record<string, unknown> | undefined
  if (
    !row
    || row.status !== 'LOCKED'
    || row.content_hash !== payload.content_hash
    || row.last_applied_event_id !== context.event.record.event_id
  ) throw new Error(`report lock projection conflicts for ${reportId}`)
  assertProjectionMarked(context)
}

function oneEvent(batch: PreparedBatchSource, eventType: string): VerifiedEventSource {
  const matches = batch.events.filter((event) => event.record.event_type === eventType)
  if (matches.length !== 1) throw new Error(`prepared result requires exactly one ${eventType} EVENT`)
  return matches[0]
}

export function registerReportPreparedFacts(registry: PreparedFactRegistry): PreparedFactRegistry {
  registry.registerEvent({
    eventType: 'REPORT_GENERATED',
    eventPayloadVersion: 2,
    projectorName: REPORT_PROJECTOR_NAME,
    validatePayload: (payload) => validateReportPayload('REPORT_GENERATED', payload, REPORT_GENERATED_KEYS),
    project: projectReport,
    assertProjected: assertReportGenerated,
    operationalEffects: []
  })
  registry.registerEvent({
    eventType: 'PLACEMENT_REVIEW_CONFIRMED',
    eventPayloadVersion: 2,
    projectorName: REPORT_PROJECTOR_NAME,
    validatePayload: (payload) => validateReportPayload('PLACEMENT_REVIEW_CONFIRMED', payload, PLACEMENT_REVIEW_KEYS),
    project: projectReport,
    assertProjected: assertPlacementReview,
    operationalEffects: []
  })
  registry.registerEvent({
    eventType: 'REPORT_LOCKED',
    eventPayloadVersion: 2,
    projectorName: REPORT_PROJECTOR_NAME,
    validatePayload: (payload) => validateReportPayload('REPORT_LOCKED', payload, REPORT_LOCKED_KEYS),
    project: projectReport,
    assertProjected: assertReportLocked,
    operationalEffects: []
  })
  registry.registerResult({
    commandType: 'reports:generate',
    resultRecipeVersion: REPORT_RESULT_RECIPE_VERSIONS['reports:generate'],
    fromPrepared: ({ batch }) => {
      const event = oneEvent(batch, 'REPORT_GENERATED')
      return { success: true, reportId: text(event.record.payload.report_id, 'report_id'), generated: true }
    }
  })
  registry.registerResult({
    commandType: 'reports:confirmPlacementReview',
    resultRecipeVersion: REPORT_RESULT_RECIPE_VERSIONS['reports:confirmPlacementReview'],
    fromPrepared: ({ batch }) => {
      const event = oneEvent(batch, 'PLACEMENT_REVIEW_CONFIRMED')
      return {
        success: true,
        reportId: text(event.record.payload.report_id, 'report_id'),
        status: text(event.record.payload.result_status, 'result_status')
      }
    }
  })
  registry.registerResult({
    commandType: 'reports:lock',
    resultRecipeVersion: REPORT_RESULT_RECIPE_VERSIONS['reports:lock'],
    fromPrepared: ({ batch }) => {
      const event = oneEvent(batch, 'REPORT_LOCKED')
      return {
        success: true,
        reportId: text(event.record.payload.report_id, 'report_id'),
        status: text(event.record.payload.status_after, 'status_after')
      }
    }
  })
  return registry
}
