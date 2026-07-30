import { dialog } from 'electron'
import { getDatabase } from '../../db/connection'
import type { DBAdapter } from '../../db/interface'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import type { ReportCommandCoordinator } from '../../domain/report-command-coordinator'
import {
  createReportsApplicationService,
  type ReportSaveDialogRequest,
  type ReportsApplicationDependencies,
  type ReportsApplicationService
} from '../../application/services/reports-service'
import {
  getReport,
  listReportGenerationCandidates,
  listReports
} from '../../application/query/reports-query-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  ConfirmPlacementReviewParams,
  ConfirmTaskClosureParams,
  ExportReportParams,
  GenerateReportParams,
  GetReportParams,
  ListReportGenerationCandidatesParams,
  ListReportsParams,
  LockReportParams,
  ReplaceTaskClosureParams
} from '../../../shared/types/report'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  confirmPlacementReview,
  confirmTaskClosure,
  createReportsApplicationService,
  exportReport,
  generateReport,
  lockReport,
  replaceTaskClosure
} from '../../application/services/reports-service'
export type {
  ReportMutationExecution,
  ReportSaveDialogRequest,
  ReportSaveDialogResult,
  ReportsApplicationDependencies,
  ReportsApplicationService
} from '../../application/services/reports-service'
export {
  getReport,
  listReportGenerationCandidates,
  listReports
} from '../../application/query/reports-query-service'

export interface ReportsHandlerRegistrationOptions extends ReportsApplicationDependencies {
  readonly coordinator: ReportCommandCoordinator
  readonly getDb?: () => DBAdapter
  readonly applicationService?: ReportsApplicationService
}

function defaultGetDb(): DBAdapter {
  return getDatabase() as unknown as DBAdapter
}

function forbidden(): { success: false; errorCode: 'FORBIDDEN' } {
  return { success: false, errorCode: 'FORBIDDEN' }
}

function requireAcceptedContext(context: AcceptedCommandContext | undefined): AcceptedCommandContext {
  if (!context) throw new Error('report mutation requires accepted command context')
  return context
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

export function registerReportsHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: ReportsHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb
  const application = options.applicationService ?? createReportsApplicationService(
    getDb(),
    options.coordinator,
    {
      now: options.now,
      exportFilePort: options.exportFilePort,
      showSaveDialog: options.showSaveDialog ?? ((request: ReportSaveDialogRequest) =>
        dialog.showSaveDialog(request))
    }
  )

  registrar.handle('reports:list', (event, params: ListReportsParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => listReports(db, trustedParams))
  })
  registrar.handle('reports:get', (event, params: GetReportParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => getReport(db, trustedParams))
  })
  registrar.handle('reports:listGenerationCandidates', (event, params: ListReportGenerationCandidatesParams) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) => listReportGenerationCandidates(db, trustedParams))
  })
  registrar.handle('reports:confirmTaskClosure', (
    event,
    params: ConfirmTaskClosureParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.confirmTaskClosure(trustedParams, requireAcceptedContext(context)))
  })
  registrar.handle('reports:replaceTaskClosure', (
    event,
    params: ReplaceTaskClosureParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.replaceTaskClosure(trustedParams, requireAcceptedContext(context)))
  })
  registrar.handle('reports:generate', (
    event,
    params: GenerateReportParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.generateReport(trustedParams, requireAcceptedContext(context)))
  })
  registrar.handle('reports:confirmPlacementReview', (
    event,
    params: ConfirmPlacementReviewParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.confirmPlacementReview(trustedParams, requireAcceptedContext(context)))
  })
  registrar.handle('reports:lock', (
    event,
    params: LockReportParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.lockReport(trustedParams, requireAcceptedContext(context)))
  })
  registrar.handle('reports:export', (
    event,
    params: ExportReportParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    return trusted(db, event.sender.id, params, (trustedParams) =>
      application.exportReport(trustedParams, requireAcceptedContext(context)))
  })
}
