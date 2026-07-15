// T10: JOB_SKILL 专业岗位报告自动生成集成测试。
// 覆盖 TC-P01~P09 + 幂等 + 非 COMPLETED/非 JOB_SKILL 守卫。

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      if (!mockState.db) throw new Error('mock writeEvent: mockState.db not set')
      const eventId = uuidv4()
      const row = mockState.db
        .prepare('SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_id = ?')
        .get(params.aggregateId) as { max_seq: number | null }
      const eventSequence = (row.max_seq ?? 0) + 1
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId, aggregate_type: params.aggregateType, aggregate_id: params.aggregateId,
        event_type: params.eventType, event_sequence: eventSequence, payload: params.payload,
        checksum: 'test-checksum', schema_version: 1, created_at: new Date().toISOString(),
        actor_id: params.actorId, actor_role: params.actorRole, app_version: 'test'
      }
      mockState.db
        .prepare(
          `INSERT INTO domain_event_projection (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(entry.event_id, entry.aggregate_type, entry.aggregate_id, entry.event_type,
          entry.event_sequence, JSON.stringify(entry.payload), entry.checksum,
          'test.jsonl', entry.schema_version, entry.created_at)
      return entry
    }
  )
}))

import { createSession, seedAssessmentErrorCodes } from '../assessment'
import { submitJobSkillOfflineScores } from '../job-skill-scoring'
import { recordTeacherObservation } from '../observation'
import { maybeGenerateJobSkillReport } from '../job-skill-report'
import {
  createTestDb,
  seedCaller,
  seedStudent,
  setAssessmentSessionStateFixture
} from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { CreateSessionParams } from '../../../../shared/types/assessment'
import type { ReportContentJobSkill } from '../../../../shared/types/json-schemas'

const JOB_MODULES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const JOB_TASK_CODE = 'JOB_SKILL_DEMO_M1M6'

function seedJobSkillBank(db: MemoryAdapter) {
  const onlineIds: string[] = []
  const offlineIds: string[] = []
  const obsIds: string[] = []
  const onlineStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, ?, 'SCORED_ITEM', ?, '{"seed":true}', 'ACTIVE')`
  )
  const offlineStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'OFFLINE_OPERATION', 'SCORED_ITEM', '{"seed":true}', '{"scoring_type":"OFFLINE_RUBRIC","max_score":2}', 'ACTIVE')`
  )
  const obsStmt = db.prepare(
    `INSERT INTO question_bank (question_id, job_code, bank_domain, job_module_code, question_type, item_usage, content_json, scoring_rule_json, status) VALUES (?, 'SUPERMARKET_SHELVER', 'JOB_SPECIFIC', ?, 'TRUE_FALSE', 'OBSERVATION_ONLY', '{"seed":true}', '{"seed":true}', 'ACTIVE')`
  )
  for (const mod of JOB_MODULES) {
    for (const qtype of ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const) {
      const id = `${mod}_${qtype.slice(0, 2)}_${uuidv4().slice(0, 6)}`
      const content = qtype === 'TRUE_FALSE' ? { question_type: 'TRUE_FALSE', expected_answer: true } : { seed: true }
      onlineStmt.run(id, mod, qtype, JSON.stringify(content))
      onlineIds.push(id)
    }
    const offId = `${mod}_OP_${uuidv4().slice(0, 6)}`
    offlineStmt.run(offId, mod)
    offlineIds.push(offId)
  }
  for (const mod of ['M1', 'M5'] as const) {
    const id = `${mod}_OB_${uuidv4().slice(0, 6)}`
    obsStmt.run(id, mod)
    obsIds.push(id)
  }
  return { onlineIds, offlineIds, obsIds, scoredIds: [...onlineIds, ...offlineIds] }
}

function seedStrategy(db: MemoryAdapter, bankIds: { scoredIds: string[]; obsIds: string[] }): string {
  const id = `strategy_t10_${uuidv4().slice(0, 6)}`
  db.prepare(
    `INSERT INTO strategy_config (strategy_id, strategy_type, job_code, strategy_name, online_question_count, offline_question_count, max_score, competent_threshold, conditional_threshold, module_veto_threshold, emotion_collapse_threshold, question_policy_json, scoring_policy_json, supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring, version, is_active) VALUES (?, 'JOB_SKILL_ASSESSMENT', 'SUPERMARKET_SHELVER', 'T10', 18, 6, 48, 80, 60, 0.5, 3, ?, '{"schema_version":"scoring-policy-v1.2","assessment_scope":"JOB_SKILL","online_score_values":[0,2],"offline_score_values":[0,1,2],"normalization":"raw_score/max_score*100","module_veto_mode":"DISABLED_RECORD_ONLY","training_focus_threshold":0.6,"safety_override_enabled":true,"placement_advice_enabled":false}', 1, 1, 1, 1, 1)`
  ).run(id, JSON.stringify({
    schema_version: 'question-policy-v1.2', bank_domain: 'JOB_SPECIFIC', selection_mode: 'FIXED_SET',
    job_module_quotas: Object.fromEntries(JOB_MODULES.map((m) => [m, { online: 3, offline: 1 }])),
    fixed_scored_question_ids: bankIds.scoredIds, embedded_observation_question_ids: bankIds.obsIds,
    fallback_strategy: 'BLOCK'
  }))
  return id
}

let db: MemoryAdapter
let callerId: string
let studentId: string
let strategyId: string
let bankIds: { scoredIds: string[]; obsIds: string[]; onlineIds: string[]; offlineIds: string[] }

function baseParams(over: Partial<CreateSessionParams> = {}): CreateSessionParams {
  return {
    callerUserId: callerId, callerRole: 'TEACHER',
    studentId, strategyId, strategyVersion: 1, taskCode: JOB_TASK_CODE, ...over
  }
}

function createOfflinePendingSession(): string {
  const result = createSession(db, baseParams())
  if (!result.success) throw new Error('createSession failed')
  setAssessmentSessionStateFixture(db, result.sessionId, 'OFFLINE_PENDING')
  return result.sessionId
}

beforeAll(async () => {
  db = await createTestDb()
  db.exec('DROP TRIGGER IF EXISTS trg_assessment_session_no_delete')
})
afterAll(() => db.close())

beforeEach(() => {
  db.exec('DELETE FROM task_report')
  db.exec('DELETE FROM assessment_session_question')
  db.exec('DELETE FROM answer_record')
  db.exec('DELETE FROM offline_score_record')
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM safety_incident_binding')
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM safety_incident')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM question_bank')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedAssessmentErrorCodes(db)
  callerId = seedCaller(db, 'TEACHER')
  studentId = seedStudent(db)
  bankIds = seedJobSkillBank(db)
  strategyId = seedStrategy(db, bankIds)
  mockState.db = db
})

// 完整流程辅助：submit 6 offline + record 2 observations → 触发 T9(结果) → T10(报告)
function completeSession(sessionId: string, offlineScore: 0 | 1 | 2 = 2) {
  submitJobSkillOfflineScores(db, {
    callerUserId: callerId, callerRole: 'TEACHER', sessionId,
    scores: bankIds.offlineIds.map((questionId) => ({ questionId, score: offlineScore }))
  })
  for (const questionId of bankIds.obsIds) {
    recordTeacherObservation(db, {
      callerUserId: callerId, callerRole: 'TEACHER', sessionId, questionId,
      observationPayload: {
        schema_version: 'teacher-observation-v1.0', observation_code: 'OB_TEST',
        observed: true, behavior_codes: [], prompt_level: 'P1',
        accommodations_used: [], observation_note: '测试观察说明',
        recorded_by: callerId, recorded_at: new Date().toISOString()
      }
    })
  }
}

function getReportContent(sessionId: string): ReportContentJobSkill | undefined {
  const row = db
    .prepare(
      `SELECT report_content_json FROM task_report
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION' AND source_aggregate_id = ?
          AND report_type = 'FULL_REPORT'`
    )
    .get(sessionId) as { report_content_json: string } | undefined
  return row ? (JSON.parse(row.report_content_json) as ReportContentJobSkill) : undefined
}

describe('TC-P: JOB_SKILL 专业岗位报告', () => {
  it('TC-P01 完整流程生成 report_scope=JOB_SKILL 报告', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const content = getReportContent(sessionId)
    expect(content).toBeDefined()
    expect(content?.report_schema_version).toBe('job-skill-report-v1.0')
    expect(content?.report_scope).toBe('JOB_SKILL')
  })

  it('TC-P01b 报告存入 task_report 表（不新增表）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const row = db
      .prepare(
        `SELECT report_id, report_type, status FROM task_report
          WHERE source_aggregate_id = ? AND report_type = 'FULL_REPORT'`
      )
      .get(sessionId) as { report_id: string; report_type: string; status: string } | undefined
    expect(row).toBeDefined()
    expect(row?.report_type).toBe('FULL_REPORT')
    expect(row?.status).toBe('GENERATED')
  })

  it('TC-P02 报告包含 M1-M6 所有模块画像', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const content = getReportContent(sessionId)
    expect(content?.job_module_profiles).toHaveLength(6)
    const codes = content?.job_module_profiles.map((p) => p.job_module_code)
    expect(codes).toContain('M1')
    expect(codes).toContain('M6')
  })

  it('TC-P03 每模块有 online_raw_score 和 offline_raw_score 分开展示', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 2)

    const content = getReportContent(sessionId)
    for (const profile of content?.job_module_profiles ?? []) {
      expect(typeof profile.online_raw_score).toBe('number')
      expect(typeof profile.offline_raw_score).toBe('number')
      expect(typeof profile.online_max_score).toBe('number')
      expect(typeof profile.offline_max_score).toBe('number')
    }
  })

  it('TC-P04 overall_summary.level_result 存在，teacher_observations 非空', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const content = getReportContent(sessionId)
    expect(content?.overall_summary.level_result).toBeDefined()
    expect(content?.overall_summary.level_result.length).toBeGreaterThan(0)
    // 录入了 2 条观察项
    expect(content?.teacher_observations).toHaveLength(2)
    expect(content?.teacher_observations[0].observation_code).toBe('OB_TEST')
    expect(content?.teacher_observations[0].prompt_level).toBe('P1')
    expect(content?.teacher_observations[0].observation_note).toBe('测试观察说明')
  })

  it('TC-P05 M2 低分（score_rate<60%）→ recommended_training_tasks 含 M2 + task_code=SHELVE_TASK', () => {
    // 全 0 分 → 所有模块 score_rate=0 < 0.6 → M2 推荐含 SHELVE_TASK
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 0)

    const content = getReportContent(sessionId)
    const m2Task = content?.recommended_training_tasks.find((t) => t.job_module_code === 'M2')
    expect(m2Task).toBeDefined()
    expect(m2Task?.task_code).toBe('SHELVE_TASK')
    expect(m2Task?.has_existing_training).toBe(true)
  })

  it('TC-P06 报告不输出就业安置结论（placement_advice.enabled=false）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const content = getReportContent(sessionId)
    expect(content?.placement_advice.enabled).toBe(false)

    // 报告全文不含就业判断字样
    const raw = JSON.stringify(content)
    expect(raw).not.toContain('适合就业')
    expect(raw).not.toContain('不适合就业')
    expect(raw).not.toContain('竞争性就业')
    expect(raw).not.toContain('支持性就业')
  })

  it('TC-P07 M3-M6 低分只有建议文案，task_code=null（无虚假链接）', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 0) // 全0分，M3-M6均低分

    const content = getReportContent(sessionId)
    for (const mod of ['M3', 'M4', 'M5', 'M6'] as const) {
      const task = content?.recommended_training_tasks.find((t) => t.job_module_code === mod)
      if (task) {
        expect(task.task_code).toBeNull()
        expect(task.has_existing_training).toBe(false)
        expect(task.recommendation_text.length).toBeGreaterThan(0)
      }
    }
  })

  it('TC-P08 M1 低分不切换为 ABILITY_SCORE 链路', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId, 0)

    const rows = db
      .prepare('SELECT result_type FROM result_record WHERE source_aggregate_id = ?')
      .all(sessionId) as { result_type: string }[]
    // 只有 JOB_SKILL_SCORE，无 ABILITY_SCORE
    expect(rows.every((r) => r.result_type === 'JOB_SKILL_SCORE')).toBe(true)
    expect(rows.some((r) => r.result_type === 'ABILITY_SCORE')).toBe(false)
  })

  it('TC-P09 报告存储在 task_report.report_content_json，无新增表', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    // 无新增表（job_skill_report 不存在）
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_skill_report'`)
      .get()
    expect(tableExists).toBeUndefined()

    // 报告在 task_report 中
    const row = db
      .prepare('SELECT report_content_json FROM task_report WHERE source_aggregate_id = ?')
      .get(sessionId) as { report_content_json: string } | undefined
    expect(row).toBeDefined()
    const parsed = JSON.parse(row!.report_content_json)
    expect(parsed.report_schema_version).toBe('job-skill-report-v1.0')
  })

  it('幂等：多次调用 maybeGenerateJobSkillReport 只生成一条 task_report', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    // 再次调用，应无副作用
    expect(() => maybeGenerateJobSkillReport(db, sessionId, callerId)).not.toThrow()
    expect(() => maybeGenerateJobSkillReport(db, sessionId, callerId)).not.toThrow()

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM task_report WHERE source_aggregate_id = ?')
      .get(sessionId) as { n: number }
    expect(count.n).toBe(1)
  })

  it('守卫：非 COMPLETED session 不生成报告', () => {
    const sessionId = createOfflinePendingSession()
    // session 仍处于 OFFLINE_PENDING，未调用 completeSession
    expect(() => maybeGenerateJobSkillReport(db, sessionId, callerId)).not.toThrow()

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM task_report WHERE source_aggregate_id = ?')
      .get(sessionId) as { n: number }
    expect(count.n).toBe(0)
  })

  it('守卫：sessionId 不存在时不抛错', () => {
    expect(() =>
      maybeGenerateJobSkillReport(db, 'non-existent-session', callerId)
    ).not.toThrow()
  })

  it('REPORT_GENERATED 事件写入 domain_event_projection', () => {
    const sessionId = createOfflinePendingSession()
    completeSession(sessionId)

    const event = db
      .prepare(`SELECT event_type, aggregate_type FROM domain_event_projection WHERE event_type = 'REPORT_GENERATED' LIMIT 1`)
      .get() as { event_type: string; aggregate_type: string } | undefined
    expect(event).toBeDefined()
    expect(event?.aggregate_type).toBe('TASK_REPORT')
  })
})
