import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { AcceptedCommandContext, CommandEnvelopeV2 } from '../command/command-types'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import type {
  ActionLogEntry,
  AggregateType,
  AssignmentEventBatchMetadataV2,
  AssignmentRuntimeContextV2Payload,
  EventType
} from '@shared/types/event-payloads'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import {
  applyLocalRuntimeContextPlan,
  planLocalRuntimeContext,
  type LocalRuntimeContextPlan,
  type LocalRuntimePlanIdentity
} from '../../domain/local-runtime-context'
import {
  confirmStudentAssignment as legacyConfirmStudentAssignment,
  createAssignment as legacyCreateAssignment,
  rebindAssignment as legacyRebindAssignment,
  releaseAssignment as legacyReleaseAssignment,
  startAssignedAssessment as legacyStartAssignedAssessment
} from '../services/assignment-service'
import type {
  AssignmentActorRole,
  ConfirmStudentAssignmentParams,
  CreateAssignmentParams,
  RebindAssignmentParams,
  ReleaseAssignmentParams,
  StartAssignedAssessmentParams
} from '@shared/types/assignment'

export const ASSIGNMENT_EVENT_PAYLOAD_VERSION = 2 as const
export const ASSIGNMENT_SNAPSHOT_VERSION = 'm5b-assignment-snapshot-v1'

export const ASSIGNMENT_PLAN_VERSIONS = Object.freeze({
  'assignment:create': 'm5b.assignment.create.plan.v1',
  'assignment:confirmStudent': 'm5b.assignment.confirm-student.plan.v1',
  'assignment:startAssessment': 'm5b.assignment.start-assessment.plan.v1',
  'assignment:rebind': 'm5b.assignment.rebind.plan.v1',
  'assignment:release': 'm5b.assignment.release.plan.v1'
} as const)

export const ASSIGNMENT_RESULT_RECIPE_VERSIONS = Object.freeze({
  'assignment:create': 'm5b.assignment.create.result.v1',
  'assignment:confirmStudent': 'm5b.assignment.confirm-student.result.v1',
  'assignment:startAssessment': 'm5b.assignment.start-assessment.result.v1',
  'assignment:rebind': 'm5b.assignment.rebind.result.v1',
  'assignment:release': 'm5b.assignment.release.result.v1'
} as const)

export const ASSIGNMENT_RUNTIME_EFFECT = Object.freeze({
  effectType: 'LOCAL_RUNTIME_CONTEXT',
  effectVersion: 1
} as const)

type AssignmentCommand = keyof typeof ASSIGNMENT_PLAN_VERSIONS
type AssignmentEventFact = Readonly<{
  event_id: string
  aggregate_type: AggregateType
  aggregate_id: string
  event_type: EventType
  event_sequence: number
  timestamp: string
  payload: Readonly<Record<string, CanonicalJsonValue>>
}>
type AssignmentSnapshotValue = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof ASSIGNMENT_SNAPSHOT_VERSION
  kind: 'NO_OP' | 'EVENTS'
  no_op_result: Readonly<Record<string, CanonicalJsonValue>> | null
  events: readonly AssignmentEventFact[]
}>
type PlanningClone = DBAdapter & { close?: () => void }
type CloneablePlanningDatabase = DBAdapter & { cloneForPlanning?: () => Promise<PlanningClone> }

