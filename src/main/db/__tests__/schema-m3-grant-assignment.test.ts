import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedLocalRuntimeContextFixture,
  seedM3GrantAssignmentFixture,
  seedStudent
} from '../test-helpers'
import type { LocalRuntimeContextFixture } from '../test-helpers'
import type { MemoryAdapter } from '../memory-adapter'

let db: MemoryAdapter

type M3Topology = {
  teacherId: string
  studentId: string
  sessionId: string
  runtime: LocalRuntimeContextFixture
}

function seedM3Topology(over: { authExpiresAt?: 'future' | 'past' } = {}): M3Topology {
  const teacherId = seedCaller(db, 'TEACHER')
  const studentId = seedStudent(db)
  const runtime = seedLocalRuntimeContextFixture(db, {
    teacherUserId: teacherId,
    authExpiresAt: over.authExpiresAt
  })
  const sessionId = seedAssessmentSessionFixture(db, {
    sessionId: uuidv4(),
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    status: 'INIT',
    createdBy: teacherId
  })
  return { teacherId, studentId, sessionId, runtime }
}

function insertGrant(params: {
  grantId?: string
  sessionId: string
  teacherId: string
  studentId: string
  runtime: LocalRuntimeContextFixture
  status?: 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'REVOKED'
  deviceId?: string
  runtimeId?: string
  authSessionId?: string
}): string {
  const grantId = params.grantId ?? uuidv4()
  db.prepare(
    `INSERT INTO delegated_access_grant
       (grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
        student_id, device_id, device_runtime_session_id, capabilities_json,
        identity_confirmation_method, status, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '["ASSESSMENT_START"]',
             'TEACHER_ATTESTATION', ?, datetime('now'), datetime('now', '+1 day'))`
  ).run(
    grantId,
    params.sessionId,
    params.authSessionId ?? params.runtime.teacherAuthSessionId,
    params.teacherId,
    params.studentId,
    params.deviceId ?? params.runtime.deviceId,
    params.runtimeId ?? params.runtime.deviceRuntimeSessionId,
    params.status ?? 'ACTIVE'
  )
  return grantId
}

