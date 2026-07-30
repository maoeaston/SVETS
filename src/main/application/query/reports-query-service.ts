import type { DBAdapter } from '../../db/interface'
import type { ReportCommandKey } from '../../domain/report-command-coordinator'
import { parseReportContent, validateReportSourceResultIds } from '../../domain/report-contract'
import { assertCaller } from '../../utils/auth-context'
import { buildReportPresentation } from '../../../shared/report-presentation'
import type { ReportContentJson } from '../../../shared/types/json-schemas'
import type {
  GetReportParams,
  GetReportResult,
  ListReportGenerationCandidatesParams,
  ListReportGenerationCandidatesResult,
  ListReportsParams,
  ListReportsResult,
  ReportContractValidationStatus,
  ReportGenerationCandidate,
  ReportLifecycleCapabilities,
  ReportLifecycleMetadata,
  ReportLifecycleStatus,
  ReportListItem,
  ReportsResult,
  TaskClosureView
} from '../../../shared/types/report'

export type ReportScope = 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
export type ActiveReportStatus = Extract<ReportLifecycleStatus, 'GENERATED' | 'EXPORTED' | 'LOCKED'>

export interface ReportRow {
  report_id: string
  report_type: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  student_id: string
  student_name: string | null
  source_aggregate_type: string | null
  source_aggregate_id: string | null
  source_result_ids_json: string | null
  report_title: string
  report_content_json: string
  generated_by: string
  generated_at: string
  placement_review_by: string | null
  placement_review_at: string | null
  lineage_key: string | null
  content_hash: string | null
  report_revision: number | null
  report_schema_version: string | null
  contract_validation_status: ReportContractValidationStatus
  status: ReportLifecycleStatus
}

interface TaskClosureRow {
  task_closure_id: string
  student_id: string
  job_code: string
  task_code: string
  cycle_no: number
  closure_revision: number
  status: 'CONFIRMED' | 'SUPERSEDED'
  is_cycle_head: number
  ability_result_id: string
  training_completion_result_id: string
  operation_pass_rate_result_id: string
}

interface BaseResultCandidateRow {
  result_id: string
  student_id: string
  result_type: 'ABILITY_SCORE' | 'TRAINING_COMPLETION' | 'OPERATION_PASS_RATE'
  source_aggregate_id: string
  generated_at: string
  job_code: string
  task_code: string
}

interface JobCandidateRow {
  result_id: string
  student_id: string
  source_aggregate_id: string
}

interface SafetyCandidateRow {
  incident_id: string
  student_id: string
  status: 'PENDING_DETAIL' | 'CONFIRMED' | 'RESOLVED'
}

export interface TaskClosureBusinessKey {
  task_closure_id: string
  student_id: string
  job_code: string
  task_code: string
}

const REPORT_STATUSES: readonly ReportLifecycleStatus[] = ['GENERATED', 'EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED', 'FAILED']
const REPORT_TYPES = ['FULL_REPORT', 'SAFETY_TERMINATION_REPORT'] as const
const REPORT_SCOPES = ['BASE_ABILITY', 'JOB_SKILL', 'SAFETY'] as const

function requireTeacher(db: DBAdapter, callerUserId: unknown, callerRole: unknown): string | null {
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok || caller.row.role !== 'TEACHER') return null
  return caller.row.user_id
}

function forbidden(): { success: false; errorCode: 'FORBIDDEN' } {
  return { success: false, errorCode: 'FORBIDDEN' }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseLimitOffset(params: { limit?: unknown; offset?: unknown }): { ok: true; limit: number; offset: number } | { ok: false } {
  const limit = params.limit === undefined ? 50 : params.limit
  const offset = params.offset === undefined ? 0 : params.offset
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) return { ok: false }
  if (!Number.isInteger(offset) || (offset as number) < 0) return { ok: false }
  return { ok: true, limit: limit as number, offset: offset as number }
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value))
}

export function reportRows(db: DBAdapter): ReportRow[] {
  return db.prepare(
    `SELECT r.report_id, r.report_type, r.student_id, s.student_name,
            r.source_aggregate_type, r.source_aggregate_id, r.source_result_ids_json,
            r.report_title, r.report_content_json, r.generated_by, r.generated_at,
            r.placement_review_by, r.placement_review_at, r.lineage_key, r.content_hash,
            r.report_revision, r.report_schema_version, r.contract_validation_status, r.status
       FROM task_report r
       LEFT JOIN student_profile s ON s.student_id = r.student_id
      ORDER BY r.generated_at DESC, r.report_id DESC`
  ).all() as ReportRow[]
}

