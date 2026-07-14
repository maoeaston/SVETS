import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, seedCaller, seedStudent, seedQuestionBank } from '../test-helpers'
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

describe('schema v0.1.10 scoring closure constraints', () => {
  beforeEach(async () => {
    db = await createTestDb()
  })

  it('offline_score_record requires score_scope and separates offline ability from task operation', () => {
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    seedQuestionBank(db)
    const q = db
      .prepare("SELECT question_id FROM question_bank WHERE question_type = 'OFFLINE_OPERATION' LIMIT 1")
      .get() as { question_id: string }
    db.prepare(
      `INSERT INTO assessment_session
         (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
          status, online_question_count, offline_question_count, created_by)
       VALUES ('s1', ?, 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER',
               'SHELVE_TASK', 1, 'OFFLINE_PENDING', 42, 8, ?)`
    ).run(studentId, teacherId)
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
    db.prepare(
      `INSERT INTO assessment_session
         (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
          status, online_question_count, offline_question_count, created_by)
       VALUES ('s1', ?, 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER',
               'SHELVE_TASK', 1, 'ACTIVE', 42, 8, ?)`
    ).run(studentId, teacherId)
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
    db.prepare(
      `INSERT INTO assessment_session
         (session_id, student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
          status, online_question_count, offline_question_count, created_by)
       VALUES ('s_binary', ?, 'strategy_baseline_shelver_v1', 'BASELINE_ASSESSMENT', 'SUPERMARKET_SHELVER',
               'SHELVE_TASK', 1, 'ACTIVE', 42, 8, ?)`
    ).run(studentId, teacherId)
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
})
