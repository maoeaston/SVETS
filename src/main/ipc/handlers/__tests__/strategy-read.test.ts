// strategy:list / get / listVersions 集成测试。
// 覆盖 PRD 验收 #12, #25-27（list 过滤/分页）+ get Detail + listVersions + FORBIDDEN。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { listStrategies, getStrategy, listVersions, seedStrategyErrorCodes } from '../strategy'
import { createTestDb, seedCaller, baseStrategyInput } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

let db: MemoryAdapter
let adminId: string

/** 直接 INSERT 一条 strategy_config 行，指定 is_active 与 version。 */
function insertStrategy(
  strategyId: string,
  over: { version?: number; isActive?: boolean; jobCode?: string; strategyType?: string } = {}
): void {
  const s = baseStrategyInput({
    strategyId,
    version: over.version ?? 1,
    isActive: over.isActive ?? true,
    // 默认 jobCode 从 strategyId 派生保证 UNIQUE(type,job,version) 不撞；
    // 需特定 jobCode 的测试（jobCode 过滤）显式传入。
    jobCode: over.jobCode ?? `JOB_${strategyId}`,
    strategyType: (over.strategyType as 'BASELINE_ASSESSMENT') ?? 'BASELINE_ASSESSMENT'
  })
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

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM assessment_session')
  db.exec('DELETE FROM training_session')
  db.exec('DELETE FROM error_event_log')
  db.exec('DELETE FROM strategy_config')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  seedStrategyErrorCodes(db)
  adminId = seedCaller(db, 'ADMIN')
})

describe('list — 过滤与分页', () => {
  it('默认排除 inactive（#26）：只返回 is_active=1', () => {
    insertStrategy('s1', { isActive: true })
    insertStrategy('s2', { isActive: false })
    const r = listStrategies(db, { callerUserId: adminId, callerRole: 'ADMIN' })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(1)
    expect(r.items[0].strategyId).toBe('s1')
  })

  it('includeInactive=true 含 inactive', () => {
    insertStrategy('s1', { isActive: true })
    insertStrategy('s2', { isActive: false })
    const r = listStrategies(db, { callerUserId: adminId, callerRole: 'ADMIN', includeInactive: true })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(2)
  })

  it('isActive 显式过滤优先级最高', () => {
    insertStrategy('s1', { isActive: true })
    insertStrategy('s2', { isActive: false })
    // includeInactive=true 但 isActive=false → 只返回 inactive
    const r = listStrategies(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      includeInactive: true,
      isActive: false
    })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(1)
    expect(r.items[0].strategyId).toBe('s2')
  })

  it('strategyType 过滤（#25）', () => {
    insertStrategy('s1', { strategyType: 'BASELINE_ASSESSMENT' })
    insertStrategy('s2', { strategyType: 'MOCK_EXAM', jobCode: 'SUPERMARKET_SHELVER_MOCK' })
    const r = listStrategies(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyType: 'MOCK_EXAM'
    })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(1)
    expect(r.items[0].strategyType).toBe('MOCK_EXAM')
  })

  it('jobCode 过滤', () => {
    insertStrategy('s1', { jobCode: 'JOB_A' })
    insertStrategy('s2', { jobCode: 'JOB_B' })
    const r = listStrategies(db, { callerUserId: adminId, callerRole: 'ADMIN', jobCode: 'JOB_B' })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(1)
    expect(r.items[0].jobCode).toBe('JOB_B')
  })

  it('分页（#27）：每页 20 条，page=1 返回 20，page=2 返回剩余', () => {
    for (let i = 0; i < 25; i++) insertStrategy(`p${i}`)
    const r1 = listStrategies(db, { callerUserId: adminId, callerRole: 'ADMIN', page: 1 })
    if (!r1.success) throw new Error('expected success')
    expect(r1.items.length).toBe(20)
    expect(r1.page).toBe(1)
    const r2 = listStrategies(db, { callerUserId: adminId, callerRole: 'ADMIN', page: 2 })
    if (!r2.success) throw new Error('expected success')
    expect(r2.items.length).toBe(5)
    expect(r2.page).toBe(2)
  })

  it('TEACHER 可读（#12）', () => {
    const teacher = seedCaller(db, 'TEACHER')
    insertStrategy('s1')
    const r = listStrategies(db, { callerUserId: teacher, callerRole: 'TEACHER' })
    if (!r.success) throw new Error('expected success')
    expect(r.items.length).toBe(1)
  })

  it('STUDENT → FORBIDDEN', () => {
    const r = listStrategies(db, { callerUserId: adminId, callerRole: 'STUDENT' })
    expect(r).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})

describe('get — Detail 含解析后 JSON', () => {
  it('返回完整 Detail（含 questionPolicy / scoringPolicy / 开关）', () => {
    insertStrategy('s1')
    const r = getStrategy(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: 's1',
      version: 1
    })
    if (!r.success) throw new Error('expected success')
    const d = r.strategy
    expect(d.strategyId).toBe('s1')
    expect(d.version).toBe(1)
    expect(d.questionPolicy.module_scope).toBe('CROSS_MODULE')
    expect(d.scoringPolicy.score_values).toEqual([0, 1, 2])
    expect(d.supportsRedlineHalt).toBe(true)
    expect(d.allowsEmotionInterrupt).toBe(true)
    expect(d.requiresOfflineScoring).toBe(true)
  })

  it('(strategyId, version) 不存在 → NOT_FOUND', () => {
    const r = getStrategy(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: 'nope',
      version: 1
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })

  it('version 非整数 → NOT_FOUND（防御）', () => {
    insertStrategy('s1')
    const r = getStrategy(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: 's1',
      version: 1.5
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })
})

describe('listVersions — 族内所有版本', () => {
  it('按 version DESC 返回 + family 元信息', () => {
    insertStrategy('fam', { version: 1 })
    insertStrategy('fam', { version: 3 })
    insertStrategy('fam', { version: 2 })
    const r = listVersions(db, { callerUserId: adminId, callerRole: 'ADMIN', strategyId: 'fam' })
    if (!r.success) throw new Error('expected success')
    expect(r.items.map((i) => i.version)).toEqual([3, 2, 1])
    expect(r.familyStrategyId).toBe('fam')
    expect(r.familyStrategyType).toBe('BASELINE_ASSESSMENT')
    expect(r.familyJobCode).toBe('JOB_fam')
  })

  it('族不存在 → NOT_FOUND', () => {
    const r = listVersions(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      strategyId: 'nonexistent'
    })
    expect(r).toEqual({ success: false, errorCode: 'NOT_FOUND' })
  })
})