export class AssignmentPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'PLANNING_ADAPTER_REQUIRED',
    message: string
  ) {
    super(`[m5b-assignment-planner] ${message}`)
    this.name = 'AssignmentPlannerError'
  }
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssignmentPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Record<string, CanonicalJsonValue>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new AssignmentPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new AssignmentPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  try {
    return record(JSON.parse(canonicalJson(value)), field)
  } catch (error) {
    throw new AssignmentPlannerError('INVALID_INPUT', `${field} is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function commandRole(envelope: CommandEnvelopeV2): AssignmentActorRole {
  if (envelope.actor.kind !== 'USER' || envelope.actor.userId !== envelope.actorId) {
    throw new AssignmentPlannerError('INVALID_INPUT', 'assignment planning requires the accepted user actor')
  }
  if (envelope.actor.role !== 'TEACHER' && envelope.actor.role !== 'ADMIN' && envelope.actor.role !== 'STUDENT') {
    throw new AssignmentPlannerError('INVALID_INPUT', 'assignment planning actor role is invalid')
  }
  return envelope.actor.role
}

function payloadFor(envelope: CommandEnvelopeV2): Record<string, CanonicalJsonValue> {
  return record(envelope.payload, 'payload')
}

function targetText(envelope: CommandEnvelopeV2, field: string): string | undefined {
  const value = envelope.target[field]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function checksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function nextSequence(database: DBAdapter, aggregateType: AggregateType, aggregateId: string): number {
  const row = database.prepare(
    `SELECT MAX(event_sequence) AS max_sequence
       FROM domain_event_projection
      WHERE aggregate_type = ? AND aggregate_id = ?`
  ).get(aggregateType, aggregateId) as { max_sequence: number | null } | undefined
  const projectionSequence = row?.max_sequence ?? 0
  if (aggregateType !== 'ASSESSMENT_SESSION') return projectionSequence + 1
  const session = database.prepare(
    'SELECT event_sequence_version FROM assessment_session WHERE session_id = ?'
  ).get(aggregateId) as { event_sequence_version: number | null } | undefined
  // Assignment events advance the same session's replay fence while living on
  // BUSINESS_SESSION. The prepared ASSESSMENT_SESSION event must follow that fence.
  return Math.max(projectionSequence, session?.event_sequence_version ?? 0) + 1
}

function deterministicUuid(commandId: string, ordinal: number, role: string): string {
  const bytes = createHash('sha256')
    .update('svets:event-batch:assignment:v1\0', 'utf8')
    .update(commandId, 'utf8')
    .update('\0', 'utf8')
    .update(String(ordinal), 'utf8')
    .update('\0', 'utf8')
    .update(role, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function runtimeExpiresAt(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000).toISOString()
}

const RUNTIME_ID_ORDINAL: Readonly<Record<LocalRuntimePlanIdentity, number>> = Object.freeze({
  organization: 1,
  node: 2,
  device: 3,
  'device-runtime-session': 4,
  'auth-session': 5,
  'token-seed': 6,
  'refresh-token-seed': 7
})

function runtimePlanPayload(plan: LocalRuntimeContextPlan): AssignmentRuntimeContextV2Payload {
  return {
    schema_version: plan.schema_version,
    context: {
      organization_id: plan.context.organizationId,
      node_id: plan.context.nodeId,
      device_id: plan.context.deviceId,
      device_runtime_session_id: plan.context.deviceRuntimeSessionId,
      teacher_auth_session_id: plan.context.teacherAuthSessionId
    },
    organization: { ...plan.organization },
    node: { ...plan.node },
    device: {
      ...plan.device,
      capabilities: plan.device.capabilities === null ? null : [...plan.device.capabilities]
    },
    runtime: { ...plan.runtime },
    auth_session: { ...plan.auth_session, capabilities: [...plan.auth_session.capabilities] }
  }
}

function preparedContext(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  ordinal: number
) {
  return Object.freeze({
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: resultRecipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: ordinal
  })
}

function cloneDatabase(database: DBAdapter): Promise<PlanningClone> {
  const cloneable = database as CloneablePlanningDatabase
  if (typeof cloneable.cloneForPlanning !== 'function') {
    throw new AssignmentPlannerError(
      'PLANNING_ADAPTER_REQUIRED',
      'assignment prepared-fact planning requires an isolated cloned database adapter'
    )
  }
  return cloneable.cloneForPlanning()
}

function runtimeSessionParam(command: AssignmentCommand, payload: Record<string, CanonicalJsonValue>): string | undefined {
  if (command === 'assignment:create') {
    return typeof payload.deviceRuntimeSessionId === 'string' ? payload.deviceRuntimeSessionId : undefined
  }
  if (command === 'assignment:rebind') {
    return typeof payload.newDeviceRuntimeSessionId === 'string' ? payload.newDeviceRuntimeSessionId : undefined
  }
  return undefined
}

function prepareRuntimeOnClone(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  command: AssignmentCommand,
  payload: Record<string, CanonicalJsonValue>,
  timestamp: string
): LocalRuntimeContextPlan | null {
  if (command !== 'assignment:create' && command !== 'assignment:rebind') return null
  const explicitRuntimeSessionId = runtimeSessionParam(command, payload)
  const context = { envelope } as unknown as AcceptedCommandContext
  try {
    const plan = planLocalRuntimeContext(database, envelope.actorId, context, {
      ...(explicitRuntimeSessionId ? {
        deviceRuntimeSessionId: explicitRuntimeSessionId,
        requireExistingAuth: true
      } : {}),
      timestamp,
      expiresAt: runtimeExpiresAt(timestamp),
      generateId: (kind) => deterministicUuid(envelope.commandId, RUNTIME_ID_ORDINAL[kind], `runtime-${kind}`)
    })
    applyLocalRuntimeContextPlan(database, plan)
    return plan
  } catch {
    return null
  }
}

function overwriteVolatileFacts(
  payload: Record<string, unknown>,
  eventType: EventType,
  commandId: string,
  timestamp: string,
  runtime: LocalRuntimeContextPlan | null
): void {
  if (eventType === 'ASSIGNMENT_CREATED') {
    payload.assignment_id = deterministicUuid(commandId, 1, 'assignment')
    payload.grant_id = deterministicUuid(commandId, 2, 'grant')
    payload.assigned_at = timestamp
    payload.granted_at = timestamp
    payload.expires_at = runtimeExpiresAt(timestamp)
  }
  if (eventType === 'GRANT_REBOUND') {
    payload.new_grant_id = deterministicUuid(commandId, 1, 'rebound-grant')
    payload.granted_at = timestamp
    payload.expires_at = runtimeExpiresAt(timestamp)
    payload.rebound_at = timestamp
  }
  if (eventType === 'ASSIGNMENT_STUDENT_CONFIRMED') payload.confirmed_at = timestamp
  if (eventType === 'ASSIGNMENT_ASSESSMENT_STARTED') payload.started_at = timestamp
  if (eventType === 'ASSIGNMENT_RELEASED') payload.released_at = timestamp
  if (runtime && (eventType === 'ASSIGNMENT_CREATED' || eventType === 'GRANT_REBOUND')) {
    payload.device_id = runtime.context.deviceId
    payload.device_runtime_session_id = runtime.context.deviceRuntimeSessionId
    payload.teacher_auth_session_id = runtime.context.teacherAuthSessionId
    if (eventType === 'GRANT_REBOUND') {
      payload.new_device_runtime_session_id = runtime.context.deviceRuntimeSessionId
    }
    payload.runtime_context_v2 = runtimePlanPayload(runtime)
  }
}

function captureLegacyEvents(input: Readonly<{
  database: DBAdapter
  envelope: CommandEnvelopeV2
  timestamp: string
  runtime: LocalRuntimeContextPlan | null
}>): { events: AssignmentEventFact[]; writeEvent: ReportMutationPort['writeEvent'] } {
  const sequences = new Map<string, number>()
  const events: AssignmentEventFact[] = []
  const writeEvent: ReportMutationPort['writeEvent'] = (params) => {
    const key = `${params.aggregateType}\u0000${params.aggregateId}`
    const sequence = sequences.get(key) ?? nextSequence(input.database, params.aggregateType, params.aggregateId)
    sequences.set(key, sequence + 1)
    overwriteVolatileFacts(params.payload, params.eventType, input.envelope.commandId, input.timestamp, input.runtime)
    const eventId = deterministicUuid(input.envelope.commandId, events.length, `${params.eventType.toLowerCase()}-event`)
    const entry: ActionLogEntry = {
      event_id: eventId,
      aggregate_type: params.aggregateType,
      aggregate_id: params.aggregateId,
      event_type: params.eventType,
      event_sequence: sequence,
      payload: params.payload,
      checksum: checksum(params.payload),
      schema_version: 1,
      created_at: input.timestamp,
      actor_id: params.actorId,
      actor_role: params.actorRole,
      app_version: 'm5b-assignment-planner',
      correlation_id: params.correlationId
    }
    events.push(Object.freeze({
      event_id: eventId,
      aggregate_type: params.aggregateType,
      aggregate_id: params.aggregateId,
      event_type: params.eventType,
      event_sequence: sequence,
      timestamp: input.timestamp,
      payload: canonicalRecord(params.payload, `legacy.${params.eventType}.payload`)
    }))
    return entry
  }
  return { events, writeEvent }
}

function publicResult(command: AssignmentCommand, legacyResult: unknown, events: readonly AssignmentEventFact[]): Record<string, CanonicalJsonValue> {
  const legacy = canonicalRecord(legacyResult, 'legacy_result')
  if (legacy.success !== true || events.length === 0) return legacy
  const payload = events.at(-1)!.payload
  if (command === 'assignment:create') {
    return {
      success: true,
      grantId: text(payload.grant_id, 'create.grant_id'),
      assignmentId: text(payload.assignment_id, 'create.assignment_id'),
      businessSessionId: text(payload.business_session_id, 'create.business_session_id'),
      sessionId: text(payload.session_id, 'create.session_id'),
      studentId: text(payload.student_id, 'create.student_id'),
      deviceId: text(payload.device_id, 'create.device_id'),
      deviceRuntimeSessionId: text(payload.device_runtime_session_id, 'create.device_runtime_session_id'),
      deliveryPhase: payload.delivery_phase_after as CanonicalJsonValue,
      assignmentStatus: payload.assignment_status as CanonicalJsonValue,
      grantStatus: payload.grant_status as CanonicalJsonValue,
      expiresAt: text(payload.expires_at, 'create.expires_at')
    }
  }
  if (command === 'assignment:confirmStudent') {
    return {
      success: true,
      assignmentId: text(payload.assignment_id, 'confirm.assignment_id'),
      businessSessionId: text(payload.business_session_id, 'confirm.business_session_id'),
      sessionId: text(payload.session_id, 'confirm.session_id'),
      studentId: text(payload.student_id, 'confirm.student_id'),
      deliveryPhase: payload.delivery_phase_after as CanonicalJsonValue,
      assignmentStatus: payload.assignment_status_after as CanonicalJsonValue,
      confirmedAt: text(payload.confirmed_at, 'confirm.confirmed_at')
    }
  }
  if (command === 'assignment:startAssessment') {
    return {
      success: true,
      sessionId: text(payload.session_id, 'start.session_id'),
      assignmentId: text(payload.assignment_id, 'start.assignment_id'),
      deliveryPhase: payload.delivery_phase_after as CanonicalJsonValue,
      firstQuestionId: text(payload.first_question_id, 'start.first_question_id'),
      firstQuestionOrder: payload.first_question_order as CanonicalJsonValue
    }
  }
  if (command === 'assignment:rebind') {
    return {
      success: true,
      assignmentId: text(payload.assignment_id, 'rebind.assignment_id'),
      businessSessionId: text(payload.business_session_id, 'rebind.business_session_id'),
      sessionId: text(payload.session_id, 'rebind.session_id'),
      oldGrantId: text(payload.old_grant_id, 'rebind.old_grant_id'),
      newGrantId: text(payload.new_grant_id, 'rebind.new_grant_id'),
      version: payload.assignment_version_after as CanonicalJsonValue,
      assignmentStatus: payload.assignment_status_after as CanonicalJsonValue,
      deliveryPhase: payload.delivery_phase_after as CanonicalJsonValue,
      requiresStudentConfirmation: payload.require_reconfirmation as CanonicalJsonValue
    }
  }
  return {
    success: true,
    assignmentId: text(payload.assignment_id, 'release.assignment_id'),
    businessSessionId: text(payload.business_session_id, 'release.business_session_id'),
    sessionId: text(payload.session_id, 'release.session_id'),
    grantId: text(payload.grant_id, 'release.grant_id'),
    assignmentStatus: payload.assignment_status_after as CanonicalJsonValue,
    grantStatus: payload.grant_status_after as CanonicalJsonValue,
    releasedAt: text(payload.released_at, 'release.released_at')
  }
}

function decorateEvents(
  events: readonly AssignmentEventFact[],
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  actorRole: AssignmentActorRole,
  appVersion: string,
  rootResult: Record<string, CanonicalJsonValue>
): readonly AssignmentEventFact[] {
  return events.map((event, ordinal) => {
    const metadata = {
      event_payload_version: ASSIGNMENT_EVENT_PAYLOAD_VERSION,
      batch_context: preparedContext(envelope, planVersion, resultRecipeVersion, ordinal),
      actor_role: actorRole,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      ...(ordinal === events.length - 1 ? { root_result: rootResult } : {})
    } satisfies AssignmentEventBatchMetadataV2
    return Object.freeze({
      ...event,
      payload: canonicalRecord({ ...event.payload, ...metadata }, `events[${ordinal}].payload`)
    })
  })
}

function executeLegacy(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  command: AssignmentCommand,
  payload: Record<string, CanonicalJsonValue>,
  writeEvent: ReportMutationPort['writeEvent']
): unknown {
  const actorRole = commandRole(envelope)
  const context = { envelope } as unknown as AcceptedCommandContext
  const execution = { eventPort: { writeEvent }, context }
  if (command === 'assignment:create') {
    return legacyCreateAssignment(database, {
      ...payload,
      businessSessionId: payload.businessSessionId ?? targetText(envelope, 'business_session_id'),
      callerUserId: envelope.actorId,
      callerRole: actorRole
    } as unknown as CreateAssignmentParams, execution)
  }
  if (command === 'assignment:confirmStudent') {
    return legacyConfirmStudentAssignment(database, {
      ...payload,
      assignmentId: payload.assignmentId ?? targetText(envelope, 'assignment_id'),
      callerUserId: envelope.actorId,
      callerRole: actorRole
    } as unknown as ConfirmStudentAssignmentParams, execution)
  }
  if (command === 'assignment:startAssessment') {
    return legacyStartAssignedAssessment(database, {
      ...payload,
      assignmentId: payload.assignmentId ?? targetText(envelope, 'assignment_id'),
      callerUserId: envelope.actorId,
      callerRole: actorRole
    } as unknown as StartAssignedAssessmentParams, execution)
  }
  if (command === 'assignment:rebind') {
    return legacyRebindAssignment(database, {
      ...payload,
      assignmentId: payload.assignmentId ?? targetText(envelope, 'assignment_id'),
      callerUserId: envelope.actorId,
      callerRole: actorRole
    } as unknown as RebindAssignmentParams, execution)
  }
  return legacyReleaseAssignment(database, {
    ...payload,
    assignmentId: payload.assignmentId ?? targetText(envelope, 'assignment_id'),
    callerUserId: envelope.actorId,
    callerRole: actorRole
  } as unknown as ReleaseAssignmentParams, execution)
}

function prepareOnClone(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): AssignmentSnapshotValue {
  const command = envelope.commandType as AssignmentCommand
  const planVersion = ASSIGNMENT_PLAN_VERSIONS[command]
  const resultRecipeVersion = ASSIGNMENT_RESULT_RECIPE_VERSIONS[command]
  if (!planVersion || !resultRecipeVersion) {
    throw new AssignmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  const actorRole = commandRole(envelope)
  const payload = payloadFor(envelope)
  const runtime = prepareRuntimeOnClone(database, envelope, command, payload, options.timestamp)
  const { events, writeEvent } = captureLegacyEvents({ database, envelope, timestamp: options.timestamp, runtime })
  const legacyResult = executeLegacy(database, envelope, command, payload, writeEvent)
  const rootResult = publicResult(command, legacyResult, events)
  if (events.length === 0) {
    return canonicalRecord({
      schema_version: ASSIGNMENT_SNAPSHOT_VERSION,
      kind: 'NO_OP',
      no_op_result: rootResult,
      events: []
    }, 'assignment_snapshot') as AssignmentSnapshotValue
  }
  if ((command === 'assignment:create' || command === 'assignment:rebind') && !runtime) {
    throw new AssignmentPlannerError('INVALID_INPUT', 'assignment runtime facts were not prepared')
  }
  return canonicalRecord({
    schema_version: ASSIGNMENT_SNAPSHOT_VERSION,
    kind: 'EVENTS',
    no_op_result: null,
    events: decorateEvents(events, envelope, planVersion, resultRecipeVersion, actorRole, options.appVersion, rootResult)
  }, 'assignment_snapshot') as AssignmentSnapshotValue
}

export async function loadAssignmentPlannerSnapshot(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): Promise<PlannerReadSnapshot<CanonicalJsonValue>> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  text(options.appVersion, 'appVersion')
  text(envelope.correlationId, 'correlationId')
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_PLAN_VERSIONS, envelope.commandType)) {
    throw new AssignmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  const clone = await cloneDatabase(database)
  try {
    return createPlannerReadSnapshot(prepareOnClone(clone, envelope, { timestamp, appVersion: options.appVersion }))
  } finally {
    clone.close?.()
  }
}

export class AssignmentPlanner {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<CanonicalJsonValue>
  }>): CommandPlanV1 {
    const command = input.envelope.commandType as AssignmentCommand
    const planVersion = ASSIGNMENT_PLAN_VERSIONS[command]
    const resultRecipeVersion = ASSIGNMENT_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) {
      throw new AssignmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    }
    const snapshot = record(input.snapshot.value, 'snapshot') as AssignmentSnapshotValue
    if (snapshot.schema_version !== ASSIGNMENT_SNAPSHOT_VERSION) {
      throw new AssignmentPlannerError('INVALID_INPUT', 'snapshot version mismatch')
    }
    if (snapshot.kind === 'NO_OP') {
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: input.envelope.commandId,
        commandType: command,
        planVersion,
        resultRecipeVersion,
        events: [],
        operationalEffects: [],
        noOpResult: record(snapshot.no_op_result, 'snapshot.no_op_result')
      }
    }
    if (snapshot.kind !== 'EVENTS' || !Array.isArray(snapshot.events) || snapshot.events.length === 0) {
      throw new AssignmentPlannerError('INVALID_INPUT', 'event snapshot is invalid')
    }
    const events: EventIntentV1[] = snapshot.events.map((value, ordinal) => {
      const event = record(value, `events[${ordinal}]`)
      const eventSequence = event.event_sequence
      if (!Number.isSafeInteger(eventSequence) || (eventSequence as number) < 1) {
        throw new AssignmentPlannerError('INVALID_INPUT', `events[${ordinal}].event_sequence is invalid`)
      }
      return Object.freeze({
        eventId: text(event.event_id, `events[${ordinal}].event_id`),
        aggregateType: text(event.aggregate_type, `events[${ordinal}].aggregate_type`) as EventIntentV1['aggregateType'],
        aggregateId: text(event.aggregate_id, `events[${ordinal}].aggregate_id`),
        eventType: text(event.event_type, `events[${ordinal}].event_type`) as EventIntentV1['eventType'],
        eventSequence: eventSequence as number,
        payload: record(event.payload, `events[${ordinal}].payload`) as EventIntentV1['payload'],
        actorId: input.envelope.actorId,
        timestamp: exactTimestamp(event.timestamp, `events[${ordinal}].timestamp`)
      })
    })
    const operationalEffects = events
      .filter((event) => event.eventType === 'ASSIGNMENT_CREATED' || event.eventType === 'GRANT_REBOUND')
      .map((event) => Object.freeze({
        sourceEventId: event.eventId,
        eventType: event.eventType,
        effectType: ASSIGNMENT_RUNTIME_EFFECT.effectType,
        effectVersion: ASSIGNMENT_RUNTIME_EFFECT.effectVersion
      }))
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: input.envelope.commandId,
      commandType: command,
      planVersion,
      resultRecipeVersion,
      events,
      operationalEffects,
      noOpResult: null
    }
  }
}
