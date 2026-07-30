import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  ExceptionCategory,
  ExceptionDetail,
  ExceptionListItem,
  ExceptionPriority,
  ExceptionPriorityCounts,
  ExceptionSeverity,
  FoundationErrorCode,
  GetExceptionParams,
  GetExceptionResult,
  GetWorkspaceOverviewResult,
  ListExceptionsParams,
  ListExceptionsResult,
  RecoveryStatus,
  TrustedCallerParams,
  WorkspaceOverview
} from '../../../shared/types/foundation'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

const PRIORITIES = new Set<ExceptionPriority>(['P0', 'P1', 'P2', 'P3'])
const CATEGORIES = new Set<ExceptionCategory>([
  'IPC', 'DB', 'AOL', 'RECOVERY', 'ASSET', 'FSM', 'SCORING', 'REPORT', 'AUTH', 'SYSTEM'
])
const RECOVERY_STATUSES = new Set<RecoveryStatus>([
  'UNRESOLVED', 'AUTO_RECOVERED', 'MANUAL_REVIEW_REQUIRED', 'RESOLVED', 'IGNORED'
])

type CallerRole = 'TEACHER' | 'ADMIN'

interface ExceptionRow {
  error_event_id: string
  error_code: string
  title: string
  default_message: string
  message: string
  severity: string
  priority_level: string
  error_category: string
  is_blocking: number
  recovery_status: string
  default_recovery_hint: string | null
  recovery_action: string | null
  related_aggregate_type: string | null
  related_aggregate_id: string | null
  related_event_id: string | null
  context_json: string | null
  stack_trace: string | null
  created_at: string
  resolved_at: string | null
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function resolveRole(db: DBAdapter, params: TrustedCallerParams): CallerRole | null {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok || (caller.row.role !== 'TEACHER' && caller.row.role !== 'ADMIN')) return null
  return caller.row.role as CallerRole
}

function teacherVisibilitySql(role: CallerRole): string {
  if (role === 'ADMIN') return '1 = 1'
  return `(
    e.related_aggregate_type IN (
      'ASSESSMENT_SESSION', 'TRAINING_SESSION', 'STUDENT_PROFILE', 'TASK_REPORT', 'SAFETY_INCIDENT'
    )
    OR e.error_category IN ('IPC', 'FSM', 'SCORING', 'REPORT', 'ASSET')
  )`
}

function baseSelect(): string {
  return `SELECT e.error_event_id, e.error_code, r.title, r.default_message,
                 e.message, e.severity, r.priority_level, e.error_category,
                 r.is_blocking, e.recovery_status, r.default_recovery_hint,
                 e.recovery_action, e.related_aggregate_type, e.related_aggregate_id,
                 e.related_event_id, e.context_json, e.stack_trace, e.created_at, e.resolved_at
            FROM error_event_log e
            JOIN error_code_registry r ON r.error_code = e.error_code`
}

function mapListItem(row: ExceptionRow): ExceptionListItem {
  return {
    errorEventId: row.error_event_id,
    errorCode: row.error_code,
    title: row.title,
    message: row.message,
    severity: row.severity as ExceptionSeverity,
    priorityLevel: row.priority_level as ExceptionPriority,
    category: row.error_category as ExceptionCategory,
    isBlocking: row.is_blocking === 1,
    recoveryStatus: row.recovery_status as RecoveryStatus,
    recoveryHint: row.default_recovery_hint,
    relatedAggregateType: row.related_aggregate_type,
    relatedAggregateId: row.related_aggregate_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  }
}

function parseContext(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed }
  } catch {
    return { raw: value }
  }
}

function toSafeLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return 30
  return Math.min(value as number, 100)
}

function toSafeOffset(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0
}

function validateExceptionFilters(params: ListExceptionsParams): FoundationErrorCode | null {
  if (params.priorityLevel && !PRIORITIES.has(params.priorityLevel)) return 'VALIDATION_ERROR'
  if (params.category && !CATEGORIES.has(params.category)) return 'VALIDATION_ERROR'
  if (params.recoveryStatus && !RECOVERY_STATUSES.has(params.recoveryStatus)) return 'VALIDATION_ERROR'
  return null
}

function exceptionWhere(role: CallerRole, params: ListExceptionsParams): { sql: string; values: unknown[] } {
  const conditions = ["e.created_at >= datetime('now', '-30 days')", teacherVisibilitySql(role)]
  const values: unknown[] = []
  if (params.priorityLevel) {
    conditions.push('r.priority_level = ?')
    values.push(params.priorityLevel)
  }
  if (params.category) {
    conditions.push('e.error_category = ?')
    values.push(params.category)
  }
  if (params.recoveryStatus) {
    conditions.push('e.recovery_status = ?')
    values.push(params.recoveryStatus)
  }
  return { sql: conditions.join(' AND '), values }
}

