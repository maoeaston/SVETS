import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { applyAssignmentEvent } from '../assignment-reducer'
import { applyAssessmentEvent } from '../assessment-reducer'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedLocalRuntimeContextFixture,
  seedQuestionBank,
  seedStudent,
  baseStrategyInput
} from '../../db/test-helpers'
import type { MemoryAdapter } from '../../db/memory-adapter'
import type { DBAdapter } from '../../db/interface'
import type { StrategyInput } from '../../../shared/types/strategy'
import type {
  ActionLogEntry,
  AssignmentAssessmentStartedPayload,
  AssignmentCreatedPayload,
  AssignmentReleasedPayload,
  AssignmentStudentConfirmedPayload,
  EventType,
  GrantReboundPayload
} from '@shared/types/event-payloads'
import type { LocalRuntimeContextFixture } from '../../db/test-helpers'

let db: MemoryAdapter
let teacherId: string
let studentId: string
let strategyId: string
let runtime: LocalRuntimeContextFixture
let sessionId: string
let firstQuestionId: string

const strategyVersion = 1
const jobCode = 'SUPERMARKET_SHELVER'
const taskCode = 'SHELVE_TASK'

function seedStrategyConfig(db: DBAdapter, over: Partial<StrategyInput> = {}): void {
  const s = baseStrategyInput(over)
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

function seedEvent(db: DBAdapter, event: ActionLogEntry): void {
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.event_id,
    event.aggregate_type,
    event.aggregate_id,
    event.event_type,
    event.event_sequence,
    JSON.stringify(event.payload),
    event.checksum,
    'assignment-reducer.test.jsonl',
    event.schema_version,
    event.created_at
  )
}

function makeEvent(
  eventType: EventType,
  payload: Record<string, unknown>,
  over: Partial<ActionLogEntry> = {}
): ActionLogEntry {
  return {
    event_id: uuidv4(),
    aggregate_type: eventType === 'ASSIGNMENT_ASSESSMENT_STARTED' ? 'ASSESSMENT_SESSION' : 'BUSINESS_SESSION',
    aggregate_id: eventType === 'ASSIGNMENT_ASSESSMENT_STARTED' ? sessionId : sessionId,
    event_type: eventType,
    event_sequence: over.event_sequence ?? 1,
    payload,
    checksum: `test-checksum-${eventType}`,
    schema_version: 1,
    created_at: over.created_at ?? '2026-07-15T00:00:00.000Z',
    actor_id: over.actor_id ?? teacherId,
    actor_role: over.actor_role ?? 'TEACHER',
    app_version: 'test',
    ...over
  }
}

function makeAssignmentCreatedEvent(over: Partial<AssignmentCreatedPayload> = {}): ActionLogEntry {
  const payload: AssignmentCreatedPayload = {
    business_session_id: sessionId,
    session_id: sessionId,
    assignment_id: uuidv4(),
    grant_id: uuidv4(),
    student_id: studentId,
    device_id: runtime.deviceId,
    device_runtime_session_id: runtime.deviceRuntimeSessionId,
    teacher_auth_session_id: runtime.teacherAuthSessionId,
    teacher_user_id: teacherId,
    capabilities: ['ASSESSMENT_START'],
    identity_confirmation_method: 'TEACHER_ATTESTATION',
    grant_status: 'ACTIVE',
    assignment_status: 'PENDING_CONFIRM',
    assigned_by: teacherId,
    assigned_at: '2026-07-15T00:01:00.000Z',
    granted_at: '2026-07-15T00:01:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    delivery_phase_before: 'PREPARED',
    delivery_phase_after: 'ASSIGNED',
    ...over
  }
  return makeEvent('ASSIGNMENT_CREATED', payload as unknown as Record<string, unknown>, {
    event_sequence: 2
  })
}