export function getReportRow(db: DBAdapter, reportId: string): ReportRow | null {
  return reportRows(db).find((row) => row.report_id === reportId) ?? null
}

export function parseStoredReportContent(row: ReportRow) {
  try {
    const parsedJson = JSON.parse(row.report_content_json) as unknown
    return parseReportContent(parsedJson)
  } catch {
    return { valid: false as const, errors: [{ code: 'TYPE' as const, path: '$' }] }
  }
}

export function inferReportScope(row: ReportRow): ReportScope | null {
  const parsed = parseStoredReportContent(row)
  if (parsed.valid) return parsed.value.report_scope
  if (row.report_type === 'SAFETY_TERMINATION_REPORT') return 'SAFETY'
  if (row.report_schema_version?.startsWith('job-skill-report')) return 'JOB_SKILL'
  if (row.report_schema_version?.startsWith('task-report')) return 'BASE_ABILITY'
  return null
}

function reportPlacementEnabled(row: ReportRow): boolean {
  const parsed = parseStoredReportContent(row)
  return parsed.valid ? parsed.value.placement_advice.enabled : false
}

function lifecycleCapabilities(row: ReportRow): ReportLifecycleCapabilities {
  const placementAdviceEnabled = reportPlacementEnabled(row)
  const active = isActiveReport(row.status)
  const valid = row.contract_validation_status === 'VALID' && parseStoredReportContent(row).valid
  const reviewed = !placementAdviceEnabled || (row.placement_review_by !== null && row.placement_review_at !== null)
  return {
    placementAdviceEnabled,
    canConfirmPlacementReview: active && valid && placementAdviceEnabled && row.placement_review_by === null && row.placement_review_at === null,
    canLock: (row.status === 'GENERATED' || row.status === 'EXPORTED') && valid && reviewed,
    canExport: active && valid && reviewed
  }
}

export function isActiveReport(status: ReportLifecycleStatus): status is ActiveReportStatus {
  return status === 'GENERATED' || status === 'EXPORTED' || status === 'LOCKED'
}

