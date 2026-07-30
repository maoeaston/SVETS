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
import { generatePaper, type QuestionBankRow } from '../../domain/paper-generator'
import { calculateAbilityScore, readOfflineAbilityScoringCompletion } from '../../domain/ability-scoring'

export const ASSESSMENT_EVENT_PAYLOAD_VERSION = 2 as const
export const ASSESSMENT_SNAPSHOT_VERSION = 'm5b-assessment-snapshot-v1'

export const ASSESSMENT_PLAN_VERSIONS = Object.freeze({
  'assessment:createSession': 'm5b.assessment.create-session.plan.v1',
  'assessment:submitAnswer': 'm5b.assessment.submit-answer.plan.v1',
  'assessment:emotionInterrupt': 'm5b.assessment.emotion-interrupt.plan.v1',
  'assessment:emotionResume': 'm5b.assessment.emotion-resume.plan.v1',
  'assessment:pauseSitting': 'm5b.assessment.pause-sitting.plan.v1',
  'assessment:startNextSitting': 'm5b.assessment.start-next-sitting.plan.v1',
  'assessment:recordEmotionCollapse': 'm5b.assessment.record-emotion-collapse.plan.v1',
  'assessment:abortSession': 'm5b.assessment.abort-session.plan.v1',
  'assessment:calculateResult': 'm5b.assessment.calculate-result.plan.v1',
  'assessment:startSession': 'm5b.assessment.start-session.plan.v1'
} as const)

export const ASSESSMENT_RESULT_RECIPE_VERSIONS = Object.freeze({
  'assessment:createSession': 'm5b.assessment.create-session.result.v1',
  'assessment:submitAnswer': 'm5b.assessment.submit-answer.result.v1',
  'assessment:emotionInterrupt': 'm5b.assessment.emotion-interrupt.result.v1',
  'assessment:emotionResume': 'm5b.assessment.emotion-resume.result.v1',
  'assessment:pauseSitting': 'm5b.assessment.pause-sitting.result.v1',
  'assessment:startNextSitting': 'm5b.assessment.start-next-sitting.result.v1',
  'assessment:recordEmotionCollapse': 'm5b.assessment.record-emotion-collapse.result.v1',
  'assessment:abortSession': 'm5b.assessment.abort-session.result.v1',
  'assessment:calculateResult': 'm5b.assessment.calculate-result.result.v1',
  'assessment:startSession': 'm5b.assessment.start-session.result.v1'
} as const)

type AssessmentCommand = keyof typeof ASSESSMENT_PLAN_VERSIONS

type SessionQuestionFact = Record<string, CanonicalJsonValue>

type QuestionProjectionRow = QuestionBankRow & {
  bank_domain: 'BASE_ABILITY' | 'JOB_SPECIFIC'
  item_usage: 'SCORED_ITEM' | 'OBSERVATION_ONLY'
  job_module_code: string | null
}

const DEFAULT_MODULES = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
] as const

const OPEN_SESSION_STATUSES = ['INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING'] as const

export class AssessmentPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'STATE_CONFLICT',
    message: string
  ) {
    super(`[m5b-assessment-planner] ${message}`)
    this.name = 'AssessmentPlannerError'
  }
}

function exactTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new AssessmentPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new AssessmentPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new AssessmentPlannerError('INVALID_INPUT', `${field} must be an integer >= ${minimum}`)
  }
  return value as number
}

function record(value: unknown, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AssessmentPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Readonly<Record<string, CanonicalJsonValue>>
}

function canonicalRecord(value: unknown): Record<string, CanonicalJsonValue> {
  const clone = JSON.parse(canonicalJson(value)) as CanonicalJsonValue
  if (typeof clone !== 'object' || clone === null || Array.isArray(clone)) {
    throw new AssessmentPlannerError('INVALID_INPUT', 'snapshot must be an object')
  }
  return clone
}

function sessionQuestionFact(
  row: QuestionProjectionRow,
  questionOrder: number,
  commandId: string
): SessionQuestionFact {
  const questionPhase = row.item_usage === 'OBSERVATION_ONLY'
    ? 'OBSERVATION'
    : row.question_type === 'OFFLINE_OPERATION'
      ? 'OFFLINE'
      : 'ONLINE'
  return {
    session_question_id: deterministicUuid(commandId, questionOrder - 1, 'assessment-session-question'),
    question_id: row.question_id,
    question_order: questionOrder,
    question_phase: questionPhase,
    bank_domain: row.bank_domain,
    module_type: row.module_type ?? null,
    question_type: row.question_type,
    item_usage: row.item_usage,
    job_module_code: row.job_module_code
  }
}

