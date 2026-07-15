import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  seedQuestionBank,
  seedAssessmentSessionFixture,
  seedStrategyReference
} from '../test-helpers'
import type { MemoryAdapter } from '../memory-adapter'

let db: MemoryAdapter

function seedSystemEvent(eventId: string): void {
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SYSTEM', ?, 'TEST_EVENT', 1, '{}', 'checksum', 'test', 1, datetime('now'))`
  ).run(eventId, eventId)
}

function schemaObjectExists(type: 'table' | 'index' | 'trigger', name: string): boolean {
  const row = db
    .prepare('SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ?')
    .get(type, name) as { present: number } | undefined
  return Boolean(row)
}

function seedM3Topology() {
  const teacherId = seedCaller(db, 'TEACHER')
  const studentId = seedStudent(db)
  db.prepare("INSERT INTO organization (organization_id, name) VALUES ('org_m3', 'M3 Org')").run()
  db.prepare(
    `INSERT INTO node (node_id, organization_id, node_name)
     VALUES ('node_m3', 'org_m3', 'M3 Node')`
  ).run()
  db.prepare(
    `INSERT INTO device (device_id, node_id, device_name, device_role, trust_state)
     VALUES ('device_m3', 'node_m3', 'M3 Device', 'STUDENT_WORKSTATION', 'TRUSTED')`
  ).run()
  db.prepare(
    `INSERT INTO device_runtime_session (device_runtime_session_id, device_id)
     VALUES ('runtime_m3', 'device_m3')`
  ).run()
  db.prepare(
    `INSERT INTO auth_session
       (auth_session_id, user_id, device_runtime_session_id, auth_method, capabilities_json,
        token_hash, expires_at, status)
     VALUES ('auth_teacher_m3', ?, 'runtime_m3', 'PASSWORD', '[]',
             'token_teacher_m3', datetime('now', '+1 day'), 'ACTIVE')`
  ).run(teacherId)
  const sessionId = seedAssessmentSessionFixture(db, {
    sessionId: 'assessment_m3',
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    status: 'INIT',
    createdBy: teacherId
  })
  return { teacherId, studentId, sessionId }
}

function insertGrant(over: Partial<{
  grantId: string
  businessSessionId: string
  teacherAuthSessionId: string
  teacherUserId: string
  studentId: string
  deviceId: string
  runtimeId: string
  status: string
}> = {}): void {
  db.prepare(
    `INSERT INTO delegated_access_grant
       (grant_id, business_session_id, teacher_auth_session_id, teacher_user_id,
        student_id, device_id, device_runtime_session_id, capabilities_json, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, datetime('now', '+1 day'))`
  ).run(
    over.grantId ?? 'grant_m3',
    over.businessSessionId ?? 'assessment_m3',
    over.teacherAuthSessionId ?? 'auth_teacher_m3',
    over.teacherUserId ?? '',
    over.studentId ?? '',
    over.deviceId ?? 'device_m3',
    over.runtimeId ?? 'runtime_m3',
    over.status ?? 'ACTIVE'
  )
}

