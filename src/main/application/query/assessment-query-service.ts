import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertSessionOwner, assertStudent } from '../../utils/auth-context'
import type { AbilityTag } from '../../../shared/types/json-schemas'
import type {
  AssessmentStrategyType,
  DeliveryPhase,
  GetSessionParams,
  GetSessionResult,
  GetSessionSuccess,
  ListMySessionsParams,
  ListMySessionsResult,
  ListMySessionsSuccess,
  ListSessionsParams,
  ListSessionsResult,
  ListSessionsSuccess,
  SessionDetail,
  SessionListItem,
  SessionQuestionContent,
  SessionStatus
} from '../../../shared/types/assessment'

const OPEN_SESSION_STATUSES = [
  'INIT',
  'ACTIVE',
  'EMOTION_INTERRUPTED',
  'SUSPENDED_REVIEW_REQUIRED',
  'OFFLINE_PENDING'
] as const

interface SessionFullRow {
  session_id: string
  business_session_id: string
  student_id: string
  strategy_id: string
  strategy_type: string
  strategy_version: number
  job_code: string
  task_code: string
  status: string
  delivery_phase: string | null
  event_sequence_version: number
  observation_template_id: string | null
  online_question_count: number
  offline_question_count: number
  online_completed_count: number
  current_question_id: string | null
  pause_count: number
  pause_started_at: string | null
  last_interruption_reason: string | null
  redline_incident_id: string | null
  level_result: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface SessionQuestionJoinRow {
  question_id: string
  question_order: number
  question_phase: string
  module_type: string
  question_type: string
  content_json: string
  media_asset_id: string | null
}

interface SessionListJoinRow {
  session_id: string
  business_session_id: string
  student_id: string
  student_name: string
  strategy_id: string
  strategy_type: string
  strategy_version: number
  job_code: string
  task_code: string
  status: string
  delivery_phase: string | null
  assignment_id: string | null
  assignment_status: string | null
  event_sequence_version: number
  observation_template_id: string | null
  online_question_count: number
  online_completed_count: number
  current_question_id: string | null
  pause_count: number
  redline_incident_id: string | null
  last_interruption_reason: string | null
  created_at: string
  started_at: string | null
}

function mapSessionListRow(row: SessionListJoinRow): SessionListItem {
  return {
    sessionId: row.session_id,
    businessSessionId: row.business_session_id,
    studentId: row.student_id,
    studentName: row.student_name,
    strategyId: row.strategy_id,
    strategyType: row.strategy_type as AssessmentStrategyType,
    strategyVersion: row.strategy_version,
    jobCode: row.job_code,
    taskCode: row.task_code,
    status: row.status as SessionStatus,
    deliveryPhase: row.delivery_phase as DeliveryPhase | null,
    assignmentId: row.assignment_id,
    assignmentStatus: row.assignment_status as SessionListItem['assignmentStatus'],
    eventSequenceVersion: row.event_sequence_version,
    observationTemplateId: row.observation_template_id,
    onlineQuestionCount: row.online_question_count,
    onlineCompletedCount: row.online_completed_count,
    currentQuestionId: row.current_question_id,
    pauseCount: row.pause_count,
    redlineIncidentId: row.redline_incident_id,
    lastInterruptionReason: row.last_interruption_reason,
    createdAt: row.created_at,
    startedAt: row.started_at
  }
}

function readCurrentQuestionContent(
  db: DBAdapter,
  sessionId: string,
  questionId: string
): SessionQuestionContent | null {
  const row = db
    .prepare(
      `SELECT sq.question_id, sq.question_order, sq.question_phase, sq.module_type,
              sq.question_type, qb.content_json, qb.media_asset_id
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_id = ?`
    )
    .get(sessionId, questionId) as SessionQuestionJoinRow | undefined
  if (!row) return null

  let content: Record<string, unknown>
  try {
    content = JSON.parse(row.content_json)
  } catch {
    console.warn(`[getSession] content_json parse failed: questionId=${questionId}`)
    return null
  }

  const interactionConfig =
    content.interaction != null
    && typeof content.interaction === 'object'
    && 'config' in (content.interaction as Record<string, unknown>)
      ? ((content.interaction as Record<string, unknown>).config as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  const base = {
    questionId: row.question_id,
    questionOrder: row.question_order,
    questionPhase: row.question_phase as 'ONLINE' | 'OFFLINE',
    moduleType: row.module_type as AbilityTag,
    questionType: row.question_type as 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG',
    prompt: typeof content.prompt === 'string' ? content.prompt : '',
    assessmentPoint: typeof content.assessment_point === 'string' ? content.assessment_point : '',
    mediaAssetId: row.media_asset_id ?? null,
    mediaBrief: typeof content.media_brief === 'string' ? content.media_brief : null
  }

  if (base.questionType === 'TRUE_FALSE') {
    const variants = Array.isArray(content.variants)
      ? content.variants
          .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
          .map((value) => ({
            variantId: typeof value.variant_id === 'string' ? value.variant_id : '',
            mediaAssetId:
              value.media_asset_id != null && typeof value.media_asset_id === 'string'
                ? value.media_asset_id
                : null,
            mediaBrief: typeof value.media_brief === 'string' ? value.media_brief : ''
          }))
      : undefined
    return { ...base, variants }
  }

  if (base.questionType === 'SINGLE_CHOICE') {
    const rawOptions = Array.isArray(interactionConfig.options)
      ? interactionConfig.options
      : Array.isArray(content.options)
        ? content.options
        : []
    const options = rawOptions
      .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
      .map((value) => ({
        key: typeof value.key === 'string' ? value.key : '',
        text: typeof value.text === 'string' ? value.text : '',
        imageAssetId:
          value.image_asset_id != null && typeof value.image_asset_id === 'string'
            ? value.image_asset_id
            : null
      }))
    return { ...base, options }
  }

  if (base.questionType === 'DRAG') {
    const rawItems = Array.isArray(interactionConfig.items)
      ? interactionConfig.items
      : Array.isArray(content.drag_items)
        ? content.drag_items
        : []
    const dragItems = rawItems
      .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
      .map((value) => ({
        itemId: typeof value.item_id === 'string' ? value.item_id : '',
        label: typeof value.label === 'string' ? value.label : '',
        imageAssetId:
          value.image_asset_id != null && typeof value.image_asset_id === 'string'
            ? value.image_asset_id
            : null
      }))
    const rawZones = Array.isArray(interactionConfig.zones)
      ? interactionConfig.zones
      : Array.isArray(content.drop_zones)
        ? content.drop_zones
        : []
    const dropZones = rawZones
      .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object')
      .map((value) => ({
        zoneId: typeof value.zone_id === 'string' ? value.zone_id : '',
        label: typeof value.label === 'string' ? value.label : ''
      }))
    const scoringMode =
      content.scoring_mode === 'ALL_OR_NOTHING' || content.scoring_mode === 'PARTIAL_CREDIT'
        ? content.scoring_mode
        : undefined
    return { ...base, dragItems, dropZones, scoringMode }
  }

  return null
}

export function getSession(db: DBAdapter, params: GetSessionParams): GetSessionResult {
  if (params.callerRole === 'STUDENT') {
    const student = assertStudent(db, params.callerUserId, params.callerRole)
    if (!student.ok) return { success: false, errorCode: 'FORBIDDEN' }
    const owner = assertSessionOwner(db, student.row.user_id, params.sessionId)
    if (!owner.ok) return { success: false, errorCode: owner.errorCode }
  } else {
    const caller = assertCaller(db, params.callerUserId, params.callerRole)
    if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  }

  const row = db
    .prepare(
      `SELECT session_id, student_id, strategy_id, strategy_type, strategy_version,
              business_session_id, job_code, task_code, status, delivery_phase,
              event_sequence_version, observation_template_id,
              online_question_count, offline_question_count, online_completed_count,
              current_question_id, pause_count, pause_started_at,
              last_interruption_reason, redline_incident_id, level_result,
              started_at, completed_at, updated_at AS created_at
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(params.sessionId) as SessionFullRow | undefined
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }

  const session: SessionDetail = {
    sessionId: row.session_id,
    businessSessionId: row.business_session_id,
    studentId: row.student_id,
    strategyId: row.strategy_id,
    strategyType: row.strategy_type as AssessmentStrategyType,
    strategyVersion: row.strategy_version,
    jobCode: row.job_code,
    taskCode: row.task_code,
    status: row.status as SessionStatus,
    deliveryPhase: row.delivery_phase as DeliveryPhase | null,
    eventSequenceVersion: row.event_sequence_version,
    observationTemplateId: row.observation_template_id,
    onlineQuestionCount: row.online_question_count,
    offlineQuestionCount: row.offline_question_count,
    onlineCompletedCount: row.online_completed_count,
    currentQuestionId: row.current_question_id,
    pauseCount: row.pause_count,
    pauseStartedAt: row.pause_started_at,
    lastInterruptionReason: row.last_interruption_reason,
    redlineIncidentId: row.redline_incident_id,
    levelResult: row.level_result,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  }

  const currentQuestion = row.current_question_id
    ? readCurrentQuestionContent(db, params.sessionId, row.current_question_id)
    : null
  const result: GetSessionSuccess = { success: true, session, currentQuestion }
  return result
}

export function listSessions(db: DBAdapter, params: ListSessionsParams): ListSessionsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const statusWhere = `s.status IN (${placeholders})`
  const selectClause = `SELECT s.session_id, s.student_id, sp.student_name,
              s.strategy_id, s.strategy_type, s.strategy_version,
              s.business_session_id, s.job_code, s.task_code, s.status,
              s.delivery_phase, bsa.assignment_id, bsa.status AS assignment_status,
              s.event_sequence_version, s.observation_template_id,
              s.online_question_count, s.online_completed_count,
              s.current_question_id, s.pause_count,
              s.redline_incident_id, s.last_interruption_reason,
              s.updated_at AS created_at, s.started_at
         FROM assessment_session s
         JOIN student_profile sp ON sp.student_id = s.student_id
         LEFT JOIN business_session_assignment bsa
                ON bsa.business_session_id = s.business_session_id
               AND bsa.status IN ('PENDING_CONFIRM', 'ACTIVE')`
  const orderClause = 'ORDER BY s.updated_at DESC'

  const rows = params.studentId
    ? (db
        .prepare(`${selectClause} WHERE s.student_id = ? AND ${statusWhere} ${orderClause}`)
        .all(params.studentId, ...OPEN_SESSION_STATUSES) as SessionListJoinRow[])
    : (db
        .prepare(`${selectClause} WHERE ${statusWhere} ${orderClause}`)
        .all(...OPEN_SESSION_STATUSES) as SessionListJoinRow[])

  const result: ListSessionsSuccess = { success: true, items: rows.map(mapSessionListRow) }
  return result
}

export function listMySessions(db: DBAdapter, params: ListMySessionsParams): ListMySessionsResult {
  const student = assertStudent(db, params.callerUserId, params.callerRole)
  if (!student.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT s.session_id, s.student_id, sp.student_name,
              s.strategy_id, s.strategy_type, s.strategy_version,
              s.business_session_id, s.job_code, s.task_code, s.status,
              s.delivery_phase, bsa.assignment_id, bsa.status AS assignment_status,
              s.event_sequence_version, s.observation_template_id,
              s.online_question_count, s.online_completed_count,
              s.current_question_id, s.pause_count,
              s.redline_incident_id, s.last_interruption_reason,
              s.updated_at AS created_at, s.started_at
         FROM assessment_session s
         JOIN student_profile sp ON sp.student_id = s.student_id
         LEFT JOIN business_session_assignment bsa
                ON bsa.business_session_id = s.business_session_id
               AND bsa.status IN ('PENDING_CONFIRM', 'ACTIVE')
        WHERE s.student_id = ? AND s.status IN (${placeholders})
        ORDER BY s.updated_at DESC`
    )
    .all(student.row.user_id, ...OPEN_SESSION_STATUSES) as SessionListJoinRow[]

  const result: ListMySessionsSuccess = { success: true, items: rows.map(mapSessionListRow) }
  return result
}
