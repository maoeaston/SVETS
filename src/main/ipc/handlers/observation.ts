// T8: TEACHER_OBSERVATION 运行时 IPC handler
// 纯函数模式，镜像 operation-scoring.ts / job-skill-scoring.ts 结构。
// 校验链：assertCaller(TEACHER) → session 存在 + JOB_SKILL_ASSESSMENT
//         → 非终态 → question_phase=OBSERVATION
//         → behavior_codes 白名单 → 幂等 → 事务写事件

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import { assertF7WriteAllowed, ReportWriteBlockedError } from '../../domain/report-write-gate'
import type { TeacherObservationPayload } from '@shared/types/json-schemas'
import type {
  RecordTeacherObservationParams,
  RecordTeacherObservationResult,
  GetTeacherObservationsParams,
  GetTeacherObservationsResult,
  TeacherObservationRecord
} from '@shared/types/teacher-observation'
import type { TeacherObservationRecordedPayload } from '@shared/types/event-payloads'
import {
  finalizeJobSkillResultCore,
  maybeGenerateJobSkillReportAfterResult
} from './job-skill-result'
import { createJobSkillReportAutomation, type JobSkillReportAutomation } from './job-skill-report'

// ---------------------------------------------------------------------------
// recordTeacherObservation — 核心纯函数
// ---------------------------------------------------------------------------

export function recordTeacherObservation(
  db: DBAdapter,
  params: RecordTeacherObservationParams,
  automation?: JobSkillReportAutomation
): RecordTeacherObservationResult {
  // 1. 身份校验（TEACHER）
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. sessionId / questionId 非空
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.questionId !== 'string' || params.questionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. 读 session
  const session = db
    .prepare(
      `SELECT session_id, status, strategy_type
         FROM assessment_session WHERE session_id = ?`
    )
    .get(params.sessionId) as
    | { session_id: string; status: string; strategy_type: string }
    | undefined

  if (!session) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 4. strategy_type 必须 JOB_SKILL_ASSESSMENT
  if (session.strategy_type !== 'JOB_SKILL_ASSESSMENT') {
    return { success: false, errorCode: 'SESSION_WRONG_STRATEGY' }
  }

  // 5. session 不是终态
  if (['COMPLETED', 'ABORTED', 'REDLINE_HALTED'].includes(session.status)) {
    return { success: false, errorCode: 'SESSION_TERMINATED' }
  }

  // 6. question 在 session 中存在，且 question_phase = 'OBSERVATION'
  const sessionQuestion = db
    .prepare(
      `SELECT question_phase FROM assessment_session_question
        WHERE session_id = ? AND question_id = ?`
    )
    .get(params.sessionId, params.questionId) as
    | { question_phase: string }
    | undefined

  if (!sessionQuestion || sessionQuestion.question_phase !== 'OBSERVATION') {
    return { success: false, errorCode: 'QUESTION_NOT_OBSERVATION' }
  }

  // 7. 校验 behavior_codes 属于题目声明的 observation_dimensions 白名单
  //    observed=false 或 behavior_codes 为空时跳过白名单校验
  const behaviorCodes = params.observationPayload.behavior_codes ?? []
  if (behaviorCodes.length > 0) {
    const questionRow = db
      .prepare(`SELECT content_json FROM question_bank WHERE question_id = ?`)
      .get(params.questionId) as { content_json: string } | undefined

    if (questionRow) {
      try {
        const contentJson = JSON.parse(questionRow.content_json)
        const allowedDimensions: string[] =
          contentJson?.administration?.observation_dimensions ?? []
        // 题目声明了白名单才做限制；无声明则不限制（宽松策略）
        if (allowedDimensions.length > 0) {
          for (const code of behaviorCodes) {
            if (!allowedDimensions.includes(code)) {
              return { success: false, errorCode: 'INVALID_BEHAVIOR_CODE' }
            }
          }
        }
      } catch {
        // content_json 解析失败：不阻止录入（宽松策略）
      }
    }
  }

  // 8. 幂等防护：已有 VALID TEACHER_OBSERVATION 记录
  const alreadyRecorded = db
    .prepare(
      `SELECT 1 FROM offline_score_record
        WHERE session_id = ? AND question_id = ?
          AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID'
        LIMIT 1`
    )
    .get(params.sessionId, params.questionId)
  if (alreadyRecorded) {
    return { success: false, errorCode: 'ALREADY_RECORDED' }
  }

  // 9. 事务：TEACHER_OBSERVATION_RECORDED 事件 → applyAssessmentEvent + 可选 JOB_SKILL finalization
  try {
    assertF7WriteAllowed('RESULT')
    const offlineScoreId = uuidv4()
    const recordedAt = new Date().toISOString()
    let finalized = false

    const txn = db.transaction(() => {
      const payload: TeacherObservationRecordedPayload = {
        session_id: params.sessionId,
        offline_score_id: offlineScoreId,
        question_id: params.questionId,
        observation_payload: params.observationPayload,
        recorded_by: params.callerUserId,
        recorded_at: recordedAt
      }
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'TEACHER_OBSERVATION_RECORDED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: params.callerUserId,
        actorRole: 'TEACHER'
      })
      applyAssessmentEvent(db, event)
      finalized = finalizeJobSkillResultCore(db, params.sessionId, params.callerUserId)
    })

    txn()

    // T10: 报告生成在观察/finalize 事务提交后执行，避免嵌套事务。
    if (finalized) {
      maybeGenerateJobSkillReportAfterResult(db, params.sessionId, params.callerUserId, automation)
    }

    return { success: true, offlineScoreId }
  } catch (err) {
    if (err instanceof ReportWriteBlockedError) {
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }
    console.error('[recordTeacherObservation] error:', err)
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
}

// ---------------------------------------------------------------------------
// getTeacherObservations — 纯读函数
// ---------------------------------------------------------------------------

export function getTeacherObservations(
  db: DBAdapter,
  params: GetTeacherObservationsParams
): GetTeacherObservationsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const sessionExists = db
    .prepare('SELECT 1 FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId)
  if (!sessionExists) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const rows = db
    .prepare(
      `SELECT question_id, offline_score_id, observation_payload_json, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as {
      question_id: string
      offline_score_id: string
      observation_payload_json: string
      scored_at: string
    }[]

  const records: TeacherObservationRecord[] = rows.map((r) => ({
    questionId: r.question_id,
    offlineScoreId: r.offline_score_id,
    observationPayload: JSON.parse(r.observation_payload_json) as TeacherObservationPayload,
    recordedAt: r.scored_at
  }))

  return { success: true, records }
}

// ---------------------------------------------------------------------------
// registerObservationHandlers — IPC 注册（薄包装）
// ---------------------------------------------------------------------------

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerObservationHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('assessment:recordTeacherObservation', (_event, params: unknown) => {
    const db = getDb()
    return recordTeacherObservation(db, params as RecordTeacherObservationParams, createJobSkillReportAutomation(db))
  })

  ipcMain.handle('assessment:getTeacherObservations', (_event, params: unknown) => {
    return getTeacherObservations(getDb(), params as GetTeacherObservationsParams)
  })
}
