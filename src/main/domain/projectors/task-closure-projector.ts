import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedBatchSource, VerifiedEventSource } from '../event-batch/projection-source'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { parseF7EventPayload } from '../report-contract'
import { applyReportEvent, markReportEventApplied } from '../report-reducer'
import { TASK_CLOSURE_RESULT_RECIPE_VERSIONS } from '../../application/planners/task-closure-planner'
import {
  preparedActionLogEntry,
  registerReportPreparedFacts
} from './report-projector'

export const TASK_CLOSURE_PROJECTOR_NAME = 'm5b-task-closure-projector-v1'

const METADATA_KEYS = [
  'actor_role',
  'app_version',
  'batch_context',
  'correlation_id',
  'event_payload_version'
] as const

const CONFIRMED_KEYS = [
  ...METADATA_KEYS,
  'closure_revision',
  'confirmed_at',
  'confirmed_by',
  'cycle_no',
  'is_cycle_head',
  'job_code',
  'source_result_ids',
  'status',
  'student_id',
  'superseded_report_ids',
  'superseded_task_closure_ids',
  'task_closure_id',
  'task_code',
  'task_result_snapshots'
] as const

const REPLACED_KEYS = [
  ...METADATA_KEYS,
  'archived_report_ids',
  'closure_revision',
  'correction_reason',
  'cycle_no',
  'is_cycle_head',
  'job_code',
  'new_result_ids',
  'new_task_closure_id',
  'old_task_closure_id',
  'replaced_at',
  'replaced_by',
  'reused_result_ids',
  'source_result_ids',
  'status',
  'student_id',
  'task_code',
  'task_result_snapshots'
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

function integer(value: CanonicalJsonValue | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${field} must be a positive integer`)
  return value as number
}

function bool(value: CanonicalJsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
  return value
}

function stringArray(value: CanonicalJsonValue | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be a string array`)
  }
  return value as string[]
}

function validateClosurePayload(
  eventType: 'TASK_CLOSURE_CONFIRMED' | 'TASK_CLOSURE_REPLACED',
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  expected: readonly string[]
): void {
  exactKeys(payload, expected)
  if (payload.event_payload_version !== 2) throw new Error('event_payload_version must equal 2')
  if (payload.actor_role !== 'TEACHER') throw new Error('task closure actor_role must be TEACHER')
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  const parsed = parseF7EventPayload(eventType, payload)
  if (!parsed.valid) {
    throw new Error(`${eventType} business payload is invalid: ${parsed.errors.map((error) => error.path).join(',')}`)
  }
}

function normalizeProjectionTimes(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const timestamp = context.event.record.timestamp
  if (context.event.record.event_type === 'TASK_CLOSURE_CONFIRMED') {
    const closureId = text(payload.task_closure_id, 'task_closure_id')
    context.database.prepare(
      'UPDATE task_closure SET created_at = ?, updated_at = ? WHERE task_closure_id = ?'
    ).run(timestamp, timestamp, closureId)
    for (const oldId of stringArray(payload.superseded_task_closure_ids, 'superseded_task_closure_ids')) {
      context.database.prepare(
        'UPDATE task_closure SET updated_at = ? WHERE task_closure_id = ?'
      ).run(timestamp, oldId)
    }
    return
  }
  const newId = text(payload.new_task_closure_id, 'new_task_closure_id')
  const oldId = text(payload.old_task_closure_id, 'old_task_closure_id')
  context.database.prepare(
    'UPDATE task_closure SET created_at = ?, updated_at = ? WHERE task_closure_id = ?'
  ).run(timestamp, timestamp, newId)
  context.database.prepare(
    'UPDATE task_closure SET updated_at = ? WHERE task_closure_id = ?'
  ).run(timestamp, oldId)
}

function projectTaskClosure(context: PreparedProjectorContext): void {
  const entry = preparedActionLogEntry(context.event)
  applyReportEvent(context.database, entry)
  normalizeProjectionTimes(context)
  markReportEventApplied(context.database, entry)
}

function assertProjectionMarked(context: PreparedProjectorContext): void {
  const row = context.database.prepare(
    'SELECT applied_to_snapshot, applied_at FROM domain_event_projection WHERE event_id = ?'
  ).get(context.event.record.event_id) as Record<string, unknown> | undefined
  if (!row || row.applied_to_snapshot !== 1 || row.applied_at !== context.event.record.timestamp) {
    throw new Error(`closure EVENT ${context.event.record.event_id} was not marked applied`)
  }
}

