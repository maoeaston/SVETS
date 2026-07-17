// assignment:* IPC handler 集成测试：直接调纯函数，注入 MemoryAdapter。
// 覆盖 M3-6 的 grant/assignment 创建、确认、启动、rebind、release 及主要拒绝路径。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) {
        throw new Error('mock writeEvent: mockState.db not set; call in beforeEach')
      }
      const eventId = uuidv4()
      const row = mockState.db
        .prepare(
          `SELECT MAX(event_sequence) AS max_seq
             FROM domain_event_projection
            WHERE aggregate_id = ?`
        )
        .get(params.aggregateId) as { max_seq: number | null }
      const eventSequence = (row.max_seq ?? 0) + 1
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: eventSequence,
        payload: params.payload,
        checksum: 'test-checksum',
        schema_version: 1,
        created_at: new Date().toISOString(),
        actor_id: params.actorId,
        actor_role: params.actorRole,
        app_version: 'test'
      }
      mockState.db
        .prepare(
          `INSERT INTO domain_event_projection
             (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
              payload_json, checksum, source_log_path, schema_version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.event_id,
          entry.aggregate_type,
          entry.aggregate_id,
          entry.event_type,
          entry.event_sequence,
          JSON.stringify(entry.payload),
          entry.checksum,
          'test-action-log.jsonl',
          entry.schema_version,
          entry.created_at
        )
      return entry
    }
  )
}))

import {
  confirmStudentAssignment,
  createAssignment,
  rebindAssignment,
  releaseAssignment,
  startAssignedAssessment
} from '../assignment'
import { listMySessions } from '../assessment'
import {
  baseStrategyInput,
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedLocalRuntimeContextFixture,
  seedQuestionBank,
  seedStudent
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { StrategyInput } from '../../../../shared/types/strategy'
import type { CreateAssignmentParams } from '../../../../shared/types/assignment'

let db: MemoryAdapter
let teacherId: string
let studentId: string
let sessionId: string
let strategyId: string
let firstQuestionId: string

function seedStrategy(over: Partial<StrategyInput> = {}): void {
  const s = baseStrategyInput({
    strategyId: `assignment-strategy-${uuidv4().slice(0, 8)}`,
    onlineQuestionCount: 1,
    offlineQuestionCount: 0,
    ...over
  })
  strategyId = s.strategyId
  db.prepare(
    `INSERT INTO strategy_config
       (strategy_id, strategy_type, job_code, strategy_name,
        online_question_count, offline_question_count, max_score,
        competent_threshold, conditional_threshold,
        module_veto_threshold, emotion_collapse_threshold,
        question_policy_json, scoring_policy_json,
        supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
        version, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.strategyId,
    s.strategyType,
    s.jobCode,
    s.strategyName,
    s.onlineQuestionCount,
    s.offlineQuestionCount,
    s.maxScore,
    s.competentThreshold,
    s.conditionalThreshold,
    s.moduleVetoThreshold,
    s.emotionCollapseThreshold,
    JSON.stringify(s.questionPolicy),
    JSON.stringify(s.scoringPolicy),
    s.supportsRedlineHalt ? 1 : 0,
    s.allowsEmotionInterrupt ? 1 : 0,
    s.requiresOfflineScoring ? 1 : 0,
    s.version,
    s.isActive ? 1 : 0
  )
}

