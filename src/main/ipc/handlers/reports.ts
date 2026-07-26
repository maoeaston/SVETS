import { dialog, ipcMain } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { getDatabase } from '../../db/connection'
import type { DBAdapter } from '../../db/interface'
import { getActionLogPath } from '../../domain/action-log-path'
import { ReportCommandCoordinator, ReportRecoveryRequiredError } from '../../domain/report-command-coordinator'
import { parseGenerateReportParams, parseReportContent, validateReportSourceResultIds } from '../../domain/report-contract'
import { ReportService, ReportServiceError } from '../../domain/report-service'
import { TaskClosureService, TaskClosureServiceError } from '../../domain/task-closure-service'
import { sha256CanonicalJson } from '../../domain/report-canonical'
import {
  completeReportHtmlExport,
  prepareReportHtmlExport,
  ReportExportError,
  type PreparedReportHtmlExport
} from '../../domain/report-export'
import { assertCaller } from '../../utils/auth-context'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import { buildReportPresentation } from '../../../shared/report-presentation'
import type {
  GenerateReportParams,
  ListReportsParams,
  ListReportsResult,
  GetReportParams,
  GetReportResult,
  ReportsResult,
  ReportErrorCode,
  ReportListItem,
  ReportLifecycleCapabilities,
  ReportLifecycleMetadata,
  ListReportGenerationCandidatesParams,
  ListReportGenerationCandidatesResult,
  ReportGenerationCandidate,
  ConfirmTaskClosureParams,
  ReplaceTaskClosureParams,
  TaskClosureMutationResult,
  TaskClosureView,
  ConfirmPlacementReviewParams,
  LockReportParams,
  ExportReportParams,
  ExportReportResult,
  ReportLifecycleMutationResult,
  ReportLifecycleStatus,
  ReportContractValidationStatus
} from '@shared/types/report'
import type {
  PlacementReviewConfirmedV2Payload,
  ReportLockedV2Payload
} from '@shared/types/event-payloads'
import type { ReportContentJson } from '@shared/types/json-schemas'

type ReportScope = 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
type ActiveReportStatus = Extract<ReportLifecycleStatus, 'GENERATED' | 'EXPORTED' | 'LOCKED'>

interface HandlerOptions {
  actionLogPath?: string
  now?: () => string
  showSaveDialog?: (request: ReportSaveDialogRequest) => Promise<ReportSaveDialogResult> | ReportSaveDialogResult
}

