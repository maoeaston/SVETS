import { describe, expect, it } from 'vitest'
import { buildCommandEnvelopeV2 } from '../../command/command-envelope'
import { createTestDb, seedAssessmentSessionFixture, seedCaller, seedStudent } from '../../../db/test-helpers'
import { loadScoringPlannerSnapshot, ScoringPlanner } from '../scoring-planner'
import { loadReportGenerationSnapshotValue } from '../report-planner'

const TIME = '2026-08-01T07:00:00.000Z'

describe('preview result/report suppression', () => {
  it('turns a preview scoring command into a no-op before constructing formal result facts', async () => {
    const db = await createTestDb()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const sessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_job_skill_shelver_v1',
      strategyType: 'JOB_SKILL_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'UNBOX_AND_SHELF',
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    db.prepare(
      `UPDATE assessment_session
          SET session_contract_kind = 'PREVIEW_SHELL',
              preview_contract_version = 'PREVIEW_CONTRACT_V1'
        WHERE session_id = ?`
    ).run(sessionId)

    const envelope = buildCommandEnvelopeV2({
      commandId: '91000000-0000-4000-8000-000000000001',
      commandType: 'assessment:submitOperationScores',
      source: 'INTERNAL',
      actor: { kind: 'USER', userId: teacherId, role: 'TEACHER', authSessionId: 'preview-auth-1' },
      target: { aggregate_type: 'ASSESSMENT_SESSION', session_id: sessionId },
      payload: { toolChecklistConfirmed: true, scores: [] },
      requestHash: 'a'.repeat(64),
      createdAt: TIME,
      clientInstanceId: '92000000-0000-4000-8000-000000000001',
      idempotencyKey: '93000000-0000-4000-8000-000000000001',
      eventBatchId: '94000000-0000-4000-8000-000000000001',
      actorId: teacherId,
      deviceId: null,
      authSessionId: 'preview-auth-1',
      leaseOwner: 'preview-result-worker',
      leaseGeneration: 1
    })

    const snapshot = await loadScoringPlannerSnapshot(db, envelope, {
      timestamp: TIME,
      appVersion: 'preview-test'
    })
    const plan = new ScoringPlanner().plan({ envelope, snapshot })

    expect(plan.events).toEqual([])
    expect(plan.noOpResult).toEqual({ success: false, errorCode: 'PREVIEW_RESULT_SUPPRESSED' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM result_record WHERE source_aggregate_id = ?').get(sessionId)).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM task_report WHERE source_aggregate_id = ?').get(sessionId)).toEqual({ count: 0 })
    db.close()
  })

  it('rejects a preview JOB_SKILL report source before building formal report facts', async () => {
    const db = await createTestDb()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const sessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_job_skill_shelver_v1',
      strategyType: 'JOB_SKILL_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'UNBOX_AND_SHELF',
      status: 'COMPLETED',
      createdBy: teacherId
    })
    db.prepare(
      `UPDATE assessment_session
          SET session_contract_kind = 'PREVIEW_SHELL',
              preview_contract_version = 'PREVIEW_CONTRACT_V1'
        WHERE session_id = ?`
    ).run(sessionId)
    const eventId = '95000000-0000-4000-8000-000000000011'
    const resultId = '96000000-0000-4000-8000-000000000011'
    db.prepare(
      `INSERT INTO domain_event_projection (
        event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at
      ) VALUES (?, 'ASSESSMENT_SESSION', ?, 'SEED', 1, '{}', 'seed', 'seed.jsonl', 1, ?)`
    ).run(eventId, sessionId, TIME)
    db.prepare(
      `INSERT INTO result_record (
        result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, raw_score, max_score, normalized_score,
        completion_ratio, level_result, result_payload_json, generated_event_id,
        generated_at, is_current
      ) VALUES (?, ?, 'JOB_SKILL_SCORE', 'ASSESSMENT_SESSION', ?,
        'strategy_job_skill_shelver_v1', 'JOB_SKILL_ASSESSMENT', ?, 24, 48, 50,
        1, 'LEVEL_NOT_COMPETENT', '{}', ?, ?, 1)`
    ).run(resultId, studentId, sessionId, 'SUPERMARKET_SHELVER', eventId, TIME)

    expect(() => loadReportGenerationSnapshotValue(db, {
      reportScope: 'JOB_SKILL',
      sourceId: resultId,
      actorRole: 'TEACHER',
      timestamp: TIME,
      appVersion: 'preview-test',
      correlationId: 'preview-report-correlation'
    })).toThrowError(expect.objectContaining({ code: 'PREVIEW_RESULT_SUPPRESSED' }))
    expect(db.prepare('SELECT COUNT(*) AS count FROM task_report WHERE source_aggregate_id = ?').get(sessionId)).toEqual({ count: 0 })
    db.close()
  })
})