function assertReportStatuses(
  context: PreparedProjectorContext,
  idsValue: CanonicalJsonValue | undefined,
  status: 'SUPERSEDED' | 'ARCHIVED'
): void {
  for (const reportId of stringArray(idsValue, `${status.toLowerCase()}_report_ids`)) {
    const row = context.database.prepare(
      'SELECT status, last_applied_event_id FROM task_report WHERE report_id = ?'
    ).get(reportId) as Record<string, unknown> | undefined
    if (!row || row.status !== status || row.last_applied_event_id !== context.event.record.event_id) {
      throw new Error(`report ${reportId} was not projected as ${status}`)
    }
  }
}

function expectedSnapshotSources(payload: Readonly<Record<string, CanonicalJsonValue>>): string[] {
  if (!Array.isArray(payload.task_result_snapshots) || payload.task_result_snapshots.length !== 3) {
    throw new Error('task_result_snapshots must contain three entries')
  }
  return payload.task_result_snapshots.map((snapshot, index) => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
      throw new Error(`task_result_snapshots[${index}] must be an object`)
    }
    return text(snapshot.source_aggregate_id, `task_result_snapshots[${index}].source_aggregate_id`)
  })
}

function assertClosureRow(
  context: PreparedProjectorContext,
  closureId: string,
  replacesId: string | null
): void {
  const payload = context.event.record.payload
  const resultIds = stringArray(payload.source_result_ids, 'source_result_ids')
  const sources = expectedSnapshotSources(payload)
  const row = context.database.prepare(
    `SELECT task_closure_id, student_id, job_code, task_code, cycle_no, closure_revision,
            status, is_cycle_head, ability_result_id, training_completion_result_id,
            operation_pass_rate_result_id, ability_source_aggregate_id,
            training_source_aggregate_id, operation_source_aggregate_id,
            replaces_task_closure_id, correction_reason, confirmed_by,
            confirmed_event_id, confirmed_at, last_applied_event_id, created_at, updated_at
       FROM task_closure WHERE task_closure_id = ?`
  ).get(closureId) as Record<string, unknown> | undefined
  if (!row) throw new Error(`task closure ${closureId} was not projected`)
  const expectations: Record<string, unknown> = {
    task_closure_id: closureId,
    student_id: payload.student_id,
    job_code: payload.job_code,
    task_code: payload.task_code,
    cycle_no: integer(payload.cycle_no, 'cycle_no'),
    closure_revision: integer(payload.closure_revision, 'closure_revision'),
    status: payload.status,
    is_cycle_head: bool(payload.is_cycle_head, 'is_cycle_head') ? 1 : 0,
    ability_result_id: resultIds[0],
    training_completion_result_id: resultIds[1],
    operation_pass_rate_result_id: resultIds[2],
    ability_source_aggregate_id: sources[0],
    training_source_aggregate_id: sources[1],
    operation_source_aggregate_id: sources[2],
    replaces_task_closure_id: replacesId,
    correction_reason: context.event.record.event_type === 'TASK_CLOSURE_REPLACED'
      ? payload.correction_reason
      : null,
    confirmed_by: context.event.record.event_type === 'TASK_CLOSURE_REPLACED'
      ? payload.replaced_by
      : payload.confirmed_by,
    confirmed_event_id: context.event.record.event_id,
    confirmed_at: context.event.record.event_type === 'TASK_CLOSURE_REPLACED'
      ? payload.replaced_at
      : payload.confirmed_at,
    last_applied_event_id: context.event.record.event_id,
    created_at: context.event.record.timestamp,
    updated_at: context.event.record.timestamp
  }
  for (const [field, expected] of Object.entries(expectations)) {
    if (row[field] !== expected) throw new Error(`task closure ${closureId}.${field} conflicts with prepared EVENT`)
  }
}

function assertTaskClosureConfirmed(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const closureId = text(payload.task_closure_id, 'task_closure_id')
  assertClosureRow(context, closureId, null)
  for (const oldId of stringArray(payload.superseded_task_closure_ids, 'superseded_task_closure_ids')) {
    const row = context.database.prepare(
      'SELECT status, is_cycle_head, last_applied_event_id, updated_at FROM task_closure WHERE task_closure_id = ?'
    ).get(oldId) as Record<string, unknown> | undefined
    if (
      !row
      || row.status !== 'SUPERSEDED'
      || row.is_cycle_head !== 0
      || row.last_applied_event_id !== context.event.record.event_id
      || row.updated_at !== context.event.record.timestamp
    ) throw new Error(`superseded task closure ${oldId} conflicts with prepared EVENT`)
  }
  assertReportStatuses(context, payload.superseded_report_ids, 'SUPERSEDED')
  assertProjectionMarked(context)
}

