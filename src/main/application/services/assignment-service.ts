// M3 Grant/Assignment application service。
//
// 所有写路径遵守：accepted command -> injected event port -> reducer 投影。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertStudent, assertSessionOwner } from '../../utils/auth-context'
import { ensureLocalRuntimeContext } from '../../domain/local-runtime-context'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import { applyAssignmentEvent } from '../../domain/assignment-reducer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import type { AcceptedCommandContext } from '../command/command-types'
import type {
  AssignmentAssessmentStartedPayload,
  AssignmentCreatedPayload,
  AssignmentReleasedPayload,
  AssignmentStudentConfirmedPayload,
  GrantReboundPayload
} from '@shared/types/event-payloads'
import type {
  AssignmentActorRole,
  AssignmentCapability,
  AssignmentDeliveryPhase,
  AssignmentErrorCode,
  AssignmentGrantTerminalStatus,
  AssignmentReleaseReason,
  BusinessSessionAssignmentStatus,
  ConfirmStudentAssignmentParams,
  ConfirmStudentAssignmentResult,
  ConfirmStudentAssignmentSuccess,
  CreateAssignmentParams,
  CreateAssignmentResult,
  CreateAssignmentSuccess,
  RebindAssignmentParams,
  RebindAssignmentResult,
  RebindAssignmentSuccess,
  ReleaseAssignmentParams,
  ReleaseAssignmentResult,
  ReleaseAssignmentSuccess,
  StartAssignedAssessmentParams,
  StartAssignedAssessmentResult,
  StartAssignedAssessmentSuccess,
  SupportedAssignmentConfirmationMethod
} from '@shared/types/assignment'

const DEFAULT_CAPABILITIES: AssignmentCapability[] = ['ASSESSMENT_START']
const DEFAULT_CONFIRMATION_METHOD: SupportedAssignmentConfirmationMethod = 'TEACHER_ATTESTATION'
const DEFAULT_GRANT_TTL_MS = 8 * 60 * 60 * 1000

type RuntimeContext = {
  deviceId: string
  deviceRuntimeSessionId: string
  teacherAuthSessionId: string
}

type AssignmentSessionRow = {
  business_session_id: string
  session_id: string
  session_type: string
  student_id: string
  job_code: string
  task_code: string
  delivery_phase: AssignmentDeliveryPhase | null
  status: string
}

type AssignmentDetailRow = {
  assignment_id: string
  business_session_id: string
  session_id: string
  student_id: string
  device_id: string
  grant_id: string
  assigned_by: string
  student_confirmed_at: string | null
  assignment_status: BusinessSessionAssignmentStatus
  assignment_version: number
  grant_status: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED'
  device_runtime_session_id: string
  teacher_auth_session_id: string
  teacher_user_id: string
  delivery_phase: AssignmentDeliveryPhase | null
  current_question_id: string | null
}

export interface AssignmentMutationExecution {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly context: AcceptedCommandContext
}

const ASSIGNMENT_MUTATION_COMMANDS = new Set([
  'assignment:create',
  'assignment:confirmStudent',
  'assignment:startAssessment',
  'assignment:rebind',
  'assignment:release'
])

function correlationFor(
  execution: AssignmentMutationExecution,
  expectedCommandType: string,
  params: { callerUserId: string; callerRole: AssignmentActorRole }
): string {
  const { envelope } = execution.context
  if (!ASSIGNMENT_MUTATION_COMMANDS.has(expectedCommandType) || envelope.commandType !== expectedCommandType) {
    throw new Error(`assignment mutation requires accepted ${expectedCommandType} context`)
  }
  if (!envelope.correlationId.trim()) throw new Error('assignment mutation correlation must be non-empty')
  const actor = envelope.actor
  if (
    actor.kind !== 'USER'
    || actor.userId !== params.callerUserId
    || actor.role !== params.callerRole
  ) {
    throw new Error('assignment mutation actor must match accepted context')
  }
  return envelope.correlationId
}

function assertAcceptedTarget(
  execution: AssignmentMutationExecution,
  expected: Readonly<Record<string, string>>
): void {
  for (const [field, value] of Object.entries(expected)) {
    if (execution.context.envelope.target[field] !== value) {
      throw new Error(`assignment mutation target mismatch: ${field}`)
    }
  }
}