function makeStudentConfirmedEvent(params: {
  assignmentId: string
  grantId: string
  eventSequence?: number
}): ActionLogEntry {
  const payload: AssignmentStudentConfirmedPayload = {
    business_session_id: sessionId,
    session_id: sessionId,
    assignment_id: params.assignmentId,
    grant_id: params.grantId,
    student_id: studentId,
    device_id: runtime.deviceId,
    confirmed_by: teacherId,
    identity_confirmation_method: 'TEACHER_ATTESTATION',
    confirmation_evidence: { attested_by: teacherId },
    student_pin_verified: false,
    teacher_attested: true,
    confirmed_at: '2026-07-15T00:02:00.000Z',
    assignment_status_before: 'PENDING_CONFIRM',
    assignment_status_after: 'ACTIVE',
    delivery_phase_before: 'ASSIGNED',
    delivery_phase_after: 'STUDENT_CONFIRMED'
  }
  return makeEvent('ASSIGNMENT_STUDENT_CONFIRMED', payload as unknown as Record<string, unknown>, {
    event_sequence: params.eventSequence ?? 3
  })
}

function makeAssessmentStartedEvent(params: {
  assignmentId: string
  grantId: string
  eventSequence?: number
}): ActionLogEntry {
  const payload: AssignmentAssessmentStartedPayload = {
    business_session_id: sessionId,
    session_id: sessionId,
    assignment_id: params.assignmentId,
    grant_id: params.grantId,
    student_id: studentId,
    device_id: runtime.deviceId,
    first_question_id: firstQuestionId,
    first_question_order: 1,
    started_at: '2026-07-15T00:03:00.000Z',
    delivery_phase_before: 'STUDENT_CONFIRMED',
    delivery_phase_after: 'ONLINE_IN_PROGRESS'
  }
  return makeEvent('ASSIGNMENT_ASSESSMENT_STARTED', payload as unknown as Record<string, unknown>, {
    actor_id: studentId,
    actor_role: 'STUDENT',
    event_sequence: params.eventSequence ?? 4
  })
}

async function resetDb(): Promise<void> {
  db = await createTestDb()
  db.exec('DELETE FROM strategy_config')
  teacherId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  runtime = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })
  strategyId = `assignment-strategy-${uuidv4().slice(0, 8)}`
  seedStrategyConfig(db, {
    strategyId,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode,
    version: strategyVersion
  })
  seedQuestionBank(db, { jobCode })
  firstQuestionId = (
    db
      .prepare("SELECT question_id FROM question_bank WHERE question_type <> 'OFFLINE_OPERATION' ORDER BY question_id LIMIT 1")
      .get() as { question_id: string }
  ).question_id
  sessionId = seedAssessmentSessionFixture(db, {
    studentId,
    strategyId,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode,
    taskCode,
    strategyVersion,
    status: 'INIT',
    createdBy: teacherId
  })
}

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  db.close()
})