describe('schema v0.1.10 scoring closure constraints', () => {
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('m3 schema baseline loads grant assignment objects and passes sqlite integrity checks', () => {
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, string>
    expect(Object.values(integrity)).toContain('ok')

    expect(
      db
        .prepare(
          "SELECT 1 AS present FROM schema_migration WHERE migration_id = '2026-07-15_mvp_schema_v0_1_15_multi_device_m3_grant_assignment'"
        )
        .get()
    ).toBeTruthy()

    for (const table of ['delegated_access_grant', 'business_session_assignment']) {
      expect(schemaObjectExists('table', table)).toBe(true)
    }
    for (const index of [
      'ux_grant_one_active_per_business_session',
      'idx_grant_student_device_status',
      'ux_assignment_one_active_per_grant',
      'ux_assignment_one_active_per_session',
      'ux_assignment_one_active_per_device'
    ]) {
      expect(schemaObjectExists('index', index)).toBe(true)
    }
    for (const trigger of [
      'trg_assessment_delivery_phase_forward_only',
      'trg_grant_self_consistency_insert',
      'trg_grant_self_consistency_update',
      'trg_assignment_grant_consistency_insert',
      'trg_assignment_grant_consistency_update',
      'trg_assignment_active_requires_active_grant_insert',
      'trg_assignment_active_requires_active_grant_update'
    ]) {
      expect(schemaObjectExists('trigger', trigger)).toBe(true)
    }
  })

  it('m3 delivery_phase enum allows assignment phases and D1 blocks illegal jumps', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedAssessmentSessionFixture(db, {
      sessionId: 'phase_assigned',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'phase-assigned-task',
      status: 'INIT',
      createdBy: teacherId
    })

    expect(() => {
      db.prepare("UPDATE assessment_session SET delivery_phase = 'ASSIGNED' WHERE session_id = 'phase_assigned'").run()
      db.prepare(
        "UPDATE assessment_session SET delivery_phase = 'STUDENT_CONFIRMED' WHERE session_id = 'phase_assigned'"
      ).run()
    }).not.toThrow()

    seedAssessmentSessionFixture(db, {
      sessionId: 'phase_prepared_jump',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'phase-prepared-jump-task',
      status: 'INIT',
      createdBy: teacherId
    })
    expect(() => {
      db.prepare(
        "UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = 'phase_prepared_jump'"
      ).run()
    }).toThrow(/PREPARED can only advance to ASSIGNED/)

    seedAssessmentSessionFixture(db, {
      sessionId: 'phase_assigned_jump',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'phase-assigned-jump-task',
      status: 'INIT',
      createdBy: teacherId
    })
    db.prepare("UPDATE assessment_session SET delivery_phase = 'ASSIGNED' WHERE session_id = 'phase_assigned_jump'").run()
    expect(() => {
      db.prepare(
        "UPDATE assessment_session SET delivery_phase = 'ONLINE_IN_PROGRESS' WHERE session_id = 'phase_assigned_jump'"
      ).run()
    }).toThrow(/ASSIGNED can only advance to STUDENT_CONFIRMED/)

    seedAssessmentSessionFixture(db, {
      sessionId: 'phase_finalized',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      taskCode: 'phase-finalized-task',
      status: 'COMPLETED',
      createdBy: teacherId
    })
    expect(() => {
      db.prepare("UPDATE assessment_session SET delivery_phase = 'OBSERVATION' WHERE session_id = 'phase_finalized'").run()
    }).toThrow(/FINALIZED|COMPLETED/)

    expect(() => {
      db.prepare("UPDATE assessment_session SET delivery_phase = 'INVALID_PHASE' WHERE session_id = 'phase_assigned'").run()
    }).toThrow()
  })

  it('m3 grant and assignment triggers reject inconsistent rows', () => {
    const { teacherId, studentId } = seedM3Topology()
    const otherStudentId = seedStudent(db, { studentName: '其他学生' })

    expect(() => {
      insertGrant({
        grantId: 'grant_bad_student',
        teacherUserId: teacherId,
        studentId: otherStudentId
      })
    }).toThrow(/grant self-consistency/)

    insertGrant({ grantId: 'grant_active_m3', teacherUserId: teacherId, studentId })
    expect(() => {
      db.prepare(
        `INSERT INTO business_session_assignment
           (assignment_id, business_session_id, student_id, device_id, grant_id, assigned_by, status)
         VALUES ('assignment_bad_actor', 'assessment_m3', ?, 'device_m3', 'grant_active_m3', ?, 'PENDING_CONFIRM')`
      ).run(studentId, studentId)
    }).toThrow(/assigned_by/)

    insertGrant({
      grantId: 'grant_expired_m3',
      teacherUserId: teacherId,
      studentId,
      status: 'EXPIRED'
    })
    expect(() => {
      db.prepare(
        `INSERT INTO business_session_assignment
           (assignment_id, business_session_id, student_id, device_id, grant_id, assigned_by, status)
         VALUES ('assignment_inactive_grant', 'assessment_m3', ?, 'device_m3', 'grant_expired_m3', ?, 'PENDING_CONFIRM')`
      ).run(studentId, teacherId)
    }).toThrow(/ACTIVE grant/)
  })

  it('offline_score_record requires score_scope and separates offline ability from task operation', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedQuestionBank(db)
    const q = db
      .prepare("SELECT question_id FROM question_bank WHERE question_type = 'OFFLINE_OPERATION' LIMIT 1")
      .get() as { question_id: string }
    seedAssessmentSessionFixture(db, {
      sessionId: 's1',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    seedSystemEvent('ev1')
    seedSystemEvent('ev2')

    expect(() => {
      db.prepare(
        `INSERT INTO offline_score_record
           (offline_score_id, session_id, question_id, score_scope, score, scoring_rubric_json,
            scored_by, scored_event_id, task_operation_code)
         VALUES ('os1', 's1', ?, 'OFFLINE_ABILITY', 2, '{}', ?, 'ev1', NULL)`
      ).run(q.question_id, teacherId)
    }).not.toThrow()

    expect(() => {
      db.prepare(
        `INSERT INTO offline_score_record
           (offline_score_id, session_id, question_id, score_scope, score, scoring_rubric_json,
            scored_by, scored_event_id, task_operation_code)
         VALUES ('os2', 's1', NULL, 'TASK_OPERATION', 2, '{}', ?, 'ev2', 'unbox_check')`
      ).run(teacherId)
    }).not.toThrow()

    expect(() => {
      db.prepare(
        `INSERT INTO offline_score_record
           (offline_score_id, session_id, question_id, score_scope, score, scoring_rubric_json,
            scored_by, scored_event_id, task_operation_code)
         VALUES ('os_bad', 's1', NULL, 'OFFLINE_ABILITY', 2, '{}', ?, 'ev1', NULL)`
      ).run(teacherId)
    }).toThrow()
  })

  it('referenced question semantic fields are frozen and revisions must use superseded_by_question_id', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedQuestionBank(db)
    const q = db
      .prepare("SELECT question_id FROM question_bank WHERE question_type <> 'OFFLINE_OPERATION' ORDER BY question_id LIMIT 1")
      .get() as { question_id: string }
    seedAssessmentSessionFixture(db, {
      sessionId: 's1',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'ACTIVE',
      createdBy: teacherId
    })
    db.prepare(
      `INSERT INTO assessment_session_question
         (session_question_id, session_id, question_id, question_order, question_phase,
          bank_domain, module_type, question_type, item_usage)
       SELECT 'sq1', 's1', question_id, 1, 'ONLINE',
              bank_domain, module_type, question_type, item_usage
         FROM question_bank WHERE question_id = ?`
    ).run(q.question_id)

    expect(() => {
      db.prepare("UPDATE question_bank SET content_json = '{}' WHERE question_id = ?").run(q.question_id)
    }).toThrow(/frozen/i)

    db.prepare(
      `INSERT INTO question_bank
         (question_id, job_code, bank_domain, module_type, question_type, item_usage, difficulty_level, content_json, scoring_rule_json, status)
       SELECT question_id || '_V2', job_code, bank_domain, module_type, question_type, item_usage, difficulty_level,
              content_json, scoring_rule_json, 'ACTIVE'
         FROM question_bank WHERE question_id = ?`
    ).run(q.question_id)
    expect(() => {
      db.prepare(
        "UPDATE question_bank SET status = 'ARCHIVED', superseded_by_question_id = question_id || '_V2' WHERE question_id = ?"
      ).run(q.question_id)
    }).not.toThrow()
  })

  it('online answer_record rejects score=1 after v1.0.6 binary scoring closure', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedQuestionBank(db)
    const q = db
      .prepare("SELECT question_id, question_type FROM question_bank WHERE question_type <> 'OFFLINE_OPERATION' LIMIT 1")
      .get() as { question_id: string; question_type: string }
    seedAssessmentSessionFixture(db, {
      sessionId: 's_binary',
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'ACTIVE',
      createdBy: teacherId
    })
    seedSystemEvent('ev_answer_binary')

    // v0.1.12: answer_record 需要先在 assessment_session_question 中存在（trg_answer_record_session_question_validation）
    db.prepare(
      `INSERT INTO assessment_session_question
         (session_question_id, session_id, question_id, question_order, question_phase,
          bank_domain, module_type, question_type, item_usage)
       SELECT 'sq_binary', 's_binary', question_id, 1, 'ONLINE',
              bank_domain, module_type, question_type, item_usage
         FROM question_bank WHERE question_id = ?`
    ).run(q.question_id)

    expect(() => {
      db.prepare(
        `INSERT INTO answer_record
           (answer_id, session_id, question_id, question_type, answer_payload_json, is_correct, score, submitted_event_id)
         VALUES ('a_bad', 's_binary', ?, ?, '{}', 0, 1, 'ev_answer_binary')`
      ).run(q.question_id, q.question_type)
    }).toThrow()

    expect(() => {
      db.prepare(
        `INSERT INTO answer_record
           (answer_id, session_id, question_id, question_type, answer_payload_json, is_correct, score, submitted_event_id)
         VALUES ('a_ok', 's_binary', ?, ?, '{}', 0, 0, 'ev_answer_binary')`
      ).run(q.question_id, q.question_type)
    }).not.toThrow()
  })

  it('result completion_ratio and placement review export guard are enforced', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedSystemEvent('ev_report')

    expect(() => {
      db.prepare(
        `INSERT INTO result_record
         (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
            job_code, normalized_score, level_result, completion_ratio, generated_event_id)
         VALUES ('r_bad', ?, 'ABILITY_SCORE', 'ASSESSMENT_SESSION', 's1',
                 'SUPERMARKET_SHELVER', 80, 'LEVEL_COMPETENT', 1.2, 'ev_report')`
      ).run(studentId)
    }).toThrow()

    db.prepare(
      `INSERT INTO task_report
       (report_id, report_type, student_id, source_aggregate_type, source_aggregate_id,
          report_title, report_content_json, generated_event_id, generated_by, status)
       VALUES ('rep1', 'FULL_REPORT', ?, 'ASSESSMENT_SESSION', 's1', '报告', '{}', 'ev_report', ?, 'GENERATED')`
    ).run(studentId, teacherId)

    expect(() => {
      db.prepare("UPDATE task_report SET status = 'EXPORTED' WHERE report_id = 'rep1'").run()
    }).toThrow(/placement review/i)

    expect(() => {
      db.prepare(
        "UPDATE task_report SET placement_review_by = ?, placement_review_at = datetime('now'), status = 'EXPORTED' WHERE report_id = 'rep1'"
      ).run(teacherId)
    }).not.toThrow()
  })

  it('m2-aware session fixtures create parent rows and delivery phases when m2 columns exist', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const completedId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'COMPLETED',
      createdBy: teacherId
    })
    const abortedId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      status: 'ABORTED',
      deliveryPhase: 'ONLINE_IN_PROGRESS',
      createdBy: teacherId
    })

    seedStrategyReference(db, 'strategy_training_shelver_v1', 1, 'training')

    const assessmentRows = db
      .prepare(
        `SELECT a.session_id, a.business_session_id, a.status, a.delivery_phase, b.session_type
           FROM assessment_session a
           JOIN business_session b ON b.business_session_id = a.business_session_id
          WHERE a.session_id IN (?, ?)
          ORDER BY a.status`
      )
      .all(completedId, abortedId) as Array<{
      session_id: string
      business_session_id: string
      status: string
      delivery_phase: string
      session_type: string
    }>

    expect(assessmentRows).toHaveLength(2)
    expect(assessmentRows.every((row) => row.session_id === row.business_session_id)).toBe(true)
    expect(assessmentRows.every((row) => row.session_type === 'ASSESSMENT')).toBe(true)
    expect(assessmentRows.find((row) => row.status === 'COMPLETED')!.delivery_phase).toBe('FINALIZED')
    expect(assessmentRows.find((row) => row.status === 'ABORTED')!.delivery_phase).toBe('ONLINE_IN_PROGRESS')

    const trainingParent = db
      .prepare("SELECT COUNT(*) AS count FROM business_session WHERE session_type = 'TRAINING'")
      .get() as { count: number }
    expect(trainingParent.count).toBe(1)
  })
})
