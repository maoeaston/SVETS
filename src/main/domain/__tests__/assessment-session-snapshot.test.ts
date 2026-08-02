import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildSessionStartedPayloadV2 } from '../assessment-session-snapshot'
import type {
  BaseAbilitySelectedQuestionSet,
  BaseAbilitySelectedQuestionEntry,
  QuestionBankSnapshotRow
} from '../assessment-session-snapshot'
import { hashRecord, parseSessionStartedPayload } from '../assessment-event-contract'
import type { GeneratedQuestion } from '../paper-generator'
import type {
  QuestionPolicyBaseAbility,
  ScoringPolicyBaseAbility
} from '../../../shared/types/json-schemas'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import selectedQuestionSetJson from '../../../shared/config/base-ability-selected-question-set-v1.json'

const policy: QuestionPolicyBaseAbility = {
  schema_version: 'question-policy-v1.2',
  module_scope: 'CROSS_MODULE',
  eligible_bank_domains: ['BASE_ABILITY'],
  online_quota_by_module: { COGNITION: 1 },
  offline_total: 1,
  eligible_item_usage: ['SCORED_ITEM'],
  allowed_question_types: ['SINGLE_CHOICE', 'OFFLINE_OPERATION'],
  unsupported_interaction_policy: 'BLOCK',
  sensory_filter_mode: 'SOFT',
  fallback_strategy: 'BLOCK'
}

const scoringPolicy: ScoringPolicyBaseAbility = {
  schema_version: 'scoring-policy-v1.1',
  online_score_values: [0, 2],
  offline_score_values: [0, 1, 2],
  normalization: 'raw_score/max_score*100',
  safety_override_enabled: true,
  placement_advice_enabled: false
}

const contentA = { schema_version: 'question-content-v1.2', prompt: 'A-online' }
const scoringA = { schema_version: 'scoring-rule-v1.1', scoring_type: 'EXACT_MATCH' }
const contentB = { schema_version: 'question-content-v1.2', prompt: 'B-offline' }
const scoringB = { schema_version: 'scoring-rule-v1.1', scoring_type: 'NO_SCORE' }

function mkEntry(
  id: string,
  module: string,
  type: string,
  phase: 'ONLINE' | 'OFFLINE',
  rendererKey: string,
  content: unknown,
  scoring: unknown
): BaseAbilitySelectedQuestionEntry {
  return {
    question_id: id,
    module_type: module,
    question_type: type,
    question_phase: phase,
    renderer_key: rendererKey,
    renderer_requirement_hash: `sha256:rr-${id}`,
    content_hash: hashRecord(content),
    scoring_hash: hashRecord(scoring)
  }
}

const entryA = mkEntry('q-a', 'COGNITION', 'SINGLE_CHOICE', 'ONLINE', 'base-ability/single-select/v1', contentA, scoringA)
const entryB = mkEntry('q-b', 'FINE_MOTOR', 'OFFLINE_OPERATION', 'OFFLINE', 'base-ability/offline-rubric/v1', contentB, scoringB)

function mkSelectedSet(entries: BaseAbilitySelectedQuestionEntry[]): BaseAbilitySelectedQuestionSet {
  return {
    schema_version: 'base-ability-selected-question-set-v1',
    authority_hash: 'sha256:authority',
    content_root_hash: 'sha256:content-root',
    scoring_root_hash: 'sha256:scoring-root',
    renderer_requirements_root_hash: 'sha256:renderer-root',
    selected_question_set_hash: hashRecord(entries.map((e) => ({ question_id: e.question_id }))),
    questions: entries
  }
}

const paper: GeneratedQuestion[] = [
  { questionId: 'q-a', questionPhase: 'ONLINE', questionType: 'SINGLE_CHOICE', moduleType: 'COGNITION', questionOrder: 1 },
  { questionId: 'q-b', questionPhase: 'OFFLINE', questionType: 'OFFLINE_OPERATION', moduleType: 'FINE_MOTOR', questionOrder: 2 }
]

const qbRows: QuestionBankSnapshotRow[] = [
  { question_id: 'q-a', version: 1, item_usage: 'SCORED_ITEM', job_module_code: null, content_json: contentA, scoring_rule_json: scoringA },
  { question_id: 'q-b', version: 1, item_usage: 'SCORED_ITEM', job_module_code: null, content_json: contentB, scoring_rule_json: scoringB }
]

function baseInput(overrides: Partial<Parameters<typeof buildSessionStartedPayloadV2>[0]> = {}) {
  return {
    sessionId: 'sess-1',
    businessSessionId: 'sess-1',
    studentId: 'stu-1',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'TASK_UNBOXING',
    onlineQuestionCount: 1,
    offlineQuestionCount: 1,
    strategy: {
      strategy_id: 'strat-1',
      strategy_type: 'BASELINE_ASSESSMENT' as const,
      strategy_version: 1,
      question_policy: policy,
      scoring_policy: scoringPolicy
    },
    paperSeed: 'seed-1',
    paper,
    questionBankRows: qbRows,
    selectedQuestionSet: mkSelectedSet([entryA, entryB]),
    ...overrides
  }
}

