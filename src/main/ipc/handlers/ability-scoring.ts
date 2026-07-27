// BASE_ABILITY 线下评分（F6-3）IPC handler。
// 只负责提交/读取 OFFLINE_ABILITY 分数，不在本步骤生成 ABILITY_SCORE 结果。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import type { OfflineScoreSubmittedPayload } from '@shared/types/event-payloads'
import type {
  AbilityOfflineScoreView,
  GetOfflineAbilityScoresParams,
  GetOfflineAbilityScoresResult,
  SubmitOfflineAbilityScoresParams,
  SubmitOfflineAbilityScoresResult
} from '../../../shared/types/ability-scoring'

type AbilityAssessmentStrategyType = 'BASELINE_ASSESSMENT' | 'MOCK_EXAM'
type AssessmentDeliveryPhase =
  | 'PREPARED'
  | 'ASSIGNED'
  | 'STUDENT_CONFIRMED'
  | 'ONLINE_IN_PROGRESS'
  | 'ONLINE_COMPLETED'
  | 'OFFLINE_SCORING'
  | 'OBSERVATION'
  | 'READY_TO_FINALIZE'
  | 'FINALIZED'

interface AbilitySessionRow {
  session_id: string
  status: string
  delivery_phase: AssessmentDeliveryPhase | null
  student_id: string
  job_code: string
  task_code: string
  strategy_type: string
}

const ABILITY_STRATEGY_TYPES = new Set<string>(['BASELINE_ASSESSMENT', 'MOCK_EXAM'])
const DELIVERY_PHASE_ORDER: Record<AssessmentDeliveryPhase, number> = {
  PREPARED: 0,
  ASSIGNED: 1,
  STUDENT_CONFIRMED: 2,
  ONLINE_IN_PROGRESS: 3,
  ONLINE_COMPLETED: 4,
  OFFLINE_SCORING: 5,
  OBSERVATION: 6,
  READY_TO_FINALIZE: 7,
  FINALIZED: 8
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function isAbilityStrategyType(value: string): value is AbilityAssessmentStrategyType {
  return ABILITY_STRATEGY_TYPES.has(value)
}

function hasReachedOnlineCompleted(phase: AssessmentDeliveryPhase | null): boolean {
  return phase !== null && DELIVERY_PHASE_ORDER[phase] >= DELIVERY_PHASE_ORDER.ONLINE_COMPLETED
}

function parseRubricJson(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    JSON.parse(value)
    return value
  } catch {
    return null
  }
}