function insertAssignment(params: {
  assignmentId?: string
  sessionId: string
  studentId: string
  deviceId: string
  grantId: string
  assignedBy: string
  status?: 'PENDING_CONFIRM' | 'ACTIVE' | 'RELEASED'
}): string {
  const assignmentId = params.assignmentId ?? uuidv4()
  db.prepare(
    `INSERT INTO business_session_assignment
       (assignment_id, business_session_id, student_id, device_id, grant_id, assigned_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    assignmentId,
    params.sessionId,
    params.studentId,
    params.deviceId,
    params.grantId,
    params.assignedBy,
    params.status ?? 'PENDING_CONFIRM'
  )
  return assignmentId
}

beforeEach(async () => {
  db = await createTestDb()
})

afterEach(() => {
  db.close()
})

describe('M3 grant/assignment schema constraints', () => {
  it('D1 只允许 assessment delivery_phase 按 M3 状态机前进', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const sessionId = seedAssessmentSessionFixture(db, {
      sessionId: uuidv4(),
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'INIT',
      createdBy: teacherId
    })

    expect(() => {
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'ASSIGNED',
        sessionId
      )
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'STUDENT_CONFIRMED',
        sessionId
      )
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'ONLINE_IN_PROGRESS',
        sessionId
      )
    }).not.toThrow()

    const preparedJumpId = seedAssessmentSessionFixture(db, {
      sessionId: uuidv4(),
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'prepared-jump',
      status: 'INIT',
      createdBy: teacherId
    })
    expect(() => {
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'ONLINE_IN_PROGRESS',
        preparedJumpId
      )
    }).toThrow(/PREPARED can only advance to ASSIGNED/)

    const assignedJumpId = seedAssessmentSessionFixture(db, {
      sessionId: uuidv4(),
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'assigned-jump',
      status: 'INIT',
      createdBy: teacherId
    })
    db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
      'ASSIGNED',
      assignedJumpId
    )
    expect(() => {
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'ONLINE_IN_PROGRESS',
        assignedJumpId
      )
    }).toThrow(/ASSIGNED can only advance to STUDENT_CONFIRMED/)

    const finalizedId = seedAssessmentSessionFixture(db, {
      sessionId: uuidv4(),
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'finalized-jump',
      status: 'COMPLETED',
      createdBy: teacherId
    })
    expect(() => {
      db.prepare('UPDATE assessment_session SET delivery_phase = ? WHERE session_id = ?').run(
        'OBSERVATION',
        finalizedId
      )
    }).toThrow(/FINALIZED|COMPLETED/)
  })

  it('D9 拒绝 grant 与 business_session、runtime/device 或 auth_session 不一致', () => {
    const topology = seedM3Topology()
    const otherStudentId = seedStudent(db, { studentName: '其他学生' })
    expect(() => {
      insertGrant({ ...topology, studentId: otherStudentId })
    }).toThrow(/grant self-consistency/)

    const otherRuntime = seedLocalRuntimeContextFixture(db, { teacherUserId: topology.teacherId })
    expect(() => {
      insertGrant({
        ...topology,
        grantId: uuidv4(),
        deviceId: topology.runtime.deviceId,
        runtimeId: otherRuntime.deviceRuntimeSessionId
      })
    }).toThrow(/grant self-consistency/)

    const expiredAuthTopology = seedM3Topology({ authExpiresAt: 'past' })
    expect(() => {
      insertGrant(expiredAuthTopology)
    }).toThrow(/grant self-consistency/)
  })

  it('D10 拒绝 assignment 与 grant 键不一致或 assigned_by 非 grant teacher/ACTIVE ADMIN', () => {
    const topology = seedM3Topology()
    const grantId = insertGrant(topology)
    const otherStudentId = seedStudent(db, { studentName: '错误学生' })

    expect(() => {
      insertAssignment({
        ...topology,
        grantId,
        deviceId: topology.runtime.deviceId,
        studentId: otherStudentId,
        assignedBy: topology.teacherId
      })
    }).toThrow(/assignment must match grant/)

    expect(() => {
      insertAssignment({
        ...topology,
        assignmentId: uuidv4(),
        grantId,
        deviceId: topology.runtime.deviceId,
        assignedBy: topology.studentId
      })
    }).toThrow(/assigned_by|grant teacher/)

    const adminId = seedCaller(db, 'ADMIN')
    expect(() => {
      insertAssignment({
        ...topology,
        assignmentId: uuidv4(),
        grantId,
        deviceId: topology.runtime.deviceId,
        assignedBy: adminId
      })
    }).not.toThrow()
  })

  it('D11 拒绝 PENDING_CONFIRM/ACTIVE assignment 指向非 ACTIVE grant', () => {
    const topology = seedM3Topology()
    const expiredGrantId = insertGrant({ ...topology, status: 'EXPIRED' })

    expect(() => {
      insertAssignment({
        ...topology,
        grantId: expiredGrantId,
        deviceId: topology.runtime.deviceId,
        assignedBy: topology.teacherId,
        status: 'PENDING_CONFIRM'
      })
    }).toThrow(/ACTIVE grant/)

    const released = seedM3GrantAssignmentFixture(db, {
      teacherId: topology.teacherId,
      studentId: topology.studentId,
      sessionId: topology.sessionId,
      runtime: topology.runtime,
      grantId: uuidv4(),
      assignmentId: uuidv4(),
      grantStatus: 'EXPIRED',
      assignmentStatus: 'RELEASED'
    })
    expect(() => {
      db.prepare(
        "UPDATE business_session_assignment SET status = 'ACTIVE' WHERE assignment_id = ?"
      ).run(released.assignmentId)
    }).toThrow(/ACTIVE grant/)
  })
})
