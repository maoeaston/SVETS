// assessment-session-snapshot.ts
// 构建 SESSION_STARTED payload v2 的完整冻结快照。
// createSession 在 v1.2 路径调用本函数：把 generateBaseAbilityPaperV12 的选题结果、
// question_bank 运行时内容和 selected-question-set 配置合并成自洽的 v2 payload。
// 纯函数（hash 校验失败时返回错误，不抛副作用），可独立单测。

import type {
  SessionStartedPayloadV2,
  SessionQuestionSnapshotV2,
  SessionStrategySnapshotV2
} from '../../shared/types/event-payloads'
import type {
  QuestionPolicyBaseAbility,
  ScoringPolicyBaseAbility,
  StrategyType
} from '../../shared/types/json-schemas'
import type { GeneratedQuestion } from './paper-generator'
import { hashRecord, computeQuestionRootHashes } from './assessment-event-contract'

// ── selected-question-set-v1.json 配置类型（Pilot 冻结的 50 题运行权威） ──
export interface BaseAbilitySelectedQuestionEntry {
  question_id: string
  module_type: string
  question_type: string
  question_phase: 'ONLINE' | 'OFFLINE'
  renderer_key: string
  renderer_requirement_hash: string
  content_hash: string
  scoring_hash: string
}
export interface BaseAbilitySelectedQuestionSet {
  schema_version: 'base-ability-selected-question-set-v1'
  authority_hash: string
  content_root_hash: string
  scoring_root_hash: string
  renderer_requirements_root_hash: string
  selected_question_set_hash: string
  questions: BaseAbilitySelectedQuestionEntry[]
}

// ── question_bank 运行时查询行（snapshot 构建需要的字段） ──
export interface QuestionBankSnapshotRow {
  question_id: string
  version: number
  item_usage: string
  job_module_code: string | null
  content_json: unknown
  scoring_rule_json: unknown
}

export interface BuildSessionSnapshotV2Input {
  sessionId: string
  businessSessionId: string
  studentId: string
  jobCode: string
  taskCode: string
  onlineQuestionCount: number
  offlineQuestionCount: number
  strategy: {
    strategy_id: string
    strategy_type: StrategyType
    strategy_version: number
    question_policy: QuestionPolicyBaseAbility
    scoring_policy: ScoringPolicyBaseAbility
  }
  paperSeed: string
  paper: GeneratedQuestion[]
  questionBankRows: QuestionBankSnapshotRow[]
  selectedQuestionSet: BaseAbilitySelectedQuestionSet
}

export type BuildSessionSnapshotV2Output =
  | { ok: true; payload: SessionStartedPayloadV2 }
  | {
      ok: false
      errorCode: 'QUESTION_NOT_IN_SELECTED_SET' | 'QUESTION_HASH_DRIFT' | 'QUESTION_BANK_MISSING'
    }

function normalizeSnapshotJson(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value !== 'string') return { ok: true, value }
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * 构建 SESSION_STARTED payload v2 冻结快照。
 * 逐题合并 paper 选题 + question_bank 运行时内容 + selected-question-set 配置；
 * 校验每题 content/scoring hash 与 authority 冻结值一致（题库内容未漂移），
 * 否则返回 QUESTION_HASH_DRIFT。root hash 由 computeQuestionRootHashes 复算。
 */
export function buildSessionStartedPayloadV2(
  input: BuildSessionSnapshotV2Input
): BuildSessionSnapshotV2Output {
  const selectedMap = new Map(
    input.selectedQuestionSet.questions.map((q) => [q.question_id, q])
  )
  const qbMap = new Map(input.questionBankRows.map((r) => [r.question_id, r]))

  const snapshots: SessionQuestionSnapshotV2[] = []
  for (const pq of input.paper) {
    const selected = selectedMap.get(pq.questionId)
    if (!selected) {
      return { ok: false, errorCode: "QUESTION_NOT_IN_SELECTED_SET" }
    }
    const qb = qbMap.get(pq.questionId)
    if (!qb) {
      return { ok: false, errorCode: "QUESTION_BANK_MISSING" }
    }
    // SQLite JSON TEXT 查询返回 string；冻结与 authority 使用解析后的 JSON 值计算 hash。
    const content = normalizeSnapshotJson(qb.content_json)
    const scoring = normalizeSnapshotJson(qb.scoring_rule_json)
    if (!content.ok || !scoring.ok) {
      return { ok: false, errorCode: "QUESTION_HASH_DRIFT" }
    }
    // 校验题库内容 hash 未漂移（与 authority 冻结值一致）
    if (hashRecord(content.value) !== selected.content_hash) {
      return { ok: false, errorCode: "QUESTION_HASH_DRIFT" }
    }
    if (hashRecord(scoring.value) !== selected.scoring_hash) {
      return { ok: false, errorCode: "QUESTION_HASH_DRIFT" }
    }
    snapshots.push({
      question_id: pq.questionId,
      question_version: qb.version,
      question_order: pq.questionOrder,
      question_phase: pq.questionPhase as 'ONLINE' | 'OFFLINE',
      bank_domain: 'BASE_ABILITY',
      module_type: pq.moduleType,
      question_type: pq.questionType,
      item_usage: qb.item_usage as 'SCORED_ITEM' | 'OBSERVATION_ONLY',
      job_module_code: qb.job_module_code,
      content_json: content.value,
      content_hash: selected.content_hash,
      scoring_rule_json: scoring.value,
      scoring_hash: selected.scoring_hash,
      renderer_key: selected.renderer_key,
      renderer_requirement_hash: selected.renderer_requirement_hash,
      asset_ids: [],
      asset_hash: null
    })
  }

  const roots = computeQuestionRootHashes(snapshots)
  const strategySnapshot: SessionStrategySnapshotV2 = {
    strategy_id: input.strategy.strategy_id,
    strategy_type: input.strategy.strategy_type,
    strategy_version: input.strategy.strategy_version,
    job_code: input.jobCode,
    task_code: input.taskCode,
    question_policy: input.strategy.question_policy,
    scoring_policy: input.strategy.scoring_policy,
    paper_seed: input.paperSeed,
    selected_question_set_hash: input.selectedQuestionSet.selected_question_set_hash
  }

  const payload: SessionStartedPayloadV2 = {
    payload_version: 2,
    session_id: input.sessionId,
    business_session_id: input.businessSessionId,
    student_id: input.studentId,
    job_code: input.jobCode,
    task_code: input.taskCode,
    online_question_count: input.onlineQuestionCount,
    offline_question_count: input.offlineQuestionCount,
    strategy: strategySnapshot,
    questions: snapshots,
    selected_question_set_hash: input.selectedQuestionSet.selected_question_set_hash,
    content_root_hash: roots.content_root_hash,
    scoring_root_hash: roots.scoring_root_hash,
    renderer_requirements_root_hash: roots.renderer_requirements_root_hash,
    initial_delivery_phase: 'PREPARED'
  }

  return { ok: true, payload }
}
