// M3 Assignment 事件投影 reducer。
//
// 职责：把 BUSINESS_SESSION 聚合上的 assignment/grant 事件投影到
// delegated_access_grant、business_session_assignment，并推进 assessment delivery_phase。
// 本函数不开事务；调用方必须与 writeEvent 放在同一个 db.transaction 内。

import type { DBAdapter } from '../db/interface'
import type {
  ActionLogEntry,
  AssignmentCreatedPayload,
  AssignmentStudentConfirmedPayload,
  GrantReboundPayload,
  AssignmentReleasedPayload
} from '@shared/types/event-payloads'
import type { AssignmentDeliveryPhase } from '@shared/types/assignment'

const DELIVERY_PHASE_ORDER: Record<AssignmentDeliveryPhase, number> = {
  PREPARED: 0,
  ASSIGNED: 1,
  STUDENT_CONFIRMED: 2,
  ONLINE_IN_PROGRESS: 3,
  ONLINE_COMPLETED: 4,
  OFFLINE_SCORING: 5,
  OBSERVATION: 6,
  READY_TO_FINALIZE: 7,
  FINALIZED: 8
}

type AssessmentProjectionRow = {
  session_id: string
  business_session_id: string
  student_id: string
  delivery_phase: AssignmentDeliveryPhase | null
  event_sequence_version: number | null
}

function isStaleAssessmentEvent(row: { event_sequence_version: number | null }, event: ActionLogEntry): boolean {
  return event.event_sequence <= (row.event_sequence_version ?? 0)
}

function markAssessmentEventApplied(db: DBAdapter, sessionId: string, event: ActionLogEntry): void {
  db.prepare(
    `UPDATE assessment_session
       SET event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END,
           last_applied_event_id = ?
     WHERE session_id = ?`
  ).run(event.event_sequence, event.event_sequence, event.event_id, sessionId)
}

