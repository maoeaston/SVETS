import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import {
  PreparedFactRegistry,
  type PreparedProjectorContext
} from '../event-batch/result-registry'
import { applyAssessmentEvent } from '../assessment-reducer'
import {
  ASSESSMENT_EVENT_PAYLOAD_VERSION,
  ASSESSMENT_RESULT_RECIPE_VERSIONS
} from '../../application/planners/assessment-planner'

export const ASSESSMENT_PROJECTOR_NAME = 'm5b-assessment-prepared-projector-v1'

type EventType =
  | 'SESSION_STARTED'
  | 'ANSWER_SUBMITTED'
  | 'EMOTION_INTERRUPTED'
  | 'EMOTION_RESUMED'
  | 'SITTING_ENDED'
  | 'SITTING_STARTED'
  | 'EMOTION_COLLAPSE_RECORDED'
  | 'EMOTION_COLLAPSE_THRESHOLD_REACHED'
  | 'SESSION_ABORTED'
  | 'RESULT_CALCULATED'
  | 'SESSION_COMPLETED'
  | 'SESSION_FIRST_QUESTION_ACTIVATED'

const EVENT_TYPES: readonly EventType[] = [
  'SESSION_STARTED',
  'ANSWER_SUBMITTED',
  'EMOTION_INTERRUPTED',
  'EMOTION_RESUMED',
  'SITTING_ENDED',
  'SITTING_STARTED',
  'EMOTION_COLLAPSE_RECORDED',
  'EMOTION_COLLAPSE_THRESHOLD_REACHED',
  'SESSION_ABORTED',
  'RESULT_CALCULATED',
  'SESSION_COMPLETED',
  'SESSION_FIRST_QUESTION_ACTIVATED'
]

function record(value: CanonicalJsonValue | undefined, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} must be a non-empty trimmed string`)
  return value
}

function integer(value: CanonicalJsonValue | undefined, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${field} must be an integer >= ${minimum}`)
  return value as number
}

