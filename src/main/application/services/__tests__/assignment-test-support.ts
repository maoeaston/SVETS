import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../../db/interface'
import { writeEvent } from '../../../domain/event-writer'
import type {
  ConfirmStudentAssignmentParams,
  CreateAssignmentParams,
  RebindAssignmentParams,
  ReleaseAssignmentParams,
  StartAssignedAssessmentParams
} from '../../../../shared/types/assignment'
import type { AcceptedCommandContext, UserCommandRole } from '../../command/command-types'
import {
  confirmStudentAssignment as executeConfirmStudentAssignment,
  createAssignment as executeCreateAssignment,
  rebindAssignment as executeRebindAssignment,
  releaseAssignment as executeReleaseAssignment,
  startAssignedAssessment as executeStartAssignedAssessment
} from '../assignment-service'

type AssignmentCommandType =
  | 'assignment:create'
  | 'assignment:confirmStudent'
  | 'assignment:startAssessment'
  | 'assignment:rebind'
  | 'assignment:release'

type AssignmentParams =
  | CreateAssignmentParams
  | ConfirmStudentAssignmentParams
  | StartAssignedAssessmentParams
  | RebindAssignmentParams
  | ReleaseAssignmentParams

function acceptedTarget(
  db: DBAdapter,
  commandType: AssignmentCommandType,
  params: AssignmentParams
): Record<string, string> {
  if (commandType === 'assignment:create') {
    const businessSessionId = (params as CreateAssignmentParams).businessSessionId
    const row = db.prepare(
      `SELECT business_session_id, student_id, job_code, task_code
         FROM business_session WHERE business_session_id = ?`
    ).get(businessSessionId) as {
      business_session_id: string
      student_id: string
      job_code: string
      task_code: string
    } | undefined
    return {
      aggregate_type: 'BUSINESS_SESSION',
      business_session_id: row?.business_session_id ?? businessSessionId,
      student_id: row?.student_id ?? 'assignment-test-student',
      job_code: row?.job_code ?? 'assignment-test-job',
      task_code: row?.task_code ?? 'assignment-test-task'
    }
  }

  const assignmentId = (params as Exclude<AssignmentParams, CreateAssignmentParams>).assignmentId
  const row = db.prepare(
    `SELECT bsa.assignment_id, bs.business_session_id,
            bs.student_id, bs.job_code, bs.task_code
       FROM business_session_assignment bsa
       JOIN business_session bs ON bs.business_session_id = bsa.business_session_id
      WHERE bsa.assignment_id = ?`
  ).get(assignmentId) as {
    assignment_id: string
    business_session_id: string
    student_id: string
    job_code: string
    task_code: string
  } | undefined
  return {
    aggregate_type: 'BUSINESS_SESSION_ASSIGNMENT',
    assignment_id: row?.assignment_id ?? assignmentId,
    business_session_id: row?.business_session_id ?? 'assignment-test-business-session',
    student_id: row?.student_id ?? 'assignment-test-student',
    job_code: row?.job_code ?? 'assignment-test-job',
    task_code: row?.task_code ?? 'assignment-test-task'
  }
}

export function acceptedAssignmentTestContext(
  db: DBAdapter,
  commandType: AssignmentCommandType,
  params: AssignmentParams,
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
        authSessionId: 'assignment-test-auth-session'
      },
      target: acceptedTarget(db, commandType, params),
      payload: {},
      requestHash: 'assignment-test-request-hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      correlationId
    },
    transport: {
      source: 'IPC',
      transportId: `assignment-test:${uuidv4()}`
    }
  } as unknown as AcceptedCommandContext
}

function execution(db: DBAdapter, commandType: AssignmentCommandType, params: AssignmentParams) {
  return {
    eventPort: { writeEvent },
    context: acceptedAssignmentTestContext(db, commandType, params)
  }
}

export function createAssignment(db: DBAdapter, params: CreateAssignmentParams) {
  return executeCreateAssignment(db, params, execution(db, 'assignment:create', params))
}

export function confirmStudentAssignment(db: DBAdapter, params: ConfirmStudentAssignmentParams) {
  return executeConfirmStudentAssignment(db, params, execution(db, 'assignment:confirmStudent', params))
}

export function startAssignedAssessment(db: DBAdapter, params: StartAssignedAssessmentParams) {
  return executeStartAssignedAssessment(db, params, execution(db, 'assignment:startAssessment', params))
}

export function rebindAssignment(db: DBAdapter, params: RebindAssignmentParams) {
  return executeRebindAssignment(db, params, execution(db, 'assignment:rebind', params))
}

export function releaseAssignment(db: DBAdapter, params: ReleaseAssignmentParams) {
  return executeReleaseAssignment(db, params, execution(db, 'assignment:release', params))
}
