import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import { assertPreviewProjectionStatus } from '../../domain/projectors/preview-event-projection'
import { PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION, validatePreviewSafetyPayload } from '../../domain/preview/preview-safety-event-contract'
import { PREVIEW_SAFETY_RESULT_RECIPE_VERSION } from '../../domain/projectors/preview-safety-projector'

export const PREVIEW_SAFETY_SNAPSHOT_VERSION = 'preview-safety-snapshot-v1'
export const PREVIEW_SAFETY_PLAN_VERSION = 'preview.preview-safety.plan.v1'

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} is invalid`)
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) throw new Error(`${field} is invalid`)
  return timestamp
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} is invalid`)
  return value as Record<string, CanonicalJsonValue>
}

function deterministicId(commandId: string, role: string): string {
  const bytes = createHash('sha256').update('svets:preview-safety:v1\0').update(commandId).update('\0').update(role).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function errorSnapshot(timestamp: string, appVersion: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot({ schema_version: PREVIEW_SAFETY_SNAPSHOT_VERSION, kind: 'NO_OP', timestamp, app_version: appVersion, no_op_result: { success: false, errorCode }, fact: null, next_sequence: null })
}

function sessionId(envelope: CommandEnvelopeV2): string {
  return text(envelope.target.preview_session_id ?? envelope.target.session_id, 'target.preview_session_id')
}

function actorRole(envelope: CommandEnvelopeV2): CanonicalJsonValue {
  return envelope.actor.kind === 'USER' ? envelope.actor.role : 'SYSTEM'
}

export function loadPreviewSafetyPlannerSnapshot(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  const appVersion = text(options.appVersion, 'appVersion')
  try {
    assertPreviewProjectionStatus(database)
    const targetSessionId = sessionId(envelope)
    const payload = record(envelope.payload, 'payload')
    const safetyInput = record(payload.safety, 'payload.safety')
    const reasonCode = text(safetyInput.reason_code, 'payload.safety.reason_code')
    const row = database.prepare(
      `SELECT preview_session_id, assessment_session_id, student_id, job_code,
              task_code, snapshot_root_hash, status
         FROM preview_session_projection
        WHERE preview_session_id = ?`
    ).get(targetSessionId) as {
      preview_session_id: string
      assessment_session_id: string
      student_id: string
      job_code: string
      task_code: string
      snapshot_root_hash: string
      status: string
    } | undefined
    if (!row) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SESSION_CONTRACT_INVALID')
    if (text(safetyInput.session_id, 'payload.safety.session_id') !== targetSessionId) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SCOPE_INVALID')
    if (row.status !== 'ACTIVE') return errorSnapshot(timestamp, appVersion, 'PREVIEW_STATE_CONFLICT')
    for (const [field, expected] of [['student_id', row.student_id], ['job_code', row.job_code], ['task_code', row.task_code]] as const) {
      if (envelope.target[field] !== undefined && envelope.target[field] !== expected) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SCOPE_INVALID')
    }
    const sequenceRow = database.prepare(
      `SELECT MAX(event_sequence) AS value
         FROM preview_event_projection
        WHERE aggregate_type = 'PREVIEW_SESSION' AND aggregate_id = ?`
    ).get(targetSessionId) as { value: number | null } | undefined
    const fact = {
      incident_id: deterministicId(envelope.commandId, 'incident'),
      preview_session_id: row.preview_session_id,
      session_id: row.assessment_session_id,
      student_id: row.student_id,
      job_code: row.job_code,
      task_code: row.task_code,
      reason_code: reasonCode,
      status_after: 'OPEN',
      preview_redline_ref: deterministicId(envelope.commandId, 'redline'),
      snapshot_root_hash: row.snapshot_root_hash,
      occurred_at: timestamp
    }
    return createPlannerReadSnapshot({ schema_version: PREVIEW_SAFETY_SNAPSHOT_VERSION, kind: 'EVENTS', timestamp, app_version: appVersion, no_op_result: null, fact, next_sequence: (sequenceRow?.value ?? 0) + 1 })
  } catch (error) {
    if (error instanceof PreviewContractError) return errorSnapshot(timestamp, appVersion, error.code)
    throw error
  }
}

export class PreviewSafetyPlanner {
  plan(input: { envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }): CommandPlanV1 {
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== PREVIEW_SAFETY_SNAPSHOT_VERSION) throw new Error('preview safety snapshot version mismatch')
    if (value.kind === 'NO_OP') {
      return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: input.envelope.commandType, planVersion: PREVIEW_SAFETY_PLAN_VERSION, resultRecipeVersion: PREVIEW_SAFETY_RESULT_RECIPE_VERSION, events: [], operationalEffects: [], noOpResult: record(value.no_op_result, 'snapshot.no_op_result') }
    }
    if (value.kind !== 'EVENTS') throw new Error('preview safety snapshot kind is invalid')
    const fact = record(value.fact, 'snapshot.fact')
    const eventPayload = {
      event_payload_version: PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION,
      batch_context: {
        schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
        plan_version: PREVIEW_SAFETY_PLAN_VERSION,
        result_recipe_version: PREVIEW_SAFETY_RESULT_RECIPE_VERSION,
        root_command_type: input.envelope.commandType,
        root_command_id: input.envelope.commandId,
        child_ordinal: 0
      },
      actor_role: actorRole(input.envelope),
      app_version: text(value.app_version, 'snapshot.app_version'),
      correlation_id: input.envelope.correlationId,
      contract_version: PREVIEW_CONTRACT_VERSION,
      allowed_shell_kind: 'PREVIEW_SHELL',
      ...fact
    }
    validatePreviewSafetyPayload(eventPayload)
    const event: EventIntentV1 = {
      eventId: deterministicId(input.envelope.commandId, 'event'),
      aggregateType: 'PREVIEW_SESSION',
      aggregateId: text(fact.preview_session_id, 'fact.preview_session_id'),
      eventType: 'PREVIEW_SAFETY_INCIDENT_CREATED',
      eventSequence: Number(value.next_sequence),
      actorId: input.envelope.actorId,
      timestamp: text(value.timestamp, 'snapshot.timestamp'),
      payload: JSON.parse(canonicalJson(eventPayload)) as EventIntentV1['payload']
    }
    return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: input.envelope.commandType, planVersion: PREVIEW_SAFETY_PLAN_VERSION, resultRecipeVersion: PREVIEW_SAFETY_RESULT_RECIPE_VERSION, events: [event], operationalEffects: [], noOpResult: null }
  }
}