function onlineQuestionFacts(sessionQuestions: readonly SessionQuestionFact[]): Array<Record<string, CanonicalJsonValue>> {
  return sessionQuestions
    .filter((question) => question.question_phase === 'ONLINE')
    .map((question) => ({
      question_id: question.question_id,
      question_order: question.question_order,
      module_type: question.bank_domain === 'JOB_SPECIFIC' ? question.job_module_code! : question.module_type!,
      question_type: question.question_type
    }))
}

function deterministicUuid(commandId: string, ordinal: number, role: string): string {
  const bytes = createHash('sha256')
    .update('svets:event-batch:v1\0', 'utf8')
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

function noOpSnapshot(timestamp: string, result: Record<string, CanonicalJsonValue>): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: ASSESSMENT_SNAPSHOT_VERSION,
    kind: 'NO_OP',
    timestamp,
    no_op_result: result
  }))
}

function nextSequence(db: DBAdapter, sessionId: string): number {
  const row = db.prepare(
    `SELECT MAX(event_sequence) AS value FROM domain_event_projection
      WHERE aggregate_type = 'ASSESSMENT_SESSION' AND aggregate_id = ?`
  ).get(sessionId) as { value: number | null } | undefined
  return (row?.value ?? 0) + 1
}

function activeUser(db: DBAdapter, userId: string, role: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS present FROM user_account
      WHERE user_id = ? AND role = ? AND status = 'ACTIVE'`
  ).get(userId, role) as { present: number } | undefined
  return Boolean(row)
}

function commandActor(envelope: CommandEnvelopeV2, role: 'TEACHER' | 'STUDENT' | 'ADMIN'): string | null {
  if (envelope.actor.kind !== 'USER' || envelope.actor.role !== role || envelope.actor.userId !== envelope.actorId) return null
  return envelope.actorId
}

function sessionRow(db: DBAdapter, sessionId: string): Record<string, unknown> | undefined {
  return db.prepare(
    `SELECT session_id, student_id, strategy_id, strategy_type, strategy_version, job_code, task_code,
            status, delivery_phase, current_question_id, online_question_count, offline_question_count,
            event_sequence_version, redline_incident_id
       FROM assessment_session WHERE session_id = ?`
  ).get(sessionId) as Record<string, unknown> | undefined
}

function sessionIdFrom(envelope: CommandEnvelopeV2): string {
  return text(envelope.target.session_id ?? envelope.target.assessment_session_id, 'target.session_id')
}

function acceptedPayloadObject(envelope: CommandEnvelopeV2): Record<string, CanonicalJsonValue> {
  return record(envelope.payload, 'payload') as Record<string, CanonicalJsonValue>
}

function nullableText(value: CanonicalJsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullableInteger(value: CanonicalJsonValue | undefined): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null
}

function collapseHistory(db: DBAdapter, sessionId: string, count: number): CanonicalJsonValue[] {
  if (count <= 0) return []
  const rows = db.prepare(
    `SELECT payload_json FROM domain_event_projection
      WHERE aggregate_id = ? AND event_type = 'EMOTION_INTERRUPTED'
      ORDER BY event_sequence DESC LIMIT ?`
  ).all(sessionId, count) as Array<{ payload_json: string }>
  return rows.reverse().map((row) => {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    return {
      interrupted_at: String(payload.interrupted_at),
      unresolved_since: String(payload.interrupted_at),
      current_question_order: typeof payload.current_question_order === 'number' ? payload.current_question_order : null
    }
  }) as CanonicalJsonValue[]
}

function evaluateAnswer(row: { question_type: string; content_json: string; scoring_rule_json: string | null }, answer: Record<string, CanonicalJsonValue>): { isCorrect: boolean; score: 0 | 2 } | null {
  if (answer.question_type !== row.question_type) return null
  let content: Record<string, unknown>
  let scoring: Record<string, unknown>
  try {
    content = JSON.parse(row.content_json) as Record<string, unknown>
    scoring = JSON.parse(row.scoring_rule_json ?? '{}') as Record<string, unknown>
  } catch {
    return null
  }
  const config = content.interaction && typeof content.interaction === 'object'
    && (content.interaction as Record<string, unknown>).config
    && typeof (content.interaction as Record<string, unknown>).config === 'object'
      ? (content.interaction as Record<string, unknown>).config as Record<string, unknown>
      : {}
  if (row.question_type === 'TRUE_FALSE') {
    if (typeof answer.selected !== 'boolean') return null
    const expected = scoring.correct_answer ?? content.expected_answer
    if (typeof expected !== 'boolean' && expected !== 'true' && expected !== 'false') return null
    const isCorrect = answer.selected === (expected === true || expected === 'true')
    return { isCorrect, score: isCorrect ? 2 : 0 }
  }
  if (row.question_type === 'SINGLE_CHOICE') {
    if (typeof answer.selected !== 'string' || !answer.selected) return null
    const options = Array.isArray(config.options) ? config.options : content.options
    if (!Array.isArray(options) || !options.some((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).key === answer.selected)) return null
    const expected = scoring.correct_answer ?? content.expected_answer
    if (typeof expected !== 'string') return null
    const isCorrect = answer.selected === expected
    return { isCorrect, score: isCorrect ? 2 : 0 }
  }
  if (row.question_type === 'DRAG') {
    if (!Array.isArray(answer.placements)) return null
    const placements = answer.placements as CanonicalJsonValue[]
    const items = Array.isArray(config.items) ? config.items : content.drag_items
    const zones = Array.isArray(config.zones) ? config.zones : content.drop_zones
    if (!Array.isArray(items) || !Array.isArray(zones) || placements.length !== items.length) return null
    const placed = new Set<string>()
    for (const entry of placements) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      const value = entry as Record<string, unknown>
      if (typeof value.item_id !== 'string' || typeof value.zone_id !== 'string' || placed.has(value.item_id)) return null
      placed.add(value.item_id)
    }
    const itemIds = new Set(items.map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).item_id : null))
    if (![...placed].every((id) => itemIds.has(id))) return null
    const byZone = new Map(zones.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object')).map((entry) => [entry.zone_id, entry]))
    let correct = 0
    for (const entry of placements as Array<Record<string, unknown>>) {
      const zone = byZone.get(entry.zone_id)
      if (!zone || !Array.isArray(zone.accepts)) return null
      if (zone.accepts.includes(entry.item_id)) correct += 1
    }
    const isCorrect = correct === placements.length
    return { isCorrect, score: isCorrect ? 2 : 0 }
  }
  return null
}

function buildCreateFacts(db: DBAdapter, envelope: CommandEnvelopeV2, timestamp: string, appVersion: string): PlannerReadSnapshot<CanonicalJsonValue> {
  const actorId = commandActor(envelope, 'TEACHER')
  if (!actorId || !activeUser(db, actorId, 'TEACHER')) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
  const studentId = text(envelope.target.student_id, 'target.student_id')
  const strategyId = text(envelope.target.strategy_id, 'target.strategy_id')
  const strategyVersion = integer(envelope.target.strategy_version, 'target.strategy_version', 1)
  const taskCode = text(envelope.target.task_code, 'target.task_code')
  const strategy = db.prepare(
    `SELECT strategy_type, job_code, online_question_count, offline_question_count, question_policy_json
       FROM strategy_config WHERE strategy_id = ? AND version = ?`
  ).get(strategyId, strategyVersion) as Record<string, unknown> | undefined
  const student = db.prepare(
    `SELECT 1 AS present FROM student_profile s JOIN user_account u ON u.user_id = s.student_id
      WHERE s.student_id = ? AND s.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.role = 'STUDENT'`
  ).get(studentId)
  if (!strategy || !student) return noOpSnapshot(timestamp, { success: false, errorCode: 'NOT_FOUND' })
  const strategyType = String(strategy.strategy_type)
  if (!['BASELINE_ASSESSMENT', 'MOCK_EXAM', 'JOB_SKILL_ASSESSMENT'].includes(strategyType)) return noOpSnapshot(timestamp, { success: false, errorCode: 'VALIDATION_ERROR' })
  const jobCode = String(strategy.job_code)
  const blocked = db.prepare(
    `SELECT 1 FROM safety_incident WHERE student_id = ? AND job_code = ? AND task_code = ?
      AND requires_review_before_next_session = 1 AND status IN ('PENDING_DETAIL', 'CONFIRMED') LIMIT 1`
  ).get(studentId, jobCode, taskCode)
  if (blocked) return noOpSnapshot(timestamp, { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' })
  const open = db.prepare(
    `SELECT 1 FROM assessment_session WHERE student_id = ? AND job_code = ? AND task_code = ?
      AND strategy_type = ? AND status IN (${OPEN_SESSION_STATUSES.map(() => '?').join(', ')}) LIMIT 1`
  ).get(studentId, jobCode, taskCode, strategyType, ...OPEN_SESSION_STATUSES)
  if (open) return noOpSnapshot(timestamp, { success: false, errorCode: 'SESSION_ALREADY_OPEN' })

  let sessionQuestions: SessionQuestionFact[] = []
  let observationTemplateId: string | null = null
  if (strategyType === 'JOB_SKILL_ASSESSMENT') {
    let policy: Record<string, unknown>
    try { policy = JSON.parse(String(strategy.question_policy_json)) as Record<string, unknown> } catch { return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }) }
    const scoredIds = Array.isArray(policy.fixed_scored_question_ids) ? policy.fixed_scored_question_ids.filter((id): id is string => typeof id === 'string') : []
    const observationIds = Array.isArray(policy.embedded_observation_question_ids) ? policy.embedded_observation_question_ids.filter((id): id is string => typeof id === 'string') : []
    if (!scoredIds.length) return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })
    const allIds = [...scoredIds, ...observationIds]
    const rows = db.prepare(
      `SELECT question_id, bank_domain, module_type, question_type, job_module_code, item_usage, status
         FROM question_bank WHERE question_id IN (${allIds.map(() => '?').join(',')})`
    ).all(...allIds) as Array<QuestionProjectionRow & { status: string }>
    const byId = new Map(rows.map((row) => [String(row.question_id), row]))
    if (allIds.some((id) => byId.get(id)?.status !== 'ACTIVE')) return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })
    const online = scoredIds.filter((id) => byId.get(id)?.question_type !== 'OFFLINE_OPERATION')
    const offline = scoredIds.filter((id) => byId.get(id)?.question_type === 'OFFLINE_OPERATION')
    const questionIds = [...online, ...offline, ...observationIds]
    sessionQuestions = questionIds.map((id, index) => sessionQuestionFact(
      byId.get(id) as QuestionProjectionRow,
      index + 1,
      envelope.commandId
    ))
    observationTemplateId = observationIds.length ? `${strategyId}@${strategyVersion}` : null
  } else {
    let policy: Record<string, unknown>
    try { policy = JSON.parse(String(strategy.question_policy_json)) as Record<string, unknown> } catch { return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }) }
    const rows = db.prepare(
      `SELECT question_id, bank_domain, module_type, question_type, item_usage, job_module_code, sensory_tags_json
         FROM question_bank WHERE job_code = ? AND status = 'ACTIVE'`
    ).all(jobCode) as QuestionProjectionRow[]
    const required = Array.isArray(policy.required_modules) && policy.required_modules.length
      ? policy.required_modules : DEFAULT_MODULES
    const paper = generatePaper({
      onlineQuestionCount: Number(strategy.online_question_count),
      offlineQuestionCount: Number(strategy.offline_question_count),
      questionRatio: policy.question_ratio as never,
      requiredModules: required as never,
      questionBankRows: rows,
      paperSeed: `${deterministicUuid(envelope.commandId, 0, 'assessment-session')}:${studentId}:${strategyId}:${strategyVersion}`,
      sensoryFilterMode: policy.sensory_filter_mode === 'STRICT' ? 'STRICT' : 'SOFT'
    })
    if (!paper.ok) return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })
    const byId = new Map(rows.map((row) => [row.question_id, row]))
    sessionQuestions = paper.questions.map((question) => sessionQuestionFact(
      byId.get(question.questionId) as QuestionProjectionRow,
      question.questionOrder,
      envelope.commandId
    ))
  }
  const questionIds = sessionQuestions.map((question) => String(question.question_id))
  const onlineQuestions = onlineQuestionFacts(sessionQuestions)
  const sessionId = deterministicUuid(envelope.commandId, 0, 'assessment-session')
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: ASSESSMENT_SNAPSHOT_VERSION, kind: 'EVENTS', timestamp, app_version: appVersion,
    events: [{
      event_type: 'SESSION_STARTED', aggregate_id: sessionId, event_sequence: 1,
      payload: {
        session_id: sessionId, business_session_id: sessionId, student_id: studentId, strategy_id: strategyId,
        strategy_type: strategyType, strategy_version: strategyVersion, job_code: jobCode, task_code: taskCode,
        online_question_count: Number(strategy.online_question_count), offline_question_count: Number(strategy.offline_question_count),
        question_ids: questionIds, session_questions: sessionQuestions,
        initial_delivery_phase: 'PREPARED', observation_template_id: observationTemplateId,
        created_by: actorId, online_questions: onlineQuestions
      }
    }]
  }))
}

function appendSnapshot(timestamp: string, appVersion: string, events: Array<Record<string, CanonicalJsonValue>>): PlannerReadSnapshot<CanonicalJsonValue> {
  return createPlannerReadSnapshot(canonicalRecord({
    schema_version: ASSESSMENT_SNAPSHOT_VERSION,
    kind: 'EVENTS',
    timestamp,
    app_version: appVersion,
    events
  }))
}

function sessionSnapshot(db: DBAdapter, envelope: CommandEnvelopeV2, timestamp: string, appVersion: string): PlannerReadSnapshot<CanonicalJsonValue> {
  const command = envelope.commandType as AssessmentCommand
  const sessionId = sessionIdFrom(envelope)
  const session = sessionRow(db, sessionId)
  if (!session) return noOpSnapshot(timestamp, { success: false, errorCode: 'NOT_FOUND' })
  const payload = acceptedPayloadObject(envelope)
  const sequence = nextSequence(db, sessionId)
  const status = String(session.status)
  const teacher = commandActor(envelope, 'TEACHER')
  const student = commandActor(envelope, 'STUDENT')
  const admin = commandActor(envelope, 'ADMIN')
  const ownedByStudent = Boolean(student && student === session.student_id && activeUser(db, student, 'STUDENT'))
  const activeTeacher = Boolean(teacher && activeUser(db, teacher, 'TEACHER'))
  const activeAdmin = Boolean(admin && activeUser(db, admin, 'ADMIN'))
  const event = (eventType: string, offset: number, fields: Record<string, CanonicalJsonValue>) => ({
    event_type: eventType,
    aggregate_id: sessionId,
    event_sequence: sequence + offset,
    payload: fields
  })
  const questionOrder = nullableInteger(payload.currentQuestionOrder)

  if (command === 'assessment:submitAnswer') {
    if (!ownedByStudent) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (status !== 'ACTIVE') return noOpSnapshot(timestamp, { success: false, errorCode: status === 'EMOTION_INTERRUPTED' ? 'SESSION_PAUSED' : status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const questionId = text(envelope.target.question_id, 'target.question_id')
    const question = db.prepare(
      `SELECT sq.question_order, sq.question_phase, sq.question_type, qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_id = ?`
    ).get(sessionId, questionId) as { question_order: number; question_phase: string; question_type: string; content_json: string; scoring_rule_json: string | null } | undefined
    if (!question || question.question_phase !== 'ONLINE') return noOpSnapshot(timestamp, { success: false, errorCode: 'QUESTION_NOT_IN_SESSION' })
    const existing = db.prepare(`SELECT 1 FROM answer_record WHERE session_id = ? AND question_id = ? AND status = 'VALID'`).get(sessionId, questionId)
    if (existing) return noOpSnapshot(timestamp, { success: false, errorCode: 'ALREADY_ANSWERED' })
    const answer = record(payload.answer ?? payload.answerPayload, 'payload.answer') as Record<string, CanonicalJsonValue>
    const evaluation = evaluateAnswer(question, answer)
    if (!evaluation) return noOpSnapshot(timestamp, { success: false, errorCode: 'VALIDATION_ERROR' })
    const answerId = deterministicUuid(envelope.commandId, 0, 'assessment-answer')
    return appendSnapshot(timestamp, appVersion, [event('ANSWER_SUBMITTED', 0, {
      session_id: sessionId, answer_id: answerId, question_id: questionId, question_type: question.question_type,
      answer_payload: answer, is_correct: evaluation.isCorrect, score: evaluation.score,
      question_order: question.question_order, submitted_at: timestamp
    })])
  }

  if (command === 'assessment:emotionInterrupt') {
    if (!ownedByStudent) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (!['ACTIVE', 'EMOTION_INTERRUPTED'].includes(status)) return noOpSnapshot(timestamp, { success: false, errorCode: status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    return appendSnapshot(timestamp, appVersion, [event('EMOTION_INTERRUPTED', 0, {
      session_id: sessionId, interrupted_at: timestamp, current_question_order: questionOrder, reason: nullableText(payload.reason)
    })])
  }

  if (command === 'assessment:emotionResume') {
    const actor = ownedByStudent ? student : activeTeacher ? teacher : null
    if (!actor) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (status !== 'EMOTION_INTERRUPTED') return noOpSnapshot(timestamp, { success: false, errorCode: 'SESSION_NOT_ACTIVE' })
    return appendSnapshot(timestamp, appVersion, [event('EMOTION_RESUMED', 0, {
      session_id: sessionId, resumed_at: timestamp, resume_from_question_order: nullableInteger(payload.resumeFromQuestionOrder)
    })])
  }

  if (command === 'assessment:pauseSitting') {
    if (!activeTeacher) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (status !== 'ACTIVE') return noOpSnapshot(timestamp, { success: false, errorCode: status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const sitting = db.prepare(`SELECT sitting_no FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL`).get(sessionId) as { sitting_no: number } | undefined
    if (!sitting) return noOpSnapshot(timestamp, { success: false, errorCode: 'ASSESSMENT_FSM_VIOLATION' })
    return appendSnapshot(timestamp, appVersion, [event('SITTING_ENDED', 0, {
      session_id: sessionId, sitting_no: sitting.sitting_no, ended_at: timestamp, ended_by: teacher!,
      end_reason: 'PAUSED_BY_PLAN', current_question_order: questionOrder
    })])
  }

  if (command === 'assessment:startNextSitting') {
    if (!activeTeacher) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (status !== 'SUSPENDED_REVIEW_REQUIRED') return noOpSnapshot(timestamp, { success: false, errorCode: status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const sitting = db.prepare(`SELECT COALESCE(MAX(sitting_no), 0) + 1 AS value FROM assessment_sitting WHERE session_id = ?`).get(sessionId) as { value: number }
    return appendSnapshot(timestamp, appVersion, [event('SITTING_STARTED', 0, {
      session_id: sessionId, sitting_no: sitting.value, started_at: timestamp, started_by: teacher!
    })])
  }

  if (command === 'assessment:recordEmotionCollapse') {
    if (!activeTeacher) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (status !== 'EMOTION_INTERRUPTED') return noOpSnapshot(timestamp, { success: false, errorCode: status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const sitting = db.prepare(`SELECT sitting_no FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL`).get(sessionId) as { sitting_no: number } | undefined
    if (!sitting) return noOpSnapshot(timestamp, { success: false, errorCode: 'ASSESSMENT_FSM_VIOLATION' })
    const thresholdRow = db.prepare(`SELECT emotion_collapse_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?`).get(session.strategy_id, session.strategy_version) as { emotion_collapse_threshold: number } | undefined
    const threshold = thresholdRow?.emotion_collapse_threshold ?? 3
    const current = db.prepare(`SELECT COUNT(*) AS count FROM domain_event_projection WHERE aggregate_id = ? AND event_type = 'EMOTION_COLLAPSE_RECORDED'`).get(sessionId) as { count: number }
    const collapseCount = current.count + 1
    const events = [
      event('SITTING_ENDED', 0, { session_id: sessionId, sitting_no: sitting.sitting_no, ended_at: timestamp, ended_by: teacher!, end_reason: 'ENDED_BY_COLLAPSE', current_question_order: questionOrder }),
      event('EMOTION_COLLAPSE_RECORDED', 1, { session_id: sessionId, sitting_no: sitting.sitting_no, recorded_at: timestamp, current_question_order: questionOrder })
    ]
    if (collapseCount >= threshold) {
      events.push(event('EMOTION_COLLAPSE_THRESHOLD_REACHED', 2, { session_id: sessionId, collapse_count: collapseCount, threshold, collapse_history: collapseHistory(db, sessionId, collapseCount), triggered_at: timestamp }))
      events.push(event('SESSION_COMPLETED', 3, { session_id: sessionId, completed_at: timestamp, total_online_answered: 0, total_offline_scored: 0, has_pending_offline: true }))
    }
    return appendSnapshot(timestamp, appVersion, events)
  }

  if (command === 'assessment:abortSession') {
    if (!activeTeacher) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (!['INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING'].includes(status)) return noOpSnapshot(timestamp, { success: false, errorCode: status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const thresholdRow = db.prepare(`SELECT emotion_collapse_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?`).get(session.strategy_id, session.strategy_version) as { emotion_collapse_threshold: number } | undefined
    const threshold = thresholdRow?.emotion_collapse_threshold ?? 3
    const counts = db.prepare(
      `SELECT SUM(CASE WHEN event_type = 'EMOTION_INTERRUPTED' THEN 1 ELSE 0 END) AS interrupted,
              SUM(CASE WHEN event_type = 'EMOTION_RESUMED' THEN 1 ELSE 0 END) AS resumed
         FROM domain_event_projection WHERE aggregate_id = ? AND event_type IN ('EMOTION_INTERRUPTED', 'EMOTION_RESUMED')`
    ).get(sessionId) as { interrupted: number | null; resumed: number | null }
    const collapseCount = (counts.interrupted ?? 0) - (counts.resumed ?? 0)
    const already = db.prepare(`SELECT 1 FROM domain_event_projection WHERE aggregate_id = ? AND event_type = 'EMOTION_COLLAPSE_THRESHOLD_REACHED'`).get(sessionId)
    const events: Array<Record<string, CanonicalJsonValue>> = []
    if (collapseCount >= threshold && !already) events.push(event('EMOTION_COLLAPSE_THRESHOLD_REACHED', 0, { session_id: sessionId, collapse_count: collapseCount, threshold, collapse_history: collapseHistory(db, sessionId, collapseCount), triggered_at: timestamp }))
    events.push(event('SESSION_ABORTED', events.length, { session_id: sessionId, aborted_at: timestamp, aborted_by: teacher!, reason: nullableText(payload.reason) }))
    return appendSnapshot(timestamp, appVersion, events)
  }

  if (command === 'assessment:calculateResult') {
    if (!activeTeacher && !activeAdmin) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    const existing = db.prepare(
      `SELECT result_id, level_result, normalized_score FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION' AND source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE' AND is_current = 1`
    ).get(sessionId) as { result_id: string; level_result: string; normalized_score: number } | undefined
    if (existing) return noOpSnapshot(timestamp, { success: true, resultId: existing.result_id, levelResult: existing.level_result, normalizedScore: existing.normalized_score })
    if (!['BASELINE_ASSESSMENT', 'MOCK_EXAM'].includes(String(session.strategy_type))) return noOpSnapshot(timestamp, { success: false, errorCode: 'VALIDATION_ERROR' })
    const isRedline = status === 'REDLINE_HALTED'
    const offline = readOfflineAbilityScoringCompletion(db, sessionId)
    if (!isRedline && (status !== 'OFFLINE_PENDING' || !offline.isComplete)) return noOpSnapshot(timestamp, { success: false, errorCode: 'SESSION_NOT_ACTIVE' })
    const calculation = calculateAbilityScore(db, { sessionId, strategyId: String(session.strategy_id), strategyVersion: Number(session.strategy_version), safetyTriggered: isRedline })
    const resultId = deterministicUuid(envelope.commandId, 0, 'assessment-result')
    const actorId = teacher ?? admin!
    const events: Array<Record<string, CanonicalJsonValue>> = [event('RESULT_CALCULATED', 0, {
      result_id: resultId, result_type: 'ABILITY_SCORE', source_type: 'ASSESSMENT_SESSION', source_id: sessionId,
      student_id: String(session.student_id), strategy_id: String(session.strategy_id), strategy_type: String(session.strategy_type),
      job_code: String(session.job_code), task_code: String(session.task_code), module_type: null,
      raw_score: calculation.rawScore, max_score: calculation.maxScore, normalized_score: calculation.normalizedScore,
      level_result: calculation.levelResult, completion_ratio: calculation.completionRatio, calculated_at: timestamp,
      calculated_by: actorId, breakdown: calculation.payload as unknown as CanonicalJsonValue
    })]
    if (!isRedline) {
      const online = db.prepare(
        `SELECT COUNT(*) AS count FROM answer_record ar JOIN assessment_session_question sq
          ON sq.session_id = ar.session_id AND sq.question_id = ar.question_id
         WHERE ar.session_id = ? AND ar.status = 'VALID' AND ar.score IS NOT NULL
           AND sq.bank_domain = 'BASE_ABILITY' AND sq.question_phase = 'ONLINE' AND sq.item_usage = 'SCORED_ITEM'`
      ).get(sessionId) as { count: number }
      events.push(event('SESSION_COMPLETED', 1, { session_id: sessionId, completed_at: timestamp, total_online_answered: online.count, total_offline_scored: offline.totalScored, has_pending_offline: false }))
    }
    return appendSnapshot(timestamp, appVersion, events)
  }

  if (command === 'assessment:startSession') {
    if (!ownedByStudent) return noOpSnapshot(timestamp, { success: false, errorCode: 'FORBIDDEN' })
    if (!['INIT', 'ACTIVE'].includes(status)) return noOpSnapshot(timestamp, { success: false, errorCode: status === 'EMOTION_INTERRUPTED' ? 'SESSION_PAUSED' : status === 'REDLINE_HALTED' ? 'SESSION_HALTED' : 'SESSION_NOT_ACTIVE' })
    const phase = session.delivery_phase
    if (phase === 'PREPARED') return noOpSnapshot(timestamp, { success: false, errorCode: 'ASSIGNMENT_REQUIRED' })
    if (phase === 'ASSIGNED' || phase === 'STUDENT_CONFIRMED') return noOpSnapshot(timestamp, { success: false, errorCode: 'STUDENT_CONFIRMATION_REQUIRED' })
    const currentQuestionId = session.current_question_id as string | null
    if (currentQuestionId) {
      const question = db.prepare(`SELECT question_order FROM assessment_session_question WHERE session_id = ? AND question_id = ?`).get(sessionId, currentQuestionId) as { question_order: number } | undefined
      const sitting = db.prepare(`SELECT 1 FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL`).get(sessionId)
      if (sitting) return noOpSnapshot(timestamp, { success: true, firstQuestionId: currentQuestionId, firstQuestionOrder: question?.question_order ?? 1 })
      const next = db.prepare(`SELECT COALESCE(MAX(sitting_no), 0) + 1 AS value FROM assessment_sitting WHERE session_id = ?`).get(sessionId) as { value: number }
      return appendSnapshot(timestamp, appVersion, [event('SITTING_STARTED', 0, {
        session_id: sessionId, sitting_no: next.value, started_at: timestamp, started_by: student!,
        resume_question_id: currentQuestionId, resume_question_order: question?.question_order ?? 1
      })])
    }
    const first = db.prepare(`SELECT question_id, question_order FROM assessment_session_question WHERE session_id = ? AND question_phase = 'ONLINE' ORDER BY question_order LIMIT 1`).get(sessionId) as { question_id: string; question_order: number } | undefined
    if (!first) return noOpSnapshot(timestamp, { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' })
    const next = db.prepare(`SELECT COALESCE(MAX(sitting_no), 0) + 1 AS value FROM assessment_sitting WHERE session_id = ?`).get(sessionId) as { value: number }
    return appendSnapshot(timestamp, appVersion, [
      event('SITTING_STARTED', 0, { session_id: sessionId, sitting_no: next.value, started_at: timestamp, started_by: student! }),
      event('SESSION_FIRST_QUESTION_ACTIVATED', 1, { session_id: sessionId, first_question_id: first.question_id, first_question_order: first.question_order, activated_at: timestamp })
    ])
  }

  throw new AssessmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${command}`)
}

