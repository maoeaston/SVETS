import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import { BATCH_CONTEXT_SCHEMA_VERSION, COMMAND_PLAN_SCHEMA_VERSION, createPlannerReadSnapshot, type CommandPlanV1, type EventIntentV1, type PlannerReadSnapshot } from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import { PREVIEW_CONTRACT_VERSION, type PreviewSessionSnapshot } from '../../../shared/types/preview-contract'
import { assertPreviewSessionSnapshot } from '../../domain/preview/preview-session-snapshot'
import { PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, validatePreviewSessionStatusPayload, type PreviewSessionEventType } from '../../domain/preview/preview-session-event-contract'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import { assertPreviewProjectionStatus } from '../../domain/projectors/preview-event-projection'
import { PREVIEW_SESSION_RESULT_RECIPE_VERSIONS } from '../../domain/projectors/preview-session-projector'

export const PREVIEW_SESSION_SNAPSHOT_VERSION = 'preview-session-plan-snapshot-v1'
export const PREVIEW_SESSION_PLAN_VERSIONS = Object.freeze({
  'preview:startSession': 'preview.preview-session-start.plan.v1',
  'preview:completeSession': 'preview.preview-session-complete.plan.v1',
  'preview:abortSession': 'preview.preview-session-abort.plan.v1',
  'preview:technicalInterruption': 'preview.preview-session-technical-interruption.plan.v1'
})

type SessionCommand = keyof typeof PREVIEW_SESSION_PLAN_VERSIONS

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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, CanonicalJsonValue>
}

function uuid(commandId: string, eventType: string): string {
  const bytes = createHash('sha256').update('svets:preview-session:v1\0').update(commandId).update('\0').update(eventType).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function context(envelope: CommandEnvelopeV2, planVersion: string, resultRecipeVersion: string) { return { schema_version: BATCH_CONTEXT_SCHEMA_VERSION, plan_version: planVersion, result_recipe_version: resultRecipeVersion, root_command_type: envelope.commandType, root_command_id: envelope.commandId, child_ordinal: 0 } as const }

function errorSnapshot(timestamp: string, appVersion: string, errorCode: string): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot({ schema_version: PREVIEW_SESSION_SNAPSHOT_VERSION, kind: 'NO_OP', timestamp, app_version: appVersion, no_op_result: { success: false, errorCode }, snapshot: null, next_sequence: null })
}

function previewSessionId(envelope: CommandEnvelopeV2): string {
  return text(envelope.target.preview_session_id ?? envelope.target.session_id, 'target.preview_session_id')
}

