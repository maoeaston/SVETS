// 统一当前结果读取 IPC（F6-5）。
// 只读 result_record.is_current = 1，不在读取时补算，也不修改当前结果标记。

import { ipcMain } from 'electron'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller, assertStudent } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  CurrentResultRecord,
  GetCurrentResult,
  GetCurrentResultParams,
  ListCurrentByStudentParams,
  ListCurrentByStudentResult,
  ResultFilters,
  ResultSourceAggregateType,
  ResultsErrorCode
} from '../../../shared/types/results'
import type { ResultType, StrategyType } from '../../../shared/types/json-schemas'

const RESULT_TYPES = new Set<ResultType>([
  'ABILITY_SCORE',
  'TRAINING_COMPLETION',
  'OPERATION_PASS_RATE',
  'JOB_SKILL_SCORE'
])

const SOURCE_TYPES = new Set<ResultSourceAggregateType>([
  'ASSESSMENT_SESSION',
  'TRAINING_SESSION'
])

type CallerContext =
  | { ok: true; role: 'STUDENT'; userId: string; studentId: string | null }
  | { ok: true; role: 'TEACHER' | 'ADMIN'; userId: string }
  | { ok: false; errorCode: 'FORBIDDEN' }

interface ResultRecordRow {
  result_id: string
  student_id: string
  result_type: string
  source_aggregate_type: string
  source_aggregate_id: string
  strategy_id: string | null
  strategy_type: string | null
  job_code: string
  module_type: string | null
  raw_score: number | null
  max_score: number | null
  normalized_score: number
  completion_ratio: number | null
  level_result: string | null
  safety_overridden: number
  redline_incident_id: string | null
  result_payload_json: string | null
  generated_event_id: string
  snapshot_id: string | null
  generated_at: string
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function resolveStudentProfileId(db: DBAdapter, userId: string): string | null {
  const row = db
    .prepare(
      `SELECT student_id
         FROM student_profile
        WHERE user_id = ?
           OR (user_id IS NULL AND student_id = ?)
        LIMIT 1`
    )
    .get(userId, userId) as { student_id: string } | undefined
  return row?.student_id ?? null
}

function resolveCaller(db: DBAdapter, params: { callerUserId: unknown; callerRole: unknown }): CallerContext {
  if (params.callerRole === 'STUDENT') {
    const caller = assertStudent(db, params.callerUserId, params.callerRole)
    if (!caller.ok) return { ok: false, errorCode: 'FORBIDDEN' }
    return {
      ok: true,
      role: 'STUDENT',
      userId: caller.row.user_id,
      studentId: resolveStudentProfileId(db, caller.row.user_id)
    }
  }

  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { ok: false, errorCode: 'FORBIDDEN' }
  return {
    ok: true,
    role: caller.row.role as 'TEACHER' | 'ADMIN',
    userId: caller.row.user_id
  }
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateFilters(filters: ResultFilters): ResultsErrorCode | null {
  if (filters.studentId !== undefined && !validString(filters.studentId)) return 'VALIDATION_ERROR'
  if (filters.resultType !== undefined && !RESULT_TYPES.has(filters.resultType)) return 'VALIDATION_ERROR'
  if (
    filters.sourceAggregateType !== undefined &&
    !SOURCE_TYPES.has(filters.sourceAggregateType)
  ) return 'VALIDATION_ERROR'
  if (
    filters.sourceAggregateId !== undefined &&
    !validString(filters.sourceAggregateId)
  ) return 'VALIDATION_ERROR'
  return null
}

function parseResultPayload(value: string | null): unknown | null {
  if (value === null) return null
  return JSON.parse(value) as unknown
}

function mapResultRow(row: ResultRecordRow): CurrentResultRecord {
  return {
    resultId: row.result_id,
    studentId: row.student_id,
    resultType: row.result_type as ResultType,
    sourceAggregateType: row.source_aggregate_type as ResultSourceAggregateType,
    sourceAggregateId: row.source_aggregate_id,
    strategyId: row.strategy_id,
    strategyType: row.strategy_type as StrategyType | null,
    jobCode: row.job_code,
    moduleType: row.module_type as CurrentResultRecord['moduleType'],
    rawScore: row.raw_score,
    maxScore: row.max_score,
    normalizedScore: row.normalized_score,
    completionRatio: row.completion_ratio,
    levelResult: row.level_result,
    safetyOverridden: row.safety_overridden === 1,
    redlineIncidentId: row.redline_incident_id,
    resultPayload: parseResultPayload(row.result_payload_json),
    generatedEventId: row.generated_event_id,
    snapshotId: row.snapshot_id,
    generatedAt: row.generated_at
  }
}

function resultSelectSql(): string {
  return `SELECT result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
                 strategy_id, strategy_type, job_code, module_type,
                 raw_score, max_score, normalized_score, completion_ratio, level_result,
                 safety_overridden, redline_incident_id, result_payload_json,
                 generated_event_id, snapshot_id, generated_at
            FROM result_record`
}

function buildCurrentWhere(
  caller: Exclude<CallerContext, { ok: false }>,
  filters: ResultFilters
): { sql: string; values: unknown[] } | { forbidden: true } {
  const conditions = ['is_current = 1']
  const values: unknown[] = []

  if (caller.role === 'STUDENT') {
    if (!caller.studentId) return { forbidden: true }
    if (filters.studentId !== undefined && filters.studentId !== caller.studentId) {
      return { forbidden: true }
    }
    conditions.push('student_id = ?')
    values.push(caller.studentId)
  } else if (filters.studentId !== undefined) {
    conditions.push('student_id = ?')
    values.push(filters.studentId)
  }

  if (filters.resultType !== undefined) {
    conditions.push('result_type = ?')
    values.push(filters.resultType)
  }
  if (filters.sourceAggregateType !== undefined) {
    conditions.push('source_aggregate_type = ?')
    values.push(filters.sourceAggregateType)
  }
  if (filters.sourceAggregateId !== undefined) {
    conditions.push('source_aggregate_id = ?')
    values.push(filters.sourceAggregateId)
  }

  return { sql: conditions.join(' AND '), values }
}

export function getCurrentResult(
  db: DBAdapter,
  params: GetCurrentResultParams
): GetCurrentResult {
  const caller = resolveCaller(db, params)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  if (
    !RESULT_TYPES.has(params.resultType) ||
    !SOURCE_TYPES.has(params.sourceAggregateType) ||
    !validString(params.sourceAggregateId) ||
    (params.studentId !== undefined && !validString(params.studentId))
  ) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const filters: ResultFilters = {
    studentId: params.studentId,
    resultType: params.resultType,
    sourceAggregateType: params.sourceAggregateType,
    sourceAggregateId: params.sourceAggregateId
  }
  const where = buildCurrentWhere(caller, filters)
  if ('forbidden' in where) return { success: false, errorCode: 'FORBIDDEN' }

  try {
    const row = db
      .prepare(
        `${resultSelectSql()}
         WHERE ${where.sql}
         LIMIT 1`
      )
      .get(...where.values) as ResultRecordRow | undefined
    return { success: true, result: row ? mapResultRow(row) : null }
  } catch (error) {
    console.error('[results:getCurrent] error:', error)
    return { success: false, errorCode: 'RESULTS_SYSTEM_ERROR' }
  }
}

export function listCurrentResultsByStudent(
  db: DBAdapter,
  params: ListCurrentByStudentParams
): ListCurrentByStudentResult {
  const caller = resolveCaller(db, params)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const validationError = validateFilters(params)
  if (validationError) return { success: false, errorCode: validationError }

  const where = buildCurrentWhere(caller, params)
  if ('forbidden' in where) return { success: false, errorCode: 'FORBIDDEN' }

  try {
    const rows = db
      .prepare(
        `${resultSelectSql()}
         WHERE ${where.sql}
         ORDER BY generated_at DESC, result_id ASC`
      )
      .all(...where.values) as ResultRecordRow[]
    return {
      success: true,
      results: rows.map(mapResultRow),
      total: rows.length
    }
  } catch (error) {
    console.error('[results:listCurrentByStudent] error:', error)
    return { success: false, errorCode: 'RESULTS_SYSTEM_ERROR' }
  }
}

export function registerResultsHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('results:getCurrent', (event, params: GetCurrentResultParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return getCurrentResult(db, trusted.params)
  })

  ipcMain.handle('results:listCurrentByStudent', (event, params: ListCurrentByStudentParams) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return listCurrentResultsByStudent(db, trusted.params)
  })
}