function getAssessmentProjection(db: DBAdapter, sessionId: string): AssessmentProjectionRow | undefined {
  return db
    .prepare(
      `SELECT session_id, business_session_id, student_id, delivery_phase, event_sequence_version
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as AssessmentProjectionRow | undefined
}

function shouldAdvancePhase(
  currentPhase: AssignmentDeliveryPhase | null,
  nextPhase: AssignmentDeliveryPhase
): boolean {
  return currentPhase === null || DELIVERY_PHASE_ORDER[nextPhase] > DELIVERY_PHASE_ORDER[currentPhase]
}

function advanceAssessmentPhaseIfCurrent(
  db: DBAdapter,
  params: {
    sessionId: string
    event: ActionLogEntry
    expectedPhase: AssignmentDeliveryPhase
    nextPhase: AssignmentDeliveryPhase
  }
): boolean {
  const row = getAssessmentProjection(db, params.sessionId)
  if (!row) return false
  if (isStaleAssessmentEvent(row, params.event)) return false
  if (row.delivery_phase !== params.expectedPhase) return false

  db.prepare(
    `UPDATE assessment_session
       SET delivery_phase = ?,
           event_sequence_version = CASE
             WHEN event_sequence_version > ? THEN event_sequence_version
             ELSE ?
           END,
           last_applied_event_id = ?
     WHERE session_id = ?
       AND delivery_phase = ?`
  ).run(
    params.nextPhase,
    params.event.event_sequence,
    params.event.event_sequence,
    params.event.event_id,
    params.sessionId,
    params.expectedPhase
  )
  return true
}

function markAssessmentEventIfForward(
  db: DBAdapter,
  params: {
    sessionId: string
    event: ActionLogEntry
    deliveryPhaseAfter: AssignmentDeliveryPhase
  }
): void {
  const row = getAssessmentProjection(db, params.sessionId)
  if (!row) return
  if (isStaleAssessmentEvent(row, params.event)) return

  if (shouldAdvancePhase(row.delivery_phase, params.deliveryPhaseAfter)) {
    db.prepare(
      `UPDATE assessment_session
         SET delivery_phase = ?,
             event_sequence_version = CASE
               WHEN event_sequence_version > ? THEN event_sequence_version
               ELSE ?
             END,
             last_applied_event_id = ?
       WHERE session_id = ?`
    ).run(
      params.deliveryPhaseAfter,
      params.event.event_sequence,
      params.event.event_sequence,
      params.event.event_id,
      params.sessionId
    )
    return
  }

  markAssessmentEventApplied(db, params.sessionId, params.event)
}

export function applyAssignmentEvent(db: DBAdapter, event: ActionLogEntry): void {
  switch (event.event_type) {
    case 'ASSIGNMENT_CREATED':
      applyAssignmentCreated(db, event)
      break
    case 'ASSIGNMENT_STUDENT_CONFIRMED':
      applyAssignmentStudentConfirmed(db, event)
      break
    case 'GRANT_REBOUND':
      applyGrantRebound(db, event)
      break
    case 'ASSIGNMENT_RELEASED':
      applyAssignmentReleased(db, event)
      break
    default:
      break
  }
}

function assertAssignmentFacts(
  row: AssessmentProjectionRow,
  payload: {
    business_session_id: string
    session_id: string
    student_id: string
  }
): void {
  if (
    row.business_session_id !== payload.business_session_id ||
    row.session_id !== payload.session_id ||
    row.student_id !== payload.student_id
  ) {
    throw new Error(`assignment event conflicts with assessment_session ${payload.session_id}`)
  }
}

function applyAssignmentCreated(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as AssignmentCreatedPayload
  const row = getAssessmentProjection(db, p.session_id)
  if (!row) return
  assertAssignmentFacts(row, p)
  if (isStaleAssessmentEvent(row, event)) return
  if (row.delivery_phase !== p.delivery_phase_before) return

  db.prepare(
    `INSERT INTO delegated_access_grant
       (grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
        student_id, device_id, device_runtime_session_id, capabilities_json,
        identity_confirmation_method, status, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.grant_id,
    p.business_session_id,
    p.teacher_auth_session_id,
    p.teacher_user_id,
    p.student_id,
    p.device_id,
    p.device_runtime_session_id,
    JSON.stringify(p.capabilities),
    p.identity_confirmation_method,
    p.grant_status,
    p.granted_at,
    p.expires_at
  )

  db.prepare(
    `INSERT INTO business_session_assignment
       (assignment_id, business_session_id, student_id, device_id, grant_id,
        assigned_by, assigned_at, status, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    p.assignment_id,
    p.business_session_id,
    p.student_id,
    p.device_id,
    p.grant_id,
    p.assigned_by,
    p.assigned_at,
    p.assignment_status
  )

  advanceAssessmentPhaseIfCurrent(db, {
    sessionId: p.session_id,
    event,
    expectedPhase: p.delivery_phase_before,
    nextPhase: p.delivery_phase_after
  })
}

function applyAssignmentStudentConfirmed(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as AssignmentStudentConfirmedPayload
  const row = getAssessmentProjection(db, p.session_id)
  if (!row) return
  assertAssignmentFacts(row, p)
  if (isStaleAssessmentEvent(row, event)) return
  if (row.delivery_phase !== p.delivery_phase_before) return

  const assignment = db
    .prepare('SELECT status, grant_id FROM business_session_assignment WHERE assignment_id = ?')
    .get(p.assignment_id) as { status: string; grant_id: string } | undefined
  if (!assignment || assignment.status !== p.assignment_status_before || assignment.grant_id !== p.grant_id) {
    return
  }

  db.prepare(
    `UPDATE delegated_access_grant
       SET confirmed_by = ?,
           confirmation_evidence = ?,
           student_pin_verified = ?,
           teacher_attested = ?,
           confirmed_at = ?,
           updated_at = datetime('now')
     WHERE grant_id = ?`
  ).run(
    p.confirmed_by,
    p.confirmation_evidence == null ? null : JSON.stringify(p.confirmation_evidence),
    p.student_pin_verified ? 1 : 0,
    p.teacher_attested ? 1 : 0,
    p.confirmed_at,
    p.grant_id
  )

  db.prepare(
    `UPDATE business_session_assignment
       SET status = ?,
           student_confirmed_at = ?,
           updated_at = datetime('now')
     WHERE assignment_id = ?
       AND status = ?`
  ).run(p.assignment_status_after, p.confirmed_at, p.assignment_id, p.assignment_status_before)

  advanceAssessmentPhaseIfCurrent(db, {
    sessionId: p.session_id,
    event,
    expectedPhase: p.delivery_phase_before,
    nextPhase: p.delivery_phase_after
  })
}

function applyGrantRebound(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as GrantReboundPayload
  const row = getAssessmentProjection(db, p.session_id)
  if (!row) return
  assertAssignmentFacts(row, p)
  if (isStaleAssessmentEvent(row, event)) return

  const assignment = db
    .prepare('SELECT grant_id, status, version FROM business_session_assignment WHERE assignment_id = ?')
    .get(p.assignment_id) as { grant_id: string; status: string; version: number } | undefined
  if (!assignment) return
  if (assignment.version >= p.assignment_version_after && assignment.grant_id === p.new_grant_id) {
    markAssessmentEventIfForward(db, {
      sessionId: p.session_id,
      event,
      deliveryPhaseAfter: p.delivery_phase_after
    })
    return
  }
  if (
    assignment.grant_id !== p.old_grant_id ||
    assignment.status !== p.assignment_status_before ||
    assignment.version !== p.assignment_version_before
  ) {
    return
  }

  db.prepare(
    `UPDATE delegated_access_grant
       SET status = ?,
           released_at = ?,
           release_reason = 'REPLACED',
           updated_at = datetime('now')
     WHERE grant_id = ?
       AND status = 'ACTIVE'`
  ).run(p.old_grant_status_after, p.rebound_at, p.old_grant_id)

  db.prepare(
    `INSERT INTO delegated_access_grant
       (grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
        student_id, device_id, device_runtime_session_id, capabilities_json,
        identity_confirmation_method, status, replaces_grant_id, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.new_grant_id,
    p.business_session_id,
    p.teacher_auth_session_id,
    p.teacher_user_id,
    p.student_id,
    p.device_id,
    p.new_device_runtime_session_id,
    JSON.stringify(p.capabilities),
    p.identity_confirmation_method,
    p.new_grant_status,
    p.replaces_grant_id,
    p.granted_at,
    p.expires_at
  )

  db.prepare(
    `UPDATE business_session_assignment
       SET grant_id = ?,
           device_id = ?,
           status = ?,
           student_confirmed_at = ?,
           version = ?,
           updated_at = datetime('now')
     WHERE assignment_id = ?
       AND grant_id = ?
       AND version = ?`
  ).run(
    p.new_grant_id,
    p.device_id,
    p.assignment_status_after,
    p.student_confirmed_at_after ?? null,
    p.assignment_version_after,
    p.assignment_id,
    p.old_grant_id,
    p.assignment_version_before
  )

  markAssessmentEventIfForward(db, {
    sessionId: p.session_id,
    event,
    deliveryPhaseAfter: p.delivery_phase_after
  })
}

function applyAssignmentReleased(db: DBAdapter, event: ActionLogEntry): void {
  const p = event.payload as unknown as AssignmentReleasedPayload
  const row = getAssessmentProjection(db, p.session_id)
  if (!row) return
  assertAssignmentFacts(row, p)
  if (isStaleAssessmentEvent(row, event)) return

  const assignment = db
    .prepare('SELECT status, grant_id FROM business_session_assignment WHERE assignment_id = ?')
    .get(p.assignment_id) as { status: string; grant_id: string } | undefined
  if (!assignment) return
  if (assignment.status === p.assignment_status_after) {
    markAssessmentEventApplied(db, p.session_id, event)
    return
  }
  if (assignment.status !== p.assignment_status_before || assignment.grant_id !== p.grant_id) return

  db.prepare(
    `UPDATE business_session_assignment
       SET status = ?,
           released_at = ?,
           release_reason = ?,
           updated_at = datetime('now')
     WHERE assignment_id = ?
       AND status = ?`
  ).run(
    p.assignment_status_after,
    p.released_at,
    p.release_reason,
    p.assignment_id,
    p.assignment_status_before
  )

  db.prepare(
    `UPDATE delegated_access_grant
       SET status = ?,
           released_at = ?,
           release_reason = ?,
           updated_at = datetime('now')
     WHERE grant_id = ?
       AND status = ?`
  ).run(
    p.grant_status_after,
    p.released_at,
    p.release_reason,
    p.grant_id,
    p.grant_status_before
  )

  markAssessmentEventApplied(db, p.session_id, event)
}