function assertTaskClosureReplaced(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  const oldId = text(payload.old_task_closure_id, 'old_task_closure_id')
  const newId = text(payload.new_task_closure_id, 'new_task_closure_id')
  assertClosureRow(context, newId, oldId)
  const old = context.database.prepare(
    `SELECT status, is_cycle_head, replacement_task_closure_id,
            last_applied_event_id, updated_at
       FROM task_closure WHERE task_closure_id = ?`
  ).get(oldId) as Record<string, unknown> | undefined
  if (
    !old
    || old.status !== 'SUPERSEDED'
    || old.is_cycle_head !== 0
    || old.replacement_task_closure_id !== newId
    || old.last_applied_event_id !== context.event.record.event_id
    || old.updated_at !== context.event.record.timestamp
  ) throw new Error(`replaced task closure ${oldId} conflicts with prepared EVENT`)
  assertReportStatuses(context, payload.archived_report_ids, 'ARCHIVED')
  assertProjectionMarked(context)
}

function oneEvent(batch: PreparedBatchSource, eventType: string): VerifiedEventSource {
  const matches = batch.events.filter((event) => event.record.event_type === eventType)
  if (matches.length !== 1) throw new Error(`prepared result requires exactly one ${eventType} EVENT`)
  return matches[0]
}

function closurePublicResult(event: VerifiedEventSource): Readonly<Record<string, CanonicalJsonValue>> {
  const payload = event.record.payload
  const closureId = event.record.event_type === 'TASK_CLOSURE_CONFIRMED'
    ? text(payload.task_closure_id, 'task_closure_id')
    : text(payload.new_task_closure_id, 'new_task_closure_id')
  const resultIds = stringArray(payload.source_result_ids, 'source_result_ids')
  if (resultIds.length !== 3) throw new Error('source_result_ids must contain exactly three IDs')
  return {
    success: true,
    taskClosure: {
      taskClosureId: closureId,
      studentId: text(payload.student_id, 'student_id'),
      jobCode: text(payload.job_code, 'job_code'),
      taskCode: text(payload.task_code, 'task_code'),
      cycleNo: integer(payload.cycle_no, 'cycle_no'),
      closureRevision: integer(payload.closure_revision, 'closure_revision'),
      status: text(payload.status, 'status'),
      isCycleHead: bool(payload.is_cycle_head, 'is_cycle_head'),
      resultIds
    }
  }
}

export function registerTaskClosurePreparedFacts(registry: PreparedFactRegistry): PreparedFactRegistry {
  registry.registerEvent({
    eventType: 'TASK_CLOSURE_CONFIRMED',
    eventPayloadVersion: 2,
    projectorName: TASK_CLOSURE_PROJECTOR_NAME,
    validatePayload: (payload) => validateClosurePayload('TASK_CLOSURE_CONFIRMED', payload, CONFIRMED_KEYS),
    project: projectTaskClosure,
    assertProjected: assertTaskClosureConfirmed,
    operationalEffects: []
  })
  registry.registerEvent({
    eventType: 'TASK_CLOSURE_REPLACED',
    eventPayloadVersion: 2,
    projectorName: TASK_CLOSURE_PROJECTOR_NAME,
    validatePayload: (payload) => validateClosurePayload('TASK_CLOSURE_REPLACED', payload, REPLACED_KEYS),
    project: projectTaskClosure,
    assertProjected: assertTaskClosureReplaced,
    operationalEffects: []
  })
  registry.registerResult({
    commandType: 'reports:confirmTaskClosure',
    resultRecipeVersion: TASK_CLOSURE_RESULT_RECIPE_VERSIONS['reports:confirmTaskClosure'],
    fromPrepared: ({ batch }) => closurePublicResult(oneEvent(batch, 'TASK_CLOSURE_CONFIRMED'))
  })
  registry.registerResult({
    commandType: 'reports:replaceTaskClosure',
    resultRecipeVersion: TASK_CLOSURE_RESULT_RECIPE_VERSIONS['reports:replaceTaskClosure'],
    fromPrepared: ({ batch }) => closurePublicResult(oneEvent(batch, 'TASK_CLOSURE_REPLACED'))
  })
  return registry
}

export function registerM5bReportAndClosurePreparedFacts(
  registry = new PreparedFactRegistry()
): PreparedFactRegistry {
  registerReportPreparedFacts(registry)
  registerTaskClosurePreparedFacts(registry)
  return registry
}
