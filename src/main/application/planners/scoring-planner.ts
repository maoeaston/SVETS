import { createHash } from 'crypto'
import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import type { AcceptedCommandContext } from '../command/command-types'
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
  EventType,
  ScoringEventBatchMetadataV3
} from '@shared/types/event-payloads'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import {
  submitOfflineAbilityScores as legacySubmitOfflineAbilityScores
} from '../services/ability-scoring-service'
import {
  submitOperationScores as legacySubmitOperationScores
} from '../services/operation-scoring-service'
import {
  submitJobSkillOfflineScores as legacySubmitJobSkillOfflineScores
} from '../services/job-skill-scoring-service'
import {
  recordTeacherObservation as legacyRecordTeacherObservation
} from '../services/observation-service'
import {
  loadReportGenerationSnapshotValue
} from './report-planner'
import {
  deterministicBatchUuid,
  planReportGenerationFragment
} from './report-plan-fragment'
import type { SubmitOfflineAbilityScoresParams } from '@shared/types/ability-scoring'
import type { SubmitOperationScoresParams } from '@shared/types/operation-scoring'
import type { SubmitJobSkillOfflineScoresParams } from '@shared/types/job-skill-scoring'
import type { RecordTeacherObservationParams } from '@shared/types/teacher-observation'
import { isPreviewAssessmentSession } from '../../domain/preview/preview-session-guard'

export const SCORING_EVENT_PAYLOAD_VERSION = 3 as const
export const SCORING_SNAPSHOT_VERSION = 'm5b-scoring-snapshot-v1'

export const SCORING_PLAN_VERSIONS = Object.freeze({
  'assessment:submitOfflineAbilityScores': 'm5b.scoring.offline-ability.plan.v1',
  'assessment:submitOperationScores': 'm5b.scoring.operation.plan.v1',
  'assessment:submitJobSkillOfflineScores': 'm5b.scoring.job-skill.plan.v1',
  'assessment:recordTeacherObservation': 'm5b.scoring.observation.plan.v1'
} as const)

export const SCORING_RESULT_RECIPE_VERSIONS = Object.freeze({
  'assessment:submitOfflineAbilityScores': 'm5b.scoring.offline-ability.result.v1',
  'assessment:submitOperationScores': 'm5b.scoring.operation.result.v1',
  'assessment:submitJobSkillOfflineScores': 'm5b.scoring.job-skill.result.v1',
  'assessment:recordTeacherObservation': 'm5b.scoring.observation.result.v1'
} as const)

type ScoringCommand = keyof typeof SCORING_PLAN_VERSIONS
type ScoringEventFact = Readonly<{
  event_id: string
  aggregate_type: AggregateType
  aggregate_id: string
  event_type: EventType
  event_sequence: number
  timestamp: string
  payload: Readonly<Record<string, CanonicalJsonValue>>
}>

type ScoringSnapshotValue = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof SCORING_SNAPSHOT_VERSION
  kind: 'NO_OP' | 'EVENTS'
  no_op_result: Readonly<Record<string, CanonicalJsonValue>> | null
  events: readonly ScoringEventFact[]
}>

type PlanningClone = DBAdapter & { close?: () => void }
type CloneablePlanningDatabase = DBAdapter & {
  cloneForPlanning?: () => Promise<PlanningClone>
}