function err(errorCode: AssignmentErrorCode): { success: false; errorCode: AssignmentErrorCode } {
  return { success: false, errorCode }
}

function isSupportedConfirmationMethod(value: unknown): value is SupportedAssignmentConfirmationMethod {
  return value === 'TEACHER_ATTESTATION' || value === 'NONE_REQUIRED'
}

function normalizeConfirmationMethod(
  value: unknown
): SupportedAssignmentConfirmationMethod | null {
  if (value == null) return DEFAULT_CONFIRMATION_METHOD
  return isSupportedConfirmationMethod(value) ? value : null
}

function normalizeCapabilities(value: unknown): AssignmentCapability[] {
  if (!Array.isArray(value)) return [...DEFAULT_CAPABILITIES]
  const capabilities = value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return capabilities.length > 0 ? capabilities : [...DEFAULT_CAPABILITIES]
}

function expiresAtFromNow(): string {
  return new Date(Date.now() + DEFAULT_GRANT_TTL_MS).toISOString()
}

function getAssignmentSession(db: DBAdapter, businessSessionId: unknown): AssignmentSessionRow | undefined {
  if (typeof businessSessionId !== 'string' || businessSessionId.length === 0) return undefined
  return db
    .prepare(
      `SELECT
         bs.business_session_id,
         a.session_id,
         bs.session_type,
         bs.student_id,
         bs.job_code,
         bs.task_code,
         a.delivery_phase,
         a.status
       FROM business_session bs
       JOIN assessment_session a ON a.business_session_id = bs.business_session_id
       WHERE bs.business_session_id = ?`
    )
    .get(businessSessionId) as AssignmentSessionRow | undefined
}

function getAssignmentDetail(db: DBAdapter, assignmentId: unknown): AssignmentDetailRow | undefined {
  if (typeof assignmentId !== 'string' || assignmentId.length === 0) return undefined
  return db
    .prepare(
      `SELECT
         bsa.assignment_id,
         bsa.business_session_id,
         a.session_id,
         bsa.student_id,
         bsa.device_id,
         bsa.grant_id,
         bsa.assigned_by,
         bsa.student_confirmed_at,
         bsa.status AS assignment_status,
         bsa.version AS assignment_version,
         g.status AS grant_status,
         g.device_runtime_session_id,
         g.teacher_auth_session_id,
         g.teacher_user_id,
         a.delivery_phase,
         a.current_question_id
       FROM business_session_assignment bsa
       JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
       JOIN assessment_session a ON a.business_session_id = bsa.business_session_id
       WHERE bsa.assignment_id = ?`
    )
    .get(assignmentId) as AssignmentDetailRow | undefined
}

function resolveExplicitRuntime(
  db: DBAdapter,
  callerUserId: string,
  deviceRuntimeSessionId: string
): RuntimeContext | { errorCode: 'DEVICE_RUNTIME_NOT_ACTIVE' | 'GRANT_AUTH_INVALID' } {
  const runtime = db
    .prepare(
      `SELECT drs.device_runtime_session_id, drs.device_id
       FROM device_runtime_session drs
       JOIN device d ON d.device_id = drs.device_id
       WHERE drs.device_runtime_session_id = ?
         AND drs.status = 'ACTIVE'
         AND d.status = 'ACTIVE'`
    )
    .get(deviceRuntimeSessionId) as
    | { device_runtime_session_id: string; device_id: string }
    | undefined
  if (!runtime) return { errorCode: 'DEVICE_RUNTIME_NOT_ACTIVE' }

  const auth = db
    .prepare(
      `SELECT auth_session_id
       FROM auth_session
       WHERE user_id = ?
         AND device_runtime_session_id = ?
         AND status = 'ACTIVE'
         AND expires_at > datetime('now')
       ORDER BY expires_at DESC, auth_session_id ASC
       LIMIT 1`
    )
    .get(callerUserId, deviceRuntimeSessionId) as { auth_session_id: string } | undefined
  if (!auth) return { errorCode: 'GRANT_AUTH_INVALID' }

  return {
    deviceId: runtime.device_id,
    deviceRuntimeSessionId: runtime.device_runtime_session_id,
    teacherAuthSessionId: auth.auth_session_id
  }
}

