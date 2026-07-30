import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertStudent } from '../../utils/auth-context'
import type {
  GetTrainingSessionParams,
  GetTrainingSessionResult,
  GetTrainingSessionSuccess,
  ListMyTrainingSessionsParams,
  ListMyTrainingSessionsResult,
  ListTrainingSessionsParams,
  ListTrainingSessionsResult,
  ListTrainingSessionsSuccess,
  TrainingSessionDetail,
  TrainingSessionListItem,
  TrainingSessionStatus,
  TrainingStepStatus,
  TrainingStepType,
  TrainingStepView
} from '@shared/types/training'

interface TrainingSessionListRow {
  training_session_id: string
  business_session_id: string
  student_id: string
  module_type: string | null
  status: string
  total_step_count: number
  completed_step_count: number
  completion_rate: number | null
  created_by: string
  started_at: string | null
  completed_at: string | null
}

export function listTrainingSessions(
  db: DBAdapter,
  params: ListTrainingSessionsParams
): ListTrainingSessionsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const limit = typeof params.limit === 'number' ? params.limit : 50
  const offset = typeof params.offset === 'number' ? params.offset : 0
  const rows = db
    .prepare(
      `SELECT ts.training_session_id, ts.business_session_id, ts.student_id, ts.module_type, ts.status,
              ts.total_step_count, ts.completed_step_count, ts.completion_rate,
              ts.created_by, ts.started_at, ts.completed_at
         FROM training_session ts
        WHERE (ts.student_id = ? OR ? IS NULL)
          AND (ts.status = ? OR ? IS NULL)
        ORDER BY ts.updated_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(
      params.studentId ?? null,
      params.studentId ?? null,
      params.status ?? null,
      params.status ?? null,
      limit,
      offset
    ) as TrainingSessionListRow[]
  const countRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM training_session
        WHERE (student_id = ? OR ? IS NULL) AND (status = ? OR ? IS NULL)`
    )
    .get(
      params.studentId ?? null,
      params.studentId ?? null,
      params.status ?? null,
      params.status ?? null
    ) as { total: number }
  const sessions: TrainingSessionListItem[] = rows.map((row) => ({
    trainingSessionId: row.training_session_id,
    businessSessionId: row.business_session_id,
    studentId: row.student_id,
    moduleType: row.module_type,
    status: row.status as TrainingSessionStatus,
    totalStepCount: row.total_step_count,
    completedStepCount: row.completed_step_count,
    completionRate: row.completion_rate,
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }))

  const success: ListTrainingSessionsSuccess = { success: true, sessions, total: countRow.total }
  return success
}

export function listMyTrainingSessions(
  db: DBAdapter,
  params: ListMyTrainingSessionsParams
): ListMyTrainingSessionsResult {
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
  const profile = db.prepare(
    `SELECT student_id FROM student_profile
      WHERE user_id = ? OR (user_id IS NULL AND student_id = ?)
      LIMIT 1`
  ).get(caller.row.user_id, caller.row.user_id) as { student_id: string } | undefined
  if (!profile) return { success: true, sessions: [], total: 0 }

  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0
    ? Math.min(params.limit as number, 100)
    : 50
  const offset = Number.isInteger(params.offset) && (params.offset ?? -1) >= 0
    ? params.offset as number
    : 0
  const rows = db.prepare(
    `SELECT ts.training_session_id, ts.business_session_id, ts.student_id, ts.module_type, ts.status,
            ts.total_step_count, ts.completed_step_count, ts.completion_rate,
            ts.created_by, ts.started_at, ts.completed_at
       FROM training_session ts
      WHERE ts.student_id = ?
      ORDER BY ts.updated_at DESC
      LIMIT ? OFFSET ?`
  ).all(profile.student_id, limit, offset) as TrainingSessionListRow[]
  const total = (db.prepare(
    'SELECT COUNT(*) AS total FROM training_session WHERE student_id = ?'
  ).get(profile.student_id) as { total: number }).total
  const sessions: TrainingSessionListItem[] = rows.map((row) => ({
    trainingSessionId: row.training_session_id,
    businessSessionId: row.business_session_id,
    studentId: row.student_id,
    moduleType: row.module_type,
    status: row.status as TrainingSessionStatus,
    totalStepCount: row.total_step_count,
    completedStepCount: row.completed_step_count,
    completionRate: row.completion_rate,
    createdBy: row.created_by,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }))
  return { success: true, sessions, total }
}

interface TrainingStepRow {
  training_step_record_id: string
  step_code: string
  step_name: string
  step_order: number
  step_type: string
  status: string
  attempt_count: number
  started_at: string | null
  completed_at: string | null
}

export function getTrainingSession(
  db: DBAdapter,
  params: GetTrainingSessionParams
): GetTrainingSessionResult {
  if (typeof params.trainingSessionId !== 'string' || params.trainingSessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const isTeacher = params.callerRole === 'TEACHER' || params.callerRole === 'ADMIN'
  const isStudent = params.callerRole === 'STUDENT'
  if (!isTeacher && !isStudent) return { success: false, errorCode: 'FORBIDDEN' }
  const callerRow = db
    .prepare('SELECT user_id, role, status FROM user_account WHERE user_id = ? AND status = \'ACTIVE\'')
    .get(params.callerUserId) as { user_id: string; role: string; status: string } | undefined
  if (!callerRow || callerRow.role !== params.callerRole) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const session = db
    .prepare(
      `SELECT training_session_id, student_id, strategy_id, strategy_version,
              business_session_id, module_type, status, total_step_count, completed_step_count,
              completion_rate, created_by, started_at, completed_at
         FROM training_session WHERE training_session_id = ?`
    )
    .get(params.trainingSessionId) as (TrainingSessionListRow & {
    strategy_id: string
    strategy_version: number
  }) | undefined
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (isStudent && session.student_id !== params.callerUserId) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const stepRows = db
    .prepare(
      `SELECT training_step_record_id, step_code, step_name, step_order, step_type,
              status, attempt_count, started_at, completed_at
         FROM training_step_record
        WHERE training_session_id = ?
        ORDER BY step_order ASC`
    )
    .all(params.trainingSessionId) as TrainingStepRow[]
  const steps: TrainingStepView[] = stepRows.map((step) => ({
    stepRecordId: step.training_step_record_id,
    stepCode: step.step_code,
    stepName: step.step_name,
    stepOrder: step.step_order,
    stepType: step.step_type as TrainingStepType,
    status: step.status as TrainingStepStatus,
    attemptCount: step.attempt_count,
    startedAt: step.started_at,
    completedAt: step.completed_at
  }))
  const detail: TrainingSessionDetail = {
    trainingSessionId: session.training_session_id,
    businessSessionId: session.business_session_id,
    studentId: session.student_id,
    strategyId: session.strategy_id,
    strategyVersion: session.strategy_version,
    moduleType: session.module_type,
    status: session.status as TrainingSessionStatus,
    totalStepCount: session.total_step_count,
    completedStepCount: session.completed_step_count,
    completionRate: session.completion_rate,
    steps,
    createdBy: session.created_by,
    startedAt: session.started_at,
    completedAt: session.completed_at
  }
  const success: GetTrainingSessionSuccess = { success: true, session: detail }
  return success
}