describe('buildSessionStartedPayloadV2', () => {
  it('运行时选定集合与 Step 1 authority 的 50 题、阶段及根 hash 对账一致', () => {
    const authority = JSON.parse(
      readFileSync('doc/features/base-ability-42plus8-authority-v1.json', 'utf8')
    ) as {
      authority_hash: string
      content_root_hash: string
      scoring_root_hash: string
      renderer_requirements_root_hash: string
      questions: Array<{
        source_question_id: string
        module_type: string
        question_type: string
        selection: { disposition: string }
        renderer_requirement: { renderer_key: string }
        renderer_requirement_hash: string
        content_hash: string
        scoring_hash: string
      }>
    }
    const runtimeSet = selectedQuestionSetJson as unknown as BaseAbilitySelectedQuestionSet
    const expectedQuestions = authority.questions
      .filter((question) => question.selection.disposition === 'SELECTED')
      .map((question) => ({
        question_id: question.source_question_id,
        module_type: question.module_type,
        question_type: question.question_type,
        question_phase: question.question_type === 'OFFLINE_OPERATION' ? 'OFFLINE' : 'ONLINE',
        renderer_key: question.renderer_requirement.renderer_key,
        renderer_requirement_hash: question.renderer_requirement_hash,
        content_hash: question.content_hash,
        scoring_hash: question.scoring_hash
      }))

    expect(runtimeSet.authority_hash).toBe(authority.authority_hash)
    expect(runtimeSet.content_root_hash).toBe(authority.content_root_hash)
    expect(runtimeSet.scoring_root_hash).toBe(authority.scoring_root_hash)
    expect(runtimeSet.renderer_requirements_root_hash).toBe(authority.renderer_requirements_root_hash)
    expect(runtimeSet.questions).toEqual(expectedQuestions)
    expect(runtimeSet.selected_question_set_hash).toBe(
      hashRecord(runtimeSet.questions.map((question) => ({ question_id: question.question_id })))
    )
  })

  it('ok：构建 v2 payload，payload_version=2，逐题快照完整，hash 自洽且 contract parser 接受', () => {
    const r = buildSessionStartedPayloadV2(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.payload_version).toBe(2)
    expect(r.payload.questions).toHaveLength(2)
    expect(r.payload.questions[0].content_hash).toBe(entryA.content_hash)
    expect(r.payload.questions[0].renderer_key).toBe('base-ability/single-select/v1')
    // contract parser 复算 hash 应自洽（不抛错）
    const event = {
      event_type: 'SESSION_STARTED',
      schema_version: 1,
      payload: r.payload as unknown as Record<string, unknown>
    } as ActionLogEntry
    expect(() => parseSessionStartedPayload(event)).not.toThrow()
  })

  it('QUESTION_NOT_IN_SELECTED_SET：paper 含配置白名单外题', () => {
    const paperWithOutsider: GeneratedQuestion[] = [
      ...paper,
      { questionId: 'q-x', questionPhase: 'ONLINE', questionType: 'SINGLE_CHOICE', moduleType: 'COGNITION', questionOrder: 3 }
    ]
    const r = buildSessionStartedPayloadV2(baseInput({ paper: paperWithOutsider }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_NOT_IN_SELECTED_SET')
  })

  it('QUESTION_HASH_DRIFT：题库 content_json 被篡改后 hash 不匹配', () => {
    const drifted: QuestionBankSnapshotRow[] = [
      { ...qbRows[0], content_json: { ...contentA, prompt: 'TAMPERED' } },
      qbRows[1]
    ]
    const r = buildSessionStartedPayloadV2(baseInput({ questionBankRows: drifted }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_HASH_DRIFT')
  })

  it('QUESTION_HASH_DRIFT：题库 scoring_rule_json 被篡改', () => {
    const drifted: QuestionBankSnapshotRow[] = [
      qbRows[0],
      { ...qbRows[1], scoring_rule_json: { ...scoringB, scoring_type: 'EXACT_MATCH' } }
    ]
    const r = buildSessionStartedPayloadV2(baseInput({ questionBankRows: drifted }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_HASH_DRIFT')
  })

  it('SQLite JSON TEXT 会先解析，再与 authority 对象 hash 对照并冻结', () => {
    const serializedRows: QuestionBankSnapshotRow[] = qbRows.map((row) => ({
      ...row,
      content_json: JSON.stringify(row.content_json),
      scoring_rule_json: JSON.stringify(row.scoring_rule_json)
    }))
    const r = buildSessionStartedPayloadV2(baseInput({ questionBankRows: serializedRows }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.questions[0].content_json).toEqual(contentA)
    expect(r.payload.questions[1].scoring_rule_json).toEqual(scoringB)
  })

  it('QUESTION_BANK_MISSING：题库缺某题运行时行', () => {
    const r = buildSessionStartedPayloadV2(baseInput({ questionBankRows: [qbRows[0]] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_BANK_MISSING')
  })

  it('root hash 篡改会被 contract parser 拒绝', () => {
    const r = buildSessionStartedPayloadV2(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const tampered = { ...r.payload, content_root_hash: 'sha256:wrong' }
    const event = {
      event_type: 'SESSION_STARTED',
      schema_version: 1,
      payload: tampered as unknown as Record<string, unknown>
    } as ActionLogEntry
    expect(() => parseSessionStartedPayload(event)).toThrow()
  })
})