function resolveRuntimeContext(
  db: DBAdapter,
  callerUserId: string,
  context: AcceptedCommandContext,
  deviceRuntimeSessionId?: string
): RuntimeContext | { errorCode: 'DEVICE_RUNTIME_NOT_ACTIVE' | 'GRANT_AUTH_INVALID' } {
  if (deviceRuntimeSessionId) {
    return resolveExplicitRuntime(db, callerUserId, deviceRuntimeSessionId)
  }
  try {
    const localRuntime = ensureLocalRuntimeContext(db, callerUserId, context)
    return {
      deviceId: localRuntime.deviceId,
      deviceRuntimeSessionId: localRuntime.deviceRuntimeSessionId,
      teacherAuthSessionId: localRuntime.teacherAuthSessionId
    }
  } catch {
    return { errorCode: 'GRANT_AUTH_INVALID' }
  }
}

function getFirstOnlineQuestion(
  db: DBAdapter,
  sessionId: string
): { question_id: string; question_order: number } | undefined {
  return db
    .prepare(
      `SELECT question_id, question_order
       FROM assessment_session_question
       WHERE session_id = ? AND question_phase = 'ONLINE'
       ORDER BY question_order ASC
       LIMIT 1`
    )
    .get(sessionId) as { question_id: string; question_order: number } | undefined
}

function getCurrentQuestionOrder(
  db: DBAdapter,
  sessionId: string,
  questionId: string
): number {
  const row = db
    .prepare(
      `SELECT question_order
       FROM assessment_session_question
       WHERE session_id = ? AND question_id = ?`
    )
    .get(sessionId, questionId) as { question_order: number } | undefined
  return row?.question_order ?? 1
}

function canConfirmAsCaller(
  db: DBAdapter,
  params: { callerUserId: string; callerRole: AssignmentActorRole; studentId: string }
): boolean {
  if (params.callerRole === 'STUDENT') {
    const caller = assertStudent(db, params.callerUserId, params.callerRole)
    return caller.ok && caller.row.user_id === params.studentId
  }
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  return caller.ok
}

function releaseGrantStatusForReason(
  reason: AssignmentReleaseReason,
  grantStatus?: AssignmentGrantTerminalStatus
): AssignmentGrantTerminalStatus {
  if (grantStatus) return grantStatus
  return reason === 'ADMIN_REVOKED' ? 'REVOKED' : 'RELEASED'
}

export function createAssignment(
  db: DBAdapter,
  params: CreateAssignmentParams,
  execution: AssignmentMutationExecution
): CreateAssignmentResult {
  const correlationId = correlationFor(execution, 'assignment:create', params)
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return err('FORBIDDEN')

  const method = normalizeConfirmationMethod(params.confirmationMethod)
  if (!method) return err('UNSUPPORTED_CONFIRMATION_METHOD')

  const session = getAssignmentSession(db, params.businessSessionId)
  if (!session || session.session_type !== 'ASSESSMENT') return err('NOT_FOUND')
  assertAcceptedTarget(execution, {
    business_session_id: session.business_session_id,
    student_id: session.student_id,
    job_code: session.job_code,
    task_code: session.task_code
  })
  if (session.delivery_phase !== 'PREPARED') return err('ASSIGNMENT_CONFLICT')

  const runtime = resolveRuntimeContext(
    db,
    caller.row.user_id,
    execution.context,
    params.deviceRuntimeSessionId
  )
  if ('errorCode' in runtime) return err(runtime.errorCode)

  const now = new Date().toISOString()
  const expiresAt = expiresAtFromNow()
  const grantId = uuidv4()
  const assignmentId = uuidv4()
  const payload: AssignmentCreatedPayload = {
    business_session_id: session.business_session_id,
    session_id: session.session_id,
    assignment_id: assignmentId,
    grant_id: grantId,
    student_id: session.student_id,
    device_id: runtime.deviceId,
    device_runtime_session_id: runtime.deviceRuntimeSessionId,
    teacher_auth_session_id: runtime.teacherAuthSessionId,
    teacher_user_id: caller.row.user_id,
    capabilities: normalizeCapabilities(params.capabilities),
    identity_confirmation_method: method,
    grant_status: 'ACTIVE',
    assignment_status: 'PENDING_CONFIRM',
    assigned_by: caller.row.user_id,
    assigned_at: now,
    granted_at: now,
    expires_at: expiresAt,
    delivery_phase_before: 'PREPARED',
    delivery_phase_after: 'ASSIGNED'
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'BUSINESS_SESSION',
        aggregateId: session.business_session_id,
        eventType: 'ASSIGNMENT_CREATED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN',
        correlationId
      })
      applyAssignmentEvent(db, event)
    })
    tx()
  } catch (e) {
    console.error('[assignment:create]', e)
    return err('ASSIGNMENT_CONFLICT')
  }

  const result: CreateAssignmentSuccess = {
    success: true,
    grantId,
    assignmentId,
    businessSessionId: session.business_session_id,
    sessionId: session.session_id,
    studentId: session.student_id,
    deviceId: runtime.deviceId,
    deviceRuntimeSessionId: runtime.deviceRuntimeSessionId,
    deliveryPhase: 'ASSIGNED',
    assignmentStatus: 'PENDING_CONFIRM',
    grantStatus: 'ACTIVE',
    expiresAt
  }
  return result
}

