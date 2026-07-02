// 组卷服务（纯函数）。
// 输入策略配置 + 题库行集合，输出 N 道 ONLINE + M 道 OFFLINE 题。
// 无 DB 副作用——DB 查询在 handler 层做，本模块只做算法。
// 确定性：相同输入产生相同输出（题库稳定排序 by question_id 取前 N，无随机）。
//
// 模块均衡策略（策略 B，impl.md Step 3 指定）：
// - 每模块精确 quota = floor(online / modules) + 余数前 N 模块 +1
// - 模块内题型按 question_ratio 比例分配（floor + 余数按 ratio 降序）
// - 全局题型可能偏离 ratio（如 14:14:14 → 每模块 3:2:2 → 全局 18:12:12），
//   模块均衡优先于全局精确 ratio。

import type { AbilityTag, QuestionPolicyJson } from '../../shared/types/json-schemas'

/**
 * handler 查出的题库行（组卷需要的最小字段）。
 * 模块归属用 question_bank.module_type 列（schema 权威 + 已有索引），
 * 不用 content_json.ability_tags[0]（impl.md 早期措辞，schema 已用 module_type 单值）。
 */
export interface QuestionBankRow {
  question_id: string
  module_type: AbilityTag
  question_type: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'OFFLINE_OPERATION'
  sensory_tags_json?: string | null
}

export interface GeneratePaperInput {
  onlineQuestionCount: number
  offlineQuestionCount: number
  questionRatio: QuestionPolicyJson['question_ratio']
  requiredModules: AbilityTag[]
  questionBankRows: QuestionBankRow[]
  /** 默认 SOFT。STRICT 完整过滤逻辑（avoidTags ∩ sensory_tags）5.3 交付。 */
  sensoryFilterMode?: 'SOFT' | 'STRICT'
}

export interface GeneratedQuestion {
  questionId: string
  questionPhase: 'ONLINE' | 'OFFLINE'
  questionType: 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'OFFLINE_OPERATION'
  moduleType: AbilityTag
  questionOrder: number
}

export type GeneratePaperOutput =
  | { ok: true; questions: GeneratedQuestion[] }
  | { ok: false; errorCode: 'QUESTION_BANK_INSUFFICIENT' | 'INVALID_POLICY' }

const ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const
type OnlineQuestionType = (typeof ONLINE_TYPES)[number]

/**
 * 模块内题型配额分配。按 ratio 比例 floor，余数按 ratio 降序（同 ratio 按枚举顺序）分配。
 */
function allocateOnlineTypesByRatio(
  quota: number,
  ratio: QuestionPolicyJson['question_ratio']
): Record<OnlineQuestionType, number> {
  const sum = ONLINE_TYPES.reduce((s, t) => s + (ratio[t] ?? 0), 0)
  if (sum === 0) {
    return { TRUE_FALSE: 0, SINGLE_CHOICE: 0, DRAG: 0 }
  }
  const base: Record<OnlineQuestionType, number> = {
    TRUE_FALSE: Math.floor((quota * (ratio.TRUE_FALSE ?? 0)) / sum),
    SINGLE_CHOICE: Math.floor((quota * (ratio.SINGLE_CHOICE ?? 0)) / sum),
    DRAG: Math.floor((quota * (ratio.DRAG ?? 0)) / sum)
  }
  let remainder = quota - (base.TRUE_FALSE + base.SINGLE_CHOICE + base.DRAG)
  if (remainder > 0) {
    const order = [...ONLINE_TYPES].sort(
      (a, b) =>
        (ratio[b] ?? 0) - (ratio[a] ?? 0) ||
        ONLINE_TYPES.indexOf(a) - ONLINE_TYPES.indexOf(b)
    )
    let i = 0
    while (remainder > 0) {
      base[order[i % order.length]] += 1
      remainder--
      i++
    }
  }
  return base
}

/**
 * 从池中稳定取前 N 道（按 question_id 升序）。池不足返回 null。
 */
function takeStable(pool: QuestionBankRow[], need: number): QuestionBankRow[] | null {
  if (pool.length < need) return null
  return [...pool].sort((a, b) => a.question_id.localeCompare(b.question_id)).slice(0, need)
}

export function generatePaper(input: GeneratePaperInput): GeneratePaperOutput {
  const {
    onlineQuestionCount,
    offlineQuestionCount,
    questionRatio,
    requiredModules,
    questionBankRows
  } = input

  // 1. 校验 question_ratio 之和
  const onlineRatioSum =
    (questionRatio.TRUE_FALSE ?? 0) +
    (questionRatio.SINGLE_CHOICE ?? 0) +
    (questionRatio.DRAG ?? 0)
  if (onlineRatioSum !== onlineQuestionCount) {
    return { ok: false, errorCode: 'INVALID_POLICY' }
  }
  if ((questionRatio.OFFLINE_OPERATION ?? 0) !== offlineQuestionCount) {
    return { ok: false, errorCode: 'INVALID_POLICY' }
  }

  // 2. sensory filter 占位（5.3 交付完整逻辑）
  // [!] STRICT 模式完整过滤（avoidTags ∩ sensory_tags_json）推迟到 5.3 sensory profile 交付后；
  // 当前 SOFT/STRICT 都不过滤，测试仅验证参数接收。

  const onlineQuestions: GeneratedQuestion[] = []

  // 3. ONLINE 模块均衡
  if (onlineQuestionCount > 0) {
    const moduleCount = requiredModules.length
    if (moduleCount === 0) {
      return { ok: false, errorCode: 'INVALID_POLICY' }
    }
    const baseQuota = Math.floor(onlineQuestionCount / moduleCount)
    const onlineRemainder = onlineQuestionCount - baseQuota * moduleCount

    for (let mi = 0; mi < moduleCount; mi++) {
      const moduleType = requiredModules[mi]
      const moduleTarget = baseQuota + (mi < onlineRemainder ? 1 : 0)
      if (moduleTarget === 0) continue

      const typeTargets = allocateOnlineTypesByRatio(moduleTarget, questionRatio)
      for (const qtype of ONLINE_TYPES) {
        const need = typeTargets[qtype]
        if (need === 0) continue
        const pool = questionBankRows.filter(
          r => r.module_type === moduleType && r.question_type === qtype
        )
        const selected = takeStable(pool, need)
        if (!selected) {
          return { ok: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
        }
        for (const row of selected) {
          onlineQuestions.push({
            questionId: row.question_id,
            questionPhase: 'ONLINE',
            questionType: qtype,
            moduleType,
            questionOrder: 0
          })
        }
      }
    }
  }

  // 4. OFFLINE（不强制模块均衡，跨任意模块）
  const offlineQuestions: GeneratedQuestion[] = []
  if (offlineQuestionCount > 0) {
    const pool = questionBankRows.filter(r => r.question_type === 'OFFLINE_OPERATION')
    const selected = takeStable(pool, offlineQuestionCount)
    if (!selected) {
      return { ok: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
    }
    for (const row of selected) {
      offlineQuestions.push({
        questionId: row.question_id,
        questionPhase: 'OFFLINE',
        questionType: 'OFFLINE_OPERATION',
        moduleType: row.module_type,
        questionOrder: 0
      })
    }
  }

  // 5. 赋 question_order：ONLINE 先（1..onlineCount），OFFLINE 后
  onlineQuestions.forEach((q, i) => {
    q.questionOrder = i + 1
  })
  offlineQuestions.forEach((q, i) => {
    q.questionOrder = onlineQuestionCount + i + 1
  })

  return { ok: true, questions: [...onlineQuestions, ...offlineQuestions] }
}