function latestReportLifecyclePayload(
  db: DBAdapter,
  reportId: string,
  eventType: 'REPORT_LOCKED' | 'REPORT_EXPORTED'
): Record<string, unknown> | null {
  const row = db.prepare(
    `SELECT payload_json
       FROM domain_event_projection
      WHERE aggregate_type = 'TASK_REPORT'
        AND aggregate_id = ?
        AND event_type = ?
      ORDER BY created_at DESC, event_sequence DESC, event_id DESC
      LIMIT 1`
  ).get(reportId, eventType) as { payload_json: string } | undefined
  if (!row) return null
  try {
    const parsed = JSON.parse(row.payload_json) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function lifecycle(db: DBAdapter, row: ReportRow): ReportLifecycleMetadata {
  const locked = latestReportLifecyclePayload(db, row.report_id, 'REPORT_LOCKED')
  const exported = latestReportLifecyclePayload(db, row.report_id, 'REPORT_EXPORTED')
  return {
    status: row.status,
    contractValidationStatus: row.contract_validation_status,
    reportRevision: row.report_revision ?? 1,
    lineageKey: row.lineage_key ?? '',
    contentHash: row.content_hash ?? '',
    placementReviewBy: row.placement_review_by,
    placementReviewAt: row.placement_review_at,
    lockedBy: typeof locked?.locked_by === 'string' ? locked.locked_by : null,
    lockedAt: typeof locked?.locked_at === 'string' ? locked.locked_at : null,
    lastExportedAt: typeof exported?.exported_at === 'string' ? exported.exported_at : null,
    capabilities: lifecycleCapabilities(row)
  }
}

function toListItem(row: ReportRow): ReportListItem {
  return {
    reportId: row.report_id,
    studentId: row.student_id,
    studentDisplayName: row.student_name ?? '',
    reportTitle: row.report_title,
    reportScope: inferReportScope(row) ?? 'BASE_ABILITY',
    reportType: row.report_type,
    status: row.status,
    contractValidationStatus: row.contract_validation_status,
    reportSchemaVersion: row.report_schema_version ?? '',
    reportRevision: row.report_revision ?? 1,
    generatedAt: row.generated_at,
    canExport: lifecycleCapabilities(row).canExport
  }
}

function matchesListFilters(row: ReportRow, params: ListReportsParams): boolean {
  const scope = inferReportScope(row)
  if (params.studentId !== undefined && row.student_id !== params.studentId) return false
  if (params.reportScope !== undefined && scope !== params.reportScope) return false
  if (params.reportType !== undefined && row.report_type !== params.reportType) return false
  if (params.status !== undefined && row.status !== params.status) return false
  if (params.generatedFrom !== undefined && row.generated_at < params.generatedFrom) return false
  if (params.generatedTo !== undefined && row.generated_at > params.generatedTo) return false
  return true
}

function validateListParams(params: ListReportsParams): boolean {
  if (params.studentId !== undefined && !isNonEmptyString(params.studentId)) return false
  if (params.reportScope !== undefined && !REPORT_SCOPES.includes(params.reportScope)) return false
  if (params.reportType !== undefined && !REPORT_TYPES.includes(params.reportType)) return false
  if (params.status !== undefined && !REPORT_STATUSES.includes(params.status)) return false
  if (params.generatedFrom !== undefined && !validDate(params.generatedFrom)) return false
  if (params.generatedTo !== undefined && !validDate(params.generatedTo)) return false
  if (params.generatedFrom !== undefined && params.generatedTo !== undefined && params.generatedFrom > params.generatedTo) return false
  return parseLimitOffset(params).ok
}

export function listReports(db: DBAdapter, params: ListReportsParams): ReportsResult<ListReportsResult> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!validateListParams(params)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const page = parseLimitOffset(params)
  if (!page.ok) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const filtered = reportRows(db).filter((row) => matchesListFilters(row, params))
  return {
    success: true,
    total: filtered.length,
    items: filtered.slice(page.offset, page.offset + page.limit).map(toListItem)
  }
}

export function getReport(db: DBAdapter, params: GetReportParams): ReportsResult<GetReportResult> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }

  const parsed = parseStoredReportContent(row)
  if (!parsed.valid) {
    return {
      success: true,
      report: {
        reportId: row.report_id,
        studentId: row.student_id,
        reportTitle: row.report_title,
        reportScope: inferReportScope(row) ?? 'BASE_ABILITY',
        reportType: row.report_type,
        presentation: null,
        contractErrors: parsed.errors,
        lifecycle: { ...lifecycle(db, row), contractValidationStatus: 'REPAIR_REQUIRED' }
      }
    }
  }

  const sourceIds = row.source_result_ids_json ? parseStoredSourceResultIds(row, parsed.value) : null
  const sourceErrors = sourceIds && !sourceIds.valid ? sourceIds.errors : []
  return {
    success: true,
    report: {
      reportId: row.report_id,
      studentId: row.student_id,
      reportTitle: row.report_title,
      reportScope: parsed.value.report_scope,
      reportType: parsed.value.report_type,
      presentation: buildReportPresentation(parsed.value, row.report_id),
      contractErrors: sourceErrors,
      lifecycle: sourceErrors.length > 0
        ? { ...lifecycle(db, row), contractValidationStatus: 'REPAIR_REQUIRED' }
        : lifecycle(db, row)
    }
  }
}