export function confirmStudentAssignment(
  db: DBAdapter,
  params: ConfirmStudentAssignmentParams,
  execution: AssignmentMutationExecution
): ConfirmStudentAssignmentResult {
  const correlationId = correlationFor(execution, 'assignment:confirmStudent', params)
  const method = normalizeConfirmationMethod(params.confirmationMethod)
  if (!method) return err('UNSUPPORTED_CONFIRMATION_METHOD')

  const detail = getAssignmentDetail(db, params.assignmentId)
  if (!detail) return err('NOT_FOUND')
  assertAcceptedTarget(execution, {
    assignment_id: detail.assignment_id,
    business_session_id: detail.business_session_id,
    student_id: detail.student_id
  })
  if (
    detail.assignment_status !== 'PENDING_CONFIRM' ||
    detail.grant_status !== 'ACTIVE' ||
    detail.delivery_phase !== 'ASSIGNED'
  ) {
    return err('ASSIGNMENT_NOT_ACTIVE')
  }
  if (
    !canConfirmAsCaller(db, {
      callerUserId: params.callerUserId,
      callerRole: params.callerRole,
      studentId: detail.student_id
    })
  ) {
    return err('FORBIDDEN')
  }

  const confirmedAt = new Date().toISOString()
  const payload: AssignmentStudentConfirmedPayload = {
    business_session_id: detail.business_session_id,
    session_id: detail.session_id,
    assignment_id: detail.assignment_id,
    grant_id: detail.grant_id,
    student_id: detail.student_id,
    device_id: detail.device_id,
    confirmed_by: params.callerUserId,
    identity_confirmation_method: method,
    confirmation_evidence: params.confirmationEvidence ?? null,
    student_pin_verified: false,
    teacher_attested: method === 'TEACHER_ATTESTATION',
    confirmed_at: confirmedAt,
    assignment_status_before: 'PENDING_CONFIRM',
    assignment_status_after: 'ACTIVE',
    delivery_phase_before: 'ASSIGNED',
    delivery_phase_after: 'STUDENT_CONFIRMED'
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'BUSINESS_SESSION',
        aggregateId: detail.business_session_id,
        eventType: 'ASSIGNMENT_STUDENT_CONFIRMED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: params.callerUserId,
        actorRole: params.callerRole,
        correlationId
      })
      applyAssignmentEvent(db, event)
    })
    tx()
  } catch (e) {
    console.error('[assignment:confirmStudent]', e)
    return err('ASSIGNMENT_SYSTEM_ERROR')
  }

  const result: ConfirmStudentAssignmentSuccess = {
    success: true,
    assignmentId: detail.assignment_id,
    businessSessionId: detail.business_session_id,
    sessionId: detail.session_id,
    studentId: detail.student_id,
    deliveryPhase: 'STUDENT_CONFIRMED',
    assignmentStatus: 'ACTIVE',
    confirmedAt
  }
  return result
}

