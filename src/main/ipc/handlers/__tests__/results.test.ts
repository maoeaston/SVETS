import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  getCurrentResult,
  listCurrentResultsByStudent
} from '../results'
import type {
  ResultSourceAggregateType
} from '../../../../shared/types/results'
import type { ResultType, StrategyType } from '../../../../shared/types/json-schemas'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string
let otherStudentId: string
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

interface SeedResultParams {
  studentId: string
  resultType: ResultType
  sourceAggregateType: ResultSourceAggregateType
  sourceAggregateId: string
  strategyType?: StrategyType | null
  payload?: unknown
  normalizedScore?: number
  isCurrent?: 0 | 1
  generatedAt?: string
}

function nextEventSequence(aggregateId: string): number {
  const row = db
    .prepare('SELECT MAX(event_sequence) AS maxSeq FROM domain_event_projection WHERE aggregate_id = ?')
    .get(aggregateId) as { maxSeq: number | null }
  return (row.maxSeq ?? 0) + 1
}

function seedGeneratedEvent(sourceAggregateType: ResultSourceAggregateType, sourceAggregateId: string): string {
  const eventId = uuidv4()
  const aggregateType = sourceAggregateType
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, ?, ?, 'RESULT_CALCULATED', ?, '{}', 'test-checksum', 'test.jsonl', 1, ?)`
  ).run(eventId, aggregateType, sourceAggregateId, nextEventSequence(sourceAggregateId), new Date().toISOString())
  return eventId
}

function seedResult(params: SeedResultParams): string {
  const resultId = uuidv4()
  const generatedEventId = seedGeneratedEvent(params.sourceAggregateType, params.sourceAggregateId)
  const normalizedScore = params.normalizedScore ?? 80
  const strategyType = params.strategyType ?? (
    params.resultType === 'TRAINING_COMPLETION'
      ? 'TRAINING_PRACTICE'
      : 'BASELINE_ASSESSMENT'
  )

  db.prepare(
    `INSERT INTO result_record
       (result_id, student_id, result_type, source_aggregate_type, source_aggregate_id,
        strategy_id, strategy_type, job_code, module_type,
        raw_score, max_score, normalized_score, completion_ratio, level_result,
        result_payload_json, generated_event_id, generated_at, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'SUPERMARKET_SHELVER', NULL,
             ?, ?, ?, 1, 'LEVEL_COMPETENT', ?, ?, ?, ?)`
  ).run(
    resultId,
    params.studentId,
    params.resultType,
    params.sourceAggregateType,
    params.sourceAggregateId,
    `strategy-${params.resultType.toLowerCase()}`,
    strategyType,
    normalizedScore,
    100,
    normalizedScore,
    params.payload === undefined ? null : JSON.stringify(params.payload),
    generatedEventId,
    params.generatedAt ?? new Date().toISOString(),
    params.isCurrent ?? 1
  )
  return resultId
}

function countCurrentRows(): number {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM result_record WHERE is_current = 1')
    .get() as { total: number }
  return row.total
}

beforeAll(async () => {
  db = await createTestDb()
})

afterAll(() => {
  consoleErrorSpy?.mockRestore()
  db.close()
})

beforeEach(() => {
  db.exec('DELETE FROM result_record')
  db.exec('DELETE FROM domain_event_projection')
  db.exec('DELETE FROM student_profile')
  db.exec('DELETE FROM user_account')
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
  otherStudentId = seedStudent(db)
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('results:listCurrentByStudent', () => {
  it('TEACHER 可读取同一学生四类当前结果，并按 source 类型过滤', () => {
    const assessmentSourceId = `assessment-${uuidv4()}`
    const trainingSourceId = `training-${uuidv4()}`
    seedResult({
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: assessmentSourceId,
      payload: { track: 'ability' },
      generatedAt: '2026-07-24T10:00:00.000Z'
    })
    seedResult({
      studentId,
      resultType: 'JOB_SKILL_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: assessmentSourceId,
      strategyType: 'JOB_SKILL_ASSESSMENT',
      payload: { track: 'job_skill' },
      generatedAt: '2026-07-24T10:01:00.000Z'
    })
    seedResult({
      studentId,
      resultType: 'OPERATION_PASS_RATE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: assessmentSourceId,
      payload: { track: 'operation' },
      generatedAt: '2026-07-24T10:02:00.000Z'
    })
    seedResult({
      studentId,
      resultType: 'TRAINING_COMPLETION',
      sourceAggregateType: 'TRAINING_SESSION',
      sourceAggregateId: trainingSourceId,
      payload: { track: 'training' },
      generatedAt: '2026-07-24T10:03:00.000Z'
    })
    seedResult({
      studentId: otherStudentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: `assessment-${uuidv4()}`,
      payload: { track: 'other' }
    })

    const all = listCurrentResultsByStudent(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId
    })

    expect(all.success).toBe(true)
    if (!all.success) return
    expect(all.total).toBe(4)
    expect(all.results.map((item) => item.resultType).sort()).toEqual([
      'ABILITY_SCORE',
      'JOB_SKILL_SCORE',
      'OPERATION_PASS_RATE',
      'TRAINING_COMPLETION'
    ])

    const assessmentOnly = listCurrentResultsByStudent(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      sourceAggregateType: 'ASSESSMENT_SESSION'
    })
    expect(assessmentOnly.success).toBe(true)
    if (!assessmentOnly.success) return
    expect(assessmentOnly.total).toBe(3)
    expect(assessmentOnly.results.every((item) => item.sourceAggregateType === 'ASSESSMENT_SESSION')).toBe(true)
  })

  it('STUDENT 只能读取自己的结果，显式请求其他学生返回 FORBIDDEN', () => {
    seedResult({
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: `assessment-${uuidv4()}`,
      payload: { owner: 'self' }
    })
    seedResult({
      studentId: otherStudentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: `assessment-${uuidv4()}`,
      payload: { owner: 'other' }
    })

    const own = listCurrentResultsByStudent(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT'
    })

    expect(own.success).toBe(true)
    if (!own.success) return
    expect(own.total).toBe(1)
    expect(own.results[0].studentId).toBe(studentId)
    expect(own.results[0].resultPayload).toEqual({ owner: 'self' })

    const forbidden = listCurrentResultsByStudent(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      studentId: otherStudentId
    })
    expect(forbidden).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('ADMIN 可按 resultType 和 sourceAggregateId 组合过滤', () => {
    const sourceAggregateId = `assessment-${uuidv4()}`
    const abilityId = seedResult({
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId,
      payload: { track: 'ability' }
    })
    seedResult({
      studentId,
      resultType: 'JOB_SKILL_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId,
      strategyType: 'JOB_SKILL_ASSESSMENT',
      payload: { track: 'job_skill' }
    })

    const filtered = listCurrentResultsByStudent(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId
    })

    expect(filtered.success).toBe(true)
    if (!filtered.success) return
    expect(filtered.total).toBe(1)
    expect(filtered.results[0].resultId).toBe(abilityId)
  })
})

describe('results:getCurrent', () => {
  it('同一 ASSESSMENT_SESSION 下按 resultType 读取单条当前结果，payload 被解析', () => {
    const sourceAggregateId = `assessment-${uuidv4()}`
    seedResult({
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId,
      payload: { track: 'ability', modules: [{ code: 'FINE_MOTOR' }] }
    })
    const jobSkillId = seedResult({
      studentId,
      resultType: 'JOB_SKILL_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId,
      strategyType: 'JOB_SKILL_ASSESSMENT',
      payload: { track: 'job_skill' }
    })
    const beforeCurrent = countCurrentRows()

    const result = getCurrentResult(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      resultType: 'JOB_SKILL_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.result?.resultId).toBe(jobSkillId)
    expect(result.result?.resultType).toBe('JOB_SKILL_SCORE')
    expect(result.result?.resultPayload).toEqual({ track: 'job_skill' })
    expect(countCurrentRows()).toBe(beforeCurrent)
  })

  it('无 payload 的当前结果返回 resultPayload=null，无匹配结果返回 result=null', () => {
    const sourceAggregateId = `training-${uuidv4()}`
    seedResult({
      studentId,
      resultType: 'TRAINING_COMPLETION',
      sourceAggregateType: 'TRAINING_SESSION',
      sourceAggregateId,
      payload: undefined
    })

    const found = getCurrentResult(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      resultType: 'TRAINING_COMPLETION',
      sourceAggregateType: 'TRAINING_SESSION',
      sourceAggregateId
    })
    expect(found.success).toBe(true)
    if (!found.success) return
    expect(found.result?.resultPayload).toBeNull()

    const missing = getCurrentResult(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId: `assessment-${uuidv4()}`
    })
    expect(missing).toEqual({ success: true, result: null })
  })

  it('STUDENT 不能通过 sourceAggregateId 读取其他学生结果', () => {
    const sourceAggregateId = `assessment-${uuidv4()}`
    seedResult({
      studentId: otherStudentId,
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId,
      payload: { owner: 'other' }
    })

    const result = getCurrentResult(db, {
      callerUserId: studentId,
      callerRole: 'STUDENT',
      resultType: 'ABILITY_SCORE',
      sourceAggregateType: 'ASSESSMENT_SESSION',
      sourceAggregateId
    })

    expect(result).toEqual({ success: true, result: null })
  })

  it('非法 resultType 返回 VALIDATION_ERROR', () => {
    const result = listCurrentResultsByStudent(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      studentId,
      resultType: 'BAD_RESULT_TYPE'
    } as never)

    expect(result).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })
  })
})