function actorRole(envelope: CommandEnvelopeV2): CanonicalJsonValue {
  return envelope.actor.kind === 'USER' ? envelope.actor.role : 'SYSTEM'
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  const parsed = JSON.parse(canonicalJson(value as CanonicalJsonValue)) as CanonicalJsonValue
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${field} is invalid`)
  return parsed
}

function eventPayloadMetadata(envelope: CommandEnvelopeV2, appVersion: string): Record<string, CanonicalJsonValue> {
  return {
    event_payload_version: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION,
    batch_context: {},
    actor_role: actorRole(envelope),
    app_version: appVersion,
    correlation_id: envelope.correlationId,
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_shell_kind: 'PREVIEW_SHELL'
  }
}

export function loadPreviewSessionPlannerSnapshot(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  const appVersion = text(options.appVersion, 'appVersion')
  const command = envelope.commandType as SessionCommand
  if (!Object.hasOwn(PREVIEW_SESSION_PLAN_VERSIONS, command)) throw new Error(`unsupported preview session command ${envelope.commandType}`)
  try {
    assertPreviewProjectionStatus(database)
    const payload = record(envelope.payload, 'payload')
    if (command === 'preview:startSession') {
      const snapshot = assertPreviewSessionSnapshot(payload.snapshot as unknown as PreviewSessionSnapshot)
      if (snapshot.session_id !== previewSessionId(envelope)) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SCOPE_INVALID')
      return createPlannerReadSnapshot({ schema_version: PREVIEW_SESSION_SNAPSHOT_VERSION, kind: 'EVENTS', timestamp, app_version: appVersion, snapshot: snapshot as unknown as CanonicalJsonValue, next_sequence: 1, no_op_result: null })
    }
    const sessionId = previewSessionId(envelope)
    const statusPayload = record(payload.status, 'payload.status')
    const row = database.prepare(
      `SELECT snapshot_json, status
         FROM preview_session_projection
        WHERE preview_session_id = ?`
    ).get(sessionId) as { snapshot_json: string; status: string } | undefined
    if (!row) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SESSION_CONTRACT_INVALID')
    if (row.status !== 'ACTIVE') return errorSnapshot(timestamp, appVersion, 'PREVIEW_STATE_CONFLICT')
    const snapshot = assertPreviewSessionSnapshot(JSON.parse(row.snapshot_json) as PreviewSessionSnapshot)
    const reasonCode = text(statusPayload.reason_code, 'payload.status.reason_code')
    if (text(statusPayload.session_id, 'payload.status.session_id') !== sessionId) return errorSnapshot(timestamp, appVersion, 'PREVIEW_SCOPE_INVALID')
    const eventType: PreviewSessionEventType = command === 'preview:completeSession'
      ? 'PREVIEW_SESSION_COMPLETED'
      : command === 'preview:abortSession'
        ? 'PREVIEW_SESSION_ABORTED'
        : 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION'
    const eventSnapshot = {
      ...eventPayloadMetadata(envelope, appVersion),
      session_id: snapshot.session_id,
      snapshot_root_hash: snapshot.snapshot_root_hash,
      status_before: 'ACTIVE',
      status_after: eventType === 'PREVIEW_SESSION_COMPLETED' ? 'COMPLETED' : eventType === 'PREVIEW_SESSION_ABORTED' ? 'ABORTED' : 'TECHNICAL_INTERRUPTED',
      reason_code: reasonCode
    }
    const sequenceRow = database.prepare(
      `SELECT MAX(event_sequence) AS value
         FROM preview_event_projection
        WHERE aggregate_type = 'PREVIEW_SESSION' AND aggregate_id = ?`
    ).get(sessionId) as { value: number | null } | undefined
    return createPlannerReadSnapshot({ schema_version: PREVIEW_SESSION_SNAPSHOT_VERSION, kind: 'EVENTS', timestamp, app_version: appVersion, snapshot: canonicalRecord(eventSnapshot, 'event_snapshot'), next_sequence: (sequenceRow?.value ?? 0) + 1, no_op_result: null })
  } catch (error) {
    if (error instanceof PreviewContractError) return errorSnapshot(timestamp, appVersion, error.code)
    throw error
  }
}

export class PreviewSessionPlanner {
  plan(input: { envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }): CommandPlanV1 {
    const command = input.envelope.commandType as SessionCommand
    const planVersion = PREVIEW_SESSION_PLAN_VERSIONS[command]
    const resultRecipeVersion = PREVIEW_SESSION_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new Error(`unsupported preview session command ${input.envelope.commandType}`)
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== PREVIEW_SESSION_SNAPSHOT_VERSION) throw new Error('preview session plan snapshot version mismatch')
    if (value.kind === 'NO_OP') {
      return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [], operationalEffects: [], noOpResult: record(value.no_op_result, 'snapshot.no_op_result') }
    }
    if (value.kind !== 'EVENTS') throw new Error('preview session plan snapshot kind is invalid')
    const start = command === 'preview:startSession'
    const eventType: PreviewSessionEventType = start ? 'PREVIEW_SESSION_STARTED' : command === 'preview:completeSession' ? 'PREVIEW_SESSION_COMPLETED' : command === 'preview:abortSession' ? 'PREVIEW_SESSION_ABORTED' : 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION'
    const snapshot = record(value.snapshot, 'snapshot.snapshot')
    const timestamp = String(value.timestamp)
    const appVersion = String(value.app_version)
    if (!start) validatePreviewSessionStatusPayload(snapshot as never, eventType)
    else assertPreviewSessionSnapshot(snapshot as never)
    const payload: Record<string, CanonicalJsonValue> = start
      ? { event_payload_version: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, batch_context: context(input.envelope, planVersion, resultRecipeVersion), actor_role: input.envelope.actor.kind === 'USER' ? input.envelope.actor.role : 'SYSTEM', app_version: appVersion, correlation_id: input.envelope.correlationId, contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL', snapshot }
      : { ...snapshot, event_payload_version: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, batch_context: context(input.envelope, planVersion, resultRecipeVersion), actor_role: input.envelope.actor.kind === 'USER' ? input.envelope.actor.role : 'SYSTEM', app_version: appVersion, correlation_id: input.envelope.correlationId, contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL' }
    const sessionId = start ? String((snapshot as Record<string, CanonicalJsonValue>).session_id) : String((snapshot as Record<string, CanonicalJsonValue>).session_id)
    const event: EventIntentV1 = { eventId: uuid(input.envelope.commandId, eventType), aggregateType: 'PREVIEW_SESSION', aggregateId: sessionId, eventType, eventSequence: start ? 1 : Number(value.next_sequence ?? 2), actorId: input.envelope.actorId, timestamp, payload: JSON.parse(canonicalJson(payload)) as EventIntentV1['payload'] }
    return { schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command, planVersion, resultRecipeVersion, events: [event], operationalEffects: [], noOpResult: null }
  }
}

export function previewSessionPlanSnapshot(value: Record<string, unknown>): PlannerReadSnapshot<CanonicalJsonValue> { return createPlannerReadSnapshot(JSON.parse(canonicalJson(value as never)) as CanonicalJsonValue) }