export function startAssignedAssessment(
  db: DBAdapter,
  params: StartAssignedAssessmentParams,
  execution: AssignmentMutationExecution
): StartAssignedAssessmentResult {
  const correlationId = correlationFor(execution, 'assignment:startAssessment', params)
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return err('FORBIDDEN')

  const detail = getAssignmentDetail(db, params.assignmentId)
  if (!detail) return err('NOT_FOUND')
  assertAcceptedTarget(execution, {
    assignment_id: detail.assignment_id,
    business_session_id: detail.business_session_id,
    student_id: detail.student_id
  })

  const owner = assertSessionOwner(db, caller.row.user_id, detail.session_id)
  if (!owner.ok) return err(owner.errorCode)
  if (detail.assignment_status !== 'ACTIVE' || detail.grant_status !== 'ACTIVE') {
    return err('ASSIGNMENT_NOT_ACTIVE')
  }

  if (detail.current_question_id) {
    const result: StartAssignedAssessmentSuccess = {
      success: true,
      sessionId: detail.session_id,
      assignmentId: detail.assignment_id,
      deliveryPhase: 'ONLINE_IN_PROGRESS',
      firstQuestionId: detail.current_question_id,
      firstQuestionOrder: getCurrentQuestionOrder(db, detail.session_id, detail.current_question_id)
    }
    return result
  }

  if (detail.delivery_phase !== 'STUDENT_CONFIRMED') {
    return err('STUDENT_CONFIRMATION_REQUIRED')
  }

  const first = getFirstOnlineQuestion(db, detail.session_id)
  if (!first) return err('ASSIGNMENT_SYSTEM_ERROR')

  const startedAt = new Date().toISOString()
  const payload: AssignmentAssessmentStartedPayload = {
    business_session_id: detail.business_session_id,
    session_id: detail.session_id,
    assignment_id: detail.assignment_id,
    grant_id: detail.grant_id,
    student_id: detail.student_id,
    device_id: detail.device_id,
    first_question_id: first.question_id,
    first_question_order: first.question_order,
    started_at: startedAt,
    delivery_phase_before: 'STUDENT_CONFIRMED',
    delivery_phase_after: 'ONLINE_IN_PROGRESS'
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: detail.session_id,
        eventType: 'ASSIGNMENT_ASSESSMENT_STARTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (e) {
    console.error('[assignment:startAssessment]', e)
    return err('ASSIGNMENT_SYSTEM_ERROR')
  }

  const result: StartAssignedAssessmentSuccess = {
    success: true,
    sessionId: detail.session_id,
    assignmentId: detail.assignment_id,
    deliveryPhase: 'ONLINE_IN_PROGRESS',
    firstQuestionId: first.question_id,
    firstQuestionOrder: first.question_order
  }
  return result
}

export function rebindAssignment(
  db: DBAdapter,
  params: RebindAssignmentParams,
  execution: AssignmentMutationExecution
): RebindAssignmentResult {
  const correlationId = correlationFor(execution, 'assignment:rebind', params)
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return err('FORBIDDEN')

  const method = normalizeConfirmationMethod(params.confirmationMethod)
  if (!method) return err('UNSUPPORTED_CONFIRMATION_METHOD')

  const detail = getAssignmentDetail(db, params.assignmentId)
  if (!detail) return err('NOT_FOUND')
  assertAcceptedTarget(execution, {
    assignment_id: detail.assignment_id,
    business_session_id: detail.business_session_id,
    student_id: detail.student_id
  })
  if (detail.grant_status !== 'ACTIVE') return err('ASSIGNMENT_NOT_ACTIVE')
  if (detail.assignment_status !== 'ACTIVE' && detail.assignment_status !== 'PENDING_CONFIRM') {
    return err('ASSIGNMENT_NOT_ACTIVE')
  }

  const runtime = resolveRuntimeContext(
    db,
    caller.row.user_id,
    execution.context,
    params.newDeviceRuntimeSessionId
  )
  if ('errorCode' in runtime) return err(runtime.errorCode)

  const requireReconfirmation = Boolean(params.requireReconfirmation)
  if (requireReconfirmation && detail.assignment_status !== 'PENDING_CONFIRM') {
    return err('VALIDATION_ERROR')
  }

  const now = new Date().toISOString()
  const expiresAt = expiresAtFromNow()
  const newGrantId = uuidv4()
  const assignmentStatusAfter: 'PENDING_CONFIRM' | 'ACTIVE' = requireReconfirmation
    ? 'PENDING_CONFIRM'
    : detail.assignment_status === 'ACTIVE'
      ? 'ACTIVE'
      : 'PENDING_CONFIRM'
  const deliveryPhaseAfter: AssignmentDeliveryPhase =
    assignmentStatusAfter === 'ACTIVE' ? 'STUDENT_CONFIRMED' : (detail.delivery_phase ?? 'ASSIGNED')

  const payload: GrantReboundPayload = {
    business_session_id: detail.business_session_id,
    session_id: detail.session_id,
    assignment_id: detail.assignment_id,
    student_id: detail.student_id,
    device_id: runtime.deviceId,
    old_grant_id: detail.grant_id,
    new_grant_id: newGrantId,
    old_device_runtime_session_id: detail.device_runtime_session_id,
    new_device_runtime_session_id: runtime.deviceRuntimeSessionId,
    teacher_auth_session_id: runtime.teacherAuthSessionId,
    teacher_user_id: caller.row.user_id,
    capabilities: normalizeCapabilities(params.capabilities),
    identity_confirmation_method: method,
    require_reconfirmation: requireReconfirmation,
    assignment_version_before: detail.assignment_version,
    assignment_version_after: detail.assignment_version + 1,
    assignment_status_before: detail.assignment_status,
    assignment_status_after: assignmentStatusAfter,
    old_grant_status_after: 'EXPIRED',
    new_grant_status: 'ACTIVE',
    replaces_grant_id: detail.grant_id,
    student_confirmed_at_after: assignmentStatusAfter === 'ACTIVE' ? detail.student_confirmed_at : null,
    delivery_phase_after: deliveryPhaseAfter,
    granted_at: now,
    expires_at: expiresAt,
    rebound_at: now
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'BUSINESS_SESSION',
        aggregateId: detail.business_session_id,
        eventType: 'GRANT_REBOUND',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN',
        correlationId
      })
      applyAssignmentEvent(db, event)
    })
    tx()
  } catch (e) {
    console.error('[assignment:rebind]', e)
    return err('ASSIGNMENT_CONFLICT')
  }

  const result: RebindAssignmentSuccess = {
    success: true,
    assignmentId: detail.assignment_id,
    businessSessionId: detail.business_session_id,
    sessionId: detail.session_id,
    oldGrantId: detail.grant_id,
    newGrantId,
    version: detail.assignment_version + 1,
    assignmentStatus: assignmentStatusAfter,
    deliveryPhase: deliveryPhaseAfter,
    requiresStudentConfirmation: requireReconfirmation
  }
  return result
}