function readAbilitySession(db: DBAdapter, sessionId: unknown): AbilitySessionRow | null {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  return (db
    .prepare(
      `SELECT session_id, status, delivery_phase, student_id, job_code, task_code, strategy_type
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as AbilitySessionRow | undefined) ?? null
}

function countRequiredOfflineAbilityQuestions(db: DBAdapter, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM assessment_session_question
        WHERE session_id = ?
          AND bank_domain = 'BASE_ABILITY'
          AND question_phase = 'OFFLINE'
          AND item_usage = 'SCORED_ITEM'`
    )
    .get(sessionId) as { total: number } | undefined
  return row?.total ?? 0
}

function countSubmittedOfflineAbilityScores(db: DBAdapter, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope = 'OFFLINE_ABILITY'
          AND status = 'VALID'`
    )
    .get(sessionId) as { total: number } | undefined
  return row?.total ?? 0
}

function readOfflineAbilityQuestionIds(db: DBAdapter, sessionId: string): Set<string> {
  const rows = db
    .prepare(
      `SELECT question_id
         FROM assessment_session_question
        WHERE session_id = ?
          AND bank_domain = 'BASE_ABILITY'
          AND question_phase = 'OFFLINE'
          AND item_usage = 'SCORED_ITEM'`
    )
    .all(sessionId) as Array<{ question_id: string }>
  return new Set(rows.map((row) => row.question_id))
}

function hasBlockingSafetyIncident(db: DBAdapter, session: AbilitySessionRow): boolean {
  const blocked = db
    .prepare(
      `SELECT 1
        FROM safety_incident
        WHERE student_id = ?
          AND job_code = ?
          AND task_code = ?
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
          AND requires_review_before_next_session = 1
        LIMIT 1`
    )
    .get(session.student_id, session.job_code, session.task_code)
  return Boolean(blocked)
}

function readScoreRows(db: DBAdapter, sessionId: string): AbilityOfflineScoreView[] {
  const rows = db
    .prepare(
      `SELECT question_id, score, scoring_rubric_json, observation_note,
              tool_checklist_confirmed, scored_at
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope = 'OFFLINE_ABILITY'
          AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(sessionId) as Array<{
      question_id: string
      score: 0 | 1 | 2
      scoring_rubric_json: string
      observation_note: string | null
      tool_checklist_confirmed: number
      scored_at: string
    }>

  return rows.map((row) => ({
    questionId: row.question_id,
    score: row.score,
    scoringRubricJson: row.scoring_rubric_json,
    observationNote: row.observation_note,
    toolChecklistConfirmed: row.tool_checklist_confirmed === 1,
    scoredAt: row.scored_at
  }))
}

/**
 * TEACHER/ADMIN 提交 BASE_ABILITY 线下题评分。
 *
 * 校验链：
 * assertCaller → session 存在 + BASELINE/MOCK + OFFLINE_PENDING
 * → delivery_phase >= ONLINE_COMPLETED
 * → questionId 属于该 session 的 BASE_ABILITY/OFFLINE/SCORED_ITEM
 * → 无重复题、无已有 VALID OFFLINE_ABILITY 记录
 * → 事务内写 N 条 OFFLINE_SCORE_SUBMITTED。
 */
export function submitOfflineAbilityScores(
  db: DBAdapter,
  params: SubmitOfflineAbilityScoresParams
): SubmitOfflineAbilityScoresResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const session = readAbilitySession(db, params.sessionId)
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (!isAbilityStrategyType(session.strategy_type)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (session.status !== 'OFFLINE_PENDING') {
    return { success: false, errorCode: 'SESSION_NOT_OFFLINE_PENDING' }
  }
  if (!hasReachedOnlineCompleted(session.delivery_phase)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (hasBlockingSafetyIncident(db, session)) {
    return { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' }
  }

  const validQuestionIds = readOfflineAbilityQuestionIds(db, session.session_id)
  if (!Array.isArray(params.scores) || params.scores.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (validQuestionIds.size === 0 || params.scores.length > validQuestionIds.size) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const seenIds = new Set<string>()
  const submittedQuestionIds: string[] = []
  for (const item of params.scores) {
    if (!validQuestionIds.has(item.questionId)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (seenIds.has(item.questionId)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (![0, 1, 2].includes(item.score)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (!parseRubricJson(item.scoringRubricJson)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (
      item.observationNote !== undefined &&
      item.observationNote !== null &&
      typeof item.observationNote !== 'string'
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (
      item.toolChecklistConfirmed !== undefined &&
      typeof item.toolChecklistConfirmed !== 'boolean'
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    seenIds.add(item.questionId)
    submittedQuestionIds.push(item.questionId)
  }

  const placeholders = submittedQuestionIds.map(() => '?').join(', ')
  const alreadyScored = db
    .prepare(
      `SELECT question_id
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope = 'OFFLINE_ABILITY'
          AND status = 'VALID'
          AND question_id IN (${placeholders})
        LIMIT 1`
    )
    .get(session.session_id, ...submittedQuestionIds)
  if (alreadyScored) {
    return { success: false, errorCode: 'ALREADY_SCORED' }
  }

  try {
    const tx = db.transaction(() => {
      const scoredAt = new Date().toISOString()
      for (const item of params.scores) {
        const payload: OfflineScoreSubmittedPayload = {
          session_id: session.session_id,
          offline_score_id: uuidv4(),
          question_id: item.questionId,
          score_scope: 'OFFLINE_ABILITY',
          task_operation_code: null,
          criterion_scores: [{ criterion_id: item.questionId, score: item.score }],
          total_score: item.score,
          scored_by: caller.row.user_id,
          scored_at: scoredAt,
          scoring_rubric_json: parseRubricJson(item.scoringRubricJson)!,
          observation_note: item.observationNote ?? null,
          tool_checklist_confirmed: item.toolChecklistConfirmed ?? false
        }

        const event = writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: session.session_id,
          eventType: 'OFFLINE_SCORE_SUBMITTED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: caller.row.user_id,
          actorRole: caller.row.role as 'TEACHER' | 'ADMIN'
        })
        applyAssessmentEvent(db, event)
      }
    })
    tx()
  } catch (err) {
    console.error('[submitOfflineAbilityScores] error:', err)
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  const totalRequired = countRequiredOfflineAbilityQuestions(db, session.session_id)
  const totalScored = countSubmittedOfflineAbilityScores(db, session.session_id)
  return {
    success: true,
    itemsScored: params.scores.length,
    totalScored,
    totalRequired,
    isComplete: totalRequired > 0 && totalScored === totalRequired
  }
}

/**
 * TEACHER/ADMIN 读取 BASE_ABILITY 线下评分记录。只读 OFFLINE_ABILITY scope。
 */
export function getOfflineAbilityScores(
  db: DBAdapter,
  params: GetOfflineAbilityScoresParams
): GetOfflineAbilityScoresResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const session = readAbilitySession(db, params.sessionId)
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (!isAbilityStrategyType(session.strategy_type)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const totalRequired = countRequiredOfflineAbilityQuestions(db, session.session_id)
  const items = readScoreRows(db, session.session_id)
  return {
    success: true,
    items,
    totalScored: items.length,
    totalRequired,
    isComplete: totalRequired > 0 && items.length === totalRequired
  }
}

export function registerAbilityScoringHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('assessment:submitOfflineAbilityScores', (event, params: SubmitOfflineAbilityScoresParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return submitOfflineAbilityScores(db, trusted.params)
  })

  ipcMain.handle('assessment:getOfflineAbilityScores', (event, params: GetOfflineAbilityScoresParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getOfflineAbilityScores(db, trusted.params)
  })
}
