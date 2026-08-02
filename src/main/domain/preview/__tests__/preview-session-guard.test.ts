import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { createTestDb, seedAssessmentSessionFixture, seedCaller, seedStudent } from '../../../db/test-helpers'
import { assertFormalAssessmentSession, isPreviewAssessmentSession } from '../preview-session-guard'

describe('preview session formal-path guard', () => {
  let db: MemoryAdapter
  let sessionId: string

  beforeEach(async () => {
    db = await createTestDb()
    const adminId = seedCaller(db, 'ADMIN')
    const studentId = seedStudent(db)
    sessionId = seedAssessmentSessionFixture(db, {
      sessionId: 'guard-session-1',
      studentId,
      strategyId: 'strategy_job_skill_shelver_v1',
      strategyType: 'JOB_SKILL_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'UNBOX_AND_SHELF',
      onlineQuestionCount: 1,
      offlineQuestionCount: 0,
      createdBy: adminId
    })
  })

  afterEach(() => db.close())

  it('allows a formal shell and rejects a preview shell with a stable suppression code', () => {
    expect(isPreviewAssessmentSession(db, sessionId)).toBe(false)
    expect(() => assertFormalAssessmentSession(db, sessionId)).not.toThrow()

    db.prepare(
      `UPDATE assessment_session
          SET session_contract_kind = 'PREVIEW_SHELL',
              preview_contract_version = 'PREVIEW_CONTRACT_V1'
        WHERE session_id = ?`
    ).run(sessionId)

    expect(isPreviewAssessmentSession(db, sessionId)).toBe(true)
    expect(() => assertFormalAssessmentSession(db, sessionId, 'formal test path')).toThrowError(
      expect.objectContaining({ code: 'PREVIEW_RESULT_SUPPRESSED' })
    )
  })
})