export function releaseAssignment(
  db: DBAdapter,
  params: ReleaseAssignmentParams,
  execution: AssignmentMutationExecution
): ReleaseAssignmentResult {
  const correlationId = correlationFor(execution, 'assignment:release', params)
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return err('FORBIDDEN')

  const detail = getAssignmentDetail(db, params.assignmentId)
  if (!detail) return err('NOT_FOUND')
  assertAcceptedTarget(execution, {
    assignment_id: detail.assignment_id,
    business_session_id: detail.business_session_id,
    student_id: detail.student_id
  })
  if (detail.assignment_status !== 'ACTIVE' && detail.assignment_status !== 'PENDING_CONFIRM') {
    return err('ASSIGNMENT_NOT_ACTIVE')
  }

  const releasedAt = new Date().toISOString()
  const grantStatusAfter = releaseGrantStatusForReason(params.releaseReason, params.grantStatus)
  const payload: AssignmentReleasedPayload = {
    business_session_id: detail.business_session_id,
    session_id: detail.session_id,
    assignment_id: detail.assignment_id,
    grant_id: detail.grant_id,
    student_id: detail.student_id,
    device_id: detail.device_id,
    release_reason: params.releaseReason,
    released_by: caller.row.user_id,
    released_at: releasedAt,
    assignment_status_before: detail.assignment_status,
    assignment_status_after: 'RELEASED',
    grant_status_before: detail.grant_status,
    grant_status_after: grantStatusAfter,
    delivery_phase_at_release: detail.delivery_phase ?? 'PREPARED'
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'BUSINESS_SESSION',
        aggregateId: detail.business_session_id,
        eventType: 'ASSIGNMENT_RELEASED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN',
        correlationId
      })
      applyAssignmentEvent(db, event)
    })
    tx()
  } catch (e) {
    console.error('[assignment:release]', e)
    return err('ASSIGNMENT_SYSTEM_ERROR')
  }

  const result: ReleaseAssignmentSuccess = {
    success: true,
    assignmentId: detail.assignment_id,
    businessSessionId: detail.business_session_id,
    sessionId: detail.session_id,
    grantId: detail.grant_id,
    assignmentStatus: 'RELEASED',
    grantStatus: grantStatusAfter,
    releasedAt
  }
  return result
}