function exactTimestamp(value: CanonicalJsonValue | undefined, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

export type AssessmentSessionQuestionSnapshot = Readonly<{
  sessionQuestionId: string
  questionId: string
  questionOrder: number
  questionPhase: 'ONLINE' | 'OFFLINE' | 'OBSERVATION'
  bankDomain: 'BASE_ABILITY' | 'JOB_SPECIFIC'
  moduleType: string | null
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'SOFTWARE_TASK' | 'OFFLINE_OPERATION'
  itemUsage: 'SCORED_ITEM' | 'OBSERVATION_ONLY'
  jobModuleCode: string | null
}>

function nullableText(value: CanonicalJsonValue | undefined, field: string): string | null {
  if (value === null) return null
  return text(value, field)
}

export function readAssessmentSessionQuestionSnapshots(payload: Readonly<Record<string, CanonicalJsonValue>>): readonly AssessmentSessionQuestionSnapshot[] {
  const rawSessionQuestions = payload.session_questions
  const questionIds = payload.question_ids
  if (!Array.isArray(rawSessionQuestions) || rawSessionQuestions.length === 0) {
    throw new Error('session_questions are required')
  }
  if (!Array.isArray(questionIds) || questionIds.length !== rawSessionQuestions.length) {
    throw new Error('question_ids must exactly match session_questions')
  }
  const ids = new Set<string>()
  return Object.freeze(rawSessionQuestions.map((entry, index) => {
    const question = record(entry as CanonicalJsonValue, `session_questions[${index}]`)
    const questionId = text(question.question_id, `session_questions[${index}].question_id`)
    const questionOrder = integer(question.question_order, `session_questions[${index}].question_order`, 1)
    const sessionQuestionId = text(question.session_question_id, `session_questions[${index}].session_question_id`)
    if (questionId !== questionIds[index] || questionOrder !== index + 1 || ids.has(questionId)) {
      throw new Error('session_questions must have unique ordered question facts')
    }
    ids.add(questionId)
    const questionPhase = text(question.question_phase, `session_questions[${index}].question_phase`)
    const bankDomain = text(question.bank_domain, `session_questions[${index}].bank_domain`)
    const questionType = text(question.question_type, `session_questions[${index}].question_type`)
    const itemUsage = text(question.item_usage, `session_questions[${index}].item_usage`)
    const moduleType = nullableText(question.module_type, `session_questions[${index}].module_type`)
    const jobModuleCode = nullableText(question.job_module_code, `session_questions[${index}].job_module_code`)
    if (!['ONLINE', 'OFFLINE', 'OBSERVATION'].includes(questionPhase)) throw new Error('session question phase is invalid')
    if (!['BASE_ABILITY', 'JOB_SPECIFIC'].includes(bankDomain)) throw new Error('session question bank domain is invalid')
    if (!['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK', 'OFFLINE_OPERATION'].includes(questionType)) throw new Error('session question type is invalid')
    if (!['SCORED_ITEM', 'OBSERVATION_ONLY'].includes(itemUsage)) throw new Error('session question item usage is invalid')
    if ((bankDomain === 'BASE_ABILITY' && (!moduleType || jobModuleCode !== null)) || (bankDomain === 'JOB_SPECIFIC' && (moduleType !== null || !jobModuleCode))) {
      throw new Error('session question domain facts are invalid')
    }
    if (
      (itemUsage === 'OBSERVATION_ONLY' && questionPhase !== 'OBSERVATION')
      || (itemUsage === 'SCORED_ITEM' && questionType === 'OFFLINE_OPERATION' && questionPhase !== 'OFFLINE')
      || (itemUsage === 'SCORED_ITEM' && questionType !== 'OFFLINE_OPERATION' && questionPhase !== 'ONLINE')
    ) throw new Error('session question phase facts are invalid')
    return Object.freeze({
      sessionQuestionId,
      questionId,
      questionOrder,
      questionPhase: questionPhase as AssessmentSessionQuestionSnapshot['questionPhase'],
      bankDomain: bankDomain as AssessmentSessionQuestionSnapshot['bankDomain'],
      moduleType,
      questionType: questionType as AssessmentSessionQuestionSnapshot['questionType'],
      itemUsage: itemUsage as AssessmentSessionQuestionSnapshot['itemUsage'],
      jobModuleCode
    })
  }))
}

function validateOnlineQuestions(payload: Readonly<Record<string, CanonicalJsonValue>>, questions: readonly AssessmentSessionQuestionSnapshot[]): void {
  if (!Array.isArray(payload.online_questions)) throw new Error('online_questions must be an array')
  const expected = questions.filter((question) => question.questionPhase === 'ONLINE')
  if (payload.online_questions.length !== expected.length) throw new Error('online_questions must match session question facts')
  payload.online_questions.forEach((entry, index) => {
    const online = record(entry as CanonicalJsonValue, `online_questions[${index}]`)
    const question = expected[index]!
    if (
      text(online.question_id, `online_questions[${index}].question_id`) !== question.questionId
      || integer(online.question_order, `online_questions[${index}].question_order`, 1) !== question.questionOrder
      || text(online.question_type, `online_questions[${index}].question_type`) !== question.questionType
      || text(online.module_type, `online_questions[${index}].module_type`) !== (question.bankDomain === 'JOB_SPECIFIC' ? question.jobModuleCode! : question.moduleType!)
    ) throw new Error('online question result facts conflict with session question facts')
  })
}

function validateMetadata(payload: Readonly<Record<string, CanonicalJsonValue>>, eventType: EventType): void {
  if (payload.event_payload_version !== ASSESSMENT_EVENT_PAYLOAD_VERSION) throw new Error('event payload version mismatch')
  const context = record(payload.batch_context, 'batch_context')
  if (typeof context.root_command_type !== 'string' || !context.root_command_type.startsWith('assessment:')) throw new Error('batch context root command mismatch')
  if (typeof context.root_command_id !== 'string' || !context.root_command_id) throw new Error('batch context root command id missing')
  integer(context.child_ordinal, 'batch_context.child_ordinal', 0)
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  if (!['TEACHER', 'STUDENT', 'ADMIN'].includes(String(payload.actor_role))) throw new Error('actor_role is invalid')
  if (eventType === 'SESSION_STARTED') {
    text(payload.session_id, 'session_id')
    text(payload.business_session_id, 'business_session_id')
    text(payload.student_id, 'student_id')
    text(payload.strategy_id, 'strategy_id')
    integer(payload.strategy_version, 'strategy_version', 1)
    text(payload.strategy_type, 'strategy_type')
    text(payload.job_code, 'job_code')
    text(payload.task_code, 'task_code')
    text(payload.created_by, 'created_by')
    integer(payload.online_question_count, 'online_question_count', 0)
    integer(payload.offline_question_count, 'offline_question_count', 0)
    const questions = readAssessmentSessionQuestionSnapshots(payload)
    validateOnlineQuestions(payload, questions)
  } else if (eventType === 'ANSWER_SUBMITTED') {
    text(payload.session_id, 'session_id')
    text(payload.answer_id, 'answer_id')
    text(payload.question_id, 'question_id')
    integer(payload.question_order, 'question_order', 1)
    exactTimestamp(payload.submitted_at, 'submitted_at')
  } else if (eventType === 'SITTING_STARTED') {
    text(payload.session_id, 'session_id')
    integer(payload.sitting_no, 'sitting_no', 1)
    exactTimestamp(payload.started_at, 'started_at')
  } else if (eventType === 'SITTING_ENDED') {
    text(payload.session_id, 'session_id')
    integer(payload.sitting_no, 'sitting_no', 1)
    exactTimestamp(payload.ended_at, 'ended_at')
  } else if (eventType === 'RESULT_CALCULATED') {
    text(payload.result_id, 'result_id')
    text(payload.source_id, 'source_id')
    exactTimestamp(payload.calculated_at, 'calculated_at')
  } else {
    text(payload.session_id, 'session_id')
  }
}

function ensurePreparedAssessmentBusinessSession(
  context: PreparedProjectorContext,
  payload: Readonly<Record<string, CanonicalJsonValue>>
): void {
  const businessSessionId = text(payload.business_session_id, 'business_session_id')
  const studentId = text(payload.student_id, 'student_id')
  const jobCode = text(payload.job_code, 'job_code')
  const taskCode = text(payload.task_code, 'task_code')
  const existing = context.database.prepare(
    `SELECT session_type, student_id, job_code, task_code
       FROM business_session WHERE business_session_id = ?`
  ).get(businessSessionId) as {
    session_type: string
    student_id: string
    job_code: string
    task_code: string
  } | undefined
  if (existing) {
    if (
      existing.session_type !== 'ASSESSMENT'
      || existing.student_id !== studentId
      || existing.job_code !== jobCode
      || existing.task_code !== taskCode
    ) throw new Error(`business_session ${businessSessionId} conflicts with prepared assessment facts`)
    return
  }
  context.database.prepare(
    `INSERT INTO business_session
       (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
  ).run(businessSessionId, studentId, jobCode, taskCode, context.event.record.actor_id)
}

export function projectPreparedAssessmentSessionStarted(context: PreparedProjectorContext): void {
  const event = context.event.record
  const payload = event.payload
  const sessionId = text(payload.session_id, 'session_id')
  const existing = context.database.prepare(
    'SELECT session_id FROM assessment_session WHERE session_id = ?'
  ).get(sessionId)
  if (existing) return
  if (text(payload.created_by, 'created_by') !== event.actor_id) {
    throw new Error('SESSION_STARTED created_by conflicts with event actor')
  }

  const questions = readAssessmentSessionQuestionSnapshots(payload)
  ensurePreparedAssessmentBusinessSession(context, payload)
  context.database.prepare(
    `INSERT INTO assessment_session
       (session_id, business_session_id, student_id, strategy_id, strategy_type, job_code, task_code,
        strategy_version, status, delivery_phase, online_question_count, offline_question_count,
        observation_template_id, created_by, started_at,
        created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INIT', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    sessionId,
    text(payload.business_session_id, 'business_session_id'),
    text(payload.student_id, 'student_id'),
    text(payload.strategy_id, 'strategy_id'),
    text(payload.strategy_type, 'strategy_type'),
    text(payload.job_code, 'job_code'),
    text(payload.task_code, 'task_code'),
    integer(payload.strategy_version, 'strategy_version', 1),
    payload.initial_delivery_phase === undefined
      ? 'PREPARED'
      : text(payload.initial_delivery_phase, 'initial_delivery_phase'),
    integer(payload.online_question_count, 'online_question_count', 0),
    integer(payload.offline_question_count, 'offline_question_count', 0),
    payload.observation_template_id === undefined || payload.observation_template_id === null
      ? null
      : text(payload.observation_template_id, 'observation_template_id'),
    event.actor_id,
    event.event_id,
    event.event_id,
    event.event_id,
    event.event_sequence
  )

  const insertQuestion = context.database.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code, generated_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const question of questions) {
    insertQuestion.run(
      question.sessionQuestionId,
      sessionId,
      question.questionId,
      question.questionOrder,
      question.questionPhase,
      question.bankDomain,
      question.moduleType,
      question.questionType,
      question.itemUsage,
      question.jobModuleCode,
      event.event_id
    )
  }
}

function project(context: PreparedProjectorContext): void {
  applyAssessmentEvent(context.database, context.event.record as unknown as ActionLogEntry)
}

function unavailableSessionStartedProjector(): never {
  throw new Error('SESSION_STARTED requires a frozen prepared projection adapter')
}

function assertProjected(context: PreparedProjectorContext): void {
  const event = context.event.record
  const payload = event.payload
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null
  if (event.event_type === 'SESSION_STARTED') {
    const session = context.database.prepare('SELECT session_id FROM assessment_session WHERE session_id = ?').get(sessionId) as { session_id: string } | undefined
    if (!session) throw new Error('assessment session projection is missing')
    return
  }
  if (event.event_type === 'ANSWER_SUBMITTED') {
    const answer = context.database.prepare('SELECT answer_id FROM answer_record WHERE answer_id = ?').get(payload.answer_id) as { answer_id: string } | undefined
    if (!answer) throw new Error('assessment answer projection is missing')
    return
  }
  if (event.event_type === 'SITTING_STARTED') {
    const sitting = context.database.prepare('SELECT sitting_id FROM assessment_sitting WHERE session_id = ? AND sitting_no = ?').get(sessionId, payload.sitting_no) as { sitting_id: string } | undefined
    if (!sitting) throw new Error('assessment sitting projection is missing')
    return
  }
  if (event.event_type === 'RESULT_CALCULATED') {
    const result = context.database.prepare('SELECT result_id FROM result_record WHERE result_id = ?').get(payload.result_id) as { result_id: string } | undefined
    if (!result) throw new Error('assessment result projection is missing')
    return
  }
  if (sessionId) {
    const session = context.database.prepare('SELECT session_id FROM assessment_session WHERE session_id = ?').get(sessionId) as { session_id: string } | undefined
    if (!session) throw new Error('assessment session projection is missing')
  }
}

function oneEvent(batch: PreparedProjectorContext['batch'], eventType: EventType) {
  const matches = batch.events.filter((event) => event.record.event_type === eventType)
  if (matches.length !== 1) throw new Error(`prepared result requires exactly one ${eventType}`)
  return matches[0]!.record.payload
}

function resultFor(commandType: string, batch: PreparedProjectorContext['batch']): Record<string, CanonicalJsonValue> {
  if (commandType === 'assessment:createSession') {
    const payload = oneEvent(batch, 'SESSION_STARTED')
    const questions = Array.isArray(payload.online_questions)
      ? payload.online_questions.map((question) => {
        const value = record(question as CanonicalJsonValue, 'online_question')
        return {
          questionId: text(value.question_id, 'online_question.question_id'),
          questionOrder: integer(value.question_order, 'online_question.question_order', 1),
          questionPhase: 'ONLINE',
          moduleType: text(value.module_type, 'online_question.module_type'),
          questionType: text(value.question_type, 'online_question.question_type')
        }
      })
      : []
    return { success: true, sessionId: text(payload.session_id, 'session_id'), businessSessionId: text(payload.business_session_id, 'business_session_id'), questions }
  }
  if (commandType === 'assessment:submitAnswer') {
    const payload = oneEvent(batch, 'ANSWER_SUBMITTED')
    if (typeof payload.is_correct !== 'boolean' || (payload.score !== 0 && payload.score !== 2)) throw new Error('answer result facts are invalid')
    return { success: true, answerId: text(payload.answer_id, 'answer_id'), isCorrect: payload.is_correct, score: payload.score }
  }
  if (commandType === 'assessment:pauseSitting' || commandType === 'assessment:startNextSitting') {
    const payload = oneEvent(batch, commandType === 'assessment:pauseSitting' ? 'SITTING_ENDED' : 'SITTING_STARTED')
    return { success: true, sittingNo: integer(payload.sitting_no, 'sitting_no', 1) }
  }
  if (commandType === 'assessment:recordEmotionCollapse') {
    const payload = oneEvent(batch, 'EMOTION_COLLAPSE_RECORDED')
    const threshold = batch.events.some((event) => event.record.event_type === 'EMOTION_COLLAPSE_THRESHOLD_REACHED')
    return { success: true, sittingNo: integer(payload.sitting_no, 'sitting_no', 1), thresholdReached: threshold }
  }
  if (commandType === 'assessment:calculateResult') {
    const payload = oneEvent(batch, 'RESULT_CALCULATED')
    return { success: true, resultId: text(payload.result_id, 'result_id'), levelResult: text(payload.level_result, 'level_result'), normalizedScore: payload.normalized_score as number }
  }
  if (commandType === 'assessment:startSession') {
    const activated = batch.events.find((event) => event.record.event_type === 'SESSION_FIRST_QUESTION_ACTIVATED')
    if (activated) {
      const payload = activated.record.payload
      return { success: true, firstQuestionId: text(payload.first_question_id, 'first_question_id'), firstQuestionOrder: integer(payload.first_question_order, 'first_question_order', 1) }
    }
    const resumed = oneEvent(batch, 'SITTING_STARTED')
    return { success: true, firstQuestionId: text(resumed.resume_question_id, 'resume_question_id'), firstQuestionOrder: integer(resumed.resume_question_order, 'resume_question_order', 1) }
  }
  return { success: true }
}

export interface AssessmentPreparedProjectorDependencies {
  readonly projectSessionStarted: (context: PreparedProjectorContext) => void
}

export function registerAssessmentPreparedFacts(
  registry = new PreparedFactRegistry(),
  dependencies?: AssessmentPreparedProjectorDependencies
): PreparedFactRegistry {
  for (const eventType of EVENT_TYPES) {
    registry.registerEvent({
      eventType,
      eventPayloadVersion: ASSESSMENT_EVENT_PAYLOAD_VERSION,
      projectorName: ASSESSMENT_PROJECTOR_NAME,
      validatePayload: (payload) => validateMetadata(payload, eventType),
      project: eventType === 'SESSION_STARTED'
        ? dependencies?.projectSessionStarted ?? unavailableSessionStartedProjector
        : project,
      assertProjected,
      operationalEffects: []
    })
  }
  for (const [commandType, recipeVersion] of Object.entries(ASSESSMENT_RESULT_RECIPE_VERSIONS)) {
    registry.registerResult({
      commandType,
      resultRecipeVersion: recipeVersion,
      fromPrepared: ({ batch }) => resultFor(commandType, batch as PreparedProjectorContext['batch'])
    })
  }
  return registry
}