export function loadAssessmentPlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  if (!Object.prototype.hasOwnProperty.call(ASSESSMENT_PLAN_VERSIONS, envelope.commandType)) {
    throw new AssessmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${envelope.commandType}`)
  }
  return envelope.commandType === 'assessment:createSession'
    ? buildCreateFacts(db, envelope, timestamp, options.appVersion)
    : sessionSnapshot(db, envelope, timestamp, options.appVersion)
}

function eventContext(envelope: CommandEnvelopeV2, planVersion: string, recipeVersion: string, ordinal: number) {
  return {
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: planVersion,
    result_recipe_version: recipeVersion,
    root_command_type: envelope.commandType,
    root_command_id: envelope.commandId,
    child_ordinal: ordinal
  } as const
}

function intent(
  envelope: CommandEnvelopeV2,
  planVersion: string,
  recipeVersion: string,
  ordinal: number,
  facts: Readonly<Record<string, CanonicalJsonValue>>,
  timestamp: string,
  appVersion: string
): EventIntentV1 {
  const eventType = text(facts.event_type, 'event.event_type')
  const aggregateId = text(facts.aggregate_id, 'event.aggregate_id')
  const sequence = integer(facts.event_sequence, 'event.event_sequence', 1)
  const payload = record(facts.payload, 'event.payload')
  const role = envelope.actor.kind === 'USER' && ['TEACHER', 'STUDENT', 'ADMIN'].includes(envelope.actor.role)
    ? envelope.actor.role : 'TEACHER'
  return {
    eventId: deterministicUuid(envelope.commandId, ordinal, `${eventType.toLowerCase()}-event`),
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId,
    eventType,
    eventSequence: sequence,
    actorId: envelope.actorId,
    timestamp,
    payload: {
      event_payload_version: ASSESSMENT_EVENT_PAYLOAD_VERSION,
      batch_context: eventContext(envelope, planVersion, recipeVersion, ordinal),
      actor_role: role,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      ...payload
    }
  }
}

export class AssessmentPlanner {
  plan(input: Readonly<{ envelope: CommandEnvelopeV2; snapshot: PlannerReadSnapshot<CanonicalJsonValue> }>): CommandPlanV1 {
    const command = input.envelope.commandType as AssessmentCommand
    const planVersion = ASSESSMENT_PLAN_VERSIONS[command]
    const resultRecipeVersion = ASSESSMENT_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) throw new AssessmentPlannerError('COMMAND_UNSUPPORTED', `unsupported ${input.envelope.commandType}`)
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== ASSESSMENT_SNAPSHOT_VERSION) throw new AssessmentPlannerError('INVALID_INPUT', 'snapshot version mismatch')
    const timestamp = exactTimestamp(value.timestamp, 'snapshot.timestamp')
    if (value.kind === 'NO_OP') {
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION, commandId: input.envelope.commandId, commandType: command,
        planVersion, resultRecipeVersion, events: [], operationalEffects: [],
        noOpResult: record(value.no_op_result, 'snapshot.no_op_result')
      }
    }
    if (value.kind !== 'EVENTS' || !Array.isArray(value.events)) throw new AssessmentPlannerError('INVALID_INPUT', 'snapshot kind is invalid')
    const appVersion = text(value.app_version, 'snapshot.app_version')
    const events = value.events.map((entry, ordinal) => intent(input.envelope, planVersion, resultRecipeVersion, ordinal, record(entry, `events[${ordinal}]`), timestamp, appVersion))
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