describe('applyAssignmentEvent', () => {
  it('创建、确认、启动三步按 D1 合法推进', () => {
    const created = makeAssignmentCreatedEvent()
    seedEvent(db, created)
    applyAssignmentEvent(db, created)

    const createdPayload = created.payload as unknown as AssignmentCreatedPayload
    const afterCreate = db
      .prepare(
        `SELECT a.delivery_phase, g.status AS grant_status, bsa.status AS assignment_status
           FROM assessment_session a
           JOIN delegated_access_grant g ON g.grant_id = ?
           JOIN business_session_assignment bsa ON bsa.assignment_id = ?
          WHERE a.session_id = ?`
      )
      .get(createdPayload.grant_id, createdPayload.assignment_id, sessionId) as {
      delivery_phase: string
      grant_status: string
      assignment_status: string
    }
    expect(afterCreate).toMatchObject({
      delivery_phase: 'ASSIGNED',
      grant_status: 'ACTIVE',
      assignment_status: 'PENDING_CONFIRM'
    })

    const confirmed = makeStudentConfirmedEvent({
      assignmentId: createdPayload.assignment_id,
      grantId: createdPayload.grant_id
    })
    seedEvent(db, confirmed)
    applyAssignmentEvent(db, confirmed)

    const afterConfirm = db
      .prepare(
        `SELECT a.delivery_phase, g.confirmed_by, g.teacher_attested, bsa.status, bsa.student_confirmed_at
           FROM assessment_session a
           JOIN delegated_access_grant g ON g.grant_id = ?
           JOIN business_session_assignment bsa ON bsa.assignment_id = ?
          WHERE a.session_id = ?`
      )
      .get(createdPayload.grant_id, createdPayload.assignment_id, sessionId) as {
      delivery_phase: string
      confirmed_by: string
      teacher_attested: number
      status: string
      student_confirmed_at: string
    }
    expect(afterConfirm).toMatchObject({
      delivery_phase: 'STUDENT_CONFIRMED',
      confirmed_by: teacherId,
      teacher_attested: 1,
      status: 'ACTIVE',
      student_confirmed_at: '2026-07-15T00:02:00.000Z'
    })

    const started = makeAssessmentStartedEvent({
      assignmentId: createdPayload.assignment_id,
      grantId: createdPayload.grant_id
    })
    seedEvent(db, started)
    applyAssessmentEvent(db, started)

    const afterStart = db
      .prepare('SELECT status, delivery_phase, current_question_id, started_at FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as {
      status: string
      delivery_phase: string
      current_question_id: string
      started_at: string
    }
    expect(afterStart).toEqual({
      status: 'ACTIVE',
      delivery_phase: 'ONLINE_IN_PROGRESS',
      current_question_id: firstQuestionId,
      started_at: '2026-07-15T00:03:00.000Z'
    })
  })

  it('重复 apply 不重复插入、不重复 version+1', () => {
    const created = makeAssignmentCreatedEvent()
    seedEvent(db, created)
    applyAssignmentEvent(db, created)
    applyAssignmentEvent(db, created)

    const createdPayload = created.payload as unknown as AssignmentCreatedPayload
    expect((db.prepare('SELECT COUNT(*) AS c FROM delegated_access_grant').get() as { c: number }).c).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS c FROM business_session_assignment').get() as { c: number }).c).toBe(1)

    const confirmed = makeStudentConfirmedEvent({
      assignmentId: createdPayload.assignment_id,
      grantId: createdPayload.grant_id
    })
    seedEvent(db, confirmed)
    applyAssignmentEvent(db, confirmed)

    const newRuntime = seedLocalRuntimeContextFixture(db, { teacherUserId: teacherId })
    const reboundPayload: GrantReboundPayload = {
      business_session_id: sessionId,
      session_id: sessionId,
      assignment_id: createdPayload.assignment_id,
      student_id: studentId,
      device_id: newRuntime.deviceId,
      old_grant_id: createdPayload.grant_id,
      new_grant_id: uuidv4(),
      old_device_runtime_session_id: runtime.deviceRuntimeSessionId,
      new_device_runtime_session_id: newRuntime.deviceRuntimeSessionId,
      teacher_auth_session_id: newRuntime.teacherAuthSessionId,
      teacher_user_id: teacherId,
      capabilities: ['ASSESSMENT_START'],
      identity_confirmation_method: 'TEACHER_ATTESTATION',
      require_reconfirmation: false,
      assignment_version_before: 1,
      assignment_version_after: 2,
      assignment_status_before: 'ACTIVE',
      assignment_status_after: 'ACTIVE',
      old_grant_status_after: 'EXPIRED',
      new_grant_status: 'ACTIVE',
      replaces_grant_id: createdPayload.grant_id,
      student_confirmed_at_after: '2026-07-15T00:02:00.000Z',
      delivery_phase_after: 'STUDENT_CONFIRMED',
      granted_at: '2026-07-15T00:04:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      rebound_at: '2026-07-15T00:04:00.000Z'
    }
    const rebound = makeEvent('GRANT_REBOUND', reboundPayload as unknown as Record<string, unknown>, {
      event_sequence: 4
    })
    seedEvent(db, rebound)
    applyAssignmentEvent(db, rebound)
    applyAssignmentEvent(db, rebound)

    const assignment = db
      .prepare('SELECT grant_id, version, status FROM business_session_assignment WHERE assignment_id = ?')
      .get(createdPayload.assignment_id) as { grant_id: string; version: number; status: string }
    expect(assignment).toEqual({
      grant_id: reboundPayload.new_grant_id,
      version: 2,
      status: 'ACTIVE'
    })
    expect((db.prepare('SELECT COUNT(*) AS c FROM delegated_access_grant').get() as { c: number }).c).toBe(2)
  })

  it('乱序确认或启动在缺少前置状态时不写非法 phase', () => {
    const created = makeAssignmentCreatedEvent()
    const createdPayload = created.payload as unknown as AssignmentCreatedPayload

    const confirmed = makeStudentConfirmedEvent({
      assignmentId: createdPayload.assignment_id,
      grantId: createdPayload.grant_id,
      eventSequence: 3
    })
    seedEvent(db, confirmed)
    applyAssignmentEvent(db, confirmed)

    const afterConfirmOnly = db
      .prepare('SELECT delivery_phase, event_sequence_version FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { delivery_phase: string; event_sequence_version: number }
    expect(afterConfirmOnly.delivery_phase).toBe('PREPARED')
    expect(afterConfirmOnly.event_sequence_version).toBe(0)

    const started = makeAssessmentStartedEvent({
      assignmentId: createdPayload.assignment_id,
      grantId: createdPayload.grant_id,
      eventSequence: 4
    })
    seedEvent(db, started)
    applyAssessmentEvent(db, started)

    const afterStartOnly = db
      .prepare('SELECT status, delivery_phase, current_question_id, event_sequence_version FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as {
      status: string
      delivery_phase: string
      current_question_id: string | null
      event_sequence_version: number
    }
    expect(afterStartOnly).toMatchObject({
      status: 'INIT',
      delivery_phase: 'PREPARED',
      current_question_id: null,
      event_sequence_version: 0
    })
  })

  it('D9-D11 冲突时抛错并由事务回滚', () => {
    const created = makeAssignmentCreatedEvent({
      student_id: uuidv4()
    })
    seedEvent(db, created)

    expect(() => db.transaction(() => applyAssignmentEvent(db, created))()).toThrow(
      /assignment event conflicts|grant self-consistency/
    )
    expect((db.prepare('SELECT COUNT(*) AS c FROM delegated_access_grant').get() as { c: number }).c).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS c FROM business_session_assignment').get() as { c: number }).c).toBe(0)
    expect(
      (db.prepare('SELECT delivery_phase FROM assessment_session WHERE session_id = ?').get(sessionId) as { delivery_phase: string })
        .delivery_phase
    ).toBe('PREPARED')
  })

  it('release 终态 assignment 与 grant，并标记事件序列', () => {
    const created = makeAssignmentCreatedEvent()
    seedEvent(db, created)
    applyAssignmentEvent(db, created)

    const createdPayload = created.payload as unknown as AssignmentCreatedPayload
    const releasePayload: AssignmentReleasedPayload = {
      business_session_id: sessionId,
      session_id: sessionId,
      assignment_id: createdPayload.assignment_id,
      grant_id: createdPayload.grant_id,
      student_id: studentId,
      device_id: runtime.deviceId,
      release_reason: 'TEACHER_RELEASED',
      released_by: teacherId,
      released_at: '2026-07-15T00:05:00.000Z',
      assignment_status_before: 'PENDING_CONFIRM',
      assignment_status_after: 'RELEASED',
      grant_status_before: 'ACTIVE',
      grant_status_after: 'RELEASED',
      delivery_phase_at_release: 'ASSIGNED'
    }
    const released = makeEvent('ASSIGNMENT_RELEASED', releasePayload as unknown as Record<string, unknown>, {
      event_sequence: 3
    })
    seedEvent(db, released)
    applyAssignmentEvent(db, released)

    const row = db
      .prepare(
        `SELECT a.event_sequence_version, bsa.status AS assignment_status, bsa.release_reason,
                g.status AS grant_status, g.release_reason AS grant_release_reason
           FROM assessment_session a
           JOIN business_session_assignment bsa ON bsa.assignment_id = ?
           JOIN delegated_access_grant g ON g.grant_id = ?
          WHERE a.session_id = ?`
      )
      .get(createdPayload.assignment_id, createdPayload.grant_id, sessionId) as {
      event_sequence_version: number
      assignment_status: string
      release_reason: string
      grant_status: string
      grant_release_reason: string
    }
    expect(row).toMatchObject({
      event_sequence_version: 3,
      assignment_status: 'RELEASED',
      release_reason: 'TEACHER_RELEASED',
      grant_status: 'RELEASED',
      grant_release_reason: 'TEACHER_RELEASED'
    })
  })
})
