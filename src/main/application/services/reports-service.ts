import { mkdirSync } from 'fs'
import { join } from 'path'
import type { DBAdapter } from '../../db/interface'
import {
  ReportRecoveryRequiredError,
  type ReportCommandCoordinator
} from '../../domain/report-command-coordinator'
import { sha256CanonicalJson } from '../../domain/report-canonical'
import { parseGenerateReportParams } from '../../domain/report-contract'
import {
  completeReportHtmlExport,
  prepareReportHtmlExport,
  ReportExportError,
  type PreparedReportHtmlExport,
  type ReportExportFilePort
} from '../../domain/report-export'
import {
  ReportService,
  ReportServiceError,
  resolveReportSourceKey
} from '../../domain/report-service'
import { readBaseTaskResultBinding } from '../../domain/report-source-reader'
import { TaskClosureService, TaskClosureServiceError } from '../../domain/task-closure-service'
import { assertCaller } from '../../utils/auth-context'
import type { AcceptedCommandContext } from '../command/command-types'
import {
  getReportRow,
  isActiveReport,
  parseStoredReportContent,
  readTaskClosureBusinessKey,
  readTaskClosureView,
  reportCommandKeyForRow,
  type ReportRow
} from '../query/reports-query-service'
import type {
  PlacementReviewConfirmedV2Payload,
  ReportLockedV2Payload
} from '../../../shared/types/event-payloads'
import type {
  ConfirmPlacementReviewParams,
  ConfirmTaskClosureParams,
  ExportReportParams,
  ExportReportResult,
  GenerateReportParams,
  LockReportParams,
  ReplaceTaskClosureParams,
  ReportErrorCode,
  ReportLifecycleMutationResult,
  ReportsResult,
  TaskClosureMutationResult
} from '../../../shared/types/report'

type ReportMutationCommand =
  | 'reports:confirmPlacementReview'
  | 'reports:confirmTaskClosure'
  | 'reports:export'
  | 'reports:generate'
  | 'reports:lock'
  | 'reports:replaceTaskClosure'

export interface ReportSaveDialogRequest {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
}

export interface ReportSaveDialogResult {
  canceled: boolean
  filePath?: string
}

export interface ReportsApplicationDependencies {
  readonly now?: () => string
  readonly showSaveDialog?: (
    request: ReportSaveDialogRequest
  ) => Promise<ReportSaveDialogResult> | ReportSaveDialogResult
  readonly exportFilePort?: ReportExportFilePort
}

export interface ReportMutationExecution extends ReportsApplicationDependencies {
  readonly coordinator: ReportCommandCoordinator
  readonly context: AcceptedCommandContext
}