export function listReportGenerationCandidates(
  db: DBAdapter,
  params: ListReportGenerationCandidatesParams
): ReportsResult<ListReportGenerationCandidatesResult> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (params.studentId !== undefined && !isNonEmptyString(params.studentId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const page = parseLimitOffset(params)
  if (!page.ok) return { success: false, errorCode: 'VALIDATION_ERROR' }

  const items = [
    ...baseCandidates(db, params.studentId),
    ...jobCandidates(db, params.studentId),
    ...safetyCandidates(db, params.studentId)
  ]
  return {
    success: true,
    total: items.length,
    items: items.slice(page.offset, page.offset + page.limit)
  }
}

export function reportCommandKeyForRow(db: DBAdapter, row: ReportRow): ReportCommandKey {
  const parsed = parseStoredReportContent(row)
  const content = parsed.valid ? parsed.value : null
  const sourceBusinessKey = row.source_aggregate_id ? reportSourceBusinessKey(db, row.source_aggregate_id) : null
  return {
    studentId: row.student_id,
    jobCode: content?.report_scope === 'JOB_SKILL'
      ? content.assessment_meta.job_code
      : content?.report_scope === 'SAFETY'
        ? content.incident_snapshot.job_code
        : sourceBusinessKey?.job_code ?? '',
    taskCode: content?.report_scope === 'SAFETY'
      ? content.incident_snapshot.task_code
      : sourceBusinessKey?.task_code ?? '',
    scope: content?.report_scope ?? inferReportScope(row) ?? 'BASE_ABILITY'
  }
}

export function readTaskClosureBusinessKey(db: DBAdapter, closureId: string): TaskClosureBusinessKey | null {
  return db.prepare(
    `SELECT task_closure_id, student_id, job_code, task_code
       FROM task_closure WHERE task_closure_id = ?`
  ).get(closureId) as TaskClosureBusinessKey | undefined ?? null
}

export function readTaskClosureView(db: DBAdapter, closureId: string): TaskClosureView {
  const row = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(closureId) as TaskClosureRow | undefined
  if (!row) throw new Error(`Task closure ${closureId} not found after mutation`)
  return {
    taskClosureId: row.task_closure_id,
    studentId: row.student_id,
    jobCode: row.job_code,
    taskCode: row.task_code,
    cycleNo: row.cycle_no,
    closureRevision: row.closure_revision,
    status: row.status,
    isCycleHead: row.is_cycle_head === 1,
    resultIds: [row.ability_result_id, row.training_completion_result_id, row.operation_pass_rate_result_id]
  }
}

function parseStoredSourceResultIds(row: ReportRow, content: ReportContentJson) {
  try {
    return validateReportSourceResultIds(content, JSON.parse(row.source_result_ids_json ?? 'null') as unknown)
  } catch {
    return { valid: false as const, errors: [{ code: 'TYPE' as const, path: '$' }] }
  }
}

function reportSourceBusinessKey(db: DBAdapter, sourceAggregateId: string): { job_code: string; task_code: string } | null {
  const assessment = db.prepare('SELECT job_code, task_code FROM assessment_session WHERE session_id = ?').get(sourceAggregateId) as {
    job_code: string
    task_code: string
  } | undefined
  if (assessment) return assessment
  const training = db.prepare('SELECT job_code, task_code FROM training_session WHERE training_session_id = ?').get(sourceAggregateId) as {
    job_code: string
    task_code: string
  } | undefined
  return training ?? null
}

function baseCandidates(db: DBAdapter, studentId?: string): ReportGenerationCandidate[] {
  const rows = db.prepare(
    `SELECT r.result_id, r.student_id, r.result_type, r.source_aggregate_id, r.generated_at,
            r.job_code, COALESCE(a.task_code, t.task_code) AS task_code
       FROM result_record r
       LEFT JOIN assessment_session a ON r.source_aggregate_type = 'ASSESSMENT_SESSION' AND a.session_id = r.source_aggregate_id
       LEFT JOIN training_session t ON r.source_aggregate_type = 'TRAINING_SESSION' AND t.training_session_id = r.source_aggregate_id
      WHERE r.is_current = 1
        AND r.safety_overridden = 0
        AND r.redline_incident_id IS NULL
        AND r.result_type IN ('ABILITY_SCORE', 'TRAINING_COMPLETION', 'OPERATION_PASS_RATE')
      ORDER BY r.generated_at DESC, r.result_id DESC`
  ).all() as BaseResultCandidateRow[]
  const grouped = new Map<string, BaseResultCandidateRow[]>()
  for (const row of rows) {
    if (studentId && row.student_id !== studentId) continue
    const key = JSON.stringify([row.student_id, row.job_code, row.task_code])
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const result: ReportGenerationCandidate[] = []
  for (const group of grouped.values()) {
    const byType = new Map(group.map((row) => [row.result_type, row]))
    const ability = byType.get('ABILITY_SCORE')
    const training = byType.get('TRAINING_COMPLETION')
    const operation = byType.get('OPERATION_PASS_RATE')
    if (!ability || !training || !operation) continue
    const closure = findActiveClosureForResultIds(db, [ability.result_id, training.result_id, operation.result_id])
    if (closure) {
      if (!activeReportForClosure(db, closure.task_closure_id)) {
        result.push({
          kind: 'BASE_CLOSURE',
          taskClosureId: closure.task_closure_id,
          studentId: closure.student_id,
          jobCode: closure.job_code,
          taskCode: closure.task_code,
          cycleNo: closure.cycle_no,
          closureRevision: closure.closure_revision
        })
      }
    } else {
      result.push({
        kind: 'BASE_RESULTS',
        studentId: ability.student_id,
        jobCode: ability.job_code,
        taskCode: ability.task_code,
        results: [
          { resultId: ability.result_id, resultType: 'ABILITY_SCORE', sourceAggregateId: ability.source_aggregate_id, generatedAt: ability.generated_at },
          { resultId: training.result_id, resultType: 'TRAINING_COMPLETION', sourceAggregateId: training.source_aggregate_id, generatedAt: training.generated_at },
          { resultId: operation.result_id, resultType: 'OPERATION_PASS_RATE', sourceAggregateId: operation.source_aggregate_id, generatedAt: operation.generated_at }
        ]
      })
    }
  }
  return result
}

function jobCandidates(db: DBAdapter, studentId?: string): ReportGenerationCandidate[] {
  const rows = db.prepare(
    `SELECT result_id, student_id, source_aggregate_id
       FROM result_record
      WHERE is_current = 1 AND result_type = 'JOB_SKILL_SCORE'
      ORDER BY generated_at DESC, result_id DESC`
  ).all() as JobCandidateRow[]
  return rows
    .filter((row) => !studentId || row.student_id === studentId)
    .filter((row) => !activeReportForSourceResult(db, row.result_id))
    .map((row) => ({ kind: 'JOB_SKILL', resultId: row.result_id, studentId: row.student_id, sourceAggregateId: row.source_aggregate_id, repairOfReportId: null }))
}

function safetyCandidates(db: DBAdapter, studentId?: string): ReportGenerationCandidate[] {
  const rows = db.prepare(
    `SELECT incident_id, student_id, status
       FROM safety_incident
      WHERE status IN ('PENDING_DETAIL', 'CONFIRMED', 'RESOLVED')
      ORDER BY updated_at DESC, incident_id DESC`
  ).all() as SafetyCandidateRow[]
  return rows
    .filter((row) => !studentId || row.student_id === studentId)
    .flatMap<ReportGenerationCandidate>((row) => {
      if (row.status === 'PENDING_DETAIL') return [{ kind: 'SAFETY_WAITING_CONFIRMATION', incidentId: row.incident_id, studentId: row.student_id }]
      if (activeSafetyReportForIncident(db, row.incident_id)) return []
      return [{ kind: 'SAFETY', incidentId: row.incident_id, studentId: row.student_id, retryable: true }]
    })
}

function findActiveClosureForResultIds(db: DBAdapter, ids: [string, string, string]): TaskClosureRow | null {
  return db.prepare(
    `SELECT * FROM task_closure
      WHERE ability_result_id = ?
        AND training_completion_result_id = ?
        AND operation_pass_rate_result_id = ?
        AND status = 'CONFIRMED'
        AND is_cycle_head = 1`
  ).get(...ids) as TaskClosureRow | undefined ?? null
}

function activeReportForClosure(db: DBAdapter, closureId: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS found FROM task_report
      WHERE task_closure_id = ? AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')`
  ).get(closureId) as { found: number } | undefined
  return Boolean(row)
}

function activeReportForSourceResult(db: DBAdapter, resultId: string): boolean {
  const rows = reportRows(db).filter((row) => isActiveReport(row.status))
  return rows.some((row) => {
    if (!row.source_result_ids_json) return false
    try {
      const ids = JSON.parse(row.source_result_ids_json) as unknown
      return Array.isArray(ids) && ids.includes(resultId)
    } catch {
      return false
    }
  })
}

function activeSafetyReportForIncident(db: DBAdapter, incidentId: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS found FROM task_report
      WHERE source_aggregate_type = 'SAFETY_INCIDENT'
        AND source_aggregate_id = ?
        AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')`
  ).get(incidentId) as { found: number } | undefined
  return Boolean(row)
}
