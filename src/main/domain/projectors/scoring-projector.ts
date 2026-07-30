import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { applyAssessmentEvent } from '../assessment-reducer'
import { registerReportPreparedFacts } from './report-projector'
import {
  SCORING_EVENT_PAYLOAD_VERSION,
  SCORING_RESULT_RECIPE_VERSIONS
} from '../../application/planners/scoring-planner'

export const SCORING_PROJECTOR_NAME = 'm5b-scoring-prepared-projector-v1'

type ScoringEventType =
  | 'OFFLINE_SCORE_SUBMITTED'
  | 'TEACHER_OBSERVATION_RECORDED'
  | 'RESULT_CALCULATED'
  | 'SESSION_COMPLETED'

const EVENT_TYPES: readonly ScoringEventType[] = [
  'OFFLINE_SCORE_SUBMITTED',
  'TEACHER_OBSERVATION_RECORDED',
  'RESULT_CALCULATED',
  'SESSION_COMPLETED'
]

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${field} must be a non-empty trimmed string`)
  }
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`)
  }
  return value as number
}

function exactTimestamp(value: CanonicalJsonValue | undefined, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  if (payload.event_payload_version !== SCORING_EVENT_PAYLOAD_VERSION) {
    throw new Error('event payload version mismatch')
  }
  const context = record(payload.batch_context, 'batch_context')
  const commandType = text(context.root_command_type, 'batch_context.root_command_type')
  if (!Object.prototype.hasOwnProperty.call(SCORING_RESULT_RECIPE_VERSIONS, commandType)) {
    throw new Error('batch context root command is invalid')
  }
  text(context.root_command_id, 'batch_context.root_command_id')
  integer(context.child_ordinal, 'batch_context.child_ordinal', 0)
  text(context.plan_version, 'batch_context.plan_version')
  text(context.result_recipe_version, 'batch_context.result_recipe_version')
  if (payload.actor_role !== 'TEACHER' && payload.actor_role !== 'ADMIN') {
    throw new Error('actor role is invalid')
  }
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  if (payload.root_result !== undefined) {
    const result = record(payload.root_result, 'root_result')
    if (typeof result.success !== 'boolean') throw new Error('root_result.success is invalid')
  }
}

function validateScore(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  text(payload.session_id, 'session_id')
  text(payload.offline_score_id, 'offline_score_id')
  const scope = text(payload.score_scope, 'score_scope')
  if (!['OFFLINE_ABILITY', 'TASK_OPERATION', 'JOB_SKILL'].includes(scope)) {
    throw new Error('score scope is invalid')
  }
  if (!Array.isArray(payload.criterion_scores) || payload.criterion_scores.length !== 1) {
    throw new Error('criterion_scores must contain exactly one fact')
  }
  if (payload.total_score !== 0 && payload.total_score !== 1 && payload.total_score !== 2) {
    throw new Error('total_score is invalid')
  }
  text(payload.scored_by, 'scored_by')
  exactTimestamp(payload.scored_at, 'scored_at')
  text(payload.scoring_rubric_json, 'scoring_rubric_json')
}

function validateObservation(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  text(payload.session_id, 'session_id')
  text(payload.offline_score_id, 'offline_score_id')
  text(payload.question_id, 'question_id')
  record(payload.observation_payload, 'observation_payload')
  text(payload.recorded_by, 'recorded_by')
  exactTimestamp(payload.recorded_at, 'recorded_at')
}

function validateResult(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  text(payload.result_id, 'result_id')
  const type = text(payload.result_type, 'result_type')
  if (!['OPERATION_PASS_RATE', 'JOB_SKILL_SCORE'].includes(type)) {
    throw new Error('result type is invalid')
  }
  if (payload.source_type !== 'ASSESSMENT_SESSION') throw new Error('result source type is invalid')
  text(payload.source_id, 'source_id')
  exactTimestamp(payload.calculated_at, 'calculated_at')
}

function validateCompleted(payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  text(payload.session_id, 'session_id')
  exactTimestamp(payload.completed_at, 'completed_at')
  integer(payload.total_online_answered, 'total_online_answered', 0)
  integer(payload.total_offline_scored, 'total_offline_scored', 0)
  if (typeof payload.has_pending_offline !== 'boolean') throw new Error('has_pending_offline is invalid')
}

function validatePayload(eventType: ScoringEventType, payload: Readonly<Record<string, CanonicalJsonValue>>): void {
  validateMetadata(payload)
  if (eventType === 'OFFLINE_SCORE_SUBMITTED') return validateScore(payload)
  if (eventType === 'TEACHER_OBSERVATION_RECORDED') return validateObservation(payload)
  if (eventType === 'RESULT_CALCULATED') return validateResult(payload)
  return validateCompleted(payload)
}

function project(context: PreparedProjectorContext): void {
  applyAssessmentEvent(context.database, context.event.record as unknown as ActionLogEntry)
}

function assertProjected(context: PreparedProjectorContext): void {
  const payload = context.event.record.payload
  if (context.event.record.event_type === 'OFFLINE_SCORE_SUBMITTED' || context.event.record.event_type === 'TEACHER_OBSERVATION_RECORDED') {
    const row = context.database.prepare(
      'SELECT offline_score_id FROM offline_score_record WHERE offline_score_id = ?'
    ).get(payload.offline_score_id) as { offline_score_id: string } | undefined
    if (!row) throw new Error('prepared score projection is missing')
    return
  }
  if (context.event.record.event_type === 'RESULT_CALCULATED') {
    const row = context.database.prepare(
      'SELECT result_id FROM result_record WHERE result_id = ?'
    ).get(payload.result_id) as { result_id: string } | undefined
    if (!row) throw new Error('prepared result projection is missing')
    return
  }
  const session = context.database.prepare(
    'SELECT status, completed_at FROM assessment_session WHERE session_id = ?'
  ).get(payload.session_id) as { status: string; completed_at: string | null } | undefined
  if (!session || session.status !== 'COMPLETED' || session.completed_at !== payload.completed_at) {
    throw new Error('prepared session completion projection is missing')
  }
}

function rootResult(batch: PreparedProjectorContext['batch']): Readonly<Record<string, CanonicalJsonValue>> {
  const matches = batch.events
    .map((event) => event.record.payload.root_result)
    .filter((value): value is CanonicalJsonValue => value !== undefined)
  if (matches.length !== 1) throw new Error('prepared scoring batch requires exactly one root_result')
  const result = record(matches[0], 'root_result')
  if (typeof result.success !== 'boolean') throw new Error('root_result.success is invalid')
  return result
}

export function registerScoringPreparedFacts(registry = new PreparedFactRegistry()): PreparedFactRegistry {
  for (const eventType of EVENT_TYPES) {
    registry.registerEvent({
      eventType,
      eventPayloadVersion: SCORING_EVENT_PAYLOAD_VERSION,
      projectorName: SCORING_PROJECTOR_NAME,
      validatePayload: (payload) => validatePayload(eventType, payload),
      project,
      assertProjected,
      operationalEffects: []
    })
  }
  for (const [commandType, resultRecipeVersion] of Object.entries(SCORING_RESULT_RECIPE_VERSIONS)) {
    registry.registerResult({
      commandType,
      resultRecipeVersion,
      fromPrepared: ({ batch }) => rootResult(batch as PreparedProjectorContext['batch'])
    })
  }
  return registerReportPreparedFacts(registry)
}