interface ReportSaveDialogRequest {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

interface ReportSaveDialogResult {
  canceled: boolean
  filePath?: string
}

interface ReportRow {
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

const REPORT_STATUSES: readonly ReportLifecycleStatus[] = ['GENERATED', 'EXPORTED', 'LOCKED', 'SUPERSEDED', 'ARCHIVED', 'FAILED']
const REPORT_TYPES = ['FULL_REPORT', 'SAFETY_TERMINATION_REPORT'] as const
const REPORT_SCOPES = ['BASE_ABILITY', 'JOB_SKILL', 'SAFETY'] as const

function nowIso(options?: HandlerOptions): string {
  return options?.now?.() ?? new Date().toISOString()
}

function coordinator(db: DBAdapter, options?: HandlerOptions): ReportCommandCoordinator {
  return new ReportCommandCoordinator({ db, actionLogPath: options?.actionLogPath ?? getActionLogPath() })
}

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

function reportRows(db: DBAdapter): ReportRow[] {
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

function parseStoredContent(row: ReportRow) {
  try {
    const parsedJson = JSON.parse(row.report_content_json) as unknown
    return parseReportContent(parsedJson)
  } catch {
    return { valid: false as const, errors: [{ code: 'TYPE' as const, path: '$' }] }
  }
}

function inferReportScope(row: ReportRow): ReportScope | null {
  const parsed = parseStoredContent(row)
  if (parsed.valid) return parsed.value.report_scope
  if (row.report_type === 'SAFETY_TERMINATION_REPORT') return 'SAFETY'
  if (row.report_schema_version?.startsWith('job-skill-report')) return 'JOB_SKILL'
  if (row.report_schema_version?.startsWith('task-report')) return 'BASE_ABILITY'
  return null
}

function reportPlacementEnabled(row: ReportRow): boolean {
  const parsed = parseStoredContent(row)
  return parsed.valid ? parsed.value.placement_advice.enabled : false
}

function lifecycleCapabilities(row: ReportRow): ReportLifecycleCapabilities {
  const placementAdviceEnabled = reportPlacementEnabled(row)
  const active = isActive(row.status)
  const valid = row.contract_validation_status === 'VALID' && parseStoredContent(row).valid
  const reviewed = !placementAdviceEnabled || (row.placement_review_by !== null && row.placement_review_at !== null)
  return {
    placementAdviceEnabled,
    canConfirmPlacementReview: active && valid && placementAdviceEnabled && row.placement_review_by === null && row.placement_review_at === null,
    canLock: (row.status === 'GENERATED' || row.status === 'EXPORTED') && valid && reviewed,
    canExport: active && valid && reviewed
  }
}

function isActive(status: ReportLifecycleStatus): status is ActiveReportStatus {
  return status === 'GENERATED' || status === 'EXPORTED' || status === 'LOCKED'
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

function latestReportLifecyclePayload(db: DBAdapter, reportId: string, eventType: 'REPORT_LOCKED' | 'REPORT_EXPORTED'): Record<string, unknown> | null {
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

function toListItem(row: ReportRow): ReportListItem {
  const scope = inferReportScope(row) ?? 'BASE_ABILITY'
  return {
    reportId: row.report_id,
    studentId: row.student_id,
    studentDisplayName: row.student_name ?? '',
    reportTitle: row.report_title,
    reportScope: scope,
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
  const row = reportRows(db).find((item) => item.report_id === params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }

  const parsed = parseStoredContent(row)
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
      lifecycle: sourceErrors.length > 0 ? { ...lifecycle(db, row), contractValidationStatus: 'REPAIR_REQUIRED' } : lifecycle(db, row)
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

export async function confirmTaskClosure(
  db: DBAdapter,
  params: ConfirmTaskClosureParams,
  options?: HandlerOptions
): Promise<ReportsResult<TaskClosureMutationResult>> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!Array.isArray(params.resultIds) || params.resultIds.length !== 3 || params.resultIds.some((id) => !isNonEmptyString(id))) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  try {
    const result = await new TaskClosureService(db, coordinator(db, options)).confirmBaseTaskClosure({
      callerUserId: params.callerUserId,
      callerRole: 'TEACHER',
      resultIds: params.resultIds
    })
    return { success: true, taskClosure: readTaskClosureView(db, result.taskClosureId) }
  } catch (error) {
    return mapError(error)
  }
}

export async function replaceTaskClosure(
  db: DBAdapter,
  params: ReplaceTaskClosureParams,
  options?: HandlerOptions
): Promise<ReportsResult<TaskClosureMutationResult>> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!isNonEmptyString(params.taskClosureId) || !Array.isArray(params.resultIds) || params.resultIds.length !== 3 || params.resultIds.some((id) => !isNonEmptyString(id)) || !isNonEmptyString(params.correctionReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  try {
    const result = await new TaskClosureService(db, coordinator(db, options)).replaceBaseTaskClosure({
      callerUserId: params.callerUserId,
      callerRole: 'TEACHER',
      oldTaskClosureId: params.taskClosureId,
      resultIds: params.resultIds,
      correctionReason: params.correctionReason
    })
    return { success: true, taskClosure: readTaskClosureView(db, result.taskClosureId) }
  } catch (error) {
    return mapError(error)
  }
}

export async function generateReport(
  db: DBAdapter,
  params: GenerateReportParams,
  options?: HandlerOptions
): Promise<ReportsResult<{ success: true; reportId: string; generated: boolean }>> {
  const parsed = parseGenerateReportParams(params)
  if (!parsed.valid) return { success: false, errorCode: 'VALIDATION_ERROR' }
  if (!requireTeacher(db, parsed.value.callerUserId, parsed.value.callerRole)) return forbidden()
  try {
    return await new ReportService(db, coordinator(db, options)).generateFromSharedParams(parsed.value)
  } catch (error) {
    return mapError(error)
  }
}

export async function confirmPlacementReview(
  db: DBAdapter,
  params: ConfirmPlacementReviewParams,
  options?: HandlerOptions
): Promise<ReportsResult<ReportLifecycleMutationResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  const parsed = parseStoredContent(row)
  if (!parsed.valid || row.contract_validation_status !== 'VALID') return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
  if (!parsed.value.placement_advice.enabled) return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  if (row.placement_review_by !== null || row.placement_review_at !== null) {
    return row.placement_review_by === teacherId
      ? { success: true, reportId: row.report_id, status: row.status }
      : { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  }
  if (!isActive(row.status)) return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }

  try {
    const result = await coordinator(db, options).runSingleEventCommand({
      key: reportKey(db, row),
      areas: ['TASK_REPORT'],
      buildIntent: () => {
        const current = getReportRow(db, row.report_id)
        if (!current) throw new Error('Report disappeared')
        if (current.placement_review_by !== null || current.placement_review_at !== null) return null
        const payload: PlacementReviewConfirmedV2Payload = {
          report_id: row.report_id,
          reviewed_by: teacherId,
          reviewed_at: nowIso(options),
          placement_advice_hash: sha256CanonicalJson(parsed.value.placement_advice)
        }
        return {
          aggregateType: 'TASK_REPORT',
          aggregateId: row.report_id,
          eventType: 'PLACEMENT_REVIEW_CONFIRMED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: teacherId,
          actorRole: 'TEACHER'
        }
      },
      mapResult: () => ({ success: true as const, reportId: row.report_id, status: getReportRow(db, row.report_id)?.status ?? row.status })
    })
    return result
  } catch (error) {
    return mapError(error)
  }
}

export async function lockReport(
  db: DBAdapter,
  params: LockReportParams,
  options?: HandlerOptions
): Promise<ReportsResult<ReportLifecycleMutationResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  if (row.status === 'LOCKED') return { success: true, reportId: row.report_id, status: 'LOCKED' }
  const parsed = parseStoredContent(row)
  if (!parsed.valid || row.contract_validation_status !== 'VALID' || !row.content_hash) return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
  if (row.status !== 'GENERATED' && row.status !== 'EXPORTED') return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  if (parsed.value.placement_advice.enabled && (!row.placement_review_by || !row.placement_review_at)) {
    return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  }

  try {
    return await coordinator(db, options).runSingleEventCommand({
      key: reportKey(db, row),
      areas: ['TASK_REPORT'],
      buildIntent: () => {
        const current = getReportRow(db, row.report_id)
        if (!current) throw new Error('Report disappeared')
        if (current.status === 'LOCKED') return null
        const payload: ReportLockedV2Payload = {
          report_id: row.report_id,
          locked_by: teacherId,
          locked_at: nowIso(options),
          lock_reason: params.lockReason ?? null,
          content_hash: row.content_hash!,
          status_before: current.status as 'GENERATED' | 'EXPORTED',
          status_after: 'LOCKED'
        }
        return {
          aggregateType: 'TASK_REPORT',
          aggregateId: row.report_id,
          eventType: 'REPORT_LOCKED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: teacherId,
          actorRole: 'TEACHER'
        }
      },
      mapResult: () => ({ success: true as const, reportId: row.report_id, status: 'LOCKED' as const })
    })
  } catch (error) {
    return mapError(error)
  }
}

export async function exportReport(
  db: DBAdapter,
  params: ExportReportParams,
  options?: HandlerOptions
): Promise<ReportsResult<ExportReportResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }

