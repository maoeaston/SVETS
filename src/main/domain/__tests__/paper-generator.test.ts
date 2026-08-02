import { describe, it, expect } from 'vitest'
import { generateBaseAbilityPaperV12, generatePaper } from '../paper-generator'
import type { QuestionBankRow, GeneratePaperInput } from '../paper-generator'
import type { AbilityTag } from '../../../shared/types/json-schemas'
import type { QuestionPolicyBaseAbility } from '../../../shared/types/json-schemas'

const MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]
const RATIO_42_8 = {
  TRUE_FALSE: 14,
  SINGLE_CHOICE: 14,
  DRAG: 14,
  OFFLINE_OPERATION: 8
}

function makeRow(
  moduleType: AbilityTag,
  questionType: QuestionBankRow['question_type'],
  k: number
): QuestionBankRow {
  return {
    question_id: `q-${moduleType}-${questionType}-${k}`,
    module_type: moduleType,
    question_type: questionType,
    sensory_tags_json: null
  }
}

// 默认 mock 题库：6 模块 × {3 online 题型 × 5 道 + OFFLINE_OPERATION × 3 道} = 108 道。
// 与 test-helpers.seedQuestionBank 默认量一致，覆盖 42+8 组卷含余量。
function makeFullBank(): QuestionBankRow[] {
  const rows: QuestionBankRow[] = []
  for (const m of MODULES) {
    for (const t of ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const) {
      for (let k = 0; k < 5; k++) rows.push(makeRow(m, t, k))
    }
    for (let k = 0; k < 3; k++) rows.push(makeRow(m, 'OFFLINE_OPERATION', k))
  }
  return rows
}

function baseInput(over: Partial<GeneratePaperInput> = {}): GeneratePaperInput {
  return {
    onlineQuestionCount: 42,
    offlineQuestionCount: 8,
    questionRatio: RATIO_42_8,
    requiredModules: MODULES,
    questionBankRows: makeFullBank(),
    ...over
  }
}

