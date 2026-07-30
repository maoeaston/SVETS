import type { DBAdapter } from '../../db/interface'
import { getDatabase } from '../../db/connection'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import type { AcceptedCommandContext } from '../../application/command/command-types'
import {
  confirmStudentAssignment,
  createAssignment,
  rebindAssignment,
  releaseAssignment,
  startAssignedAssessment,
  type AssignmentMutationExecution
} from '../../application/services/assignment-service'
import { resolveTrustedAuthSessionCaller } from '../../utils/auth-session'
import type {
  ConfirmStudentAssignmentParams,
  CreateAssignmentParams,
  RebindAssignmentParams,
  ReleaseAssignmentParams,
  StartAssignedAssessmentParams
} from '../../../shared/types/assignment'
import type { LegacyIpcHandlerRegistrar } from '../legacy-handler-collector'

export {
  confirmStudentAssignment,
  createAssignment,
  rebindAssignment,
  releaseAssignment,
  startAssignedAssessment
} from '../../application/services/assignment-service'

export interface AssignmentHandlerRegistrationOptions {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly getDb?: () => DBAdapter
}

function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

function mutationExecution(
  eventPort: Pick<ReportMutationPort, 'writeEvent'>,
  context: AcceptedCommandContext | undefined
): AssignmentMutationExecution {
  if (!context) throw new Error('assignment mutation requires accepted command context')
  return { eventPort, context }
}

export function registerAssignmentHandlers(
  registrar: LegacyIpcHandlerRegistrar,
  options: AssignmentHandlerRegistrationOptions
): void {
  const getDb = options.getDb ?? defaultGetDb

  registrar.handle('assignment:create', (
    event,
    params: CreateAssignmentParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return createAssignment(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assignment:confirmStudent', (
    event,
    params: ConfirmStudentAssignmentParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return confirmStudentAssignment(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assignment:startAssessment', (
    event,
    params: StartAssignedAssessmentParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return startAssignedAssessment(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assignment:rebind', (
    event,
    params: RebindAssignmentParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return rebindAssignment(db, trusted.params, mutationExecution(options.eventPort, context))
  })

  registrar.handle('assignment:release', (
    event,
    params: ReleaseAssignmentParams,
    context?: AcceptedCommandContext
  ) => {
    const db = getDb()
    const trusted = resolveTrustedAuthSessionCaller(db, event.sender.id, params)
    if (!trusted.ok) return { success: false as const, errorCode: 'FORBIDDEN' as const }
    return releaseAssignment(db, trusted.params, mutationExecution(options.eventPort, context))
  })
}
