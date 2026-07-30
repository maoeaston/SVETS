import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import { writeEvent } from '../../../domain/event-writer'
import type {
  ConfirmSafetyIncidentParams,
  ReplaceSafetyIncidentParams,
  ResolveSafetyIncidentParams,
  VoidSafetyIncidentParams
} from '../../../../shared/types/safety-incident'
import type { AcceptedCommandContext, UserCommandRole } from '../../command/command-types'
import {
  confirmSafetyIncident as executeConfirmSafetyIncident,
  createSafetyReportAutomation,
  replaceSafetyIncidentForFactualCorrection as executeReplaceSafetyIncidentForFactualCorrection,
  resolveSafetyIncident as executeResolveSafetyIncident,
  voidSafetyIncident as executeVoidSafetyIncident,
  type SafetyReportAutomation
} from '../safety-service'

export {
  getSafetyIncident,
  listSafetyIncidents
} from '../../query/safety-query-service'
export { createSafetyReportAutomation }
export type { SafetyReportAutomation }

type SafetyCommandType =
  | 'safety:confirm'
  | 'safety:resolve'
  | 'safety:void'
  | 'safety:replaceForFactualCorrection'

type SafetyParams =
  | ConfirmSafetyIncidentParams
  | ResolveSafetyIncidentParams
  | VoidSafetyIncidentParams
  | ReplaceSafetyIncidentParams

export function acceptedSafetyTestContext(
  db: DBAdapter,
  commandType: SafetyCommandType,
  params: SafetyParams,
  correlationId = uuidv4()
): AcceptedCommandContext {
  const incident = db.prepare(
    `SELECT incident_id, student_id, job_code, task_code
       FROM safety_incident WHERE incident_id = ?`
  ).get(params.incidentId) as {
    incident_id: string
    student_id: string
    job_code: string
    task_code: string
  } | undefined
  return {
    envelope: {
      commandId: uuidv4(),
      commandType,
      source: 'IPC',
      actor: {
        kind: 'USER',
        userId: params.callerUserId,
        role: params.callerRole as UserCommandRole,
        authSessionId: 'safety-test-auth-session'
      },
      target: {
        aggregate_type: 'SAFETY_INCIDENT',
        incident_id: incident?.incident_id ?? params.incidentId,
        student_id: incident?.student_id ?? 'safety-test-student',
        job_code: incident?.job_code ?? 'safety-test-job',
        task_code: incident?.task_code ?? 'safety-test-task'
      },
      payload: {},
      requestHash: 'safety-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId
    },
    transport: {
      source: 'IPC',
      transportId: `safety-test:${uuidv4()}`
    }
  } as unknown as AcceptedCommandContext
}

function execution(
  db: DBAdapter,
  commandType: SafetyCommandType,
  params: SafetyParams,
  automation?: SafetyReportAutomation
) {
  return {
    eventPort: { writeEvent },
    context: acceptedSafetyTestContext(db, commandType, params),
    automation
  }
}

export function confirmSafetyIncident(
  db: DBAdapter,
  params: ConfirmSafetyIncidentParams,
  automation?: SafetyReportAutomation
) {
  return executeConfirmSafetyIncident(db, params, execution(db, 'safety:confirm', params, automation))
}

export function resolveSafetyIncident(
  db: DBAdapter,
  params: ResolveSafetyIncidentParams,
  automation?: SafetyReportAutomation
) {
  return executeResolveSafetyIncident(db, params, execution(db, 'safety:resolve', params, automation))
}

export function voidSafetyIncident(
  db: DBAdapter,
  params: VoidSafetyIncidentParams,
  automation?: SafetyReportAutomation
) {
  return executeVoidSafetyIncident(db, params, execution(db, 'safety:void', params, automation))
}

export function replaceSafetyIncidentForFactualCorrection(
  db: DBAdapter,
  params: ReplaceSafetyIncidentParams,
  automation?: SafetyReportAutomation
) {
  return executeReplaceSafetyIncidentForFactualCorrection(
    db,
    params,
    execution(db, 'safety:replaceForFactualCorrection', params, automation)
  )
}