export interface ReportsApplicationService {
  readonly coordinator: ReportCommandCoordinator
  confirmTaskClosure(
    params: ConfirmTaskClosureParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<TaskClosureMutationResult>>
  replaceTaskClosure(
    params: ReplaceTaskClosureParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<TaskClosureMutationResult>>
  generateReport(
    params: GenerateReportParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<{ success: true; reportId: string; generated: boolean }>>
  confirmPlacementReview(
    params: ConfirmPlacementReviewParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<ReportLifecycleMutationResult>>
  lockReport(
    params: LockReportParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<ReportLifecycleMutationResult>>
  exportReport(
    params: ExportReportParams,
    context: AcceptedCommandContext
  ): Promise<ReportsResult<ExportReportResult>>
}

function nowIso(execution: ReportsApplicationDependencies): string {
  return execution.now?.() ?? new Date().toISOString()
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

function correlationFor(
  execution: ReportMutationExecution,
  commandType: ReportMutationCommand,
  params: { callerUserId: string; callerRole: string }
): string {
  const { envelope } = execution.context
  if (envelope.commandType !== commandType) {
    throw new Error(`report mutation requires accepted ${commandType} context`)
  }
  if (!envelope.correlationId.trim()) throw new Error('report mutation correlation must be non-empty')
  const actor = envelope.actor
  if (
    actor.kind !== 'USER'
    || actor.userId !== params.callerUserId
    || actor.role !== params.callerRole
  ) {
    throw new Error('report mutation actor must match accepted context')
  }
  return envelope.correlationId
}

function assertAcceptedTarget<T extends object>(
  execution: ReportMutationExecution,
  expected: Readonly<T>
): void {
  const target = execution.context.envelope.target
  for (const [field, value] of Object.entries(expected)) {
    if (JSON.stringify(target[field]) !== JSON.stringify(value)) {
      throw new Error(`report mutation target mismatch: ${field}`)
    }
  }
}

function assertExistingReportTarget(
  db: DBAdapter,
  row: ReportRow,
  execution: ReportMutationExecution
): void {
  const key = reportCommandKeyForRow(db, row)
  assertAcceptedTarget(execution, {
    aggregate_type: 'TASK_REPORT',
    report_id: row.report_id,
    student_id: row.student_id,
    ...(key.jobCode ? { job_code: key.jobCode } : {}),
    ...(key.taskCode ? { task_code: key.taskCode } : {})
  })
}

export async function confirmTaskClosure(
  db: DBAdapter,
  params: ConfirmTaskClosureParams,
  execution: ReportMutationExecution
): Promise<ReportsResult<TaskClosureMutationResult>> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!Array.isArray(params.resultIds) || params.resultIds.length !== 3 || params.resultIds.some((id) => !isNonEmptyString(id))) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const correlationId = correlationFor(execution, 'reports:confirmTaskClosure', params)
  try {
    const binding = readBaseTaskResultBinding(db, params.resultIds)
    assertAcceptedTarget(execution, {
      aggregate_type: 'TASK_CLOSURE',
      student_id: binding.studentId,
      job_code: binding.jobCode,
      task_code: binding.taskCode,
      source_result_ids: binding.sourceResultIds
    })
    const result = await new TaskClosureService(db, execution.coordinator).confirmBaseTaskClosure({
      callerUserId: params.callerUserId,
      callerRole: 'TEACHER',
      resultIds: params.resultIds,
      correlationId
    })
    return { success: true, taskClosure: readTaskClosureView(db, result.taskClosureId) }
  } catch (error) {
    return mapError(error)
  }
}

export async function replaceTaskClosure(
  db: DBAdapter,
  params: ReplaceTaskClosureParams,
  execution: ReportMutationExecution
): Promise<ReportsResult<TaskClosureMutationResult>> {
  if (!requireTeacher(db, params.callerUserId, params.callerRole)) return forbidden()
  if (!isNonEmptyString(params.taskClosureId) || !Array.isArray(params.resultIds) || params.resultIds.length !== 3 || params.resultIds.some((id) => !isNonEmptyString(id)) || !isNonEmptyString(params.correctionReason)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const correlationId = correlationFor(execution, 'reports:replaceTaskClosure', params)
  try {
    const closure = readTaskClosureBusinessKey(db, params.taskClosureId)
    if (!closure) return { success: false, errorCode: 'NOT_FOUND' }
    assertAcceptedTarget(execution, {
      aggregate_type: 'TASK_CLOSURE',
      task_closure_id: closure.task_closure_id,
      student_id: closure.student_id,
      job_code: closure.job_code,
      task_code: closure.task_code,
      source_result_ids: params.resultIds
    })
    const result = await new TaskClosureService(db, execution.coordinator).replaceBaseTaskClosure({
      callerUserId: params.callerUserId,
      callerRole: 'TEACHER',
      oldTaskClosureId: params.taskClosureId,
      resultIds: params.resultIds,
      correctionReason: params.correctionReason,
      correlationId
    })
    return { success: true, taskClosure: readTaskClosureView(db, result.taskClosureId) }
  } catch (error) {
    return mapError(error)
  }
}

export async function generateReport(
  db: DBAdapter,
  params: GenerateReportParams,
  execution: ReportMutationExecution
): Promise<ReportsResult<{ success: true; reportId: string; generated: boolean }>> {
  const parsed = parseGenerateReportParams(params)
  if (!parsed.valid) return { success: false, errorCode: 'VALIDATION_ERROR' }
  if (!requireTeacher(db, parsed.value.callerUserId, parsed.value.callerRole)) return forbidden()
  const correlationId = correlationFor(execution, 'reports:generate', parsed.value)
  try {
    const sourceKey = resolveReportSourceKey(db, parsed.value)
    const sourceId = parsed.value.reportScope === 'BASE_ABILITY'
      ? parsed.value.taskClosureId
      : parsed.value.reportScope === 'JOB_SKILL'
        ? parsed.value.resultId
        : parsed.value.incidentId
    assertAcceptedTarget(execution, {
      aggregate_type: 'TASK_REPORT',
      report_scope: sourceKey.scope,
      source_id: sourceId,
      student_id: sourceKey.studentId,
      job_code: sourceKey.jobCode,
      task_code: sourceKey.taskCode
    })
    return await new ReportService(db, execution.coordinator).generateFromSharedParams(
      parsed.value,
      correlationId
    )
  } catch (error) {
    return mapError(error)
  }
}

export async function confirmPlacementReview(
  db: DBAdapter,
  params: ConfirmPlacementReviewParams,
  execution: ReportMutationExecution
): Promise<ReportsResult<ReportLifecycleMutationResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  const correlationId = correlationFor(execution, 'reports:confirmPlacementReview', params)
  assertExistingReportTarget(db, row, execution)
  const parsed = parseStoredReportContent(row)
  if (!parsed.valid || row.contract_validation_status !== 'VALID') return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
  if (!parsed.value.placement_advice.enabled) return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  if (row.placement_review_by !== null || row.placement_review_at !== null) {
    return row.placement_review_by === teacherId
      ? { success: true, reportId: row.report_id, status: row.status }
      : { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  }
  if (!isActiveReport(row.status)) return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }

  try {
    return await execution.coordinator.runSingleEventCommand({
      key: reportCommandKeyForRow(db, row),
      areas: ['TASK_REPORT'],
      buildIntent: () => {
        const current = getReportRow(db, row.report_id)
        if (!current) throw new Error('Report disappeared')
        if (current.placement_review_by !== null || current.placement_review_at !== null) return null
        const payload: PlacementReviewConfirmedV2Payload = {
          report_id: row.report_id,
          reviewed_by: teacherId,
          reviewed_at: nowIso(execution),
          placement_advice_hash: sha256CanonicalJson(parsed.value.placement_advice)
        }
        return {
          aggregateType: 'TASK_REPORT',
          aggregateId: row.report_id,
          eventType: 'PLACEMENT_REVIEW_CONFIRMED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: teacherId,
          actorRole: 'TEACHER',
          correlationId
        }
      },
      mapResult: () => ({
        success: true as const,
        reportId: row.report_id,
        status: getReportRow(db, row.report_id)?.status ?? row.status
      })
    })
  } catch (error) {
    return mapError(error)
  }
}

export async function lockReport(
  db: DBAdapter,
  params: LockReportParams,
  execution: ReportMutationExecution
): Promise<ReportsResult<ReportLifecycleMutationResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  const correlationId = correlationFor(execution, 'reports:lock', params)
  assertExistingReportTarget(db, row, execution)
  if (row.status === 'LOCKED') return { success: true, reportId: row.report_id, status: 'LOCKED' }
  const parsed = parseStoredReportContent(row)
  if (!parsed.valid || row.contract_validation_status !== 'VALID' || !row.content_hash) return { success: false, errorCode: 'REPORT_CONTRACT_INVALID' }
  if (row.status !== 'GENERATED' && row.status !== 'EXPORTED') return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  if (parsed.value.placement_advice.enabled && (!row.placement_review_by || !row.placement_review_at)) {
    return { success: false, errorCode: 'REPORT_STATE_CONFLICT' }
  }

  try {
    return await execution.coordinator.runSingleEventCommand({
      key: reportCommandKeyForRow(db, row),
      areas: ['TASK_REPORT'],
      buildIntent: () => {
        const current = getReportRow(db, row.report_id)
        if (!current) throw new Error('Report disappeared')
        if (current.status === 'LOCKED') return null
        const payload: ReportLockedV2Payload = {
          report_id: row.report_id,
          locked_by: teacherId,
          locked_at: nowIso(execution),
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
          actorRole: 'TEACHER',
          correlationId
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
  execution: ReportMutationExecution
): Promise<ReportsResult<ExportReportResult>> {
  const teacherId = requireTeacher(db, params.callerUserId, params.callerRole)
  if (!teacherId) return forbidden()
  if (!isNonEmptyString(params.reportId)) return { success: false, errorCode: 'VALIDATION_ERROR' }
  const row = getReportRow(db, params.reportId)
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }
  const correlationId = correlationFor(execution, 'reports:export', params)
  assertExistingReportTarget(db, row, execution)

  try {
    const exportedAt = nowIso(execution)
    const prepared = prepareReportHtmlExport(db, params.reportId, exportedAt)
    const saveResult = await showReportSaveDialog(prepared, execution)
    if (saveResult.canceled || !isNonEmptyString(saveResult.filePath)) {
      return { success: true, canceled: true }
    }
    const result = await completeReportHtmlExport(db, execution.coordinator, {
      prepared,
      targetPath: saveResult.filePath,
      exportedBy: teacherId,
      exportedAt,
      correlationId
    }, execution.exportFilePort)
    return { ...result, canceled: false }
  } catch (error) {
    return mapExportError(error)
  }
}

export function createReportsApplicationService(
  db: DBAdapter,
  coordinator: ReportCommandCoordinator,
  dependencies: ReportsApplicationDependencies = {}
): ReportsApplicationService {
  const execution = (context: AcceptedCommandContext): ReportMutationExecution => ({
    ...dependencies,
    coordinator,
    context
  })
  return Object.freeze({
    coordinator,
    confirmTaskClosure: (params, context) => confirmTaskClosure(db, params, execution(context)),
    replaceTaskClosure: (params, context) => replaceTaskClosure(db, params, execution(context)),
    generateReport: (params, context) => generateReport(db, params, execution(context)),
    confirmPlacementReview: (params, context) => confirmPlacementReview(db, params, execution(context)),
    lockReport: (params, context) => lockReport(db, params, execution(context)),
    exportReport: (params, context) => exportReport(db, params, execution(context))
  })
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
  execution: ReportsApplicationDependencies
): Promise<ReportSaveDialogResult> {
  const request: ReportSaveDialogRequest = {
    title: '导出脱敏 HTML 报告',
    defaultPath: prepared.suggestedFileName,
    filters: [{ name: 'HTML', extensions: ['html'] }]
  }
  const e2eExportDir = process.env['SVETS_E2E'] === '1' ? process.env['SVETS_REPORT_E2E_EXPORT_DIR'] : undefined
  if (e2eExportDir) {
    mkdirSync(e2eExportDir, { recursive: true })
    return { canceled: false, filePath: join(e2eExportDir, prepared.suggestedFileName) }
  }
  if (!execution.showSaveDialog) {
    throw new ReportExportError('REPORT_EXPORT_FAILED', 'Report save dialog is unavailable')
  }
  return execution.showSaveDialog(request)
}
