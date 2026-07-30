import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import { readBaseTaskResultBinding } from '../../../domain/report-source-reader'
import { resolveReportSourceKey } from '../../../domain/report-service'
import type { AcceptedCommandContext, UserCommandRole } from '../../command/command-types'
import {
  getReport,
  getReportRow,
  listReportGenerationCandidates,
  listReports,
  readTaskClosureBusinessKey,
  reportCommandKeyForRow
} from '../../query/reports-query-service'
import {
  confirmPlacementReview as executeConfirmPlacementReview,
  confirmTaskClosure as executeConfirmTaskClosure,
  exportReport as executeExportReport,
  generateReport as executeGenerateReport,
  lockReport as executeLockReport,
  replaceTaskClosure as executeReplaceTaskClosure,
  type ReportMutationExecution
} from '../reports-service'
import type {
  ConfirmPlacementReviewParams,
  ConfirmTaskClosureParams,
  ExportReportParams,
  GenerateReportParams,
  LockReportParams,
  ReplaceTaskClosureParams
} from '../../../../shared/types/report'

export { getReport, listReportGenerationCandidates, listReports }

type ReportCommandType =
  | 'reports:confirmPlacementReview'
  | 'reports:confirmTaskClosure'
  | 'reports:export'
  | 'reports:generate'
  | 'reports:lock'
  | 'reports:replaceTaskClosure'

type ReportParams =
  | ConfirmPlacementReviewParams
  | ConfirmTaskClosureParams
  | ExportReportParams
  | GenerateReportParams
  | LockReportParams
  | ReplaceTaskClosureParams

type TestExecution = Omit<ReportMutationExecution, 'context'>

function acceptedTarget(
  db: DBAdapter,
  commandType: ReportCommandType,
  params: ReportParams
): Record<string, unknown> {
  if (commandType === 'reports:confirmTaskClosure') {
    try {
      const binding = readBaseTaskResultBinding(db, (params as ConfirmTaskClosureParams).resultIds)
      return {
        aggregate_type: 'TASK_CLOSURE',
        student_id: binding.studentId,
        job_code: binding.jobCode,
        task_code: binding.taskCode,
        source_result_ids: binding.sourceResultIds
      }
    } catch {
      return {
        aggregate_type: 'TASK_CLOSURE',
        student_id: 'report-test-student',
        job_code: 'report-test-job',
        task_code: 'report-test-task',
        source_result_ids: (params as ConfirmTaskClosureParams).resultIds
      }
    }
  }
  if (commandType === 'reports:replaceTaskClosure') {
    const replacement = params as ReplaceTaskClosureParams
    const closure = readTaskClosureBusinessKey(db, replacement.taskClosureId)
    return {
      aggregate_type: 'TASK_CLOSURE',
      task_closure_id: closure?.task_closure_id ?? replacement.taskClosureId,
      student_id: closure?.student_id ?? 'report-test-student',
      job_code: closure?.job_code ?? 'report-test-job',
      task_code: closure?.task_code ?? 'report-test-task',
      source_result_ids: replacement.resultIds
    }
  }
  if (commandType === 'reports:generate') {
    const generation = params as GenerateReportParams
    try {
      const source = resolveReportSourceKey(db, generation)
      return {
        aggregate_type: 'TASK_REPORT',
        report_scope: source.scope,
        source_id: generation.reportScope === 'BASE_ABILITY'
          ? generation.taskClosureId
          : generation.reportScope === 'JOB_SKILL'
            ? generation.resultId
            : generation.incidentId,
        student_id: source.studentId,
        job_code: source.jobCode,
        task_code: source.taskCode
      }
    } catch {
      return {
        aggregate_type: 'TASK_REPORT',
        report_scope: generation.reportScope,
        source_id: 'report-test-source',
        student_id: 'report-test-student',
        job_code: 'report-test-job',
        task_code: 'report-test-task'
      }
    }
  }
  const reportId = (params as ConfirmPlacementReviewParams | ExportReportParams | LockReportParams).reportId
  const row = getReportRow(db, reportId)
  if (row) {
    const key = reportCommandKeyForRow(db, row)
    return {
      aggregate_type: 'TASK_REPORT',
      report_id: row.report_id,
      student_id: row.student_id,
      job_code: key.jobCode,
      task_code: key.taskCode
    }
  }
  return {
    aggregate_type: 'TASK_REPORT',
    report_id: reportId,
    student_id: 'report-test-student',
    job_code: 'report-test-job',
    task_code: 'report-test-task'
  }
}

export function acceptedReportsTestContext(
  db: DBAdapter,
  commandType: ReportCommandType,
  params: ReportParams,
  correlationId = uuidv4()
): AcceptedCommandContext {
  return {
    envelope: {
      commandId: uuidv4(),
      commandType,
      source: 'IPC',
      actor: {
        kind: 'USER',
        userId: params.callerUserId,
        role: params.callerRole as UserCommandRole,
        authSessionId: 'reports-test-auth-session'
      },
      target: acceptedTarget(db, commandType, params),
      payload: {},
      requestHash: 'reports-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId
    },
    transport: {
      source: 'IPC',
      transportId: `reports-test:${uuidv4()}`
    }
  } as unknown as AcceptedCommandContext
}

function execution(
  db: DBAdapter,
  commandType: ReportCommandType,
  params: ReportParams,
  options: TestExecution
): ReportMutationExecution {
  return {
    ...options,
    context: acceptedReportsTestContext(db, commandType, params)
  }
}

export function confirmTaskClosure(
  db: DBAdapter,
  params: ConfirmTaskClosureParams,
  options: TestExecution
) {
  return executeConfirmTaskClosure(db, params, execution(db, 'reports:confirmTaskClosure', params, options))
}

export function replaceTaskClosure(
  db: DBAdapter,
  params: ReplaceTaskClosureParams,
  options: TestExecution
) {
  return executeReplaceTaskClosure(db, params, execution(db, 'reports:replaceTaskClosure', params, options))
}

export function generateReport(
  db: DBAdapter,
  params: GenerateReportParams,
  options: TestExecution
) {
  return executeGenerateReport(db, params, execution(db, 'reports:generate', params, options))
}

export function confirmPlacementReview(
  db: DBAdapter,
  params: ConfirmPlacementReviewParams,
  options: TestExecution
) {
  return executeConfirmPlacementReview(db, params, execution(db, 'reports:confirmPlacementReview', params, options))
}

export function lockReport(
  db: DBAdapter,
  params: LockReportParams,
  options: TestExecution
) {
  return executeLockReport(db, params, execution(db, 'reports:lock', params, options))
}

export function exportReport(
  db: DBAdapter,
  params: ExportReportParams,
  options: TestExecution
) {
  return executeExportReport(db, params, execution(db, 'reports:export', params, options))
}