describe('generatePaper', () => {
  it('正常路径：6 模块 × 7 题均衡输出 42 ONLINE + 8 OFFLINE，order 连续 1..50', () => {
    const r = generatePaper(baseInput())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const online = r.questions.filter(q => q.questionPhase === 'ONLINE')
    const offline = r.questions.filter(q => q.questionPhase === 'OFFLINE')
    expect(online.length).toBe(42)
    expect(offline.length).toBe(8)
    // 每模块 ONLINE = 7
    for (const m of MODULES) {
      expect(online.filter(q => q.moduleType === m).length).toBe(7)
    }
    // order 连续 1..50
    const orders = r.questions.map(q => q.questionOrder).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it('题库不足：FINE_MOTOR 的 TF 只剩 2 道（需 3）→ QUESTION_BANK_INSUFFICIENT', () => {
    const reduced = makeFullBank().filter(r => {
      if (r.module_type === 'FINE_MOTOR' && r.question_type === 'TRUE_FALSE') {
        // 保留 -0, -1（2 道），需 3 → 不足
        return r.question_id.endsWith('-0') || r.question_id.endsWith('-1')
      }
      return true
    })
    const r = generatePaper(baseInput({ questionBankRows: reduced }))
    expect(r).toEqual({ ok: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' })
  })

  it('无效策略：question_ratio online 之和 (13+14+14=41) != onlineQuestionCount (42) → INVALID_POLICY', () => {
    const r = generatePaper(
      baseInput({
        questionRatio: { TRUE_FALSE: 13, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 }
      })
    )
    expect(r).toEqual({ ok: false, errorCode: 'INVALID_POLICY' })
  })

  it('sensory filter STRICT 模式参数被接收（5.4 占位不过滤；完整逻辑 5.3 交付）', () => {
    const rStrict = generatePaper(baseInput({ sensoryFilterMode: 'STRICT' }))
    const rSoft = generatePaper(baseInput({ sensoryFilterMode: 'SOFT' }))
    expect(rStrict.ok).toBe(true)
    expect(rSoft.ok).toBe(true)
    if (rStrict.ok && rSoft.ok) {
      // 占位行为：STRICT 与 SOFT 输出相同（5.3 后 STRICT 会过滤）
      expect(rStrict.questions.length).toBe(rSoft.questions.length)
    }
  })

  it('确定性：相同输入两次调用输出完全相同', () => {
    const r1 = generatePaper(baseInput())
    const r2 = generatePaper(baseInput())
    expect(r1).toEqual(r2)
  })

  it('可复现伪随机：相同 paperSeed 输出完全相同', () => {
    const r1 = generatePaper(baseInput({ paperSeed: 'session-a-student-a-strategy-v1' }))
    const r2 = generatePaper(baseInput({ paperSeed: 'session-a-student-a-strategy-v1' }))
    expect(r1).toEqual(r2)
  })

  it('可复现伪随机：不同 paperSeed 在有余量题库时输出不同，且仍满足 42 ONLINE + 8 OFFLINE 配额', () => {
    const r1 = generatePaper(baseInput({ paperSeed: 'session-a-student-a-strategy-v1' }))
    const r2 = generatePaper(baseInput({ paperSeed: 'session-b-student-a-strategy-v1' }))
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    expect(r1.questions.map(q => q.questionId)).not.toEqual(r2.questions.map(q => q.questionId))
    for (const r of [r1, r2]) {
      expect(r.questions.filter(q => q.questionPhase === 'ONLINE')).toHaveLength(42)
      expect(r.questions.filter(q => q.questionPhase === 'OFFLINE')).toHaveLength(8)
    }
  })

  it('极值 onlineQuestionCount=0 + ratio online 全 0 → 0 ONLINE + 8 OFFLINE', () => {
    const r = generatePaper(
      baseInput({
        onlineQuestionCount: 0,
        questionRatio: { TRUE_FALSE: 0, SINGLE_CHOICE: 0, DRAG: 0, OFFLINE_OPERATION: 8 }
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.questions.length).toBe(8)
    expect(r.questions.every(q => q.questionPhase === 'OFFLINE')).toBe(true)
    expect(r.questions.map(q => q.questionOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

const V12_POLICY: QuestionPolicyBaseAbility = {
  schema_version: 'question-policy-v1.2',
  module_scope: 'CROSS_MODULE',
  eligible_bank_domains: ['BASE_ABILITY'],
  online_quota_by_module: { FINE_MOTOR: 7, COGNITION: 7, RULE_EXECUTION: 7, EMOTION_REGULATION: 7, BASIC_SOCIAL: 7, SAFETY_OPERATION: 7 },
  offline_total: 8,
  eligible_item_usage: ['SCORED_ITEM'],
  allowed_question_types: ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK', 'OFFLINE_OPERATION'],
  unsupported_interaction_policy: 'BLOCK',
  sensory_filter_mode: 'SOFT',
  fallback_strategy: 'BLOCK'
}

const V12_ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'SOFTWARE_TASK'] as const

// v1.2 mock 题库：6 模块 × {7 白名单内线上 + 2 白名单外干扰} + 8 白名单内线下 + 2 白名单外干扰。
function makeV12Bank(): { rows: QuestionBankRow[]; selectedIds: Set<string> } {
  const rows: QuestionBankRow[] = []
  const selectedIds = new Set<string>()
  for (const m of MODULES) {
    for (let k = 0; k < 7; k++) {
      const id = `v12-${m}-${k}`
      rows.push({ question_id: id, module_type: m, question_type: V12_ONLINE_TYPES[k % V12_ONLINE_TYPES.length], sensory_tags_json: null })
      selectedIds.add(id)
    }
    for (let k = 0; k < 2; k++) {
      rows.push({ question_id: `v12-out-${m}-${k}`, module_type: m, question_type: V12_ONLINE_TYPES[k % V12_ONLINE_TYPES.length], sensory_tags_json: null })
    }
  }
  for (let k = 0; k < 8; k++) {
    const id = `v12-offline-${k}`
    rows.push({ question_id: id, module_type: MODULES[k % MODULES.length], question_type: 'OFFLINE_OPERATION', sensory_tags_json: null })
    selectedIds.add(id)
  }
  for (let k = 0; k < 2; k++) {
    rows.push({ question_id: `v12-offline-out-${k}`, module_type: MODULES[k % MODULES.length], question_type: 'OFFLINE_OPERATION', sensory_tags_json: null })
  }
  return { rows, selectedIds }
}

describe('generateBaseAbilityPaperV12', () => {
  it('精确 42 ONLINE + 8 OFFLINE，每模块 7 道，白名单外题不入选，order 连续 1..50', () => {
    const { rows, selectedIds } = makeV12Bank()
    const r = generateBaseAbilityPaperV12({ policy: V12_POLICY, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'seed-1' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.questions).toHaveLength(50)
    expect(r.questions.filter((q) => q.questionPhase === 'ONLINE')).toHaveLength(42)
    expect(r.questions.filter((q) => q.questionPhase === 'OFFLINE')).toHaveLength(8)
    for (const m of MODULES) {
      expect(r.questions.filter((q) => q.moduleType === m && q.questionPhase === 'ONLINE')).toHaveLength(7)
    }
    expect(r.questions.every((q) => selectedIds.has(q.questionId))).toBe(true)
    expect(r.questions.map((q) => q.questionOrder)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
  })

  it('相同 paperSeed 重放输出完全一致', () => {
    const { rows, selectedIds } = makeV12Bank()
    const a = generateBaseAbilityPaperV12({ policy: V12_POLICY, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'same-seed' })
    const b = generateBaseAbilityPaperV12({ policy: V12_POLICY, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'same-seed' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.questions.map((q) => q.questionId)).toEqual(b.questions.map((q) => q.questionId))
  })

  it('某模块白名单内线上题不足 7 → QUESTION_BANK_INSUFFICIENT', () => {
    const { rows, selectedIds } = makeV12Bank()
    selectedIds.delete('v12-FINE_MOTOR-0')
    const r = generateBaseAbilityPaperV12({ policy: V12_POLICY, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'seed-1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_BANK_INSUFFICIENT')
  })

  it('线下白名单内不足 8 → QUESTION_BANK_INSUFFICIENT', () => {
    const { rows, selectedIds } = makeV12Bank()
    selectedIds.delete('v12-offline-6')
    selectedIds.delete('v12-offline-7')
    const r = generateBaseAbilityPaperV12({ policy: V12_POLICY, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'seed-1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_BANK_INSUFFICIENT')
  })

  it('allowed_question_types 排除 SOFTWARE_TASK 致模块不足 → QUESTION_BANK_INSUFFICIENT', () => {
    const { rows, selectedIds } = makeV12Bank()
    const restrictedPolicy: QuestionPolicyBaseAbility = { ...V12_POLICY, allowed_question_types: ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG', 'OFFLINE_OPERATION'] }
    const r = generateBaseAbilityPaperV12({ policy: restrictedPolicy, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'seed-1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('QUESTION_BANK_INSUFFICIENT')
  })

  it('INVALID_POLICY：schema_version 不对', () => {
    const { rows, selectedIds } = makeV12Bank()
    const bad = { ...V12_POLICY, schema_version: 'wrong' as unknown as 'question-policy-v1.2' }
    const r = generateBaseAbilityPaperV12({ policy: bad, questionBankRows: rows, selectedQuestionIds: selectedIds, paperSeed: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errorCode).toBe('INVALID_POLICY')
  })
})