function seedFirstQuestion(session: string): void {
  seedQuestionBank(db, { onlinePerModule: 1, offlinePerModule: 0 })
  const q = db
    .prepare(
      `SELECT question_id, bank_domain, module_type, question_type, item_usage, job_module_code
       FROM question_bank
       WHERE question_type <> 'OFFLINE_OPERATION'
       ORDER BY question_id
       LIMIT 1`
    )
    .get() as {
    question_id: string
    bank_domain: string
    module_type: string
    question_type: string
    item_usage: string
    job_module_code: string | null
  }
  firstQuestionId = q.question_id
  db.prepare(
    `INSERT INTO assessment_session_question
       (session_question_id, session_id, question_id, question_order, question_phase,
        bank_domain, module_type, question_type, item_usage, job_module_code)
     VALUES (?, ?, ?, 1, 'ONLINE', ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    session,
    q.question_id,
    q.bank_domain,
    q.module_type,
    q.question_type,
    q.item_usage,
    q.job_module_code
  )
}

function seedPreparedSession(over: { taskCode?: string } = {}): void {
  sessionId = uuidv4()
  seedAssessmentSessionFixture(db, {
    sessionId,
    studentId,
    strategyId,
    taskCode: over.taskCode,
    status: 'INIT',
    deliveryPhase: 'PREPARED',
    onlineQuestionCount: 1,
    offlineQuestionCount: 0,
    createdBy: teacherId
  })
  seedFirstQuestion(sessionId)
}

function baseCreateParams(over: Partial<CreateAssignmentParams> = {}): CreateAssignmentParams {
  return {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    businessSessionId: sessionId,
    ...over
  }
}

async function createConfirmAndStart(): Promise<{
  assignmentId: string
  grantId: string
}> {
  const created = createAssignment(db, baseCreateParams())
  if (!created.success) throw new Error(`createAssignment failed: ${JSON.stringify(created)}`)
  const confirmed = confirmStudentAssignment(db, {
    callerUserId: teacherId,
    callerRole: 'TEACHER',
    assignmentId: created.assignmentId,
    confirmationMethod: 'TEACHER_ATTESTATION',
    confirmationEvidence: { attestedBy: teacherId }
  })
  if (!confirmed.success) {
    throw new Error(`confirmStudentAssignment failed: ${JSON.stringify(confirmed)}`)
  }
  const started = startAssignedAssessment(db, {
    callerUserId: studentId,
    callerRole: 'STUDENT',
    assignmentId: created.assignmentId
  })
  if (!started.success) throw new Error(`startAssignedAssessment failed: ${JSON.stringify(started)}`)
  return { assignmentId: created.assignmentId, grantId: created.grantId }
}

beforeEach(async () => {
  db = await createTestDb()
  mockState.db = db
  db.exec('DELETE FROM strategy_config')
  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  seedStrategy()
  seedPreparedSession()
})

afterEach(() => {
  db.close()
  mockState.db = null as unknown as typeof mockState.db
})

describe('assignment IPC handler', () => {
  it('create -> confirmStudent -> startAssessment 推进到 ONLINE_IN_PROGRESS', () => {
    const created = createAssignment(db, baseCreateParams())
    expect(created.success).toBe(true)
    if (!created.success) return

    expect(created).toMatchObject({
      businessSessionId: sessionId,
      sessionId,
      studentId,
      deliveryPhase: 'ASSIGNED',
      assignmentStatus: 'PENDING_CONFIRM',
      grantStatus: 'ACTIVE'
    })

    const afterCreate = db
      .prepare(
        `SELECT a.delivery_phase, bsa.status AS assignment_status, g.status AS grant_status
         FROM assessment_session a
         JOIN business_session_assignment bsa ON bsa.business_session_id = a.business_session_id
         JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
         WHERE a.session_id = ?`
      )
      .get(sessionId) as {
      delivery_phase: string
      assignment_status: string
      grant_status: string
    }
    expect(afterCreate).toEqual({
      delivery_phase: 'ASSIGNED',
      assignment_status: 'PENDING_CONFIRM',
      grant_status: 'ACTIVE'
    })

    const confirmed = confirmStudentAssignment(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      confirmationMethod: 'TEACHER_ATTESTATION',
      confirmationEvidence: { attestedBy: teacherId }
    })
    expect(confirmed).toMatchObject({
      success: true,
      assignmentId: created.assignmentId,
      deliveryPhase: 'STUDENT_CONFIRMED',
      assignmentStatus: 'ACTIVE'
    })

    const started = startAssignedAssessment(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      assignmentId: created.assignmentId
    })
    expect(started).toEqual({
      success: true,
      sessionId,
      assignmentId: created.assignmentId,
      deliveryPhase: 'ONLINE_IN_PROGRESS',
      firstQuestionId,
      firstQuestionOrder: 1
    })

    const session = db
      .prepare(
        `SELECT status, delivery_phase, current_question_id
         FROM assessment_session
         WHERE session_id = ?`
      )
      .get(sessionId) as {
      status: string
      delivery_phase: string
      current_question_id: string
    }
    expect(session).toEqual({
      status: 'ACTIVE',
      delivery_phase: 'ONLINE_IN_PROGRESS',
      current_question_id: firstQuestionId
    })
  })

  it('listMySessions 暴露 assignmentId + assignmentStatus（供学生端确认/启动）', () => {
    const created = createAssignment(db, baseCreateParams())
    if (!created.success) throw new Error(`createAssignment failed: ${JSON.stringify(created)}`)

    const listed = listMySessions(db, { callerUserId: studentId, callerRole: 'STUDENT' })
    expect(listed.success).toBe(true)
    if (!listed.success) return
    const row = listed.items.find((i) => i.sessionId === sessionId)
    expect(row).toBeDefined()
    expect(row?.assignmentId).toBe(created.assignmentId)
    expect(row?.assignmentStatus).toBe('PENDING_CONFIRM')
  })

  it('拒绝非教师创建、非活跃 runtime、过期 auth 和不支持的确认方式', () => {
    expect(
      createAssignment(db, {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        businessSessionId: sessionId
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })

    const inactiveRuntime = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })
    db.prepare(
      "UPDATE device_runtime_session SET status = 'ENDED' WHERE device_runtime_session_id = ?"
    ).run(inactiveRuntime.deviceRuntimeSessionId)
    expect(
      createAssignment(db, baseCreateParams({ deviceRuntimeSessionId: inactiveRuntime.deviceRuntimeSessionId }))
    ).toEqual({ success: false, errorCode: 'DEVICE_RUNTIME_NOT_ACTIVE' })

    const expiredAuthRuntime = seedLocalRuntimeContextFixture(db, {
      teacherUserId: teacherId,
      authExpiresAt: 'past'
    })
    expect(
      createAssignment(
        db,
        baseCreateParams({ deviceRuntimeSessionId: expiredAuthRuntime.deviceRuntimeSessionId })
      )
    ).toEqual({ success: false, errorCode: 'GRANT_AUTH_INVALID' })

    expect(
      createAssignment(
        db,
        baseCreateParams({
          confirmationMethod: 'PIN' as unknown as CreateAssignmentParams['confirmationMethod']
        })
      )
    ).toEqual({ success: false, errorCode: 'UNSUPPORTED_CONFIRMATION_METHOD' })
  })

  it('startAssessment 要求学生本人、ACTIVE assignment 和 STUDENT_CONFIRMED phase', () => {
    const created = createAssignment(db, baseCreateParams())
    expect(created.success).toBe(true)
    if (!created.success) return

    expect(
      startAssignedAssessment(db, {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        assignmentId: created.assignmentId
      })
    ).toEqual({ success: false, errorCode: 'ASSIGNMENT_NOT_ACTIVE' })

    const confirmed = confirmStudentAssignment(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      assignmentId: created.assignmentId,
      confirmationMethod: 'NONE_REQUIRED'
    })
    expect(confirmed.success).toBe(true)

    const otherStudentId = seedStudent(db)
    expect(
      startAssignedAssessment(db, {
        callerUserId: otherStudentId,
        callerRole: 'STUDENT',
        assignmentId: created.assignmentId
      })
    ).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('release 后不能再次 start，grant 过期时也拒绝 start', () => {
    const releasedFlow = createAssignment(db, baseCreateParams())
    expect(releasedFlow.success).toBe(true)
    if (!releasedFlow.success) return
    expect(
      confirmStudentAssignment(db, {
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        assignmentId: releasedFlow.assignmentId,
        confirmationMethod: 'TEACHER_ATTESTATION',
        confirmationEvidence: { attestedBy: teacherId }
      }).success
    ).toBe(true)
    expect(
      releaseAssignment(db, {
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        assignmentId: releasedFlow.assignmentId,
        releaseReason: 'TEACHER_RELEASED'
      }).success
    ).toBe(true)
    expect(
      startAssignedAssessment(db, {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        assignmentId: releasedFlow.assignmentId
      })
    ).toEqual({ success: false, errorCode: 'ASSIGNMENT_NOT_ACTIVE' })

    seedPreparedSession({ taskCode: `expired-grant-${uuidv4().slice(0, 8)}` })
    const expiredGrantFlow = createAssignment(db, baseCreateParams())
    expect(expiredGrantFlow.success).toBe(true)
    if (!expiredGrantFlow.success) return
    expect(
      confirmStudentAssignment(db, {
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        assignmentId: expiredGrantFlow.assignmentId,
        confirmationMethod: 'TEACHER_ATTESTATION',
        confirmationEvidence: { attestedBy: teacherId }
      }).success
    ).toBe(true)
    db.prepare("UPDATE delegated_access_grant SET status = 'EXPIRED' WHERE grant_id = ?").run(
      expiredGrantFlow.grantId
    )
    expect(
      startAssignedAssessment(db, {
        callerUserId: studentId,
        callerRole: 'STUDENT',
        assignmentId: expiredGrantFlow.assignmentId
      })
    ).toEqual({ success: false, errorCode: 'ASSIGNMENT_NOT_ACTIVE' })
  })

  it('rebind 无需重确认时替换 grant、version+1，并保留 ACTIVE', async () => {
    const { assignmentId, grantId } = await createConfirmAndStart()
    const newRuntime = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })

    const rebound = rebindAssignment(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId,
      newDeviceRuntimeSessionId: newRuntime.deviceRuntimeSessionId,
      requireReconfirmation: false,
      confirmationMethod: 'TEACHER_ATTESTATION'
    })
    expect(rebound).toMatchObject({
      success: true,
      assignmentId,
      oldGrantId: grantId,
      version: 2,
      assignmentStatus: 'ACTIVE',
      deliveryPhase: 'STUDENT_CONFIRMED',
      requiresStudentConfirmation: false
    })
    if (!rebound.success) return

    const row = db
      .prepare(
        `SELECT bsa.grant_id, bsa.version, bsa.status, g.status AS old_grant_status
         FROM business_session_assignment bsa
         JOIN delegated_access_grant g ON g.grant_id = ?
         WHERE bsa.assignment_id = ?`
      )
      .get(grantId, assignmentId) as {
      grant_id: string
      version: number
      status: string
      old_grant_status: string
    }
    expect(row).toEqual({
      grant_id: rebound.newGrantId,
      version: 2,
      status: 'ACTIVE',
      old_grant_status: 'EXPIRED'
    })
  })

  it('rebind 需重确认路径在 PENDING_CONFIRM assignment 上 version+1', () => {
    const created = createAssignment(db, baseCreateParams())
    expect(created.success).toBe(true)
    if (!created.success) return
    const newRuntime = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })

    const rebound = rebindAssignment(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      newDeviceRuntimeSessionId: newRuntime.deviceRuntimeSessionId,
      requireReconfirmation: true,
      confirmationMethod: 'TEACHER_ATTESTATION'
    })
    expect(rebound).toMatchObject({
      success: true,
      assignmentId: created.assignmentId,
      oldGrantId: created.grantId,
      version: 2,
      assignmentStatus: 'PENDING_CONFIRM',
      deliveryPhase: 'ASSIGNED',
      requiresStudentConfirmation: true
    })
  })

  it('release 终态 assignment 与 grant', () => {
    const created = createAssignment(db, baseCreateParams())
    expect(created.success).toBe(true)
    if (!created.success) return

    const released = releaseAssignment(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      releaseReason: 'TEACHER_RELEASED'
    })
    expect(released).toMatchObject({
      success: true,
      assignmentId: created.assignmentId,
      grantId: created.grantId,
      assignmentStatus: 'RELEASED',
      grantStatus: 'RELEASED'
    })

    const row = db
      .prepare(
        `SELECT bsa.status AS assignment_status, g.status AS grant_status
         FROM business_session_assignment bsa
         JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
         WHERE bsa.assignment_id = ?`
      )
      .get(created.assignmentId) as {
      assignment_status: string
      grant_status: string
    }
    expect(row).toEqual({
      assignment_status: 'RELEASED',
      grant_status: 'RELEASED'
    })
  })
})
