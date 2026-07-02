import { describe, it, expect } from 'vitest'
import { generatePaper } from '../paper-generator'
import type { QuestionBankRow, GeneratePaperInput } from '../paper-generator'
import type { AbilityTag } from '../../../shared/types/json-schemas'

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