export class ScoringPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'PLANNING_ADAPTER_REQUIRED',
    message: string
  ) {
    super(`[m5b-scoring-planner] ${message}`)
    this.name = 'ScoringPlannerError'
  }
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ScoringPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Record<string, CanonicalJsonValue>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new ScoringPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new ScoringPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  try {
    return record(JSON.parse(canonicalJson(value)), field)
  } catch (error) {
    throw new ScoringPlannerError('INVALID_INPUT', `${field} is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function commandRole(envelope: CommandEnvelopeV2): 'TEACHER' | 'ADMIN' {
  if (envelope.actor.kind !== 'USER' || envelope.actor.userId !== envelope.actorId) {
    throw new ScoringPlannerError('INVALID_INPUT', 'scoring planning requires the accepted user actor')
  }
  if (envelope.actor.role !== 'TEACHER' && envelope.actor.role !== 'ADMIN') {
    throw new ScoringPlannerError('INVALID_INPUT', 'scoring planning requires a teacher or admin actor')
  }
  return envelope.actor.role
}

function sessionId(envelope: CommandEnvelopeV2): string {
  return text(envelope.target.session_id ?? envelope.target.assessment_session_id, 'target.session_id')
}

function payloadFor(envelope: CommandEnvelopeV2): Record<string, CanonicalJsonValue> {
  return record(envelope.payload, 'payload')
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
  return (row?.max_sequence ?? 0) + 1
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

function overwriteVolatileFacts(
  payload: Record<string, unknown>,
  eventType: EventType,
  commandId: string,
  ordinal: number,
  timestamp: string
): void {
  if (typeof payload.offline_score_id === 'string') {
    payload.offline_score_id = deterministicBatchUuid(commandId, ordinal, 'offline-score')
  }
  if (typeof payload.result_id === 'string') {
    payload.result_id = deterministicBatchUuid(commandId, ordinal, 'assessment-result')
  }
  if (eventType === 'OFFLINE_SCORE_SUBMITTED') payload.scored_at = timestamp
  if (eventType === 'TEACHER_OBSERVATION_RECORDED') payload.recorded_at = timestamp
  if (eventType === 'RESULT_CALCULATED') payload.calculated_at = timestamp
  if (eventType === 'SESSION_COMPLETED') payload.completed_at = timestamp
}

function cloneDatabase(database: DBAdapter): Promise<PlanningClone> {
  const cloneable = database as CloneablePlanningDatabase
  if (typeof cloneable.cloneForPlanning !== 'function') {
    throw new ScoringPlannerError(
      'PLANNING_ADAPTER_REQUIRED',
      'scoring prepared-fact planning requires an isolated cloned database adapter'
    )
  }
  return cloneable.cloneForPlanning()
}

function resultId(events: readonly ScoringEventFact[]): string | null {
  const event = events.find((entry) => entry.event_type === 'RESULT_CALCULATED')
  return event && typeof event.payload.result_id === 'string' ? event.payload.result_id : null
}

function publicResult(
  command: ScoringCommand,
  legacyResult: unknown,
  events: readonly ScoringEventFact[]
): Record<string, CanonicalJsonValue> {
  const result = canonicalRecord(legacyResult, 'legacy_result')
  if (result.success !== true) return result
  if (command === 'assessment:submitOperationScores') {
    const calculated = events.find((entry) => entry.event_type === 'RESULT_CALCULATED')
    if (!calculated) throw new ScoringPlannerError('INVALID_INPUT', 'operation scoring did not prepare a result event')
    return {
      success: true,
      resultId: text(calculated.payload.result_id, 'operation.result_id'),
      normalizedScore: calculated.payload.normalized_score as number,
      levelResult: text(calculated.payload.level_result, 'operation.level_result')
    }
  }
  if (command === 'assessment:recordTeacherObservation') {
    const observation = events.find((entry) => entry.event_type === 'TEACHER_OBSERVATION_RECORDED')
    if (!observation) throw new ScoringPlannerError('INVALID_INPUT', 'observation did not prepare an event')
    return { success: true, offlineScoreId: text(observation.payload.offline_score_id, 'observation.offline_score_id') }
  }
  return result
}

function decorateScoringEvents(
  events: readonly ScoringEventFact[],
  envelope: CommandEnvelopeV2,
  planVersion: string,
  resultRecipeVersion: string,
  actorRole: 'TEACHER' | 'ADMIN',
  appVersion: string,
  rootResult: Record<string, CanonicalJsonValue>
): readonly ScoringEventFact[] {
  return events.map((event, ordinal) => {
    const metadata = {
      event_payload_version: SCORING_EVENT_PAYLOAD_VERSION,
      batch_context: preparedContext(envelope, planVersion, resultRecipeVersion, ordinal),
      actor_role: actorRole,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      ...(ordinal === events.length - 1 ? { root_result: rootResult } : {})
    } satisfies ScoringEventBatchMetadataV3
    const payload: Record<string, CanonicalJsonValue> = {
      ...event.payload,
      ...metadata
    }
    return Object.freeze({ ...event, payload: canonicalRecord(payload, `events[${ordinal}].payload`) })
  })
}

function captureLegacyEvents(input: Readonly<{
  database: DBAdapter
  envelope: CommandEnvelopeV2
  timestamp: string
}>): { events: ScoringEventFact[]; writeEvent: ReportMutationPort['writeEvent'] } {
  const sequences = new Map<string, number>()
  const events: ScoringEventFact[] = []
  const writeEvent: ReportMutationPort['writeEvent'] = (params) => {
    const ordinal = events.length
    const key = `${params.aggregateType}\u0000${params.aggregateId}`
    const sequence = sequences.get(key) ?? nextSequence(input.database, params.aggregateType, params.aggregateId)
    sequences.set(key, sequence + 1)
    overwriteVolatileFacts(params.payload, params.eventType, input.envelope.commandId, ordinal, input.timestamp)
    const eventId = deterministicBatchUuid(input.envelope.commandId, ordinal, `${params.eventType.toLowerCase()}-event`)
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
      app_version: 'm5b-scoring-planner',
      correlation_id: params.correlationId
    }
    input.database.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
          payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.event_id,
      entry.aggregate_type,
      entry.aggregate_id,
      entry.event_type,
      entry.event_sequence,
      JSON.stringify(entry.payload),
      entry.checksum,
      'm5b-scoring-planner.jsonl',
      entry.schema_version,
      entry.created_at
    )
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

function prepareOnClone(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): ScoringSnapshotValue {
  const command = envelope.commandType as ScoringCommand
  const planVersion = SCORING_PLAN_VERSIONS[command]
  const resultRecipeVersion = SCORING_RESULT_RECIPE_VERSIONS[command]
  if (!planVersion || !resultRecipeVersion) {
    throw new ScoringPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  const actorRole = commandRole(envelope)
  const targetSessionId = sessionId(envelope)
  const payload = payloadFor(envelope)
  const { events, writeEvent } = captureLegacyEvents({ database, envelope, timestamp: options.timestamp })
  const context = { envelope } as unknown as AcceptedCommandContext
  let legacyResult: unknown

  if (command === 'assessment:submitOfflineAbilityScores') {
    legacyResult = legacySubmitOfflineAbilityScores(database, {
      ...payload,
      callerUserId: envelope.actorId,
      callerRole: actorRole,
      sessionId: targetSessionId
    } as unknown as SubmitOfflineAbilityScoresParams, { eventPort: { writeEvent }, context })
  } else if (command === 'assessment:submitOperationScores') {
    legacyResult = legacySubmitOperationScores(database, {
      ...payload,
      callerUserId: envelope.actorId,
      callerRole: actorRole,
      sessionId: targetSessionId
    } as unknown as SubmitOperationScoresParams, { eventPort: { writeEvent }, context })
  } else if (command === 'assessment:submitJobSkillOfflineScores') {
    legacyResult = legacySubmitJobSkillOfflineScores(database, {
      ...payload,
      callerUserId: envelope.actorId,
      callerRole: actorRole,
      sessionId: targetSessionId
    } as unknown as SubmitJobSkillOfflineScoresParams, { eventPort: { writeEvent }, context })
  } else {
    legacyResult = legacyRecordTeacherObservation(database, {
      ...payload,
      callerUserId: envelope.actorId,
      callerRole: actorRole,
      sessionId: targetSessionId
    } as unknown as RecordTeacherObservationParams, { eventPort: { writeEvent }, context })
  }

  const rootResult = publicResult(command, legacyResult, events)
  if (events.length === 0) {
    return canonicalRecord({
      schema_version: SCORING_SNAPSHOT_VERSION,
      kind: 'NO_OP',
      no_op_result: rootResult,
      events: []
    }, 'scoring_snapshot') as ScoringSnapshotValue
  }

  const scoringEvents = decorateScoringEvents(
    events,
    envelope,
    planVersion,
    resultRecipeVersion,
    actorRole,
    options.appVersion,
    rootResult
  )
  const eventsWithReport = [...scoringEvents]
  const jobSkillResultId = resultId(events)
  if (
    (command === 'assessment:submitJobSkillOfflineScores' || command === 'assessment:recordTeacherObservation')
    && jobSkillResultId
  ) {
    const reportSnapshot = loadReportGenerationSnapshotValue(database, {
      reportScope: 'JOB_SKILL',
      sourceId: jobSkillResultId,
      actorRole: 'SYSTEM',
      timestamp: options.timestamp,
      appVersion: options.appVersion,
      correlationId: envelope.correlationId
    })
    const fragment = planReportGenerationFragment(reportSnapshot, {
      envelope,
      planVersion,
      resultRecipeVersion,
      childOrdinal: eventsWithReport.length
    })
    for (const event of fragment.events) {
      eventsWithReport.push(Object.freeze({
        event_id: event.eventId,
        aggregate_type: event.aggregateType as AggregateType,
        aggregate_id: event.aggregateId,
        event_type: event.eventType as EventType,
        event_sequence: event.eventSequence,
        timestamp: event.timestamp,
        payload: canonicalRecord(event.payload, 'report_fragment.payload')
      }))
    }
  }
  return canonicalRecord({
    schema_version: SCORING_SNAPSHOT_VERSION,
    kind: 'EVENTS',
    no_op_result: null,
    events: eventsWithReport
  }, 'scoring_snapshot') as ScoringSnapshotValue
}

export async function loadScoringPlannerSnapshot(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): Promise<PlannerReadSnapshot<CanonicalJsonValue>> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  text(options.appVersion, 'appVersion')
  text(envelope.correlationId, 'correlationId')
  if (!Object.prototype.hasOwnProperty.call(SCORING_PLAN_VERSIONS, envelope.commandType)) {
    throw new ScoringPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  if (isPreviewAssessmentSession(database, sessionId(envelope))) {
    return createPlannerReadSnapshot(canonicalRecord({
      schema_version: SCORING_SNAPSHOT_VERSION,
      kind: 'NO_OP',
      no_op_result: { success: false, errorCode: 'PREVIEW_RESULT_SUPPRESSED' },
      events: []
    }, 'scoring_snapshot'))
  }
  const clone = await cloneDatabase(database)
  try {
    return createPlannerReadSnapshot(prepareOnClone(clone, envelope, { timestamp, appVersion: options.appVersion }))
  } finally {
    clone.close?.()
  }
}

export class ScoringPlanner {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<CanonicalJsonValue>
  }>): CommandPlanV1 {
    const command = input.envelope.commandType as ScoringCommand
    const planVersion = SCORING_PLAN_VERSIONS[command]
    const resultRecipeVersion = SCORING_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) {
      throw new ScoringPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    }
    const snapshot = record(input.snapshot.value, 'snapshot') as ScoringSnapshotValue
    if (snapshot.schema_version !== SCORING_SNAPSHOT_VERSION) {
      throw new ScoringPlannerError('INVALID_INPUT', 'snapshot version mismatch')
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
      throw new ScoringPlannerError('INVALID_INPUT', 'event snapshot is invalid')
    }
    const events: EventIntentV1[] = snapshot.events.map((value, ordinal) => {
      const event = record(value, `events[${ordinal}]`)
      const eventSequence = event.event_sequence
      if (!Number.isSafeInteger(eventSequence) || (eventSequence as number) < 1) {
        throw new ScoringPlannerError('INVALID_INPUT', `events[${ordinal}].event_sequence is invalid`)
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
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: input.envelope.commandId,
      commandType: command,
      planVersion,
      resultRecipeVersion,
      events,
      operationalEffects: [],
      noOpResult: null
    }
  }
}