  try {
    const exportedAt = nowIso(options)
    const prepared = prepareReportHtmlExport(db, params.reportId, exportedAt)
    const saveResult = await showReportSaveDialog(prepared, options)
    if (saveResult.canceled || !isNonEmptyString(saveResult.filePath)) {
      return { success: true, canceled: true }
    }
    const result = await completeReportHtmlExport(db, coordinator(db, options), {
      prepared,
      targetPath: saveResult.filePath,
      exportedBy: teacherId,
      exportedAt
    })
    return { ...result, canceled: false }
  } catch (error) {
    return mapExportError(error)
  }
}

function getReportRow(db: DBAdapter, reportId: string): ReportRow | null {
  return reportRows(db).find((row) => row.report_id === reportId) ?? null
}

function parseStoredSourceResultIds(row: ReportRow, content: ReportContentJson) {
  try {
    return validateReportSourceResultIds(content, JSON.parse(row.source_result_ids_json ?? 'null') as unknown)
  } catch {
    return { valid: false as const, errors: [{ code: 'TYPE' as const, path: '$' }] }
  }
}

function reportKey(db: DBAdapter, row: ReportRow) {
  const parsed = parseStoredContent(row)
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
  const rows = reportRows(db).filter((row) => isActive(row.status))
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

function readTaskClosureView(db: DBAdapter, closureId: string): TaskClosureView {
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

function mapError(error: unknown): { success: false; errorCode: ReportErrorCode } {
  if (error instanceof ReportRecoveryRequiredError) return { success: false, errorCode: 'REPORT_GENERATION_FAILED' }
  if (error instanceof ReportServiceError) {
    if (error.code === 'FORBIDDEN') return forbidden()
    if (error.code === 'INVALID_INPUT') return { success: false, errorCode: 'VALIDATION_ERROR' }
    if (error.code === 'SOURCE_NOT_FOUND') return { success: false, errorCode: 'NOT_FOUND' }
    if (error.code === 'REPORT_CONTRACT_INVALID') return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
    return { success: false, errorCode: 'REPORT_GENERATION_FAILED' }
  }
  if (error instanceof TaskClosureServiceError) {
    if (error.code === 'FORBIDDEN') return forbidden()
    if (error.code === 'CLOSURE_NOT_FOUND') return { success: false, errorCode: 'NOT_FOUND' }
    if (error.code === 'RESULT_ALREADY_USED' || error.code === 'INVALID_REPLACEMENT' || error.code === 'REPLACEMENT_NOT_ALLOWED') {
      return { success: false, errorCode: 'TASK_CLOSURE_INVALID' }
    }
  }
  return { success: false, errorCode: 'REPORT_SYSTEM_ERROR' }
}

function mapExportError(error: unknown): { success: false; errorCode: ReportErrorCode } {
  if (error instanceof ReportRecoveryRequiredError) return { success: false, errorCode: 'REPORT_EXPORT_FAILED' }
  if (error instanceof ReportExportError) {
    if (error.code === 'NOT_FOUND') return { success: false, errorCode: 'NOT_FOUND' }
    if (error.code === 'VALIDATION_ERROR') return { success: false, errorCode: 'VALIDATION_ERROR' }
    if (error.code === 'REPORT_CONTRACT_INVALID') return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
    if (error.code === 'REPORT_STATE_CONFLICT') return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
    return { success: false, errorCode: 'REPORT_EXPORT_FAILED' }
  }
  return { success: false, errorCode: 'REPORT_EXPORT_FAILED' }
}

async function showReportSaveDialog(
  prepared: PreparedReportHtmlExport,
  options?: HandlerOptions
): Promise<ReportSaveDialogResult> {
  const request = {
    title: '导出脱敏 HTML 报告',
    defaultPath: prepared.suggestedFileName,
    filters: [{ name: 'HTML', extensions: ['html'] }]
  }
  if (options?.showSaveDialog) return options.showSaveDialog(request)
  const e2eExportDir = process.env['SVETS_E2E'] === '1' ? process.env['SVETS_REPORT_E2E_EXPORT_DIR'] : undefined
  if (e2eExportDir) {
    mkdirSync(e2eExportDir, { recursive: true })
    return { canceled: false, filePath: join(e2eExportDir, prepared.suggestedFileName) }
  }
  return dialog.showSaveDialog(request)
}

function defaultGetDb(): DBAdapter {
  return getDatabase() as unknown as DBAdapter
}

function trusted<T extends { callerUserId: string; callerRole: string }, R>(
  db: DBAdapter,
  senderId: number,
  params: T,
  run: (trustedParams: T) => R
): R | { success: false; errorCode: 'FORBIDDEN' } {
  const resolved = resolveTrustedAuthSessionCaller(db, senderId, params)
  if (!resolved.ok) return forbidden()
  return run(resolved.params)
}

export function registerReportsHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  ipcMain.handle('reports:list', (event, params: ListReportsParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => listReports(db, trustedParams))
  })
  ipcMain.handle('reports:get', (event, params: GetReportParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => getReport(db, trustedParams))
  })
  ipcMain.handle('reports:listGenerationCandidates', (event, params: ListReportGenerationCandidatesParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => listReportGenerationCandidates(db, trustedParams))
  })
  ipcMain.handle('reports:confirmTaskClosure', (event, params: ConfirmTaskClosureParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => confirmTaskClosure(db, trustedParams))
  })
  ipcMain.handle('reports:replaceTaskClosure', (event, params: ReplaceTaskClosureParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => replaceTaskClosure(db, trustedParams))
  })
  ipcMain.handle('reports:generate', (event, params: GenerateReportParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => generateReport(db, trustedParams))
  })
  ipcMain.handle('reports:confirmPlacementReview', (event, params: ConfirmPlacementReviewParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => confirmPlacementReview(db, trustedParams))
  })
  ipcMain.handle('reports:lock', (event, params: LockReportParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => lockReport(db, trustedParams))
  })
  ipcMain.handle('reports:export', (event, params: ExportReportParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => exportReport(db, trustedParams))
  })
}