export function listExceptions(db: DBAdapter, params: ListExceptionsParams): ListExceptionsResult {
  const role = resolveRole(db, params)
  if (!role) return { success: false, errorCode: 'FORBIDDEN' }
  const invalid = validateExceptionFilters(params)
  if (invalid) return { success: false, errorCode: invalid }

  try {
    const where = exceptionWhere(role, params)
    const limit = toSafeLimit(params.limit)
    const offset = toSafeOffset(params.offset)
    const rows = db.prepare(
      `${baseSelect()}
       WHERE ${where.sql}
       ORDER BY CASE r.priority_level WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                e.created_at DESC, e.error_event_id ASC
       LIMIT ? OFFSET ?`
    ).all(...where.values, limit, offset) as ExceptionRow[]
    const totalRow = db.prepare(
      `SELECT COUNT(*) AS total FROM error_event_log e
       JOIN error_code_registry r ON r.error_code = e.error_code
       WHERE ${where.sql}`
    ).get(...where.values) as { total: number }
    const countRows = db.prepare(
      `SELECT r.priority_level, COUNT(*) AS count FROM error_event_log e
       JOIN error_code_registry r ON r.error_code = e.error_code
       WHERE ${teacherVisibilitySql(role)} AND e.created_at >= datetime('now', '-30 days')
       GROUP BY r.priority_level`
    ).all() as { priority_level: ExceptionPriority; count: number }[]
    const priorityCounts: ExceptionPriorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 }
    for (const row of countRows) priorityCounts[row.priority_level] = row.count
    return { success: true, items: rows.map(mapListItem), total: totalRow.total, priorityCounts }
  } catch (error) {
    console.error('[Foundation] listExceptions failed:', error)
    return { success: false, errorCode: 'FOUNDATION_SYSTEM_ERROR' }
  }
}

export function getException(db: DBAdapter, params: GetExceptionParams): GetExceptionResult {
  const role = resolveRole(db, params)
  if (!role) return { success: false, errorCode: 'FORBIDDEN' }
  if (typeof params.errorEventId !== 'string' || params.errorEventId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  try {
    const row = db.prepare(
      `${baseSelect()}
       WHERE e.error_event_id = ? AND ${teacherVisibilitySql(role)}`
    ).get(params.errorEventId) as ExceptionRow | undefined
    if (!row) return { success: false, errorCode: 'NOT_FOUND' }
    const detail: ExceptionDetail = {
      ...mapListItem(row),
      defaultMessage: row.default_message,
      recoveryAction: row.recovery_action,
      relatedEventId: row.related_event_id,
      context: role === 'ADMIN' ? parseContext(row.context_json) : null,
      stackTrace: role === 'ADMIN' ? row.stack_trace : null
    }
    return { success: true, exception: detail }
  } catch (error) {
    console.error('[Foundation] getException failed:', error)
    return { success: false, errorCode: 'FOUNDATION_SYSTEM_ERROR' }
  }
}

function count(db: DBAdapter, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count
}

export function getWorkspaceOverview(
  db: DBAdapter,
  params: TrustedCallerParams
): GetWorkspaceOverviewResult {
  const role = resolveRole(db, params)
  if (!role) return { success: false, errorCode: 'FORBIDDEN' }
  try {
    const overview: WorkspaceOverview = {
      role,
      activeStudentCount: count(db, "SELECT COUNT(*) AS count FROM student_profile WHERE status = 'ACTIVE'"),
      openAssessmentCount: count(db, `SELECT COUNT(*) AS count FROM assessment_session
        WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED', 'OFFLINE_PENDING')`),
      openTrainingCount: count(db, `SELECT COUNT(*) AS count FROM training_session
        WHERE status IN ('INIT', 'ACTIVE', 'EMOTION_INTERRUPTED', 'SUSPENDED_REVIEW_REQUIRED')`),
      pendingSafetyCount: count(db, "SELECT COUNT(*) AS count FROM safety_incident WHERE status IN ('PENDING_DETAIL', 'CONFIRMED')"),
      reportCount: count(db, "SELECT COUNT(*) AS count FROM task_report WHERE status NOT IN ('SUPERSEDED', 'ARCHIVED', 'FAILED')"),
      unresolvedExceptionCount: count(db, `SELECT COUNT(*) AS count FROM error_event_log e
        WHERE e.recovery_status IN ('UNRESOLVED', 'MANUAL_REVIEW_REQUIRED') AND ${teacherVisibilitySql(role)}`),
      teacherAccountCount: count(db, "SELECT COUNT(*) AS count FROM user_account WHERE role = 'TEACHER'"),
      activeStrategyCount: count(db, 'SELECT COUNT(DISTINCT strategy_id) AS count FROM strategy_config WHERE is_active = 1'),
      assetIssueCount: count(db, "SELECT COUNT(*) AS count FROM asset_resource WHERE status IN ('MISSING', 'CORRUPTED')"),
      unverifiedAssetCount: count(db, 'SELECT COUNT(*) AS count FROM asset_resource WHERE last_verified_at IS NULL'),
      snapshotCount: count(db, 'SELECT COUNT(*) AS count FROM snapshot_meta'),
      lastSnapshotAt: (db.prepare('SELECT MAX(created_at) AS value FROM snapshot_meta').get() as { value: string | null }).value
    }
    return { success: true, overview }
  } catch (error) {
    console.error('[Foundation] getWorkspaceOverview failed:', error)
    return { success: false, errorCode: 'FOUNDATION_SYSTEM_ERROR' }
  }
}

export function registerFoundationHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  getDb: () => DBAdapter = defaultGetDb
): void {
  function trusted<T extends TrustedCallerParams, R>(
    event: Electron.IpcMainInvokeEvent,
    params: T,
    run: (db: DBAdapter, trustedParams: T) => R
  ): R | { success: false; errorCode: 'FORBIDDEN' } {
    const db = getDb()
    const resolved = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!resolved.ok) return { success: false, errorCode: 'FORBIDDEN' }
    return run(db, resolved.params)
  }

  registrar.handle('foundation:getOverview', (event, params: TrustedCallerParams) =>
    trusted(event, params, getWorkspaceOverview))
  registrar.handle('foundation:listExceptions', (event, params: ListExceptionsParams) =>
    trusted(event, params, listExceptions))
  registrar.handle('foundation:getException', (event, params: GetExceptionParams) =>
    trusted(event, params, getException))
}
