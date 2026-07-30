// 测评会话（assessment_session）application service。
// mutation 只通过 composition root 注入的 legacy event port 写事件，
// 并要求 Command Bus 已接受的执行上下文提供 correlation。
//
// [!] 架构决策（.continue-here.md Key Decisions）：
//   reducer 是投影唯一写入者——applySessionStarted 承担 INSERT assessment_session
//   + 50 行 assessment_session_question + status=ACTIVE（无独立 SESSION_ACTIVATED
//   事件，保冷启动重放忠实）。service 只调 injected event port +
//   applyAssessmentEvent，不另 INSERT / UPDATE。这与 impl.md Step 6b 文本（描述
//   handler 做 INSERT）有冲突，以 reducer 实际实现 + 决策记录为准。
//
// 事务边界（impl.md「事件写入事务边界」决策）：
//   db.transaction(() => { writeEvent(...); applyAssessmentEvent(...) })。
//   注入 port 与调用者共享同一 DB；jsonl appendFileSync 不可回滚（接受的边界，
//   由 reducer 幂等性 + 冷启动重放兜底）。

import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertStudent, assertSessionOwner } from '../../utils/auth-context'
import type { ReportMutationPort } from '../../domain/report-command-coordinator'
import { haltTrainingSessionSteps } from './training-service'
import type { AcceptedCommandContext } from '../command/command-types'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import {
  generatePaper,
  type QuestionBankRow
} from '../../domain/paper-generator'
import type { AbilityTag, QuestionPolicyJson, QuestionPolicyJobSkillFixedSet } from '../../../shared/types/json-schemas'
import type {
  SessionStartedPayload,
  SessionFirstQuestionActivatedPayload,
  AnswerSubmittedPayload,
  EmotionInterruptedPayload,
  EmotionResumedPayload,
  SittingStartedPayload,
  SittingEndedPayload,
  EmotionCollapseRecordedPayload,
  EmotionCollapseThresholdReachedPayload,
  SessionCompletedPayload,
  CollapseRecord,
  SessionAbortedPayload,
  RedlineTriggeredPayload,
  ResultCalculatedPayload,
  SafetyIncidentCreatedPayload
} from '@shared/types/event-payloads'

import {
  calculateAbilityScore,
  readOfflineAbilityScoringCompletion
} from '../../domain/ability-scoring'
import {
  SAFETY_REASON_CODES as SAFETY_REASON_CODES_SRC,
  SAFETY_CONTEXT_PHASES as SAFETY_CONTEXT_PHASES_SRC
} from '../../../shared/types/safety'
import type {
  AssessmentStrategyType,
  CreateSessionParams,
  CreateSessionResult,
  CreateSessionSuccess,
  DeliveryPhase,
  SessionQuestionView,
  SubmitAnswerParams,
  SubmitAnswerResult,
  SubmitAnswerSuccess,
  StartSessionParams,
  StartSessionResult,
  StartSessionSuccess,
  EmotionInterruptParams,
  EmotionInterruptResult,
  EmotionResumeParams,
  EmotionResumeResult,
  PauseSittingParams,
  PauseSittingResult,
  StartNextSittingParams,
  StartNextSittingResult,
  RecordEmotionCollapseParams,
  RecordEmotionCollapseResult,
  AbortSessionParams,
  AbortSessionResult,
  TriggerRedlineParams,
  TriggerRedlineResult,
  TriggerRedlineSuccess,
  CalculateResultParams,
  CalculateResultResult,
  CalculateResultSuccess,
  AssessmentErrorCode
} from '../../../shared/types/assessment'

export interface AssessmentMutationExecution {
  readonly eventPort: Pick<ReportMutationPort, 'writeEvent'>
  readonly context: AcceptedCommandContext
}

const ASSESSMENT_CORE_MUTATION_COMMANDS = new Set([
  'assessment:abortSession',
  'assessment:calculateResult',
  'assessment:createSession',
  'assessment:emotionInterrupt',
  'assessment:emotionResume',
  'assessment:pauseSitting',
  'assessment:recordEmotionCollapse',
  'assessment:startNextSitting',
  'assessment:startSession',
  'assessment:submitAnswer',
  'assessment:triggerRedline'
])

function correlationFor(
  execution: AssessmentMutationExecution,
  expectedCommandType: string
): string {
  const { envelope } = execution.context
  if (
    !ASSESSMENT_CORE_MUTATION_COMMANDS.has(expectedCommandType)
    || envelope.commandType !== expectedCommandType
  ) {
    throw new Error(`assessment mutation requires accepted ${expectedCommandType} context`)
  }
  if (!envelope.correlationId.trim()) {
    throw new Error('assessment mutation correlation must be non-empty')
  }
  return envelope.correlationId
}

function collectRuntimeAssetIds(row: {
  media_asset_id: string | null
  tool_asset_ids_json: string | null
  content_json: string
}): string[] {
  const ids = new Set<string>()
  const add = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && (key === 'asset_id' || key.endsWith('_asset_id'))) {
      ids.add(value)
      return
    }
    if (Array.isArray(value)) {
      if (key === 'asset_ids' || key.endsWith('_asset_ids')) {
        for (const item of value) if (typeof item === 'string') ids.add(item)
      } else {
        for (const item of value) add(item)
      }
      return
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) add(child, childKey)
    }
  }
  if (row.media_asset_id) ids.add(row.media_asset_id)
  try {
    for (const assetId of JSON.parse(row.tool_asset_ids_json ?? '[]') as unknown[]) {
      if (typeof assetId === 'string') ids.add(assetId)
    }
    add(JSON.parse(row.content_json) as unknown)
  } catch {
    ids.add('__INVALID_ASSET_REFERENCE_JSON__')
  }
  return [...ids].sort()
}

// MVP 固定 6 模块（AbilityTag 全集）。questionPolicy.required_modules 缺失时用此默认。
// 5.3 题库未交付时不影响——seedQuestionBank 也按此 6 模块生成 mock。
const DEFAULT_REQUIRED_MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

// 开放 session 状态集合（与 schema partial unique index WHERE 子句一致）。
const OPEN_SESSION_STATUSES = [
  'INIT',
  'ACTIVE',
  'EMOTION_INTERRUPTED',
  'SUSPENDED_REVIEW_REQUIRED',
  'OFFLINE_PENDING'
] as const

// safety_incident 枚举：从 shared 共享常量派生（单一来源 = src/shared/types/safety.ts）。
// schema CHECK 是兜底；handler 前置校验避免脏 jsonl。
const SAFETY_REASON_CODES = new Set<string>(SAFETY_REASON_CODES_SRC.map((r) => r.value))
const SAFETY_CONTEXT_PHASES = new Set<string>(SAFETY_CONTEXT_PHASES_SRC.map((p) => p.value))

/**
 * STUDENT 答题路径的 session.status → 错误码映射。
 * ACTIVE → null（可答）；EMOTION_INTERRUPTED → SESSION_PAUSED；
 * REDLINE_HALTED → SESSION_HALTED；其余（INIT/COMPLETED/ABORTED/...）→ SESSION_NOT_ACTIVE。
 */
function statusToAnswerErrorCode(status: string): AssessmentErrorCode | null {
  switch (status) {
    case 'ACTIVE':
      return null
    case 'EMOTION_INTERRUPTED':
      return 'SESSION_PAUSED'
    case 'REDLINE_HALTED':
      return 'SESSION_HALTED'
    default:
      return 'SESSION_NOT_ACTIVE'
  }
}

function statusToStartSessionErrorCode(status: string): AssessmentErrorCode | null {
  switch (status) {
    case 'INIT':
    case 'ACTIVE':
      return null
    case 'EMOTION_INTERRUPTED':
      return 'SESSION_PAUSED'
    case 'REDLINE_HALTED':
      return 'SESSION_HALTED'
    default:
      return 'SESSION_NOT_ACTIVE'
  }
}

/**
 * STUDENT 情绪中断路径的 status 映射。
 * ACTIVE / EMOTION_INTERRUPTED → 允许（后者代表中断中再次崩溃，collapse 累加）；
 * REDLINE_HALTED → SESSION_HALTED；其余 → SESSION_NOT_ACTIVE。
 */
function statusToInterruptErrorCode(status: string): AssessmentErrorCode | null {
  switch (status) {
    case 'ACTIVE':
    case 'EMOTION_INTERRUPTED':
      return null
    case 'REDLINE_HALTED':
      return 'SESSION_HALTED'
    default:
      return 'SESSION_NOT_ACTIVE'
  }
}

/**
 * TEACHER 终止路径的 status 映射。
 * 所有非终态（INIT/ACTIVE/EMOTION_INTERRUPTED/SUSPENDED_REVIEW_REQUIRED/OFFLINE_PENDING）→ 允许；
 * REDLINE_HALTED → SESSION_HALTED；COMPLETED/ABORTED → SESSION_NOT_ACTIVE。
 */
function statusToAbortErrorCode(status: string): AssessmentErrorCode | null {
  switch (status) {
    case 'INIT':
    case 'ACTIVE':
    case 'EMOTION_INTERRUPTED':
    case 'SUSPENDED_REVIEW_REQUIRED':
    case 'OFFLINE_PENDING':
      return null
    case 'REDLINE_HALTED':
      return 'SESSION_HALTED'
    default:
      return 'SESSION_NOT_ACTIVE'
  }
}

// --- 错误码 seed + 审计 ---

/**
 * Seed 测评相关错误码（INSERT OR IGNORE，幂等）。一次性 seed 5.4 全部步骤的码，
 * 满足 error_event_log.error_code FK 约束（先 seed 才能写审计）。
 * error_category='SYSTEM'（schema CHECK 枚举不含 'ASSESSMENT'，与 student/strategy 一致）。
 * exported 供测试使用；生产由 application runtime 在 IPC boundary ready 前统一调用。
 *
 * ERROR 级（异常，审计 recovery_status=UNRESOLVED）：
 *   - ASSESSMENT_SYSTEM_ERROR：handler catch 兜底
 *   - ASSESSMENT_FSM_VIOLATION：非法状态迁移（Step 7+）
 *   - QUESTION_BANK_INSUFFICIENT：题库不足以组卷（运营需补题）
 *   - ANSWER_PERSIST_FAILED：答题持久化异常（Step 7）
 *   - EMOTION_TRANSITION_FAILED：情绪状态转换异常（Step 7）
 *   - REDLINE_TRIGGER_SYSTEM_ERROR：红线触发链异常（Step 8）
 *
 * INFO 级（审计 TEACHER 关键操作，recovery_status=IGNORED）：
 *   - SESSION_CREATED / SESSION_ABORTED / REDLINE_TRIGGERED
 *
 * 业务校验返回码（FORBIDDEN / NOT_FOUND / SESSION_ALREADY_OPEN 等）不 seed、
 * 不写审计（与 student.ts / strategy.ts 一致：正常业务拒绝，非异常）。
 */
export function seedAssessmentErrorCodes(db: DBAdapter): void {
  const codes: Array<[string, 'INFO' | 'ERROR', 'P1' | 'P2' | 'P3', string, string, 0 | 1]> = [
    ['SESSION_CREATED', 'INFO', 'P3', '测评会话创建', '教师发起测评会话', 0],
    ['SESSION_ABORTED', 'INFO', 'P3', '测评会话终止', '教师终止测评会话', 0],
    ['REDLINE_TRIGGERED', 'INFO', 'P2', '安全红线触发', '教师/管理员触发安全红线', 0],
    ['ASSESSMENT_SYSTEM_ERROR', 'ERROR', 'P1', '测评系统异常', '测评操作异常', 1],
    ['ASSESSMENT_FSM_VIOLATION', 'ERROR', 'P1', '测评状态机违规', '非法状态迁移', 1],
    ['QUESTION_BANK_INSUFFICIENT', 'ERROR', 'P2', '题库不足', '题库不足以组卷', 1],
    ['ANSWER_PERSIST_FAILED', 'ERROR', 'P1', '答题持久化失败', '答题持久化异常', 1],
    ['EMOTION_TRANSITION_FAILED', 'ERROR', 'P1', '情绪状态转换失败', '情绪状态转换异常', 1],
    ['REDLINE_TRIGGER_SYSTEM_ERROR', 'ERROR', 'P1', '红线触发系统异常', '红线触发链异常', 1]
  ]
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO error_code_registry
       (error_code, error_category, severity, priority_level, title, default_message, is_blocking)
     VALUES (?, 'SYSTEM', ?, ?, ?, ?, ?)`
  )
  for (const c of codes) stmt.run(...c)
}

/**
 * 写审计日志到 error_event_log。
 * related_aggregate_id = sessionId（聚合根 ID）。
 *
 * recovery_status 语义（与 student.ts / strategy.ts 一致）：
 * - INFO 审计行用 'IGNORED'
 * - ERROR 异常行用 'UNRESOLVED'
 */
function logAssessmentEvent(
  db: DBAdapter,
  code: string,
  severity: 'INFO' | 'ERROR',
  sessionId: string,
  callerUserId: string,
  context: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO error_event_log
       (error_event_id, error_code, severity, error_category,
        related_aggregate_type, related_aggregate_id, message, context_json, recovery_status, created_at)
     VALUES (?, ?, ?, 'SYSTEM', 'ASSESSMENT_SESSION', ?, ?, ?, ?, datetime('now'))`
  ).run(
    uuidv4(),
    code,
    severity,
    sessionId,
    `${code} session=${sessionId} by=${callerUserId}`,
    JSON.stringify({ callerUserId, ...context }),
    severity === 'INFO' ? 'IGNORED' : 'UNRESOLVED'
  )
}

// --- 行映射 ---

interface StrategyConfigRow {
  strategy_type: string
  job_code: string
  online_question_count: number
  offline_question_count: number
  question_policy_json: string
}

// --- createSession ---

/**
 * assessment:createSession 核心纯函数（TEACHER）。
 *
 * 核心路径（impl.md Step 6b）：
 *   assertCaller(TEACHER) → 读 strategy_config（校验 type ∈ BASELINE/MOCK）
 *   → 校验 student ACTIVE → 校验无开放 session → 校验无未解决安全事件
 *   → 查 ACTIVE question_bank → generatePaper
 *   → db.transaction{ writeEvent(SESSION_STARTED) + applyAssessmentEvent }
 *   → 返回 sessionId + 42 ONLINE 题
 *
 * reducer（applyAssessmentEvent → applySessionStarted）承担 INSERT assessment_session
 * + 50 行 assessment_session_question + status=ACTIVE。handler 不另 INSERT/UPDATE。
 *
 * 失败码：
 * - FORBIDDEN：非 TEACHER 或账号非 ACTIVE
 * - VALIDATION_ERROR：taskCode 空 / strategy_type 非 assessment 类（TRAINING_PRACTICE）
 * - NOT_FOUND：studentId/strategyId/strategyVersion 缺失或 (strategyId, version) 不存在 / student 不存在
 * - SESSION_ALREADY_OPEN：同 (student, task, strategy_type) 已有开放 session
 * - BLOCKED_BY_SAFETY_INCIDENT：存在未解决安全事件（PENDING_DETAIL/CONFIRMED + requires_review）
 * - QUESTION_BANK_INSUFFICIENT：题库不足以组卷（写审计，运营可见）
 * - ASSESSMENT_SYSTEM_ERROR：异常 catch 兜底（写审计）
 */
export function createSession(
  db: DBAdapter,
  params: CreateSessionParams,
  execution: AssessmentMutationExecution
): CreateSessionResult {
  const correlationId = correlationFor(execution, 'assessment:createSession')
  // 1. 身份校验
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. 参数基础校验
  if (typeof params.studentId !== 'string' || params.studentId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (
    typeof params.strategyVersion !== 'number' ||
    !Number.isInteger(params.strategyVersion) ||
    params.strategyVersion < 1
  ) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.taskCode !== 'string' || params.taskCode.trim().length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 3. 读 strategy_config
  const strategy = db
    .prepare(
      `SELECT strategy_type, job_code, online_question_count, offline_question_count,
              question_policy_json
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(params.strategyId, params.strategyVersion) as StrategyConfigRow | undefined
  if (!strategy) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 4. 校验 strategy_type（assessment 仅接受 BASELINE_ASSESSMENT/MOCK_EXAM/JOB_SKILL_ASSESSMENT；TRAINING_PRACTICE 走训练功能）
  if (
    strategy.strategy_type !== 'BASELINE_ASSESSMENT' &&
    strategy.strategy_type !== 'MOCK_EXAM' &&
    strategy.strategy_type !== 'JOB_SKILL_ASSESSMENT'
  ) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const strategyType = strategy.strategy_type as AssessmentStrategyType

  // 5. 校验 student 存在 ACTIVE（student_profile + user_account 双 ACTIVE）
  const student = db
    .prepare(
      `SELECT s.student_id
         FROM student_profile s
         JOIN user_account u ON u.user_id = s.student_id
        WHERE s.student_id = ? AND s.status = 'ACTIVE' AND u.status = 'ACTIVE'`
    )
    .get(params.studentId) as { student_id: string } | undefined
  if (!student) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 6. 校验同 student/job/task 下无开放 session（schema partial unique index 兜底；前置 SELECT 返回友好错误码）
  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const openSession = db
    .prepare(
      `SELECT session_id FROM assessment_session
        WHERE student_id = ? AND job_code = ? AND task_code = ? AND strategy_type = ?
          AND status IN (${placeholders})
        LIMIT 1`
    )
    .get(
      params.studentId,
      strategy.job_code,
      params.taskCode,
      strategyType,
      ...OPEN_SESSION_STATUSES
    ) as { session_id: string } | undefined
  if (openSession) {
    return { success: false, errorCode: 'SESSION_ALREADY_OPEN' }
  }

  // 7. 校验同 student/job/task 下无未解决安全事件（schema trigger trg_assessment_session_block_unresolved_safety_incident
  //    是兜底 BEFORE INSERT ABORT；handler 前置 SELECT 返回友好错误码，避免进事务后才发现）
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND job_code = ? AND task_code = ?
          AND requires_review_before_next_session = 1
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
        LIMIT 1`
    )
    .get(params.studentId, strategy.job_code, params.taskCode) as { 1: number } | undefined
  if (blocked) {
    return { success: false, errorCode: 'BLOCKED_BY_SAFETY_INCIDENT' }
  }

  // 8-9. 解析 question_policy_json，按策略类型选题
  const sessionId = uuidv4()
  const businessSessionId = sessionId
  let observationTemplateId: string | null = null
  let questionIds: string[]
  let onlineQuestionsToReturn: SessionQuestionView[]

  if (strategyType === 'JOB_SKILL_ASSESSMENT') {
    // FIXED_SET 路径：从策略配置读固定题集，不走随机组卷
    let fixedPolicy: QuestionPolicyJobSkillFixedSet
    try {
      fixedPolicy = JSON.parse(strategy.question_policy_json) as QuestionPolicyJobSkillFixedSet
    } catch (err) {
      logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', sessionId, caller.row.user_id, {
        operation: 'createSession',
        error: `parse question_policy_json: ${String(err)}`,
        strategyId: params.strategyId,
        strategyVersion: params.strategyVersion
      })
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }

    const scoredIds = fixedPolicy.fixed_scored_question_ids ?? []
    const obsIds = fixedPolicy.embedded_observation_question_ids ?? []
    observationTemplateId = obsIds.length > 0 ? `${params.strategyId}@${params.strategyVersion}` : null

    if (scoredIds.length === 0) {
      logAssessmentEvent(db, 'QUESTION_BANK_INSUFFICIENT', 'ERROR', 'unknown', caller.row.user_id, {
        operation: 'createSession',
        strategyId: params.strategyId,
        strategyVersion: params.strategyVersion,
        error: 'fixed_scored_question_ids is empty — strategy not configured'
      })
      return { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
    }

    // 验证所有固定题（scored + obs）存在且 ACTIVE；同时读 question_type 供排序和返回
    type FixedQbRow = {
      question_id: string
      status: string
      question_type: string
      item_usage: string
      job_module_code: string | null
      media_asset_id: string | null
      tool_asset_ids_json: string | null
      content_json: string
    }
    const allCandidateIds = [...scoredIds, ...obsIds]
    const placeholders = allCandidateIds.map(() => '?').join(',')
    const fixedQbRows = db
      .prepare(
        `SELECT question_id, status, question_type, item_usage, job_module_code,
                media_asset_id, tool_asset_ids_json, content_json
           FROM question_bank
          WHERE question_id IN (${placeholders})`
      )
      .all(...allCandidateIds) as FixedQbRow[]
    const fixedQbMap = new Map(fixedQbRows.map((r) => [r.question_id, r]))

    for (const qid of allCandidateIds) {
      const row = fixedQbMap.get(qid)
      if (!row || row.status !== 'ACTIVE') {
        logAssessmentEvent(db, 'QUESTION_BANK_INSUFFICIENT', 'ERROR', 'unknown', caller.row.user_id, {
          operation: 'createSession',
          strategyId: params.strategyId,
          strategyVersion: params.strategyVersion,
          questionId: qid,
          error: row ? `question status=${row.status}` : 'question not found in bank'
        })
        return { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
      }
    }

    const requiredAssetIds = [...new Set(fixedQbRows.flatMap(collectRuntimeAssetIds))]
    if (requiredAssetIds.length > 0) {
      const assetPlaceholders = requiredAssetIds.map(() => '?').join(',')
      const activeAssetRows = db
        .prepare(`SELECT asset_id FROM asset_resource WHERE status = 'ACTIVE' AND asset_id IN (${assetPlaceholders})`)
        .all(...requiredAssetIds) as Array<{ asset_id: string }>
      const activeAssetIds = new Set(activeAssetRows.map((asset) => asset.asset_id))
      const unavailable = requiredAssetIds.filter((assetId) => !activeAssetIds.has(assetId))
      if (unavailable.length > 0) {
        logAssessmentEvent(db, 'QUESTION_BANK_INSUFFICIENT', 'ERROR', 'unknown', caller.row.user_id, {
          operation: 'createSession',
          strategyId: params.strategyId,
          strategyVersion: params.strategyVersion,
          error: `required assets unavailable: ${unavailable.join(', ')}`
        })
        return { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
      }
    }

    // 排序：ONLINE scored（非 OFFLINE_OPERATION）→ OFFLINE scored → OBSERVATION
    // reducer 根据 item_usage/question_type 决定 phase，顺序决定 question_order
    const onlineScoredIds = scoredIds.filter(
      (id) => fixedQbMap.get(id)!.question_type !== 'OFFLINE_OPERATION'
    )
    const offlineScoredIds = scoredIds.filter(
      (id) => fixedQbMap.get(id)!.question_type === 'OFFLINE_OPERATION'
    )
    questionIds = [...onlineScoredIds, ...offlineScoredIds, ...obsIds]

    // 返回仅 ONLINE scored 题（OFFLINE/OBSERVATION 不进答题指针）
    onlineQuestionsToReturn = onlineScoredIds.map((qid, i) => {
      const qb = fixedQbMap.get(qid)!
      return {
        questionId: qid,
        questionOrder: i + 1,
        questionPhase: 'ONLINE' as const,
        // JOB_SPECIFIC 题 module_type=NULL；job_module_code 作 moduleType 字段传递
        moduleType: (qb.job_module_code ?? '') as AbilityTag,
        questionType: qb.question_type as 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
      }
    })
  } else {
    // BASE_ABILITY / MOCK 路径（现有随机组卷逻辑）
    let questionPolicy: QuestionPolicyJson
    try {
      questionPolicy = JSON.parse(strategy.question_policy_json) as QuestionPolicyJson
    } catch (err) {
      logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', sessionId, caller.row.user_id, {
        operation: 'createSession',
        error: `parse question_policy_json: ${String(err)}`,
        strategyId: params.strategyId,
        strategyVersion: params.strategyVersion
      })
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }

    const requiredModules =
      Array.isArray(questionPolicy.required_modules) && questionPolicy.required_modules.length > 0
        ? questionPolicy.required_modules
        : DEFAULT_REQUIRED_MODULES

    const qbRows = db
      .prepare(
        `SELECT question_id, module_type, question_type, sensory_tags_json
           FROM question_bank
          WHERE job_code = ? AND status = 'ACTIVE'`
      )
      .all(strategy.job_code) as QuestionBankRow[]

    const paperSeed = `${sessionId}:${params.studentId}:${params.strategyId}:${params.strategyVersion}`
    const paper = generatePaper({
      onlineQuestionCount: strategy.online_question_count,
      offlineQuestionCount: strategy.offline_question_count,
      questionRatio: questionPolicy.question_ratio,
      requiredModules,
      questionBankRows: qbRows,
      paperSeed,
      sensoryFilterMode: questionPolicy.sensory_filter_mode ?? 'SOFT'
    })
    if (!paper.ok) {
      if (paper.errorCode === 'QUESTION_BANK_INSUFFICIENT') {
        logAssessmentEvent(db, 'QUESTION_BANK_INSUFFICIENT', 'ERROR', 'unknown', caller.row.user_id, {
          operation: 'createSession',
          strategyId: params.strategyId,
          strategyVersion: params.strategyVersion,
          studentId: params.studentId,
          activeQuestionCount: qbRows.length
        })
        return { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
      }
      // INVALID_POLICY
      logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', sessionId, caller.row.user_id, {
        operation: 'createSession',
        error: 'generatePaper INVALID_POLICY',
        strategyId: params.strategyId,
        strategyVersion: params.strategyVersion
      })
      return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
    }

    questionIds = paper.questions.map((q) => q.questionId)
    onlineQuestionsToReturn = paper.questions
      .filter((q) => q.questionPhase === 'ONLINE')
      .map((q) => ({
        questionId: q.questionId,
        questionOrder: q.questionOrder,
        questionPhase: 'ONLINE' as const,
        moduleType: q.moduleType,
        questionType: q.questionType as 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG' | 'SOFTWARE_TASK'
      }))
  }

  // 10. 事务：writeEvent(SESSION_STARTED) + applyAssessmentEvent
  //     reducer applySessionStarted 承担 INSERT assessment_session（status=ACTIVE）
  //     + assessment_session_question 行（ONLINE/OFFLINE/OBSERVATION phase 由 reducer 判定）
  const payload: SessionStartedPayload = {
    session_id: sessionId,
    business_session_id: businessSessionId,
    student_id: params.studentId,
    strategy_id: params.strategyId,
    strategy_type: strategyType,
    strategy_version: params.strategyVersion,
    job_code: strategy.job_code,
    task_code: params.taskCode,
    online_question_count: strategy.online_question_count,
    offline_question_count: strategy.offline_question_count,
    question_ids: questionIds,
    initial_delivery_phase: 'PREPARED',
    observation_template_id: observationTemplateId
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: sessionId,
        eventType: 'SESSION_STARTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (err) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', sessionId, caller.row.user_id, {
      operation: 'createSession',
      error: String(err),
      strategyId: params.strategyId,
      strategyVersion: params.strategyVersion,
      studentId: params.studentId
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 11. 审计 SESSION_CREATED（TEACHER 关键操作）
  logAssessmentEvent(db, 'SESSION_CREATED', 'INFO', sessionId, caller.row.user_id, {
    studentId: params.studentId,
    strategyId: params.strategyId,
    strategyVersion: params.strategyVersion,
    taskCode: params.taskCode
  })

  // 12. 返回（仅 ONLINE 题，学生立即可答；OFFLINE/OBSERVATION 由线下评分/教师观察流程处理）
  const result: CreateSessionSuccess = {
    success: true,
    sessionId,
    businessSessionId,
    questions: onlineQuestionsToReturn
  }
  return result
}

export { applyAssessmentEvent }

// --- submitAnswer ---

/**
 * assessment:submitAnswer 核心纯函数（STUDENT）。
 *
 * 核心路径（impl.md Step 7）：
 *   assertStudent + assertSessionOwner → 校验 status=ACTIVE
 *   → 校验 question ∈ session ONLINE → 校验无 VALID answer_record
 *   → 校验 answerPayload 结构 + content_json 一致性 → 计分
 *   → db.transaction{ writeEvent(ANSWER_SUBMITTED) + applyAssessmentEvent }
 *
 * reducer（applyAnswerSubmitted）承担 INSERT answer_record + session 计数前移。
 * handler 不另 INSERT/UPDATE。
 *
 * [!] answerPayload 字段名以 event-payloads.ts 为准（selected / placements），
 * 非 impl.md Step 7 文本的 selected_option / slots（文档不一致，待同步）。
 *
 * [!] 计分逻辑按题型硬编码（doc §2：线上题二值 2/0），
 * 不读 scoring_rule_json（该字段供教师界面标签展示用，非运行期评分输入）。
 *
 * 失败码：
 * - FORBIDDEN：非 STUDENT / 账号非 ACTIVE / session 不属于 caller
 * - NOT_FOUND：session 不存在
 * - SESSION_NOT_ACTIVE / SESSION_PAUSED / SESSION_HALTED：status 非 ACTIVE
 * - QUESTION_NOT_IN_SESSION：question_id 不在本 session 或非 ONLINE
 * - ALREADY_ANSWERED：已存在 VALID answer_record（ux_answer_record_one_valid_answer 兜底）
 * - VALIDATION_ERROR：answerPayload 结构错 / question_type 不匹配 / content_json 缺字段或缺校验数据
 * - ANSWER_PERSIST_FAILED：事务异常（写审计）
 */
export function submitAnswer(
  db: DBAdapter,
  params: SubmitAnswerParams,
  execution: AssessmentMutationExecution
): SubmitAnswerResult {
  const correlationId = correlationFor(execution, 'assessment:submitAnswer')
  // 1. STUDENT 身份校验
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 所有权（NOT_FOUND / FORBIDDEN）
  const owner = assertSessionOwner(db, caller.row.user_id, params.sessionId)
  if (!owner.ok) {
    return { success: false, errorCode: owner.errorCode }
  }

  // 3. status 必须 ACTIVE
  const statusErr = statusToAnswerErrorCode(owner.sessionRow.status)
  if (statusErr) {
    return { success: false, errorCode: statusErr }
  }

  // 4. questionId 基础校验
  if (typeof params.questionId !== 'string' || params.questionId.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 5. question ∈ 本 session 的 ONLINE 题 + 读 question_bank.content_json（计分依赖）
  const sq = db
    .prepare(
      `SELECT sq.question_phase, sq.question_type AS sq_type, sq.question_order,
              qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_id = ?`
    )
    .get(params.sessionId, params.questionId) as
    | { question_phase: string; sq_type: string; question_order: number; content_json: string; scoring_rule_json: string | null }
    | undefined
  if (!sq || sq.question_phase !== 'ONLINE') {
    return { success: false, errorCode: 'QUESTION_NOT_IN_SESSION' }
  }

  // 6. 无 VALID answer_record（schema ux_answer_record_one_valid_answer 兜底；前置 SELECT 返回友好码）
  const existing = db
    .prepare(
      `SELECT answer_id FROM answer_record
        WHERE session_id = ? AND question_id = ? AND status = 'VALID'`
    )
    .get(params.sessionId, params.questionId) as { answer_id: string } | undefined
  if (existing) {
    return { success: false, errorCode: 'ALREADY_ANSWERED' }
  }

  // 7. answerPayload 结构 + content_json 一致性 + 计分
  const payload = params.answerPayload
  if (payload.question_type !== sq.sq_type) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  let content: Record<string, unknown>
  try {
    content = JSON.parse(sq.content_json)
  } catch {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // scoring_rule_json 存放正确答案（实际导入数据），content.expected_answer 为测试兼容 fallback
  let scoringRule: Record<string, unknown> | null = null
  try {
    scoringRule = JSON.parse(sq.scoring_rule_json ?? '{}')
  } catch { /* ignore */ }

  // interaction.config 存放选项/拖拽等交互数据（实际导入数据）
  const answerInteractionConfig =
    content.interaction != null &&
    typeof content.interaction === 'object' &&
    'config' in (content.interaction as Record<string, unknown>)
      ? ((content.interaction as Record<string, unknown>).config as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  let isCorrect: boolean
  let score: 0 | 2

  if (payload.question_type === 'TRUE_FALSE') {
    if (typeof payload.selected !== 'boolean') {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    // variants 完整性检查：若存在则每个 variant.expected_answer 必须是 boolean
    if (Array.isArray(content.variants)) {
      for (const v of content.variants) {
        if (v == null || typeof v !== 'object' || typeof (v as Record<string, unknown>).expected_answer !== 'boolean') {
          return { success: false, errorCode: 'VALIDATION_ERROR' }
        }
      }
    }
    // correct_answer from scoring_rule_json (production) or content.expected_answer (test compat)
    const expectedRaw = scoringRule?.correct_answer ?? content.expected_answer
    const expected = expectedRaw === true || expectedRaw === 'true'
      ? true
      : expectedRaw === false || expectedRaw === 'false'
        ? false
        : undefined
    if (expected === undefined) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    isCorrect = payload.selected === expected
    score = isCorrect ? 2 : 0
  } else if (payload.question_type === 'SINGLE_CHOICE') {
    if (typeof payload.selected !== 'string' || payload.selected.length === 0) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    // options from interaction.config (production) or content.options (test compat)
    const rawOptions = Array.isArray(answerInteractionConfig.options)
      ? answerInteractionConfig.options
      : Array.isArray(content.options)
        ? content.options
        : null
    if (
      !rawOptions ||
      !rawOptions.every(
        (o) => o !== null && typeof o === 'object' && typeof (o as { key?: unknown }).key === 'string'
      )
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const validKeys = (rawOptions as { key: string }[]).map((o) => o.key)
    if (!validKeys.includes(payload.selected)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    // correct_answer from scoring_rule_json (production) or content.expected_answer (test compat)
    const expectedAnswer = scoringRule?.correct_answer ?? content.expected_answer
    if (typeof expectedAnswer !== 'string') {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    isCorrect = payload.selected === expectedAnswer
    score = isCorrect ? 2 : 0
  } else {
    // DRAG
    if (
      !Array.isArray(payload.placements) ||
      !payload.placements.every(
        (p) =>
          p !== null &&
          typeof p === 'object' &&
          typeof (p as { item_id?: unknown }).item_id === 'string' &&
          typeof (p as { zone_id?: unknown }).zone_id === 'string'
      )
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const placements = payload.placements
    // items/zones from interaction.config (production) or content top-level (test compat)
    const rawDragItems = Array.isArray(answerInteractionConfig.items)
      ? answerInteractionConfig.items
      : Array.isArray(content.drag_items)
        ? content.drag_items
        : null
    const rawDropZones = Array.isArray(answerInteractionConfig.zones)
      ? answerInteractionConfig.zones
      : Array.isArray(content.drop_zones)
        ? content.drop_zones
        : null
    if (!rawDragItems || !rawDropZones) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const dragItems = rawDragItems as { item_id?: unknown }[]
    const dropZones = rawDropZones as { zone_id?: unknown; accepts?: unknown }[]
    if (
      !dragItems.every((i) => typeof i.item_id === 'string') ||
      !dropZones.every((z) => typeof z.zone_id === 'string' && Array.isArray(z.accepts))
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const placedIds = placements.map((p) => p.item_id)
    // 每个 item 恰好放置一次（数量 = 可拖元素数，且无重复）
    if (placedIds.length !== dragItems.length) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (new Set(placedIds).size !== placedIds.length) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const validItemIds = new Set(dragItems.map((i) => i.item_id as string))
    if (!placedIds.every((id) => validItemIds.has(id))) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const validZoneIds = new Set(dropZones.map((z) => z.zone_id as string))
    if (!placements.every((p) => validZoneIds.has(p.zone_id))) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    // 计分：每个 placement 的 item_id 是否落在 accepts 它的 zone
    const correctCount = placements.filter((p) => {
      const zone = dropZones.find((z) => (z.zone_id as string) === p.zone_id)
      return zone ? (zone.accepts as string[]).includes(p.item_id) : false
    }).length
    const total = placements.length
    const allCorrect = correctCount === total
    isCorrect = allCorrect
    score = allCorrect ? 2 : 0
  }

  // 8. 事务：writeEvent(ANSWER_SUBMITTED) + applyAssessmentEvent
  const answerId = uuidv4()
  const submittedAt = new Date().toISOString()
  const eventPayload: AnswerSubmittedPayload = {
    session_id: params.sessionId,
    answer_id: answerId,
    question_id: params.questionId,
    question_type: payload.question_type,
    answer_payload: payload,
    is_correct: isCorrect,
    score,
    question_order: sq.question_order,
    submitted_at: submittedAt
  }

  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'ANSWER_SUBMITTED',
        payload: eventPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (err) {
    logAssessmentEvent(db, 'ANSWER_PERSIST_FAILED', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'submitAnswer',
      error: String(err),
      questionId: params.questionId
    })
    return { success: false, errorCode: 'ANSWER_PERSIST_FAILED' }
  }

  const result: SubmitAnswerSuccess = {
    success: true,
    answerId,
    isCorrect,
    score
  }
  return result
}

// --- emotionInterrupt ---

/**
 * assessment:emotionInterrupt 核心纯函数（STUDENT）。
 *
 * 学生情绪崩溃中断。允许从 ACTIVE 与 EMOTION_INTERRUPTED（escalating collapse，
 * 连续未恢复中断累加，是达到 emotion_collapse_threshold 的唯一路径）。
 *
 * reducer applyEmotionInterrupted 承担 status=EMOTION_INTERRUPTED + pause_count+1。
 *
 * 失败码：FORBIDDEN / NOT_FOUND / SESSION_NOT_ACTIVE / SESSION_HALTED / EMOTION_TRANSITION_FAILED
 */
export function emotionInterrupt(
  db: DBAdapter,
  params: EmotionInterruptParams,
  execution: AssessmentMutationExecution
): EmotionInterruptResult {
  const correlationId = correlationFor(execution, 'assessment:emotionInterrupt')
  // 1. STUDENT 身份校验
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 所有权
  const owner = assertSessionOwner(db, caller.row.user_id, params.sessionId)
  if (!owner.ok) {
    return { success: false, errorCode: owner.errorCode }
  }

  // 3. status 必须 ACTIVE 或 EMOTION_INTERRUPTED
  const err = statusToInterruptErrorCode(owner.sessionRow.status)
  if (err) {
    return { success: false, errorCode: err }
  }

  // 4. 写事件 + 投影
  const payload: EmotionInterruptedPayload = {
    session_id: params.sessionId,
    interrupted_at: new Date().toISOString(),
    current_question_order: params.currentQuestionOrder ?? null,
    reason: params.reason ?? null
  }
  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'EMOTION_INTERRUPTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'EMOTION_TRANSITION_FAILED', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'emotionInterrupt',
      error: String(e)
    })
    return { success: false, errorCode: 'EMOTION_TRANSITION_FAILED' }
  }
  return { success: true }
}

// --- emotionResume ---

/**
 * assessment:emotionResume 核心纯函数（学生或教师）。
 *
 * 教师安抚后恢复。仅 EMOTION_INTERRUPTED 态可恢复；其余 → SESSION_NOT_ACTIVE。
 * reducer applyEmotionResumed 承担 status=ACTIVE + 清 pause_started_at。
 *
 * 失败码：FORBIDDEN / NOT_FOUND / SESSION_NOT_ACTIVE / EMOTION_TRANSITION_FAILED
 */
export function emotionResume(
  db: DBAdapter,
  params: EmotionResumeParams,
  execution: AssessmentMutationExecution
): EmotionResumeResult {
  const correlationId = correlationFor(execution, 'assessment:emotionResume')
  // 1. 身份与访问范围校验：学生仅可恢复自己的 session，教师可恢复本机构任意学生的 session。
  const caller = params.callerRole === 'STUDENT'
    ? assertStudent(db, params.callerUserId, params.callerRole)
    : assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok || !['STUDENT', 'TEACHER'].includes(caller.row.role)) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 存在（TEACHER 不做所有权校验：单租户，任何教师可恢复任何学生 session）
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  const sess = db
    .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId) as { status: string } | undefined
  if (!sess) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (caller.row.role === 'STUDENT') {
    const owner = assertSessionOwner(db, caller.row.user_id, params.sessionId)
    if (!owner.ok) return { success: false, errorCode: owner.errorCode }
  }

  // 3. status 必须 EMOTION_INTERRUPTED（恢复非中断态无意义）
  if (sess.status !== 'EMOTION_INTERRUPTED') {
    return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  }

  // 4. 写事件 + 投影
  const payload: EmotionResumedPayload = {
    session_id: params.sessionId,
    resumed_at: new Date().toISOString(),
    resume_from_question_order: params.resumeFromQuestionOrder ?? null
  }
  try {
    const tx = db.transaction(() => {
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'EMOTION_RESUMED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'STUDENT' | 'TEACHER',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'EMOTION_TRANSITION_FAILED', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'emotionResume',
      error: String(e)
    })
    return { success: false, errorCode: 'EMOTION_TRANSITION_FAILED' }
  }
  return { success: true }
}

function requireTeacherCaller(db: DBAdapter, callerUserId: unknown, callerRole: unknown) {
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok || caller.row.role !== 'TEACHER') return null
  return caller.row
}

/** 教师按计划结束当前坐次。该路径不作废 session，下一坐次仍可继续。 */
export function pauseSitting(
  db: DBAdapter,
  params: PauseSittingParams,
  execution: AssessmentMutationExecution
): PauseSittingResult {
  const correlationId = correlationFor(execution, 'assessment:pauseSitting')
  const teacher = requireTeacherCaller(db, params.callerUserId, params.callerRole)
  if (!teacher) return { success: false, errorCode: 'FORBIDDEN' }
  const session = db
    .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId) as { status: string } | undefined
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (session.status === 'REDLINE_HALTED') return { success: false, errorCode: 'SESSION_HALTED' }
  if (session.status !== 'ACTIVE') return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  const openSitting = db
    .prepare('SELECT sitting_no FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL')
    .get(params.sessionId) as { sitting_no: number } | undefined
  if (!openSitting) return { success: false, errorCode: 'ASSESSMENT_FSM_VIOLATION' }
  const endedAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const payload: SittingEndedPayload = {
        session_id: params.sessionId,
        sitting_no: openSitting.sitting_no,
        ended_at: endedAt,
        ended_by: teacher.user_id,
        end_reason: 'PAUSED_BY_PLAN',
        current_question_order: params.currentQuestionOrder ?? null
      }
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId,
        eventType: 'SITTING_ENDED', payload: payload as unknown as Record<string, unknown>,
        actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
      })
      applyAssessmentEvent(db, event)
    })()
  } catch (error) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, teacher.user_id, {
      operation: 'pauseSitting', error: String(error)
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
  return { success: true, sittingNo: openSitting.sitting_no }
}

/** 教师开始下一坐次，只允许从计划暂停或崩溃待复核状态继续。 */
export function startNextSitting(
  db: DBAdapter,
  params: StartNextSittingParams,
  execution: AssessmentMutationExecution
): StartNextSittingResult {
  const correlationId = correlationFor(execution, 'assessment:startNextSitting')
  const teacher = requireTeacherCaller(db, params.callerUserId, params.callerRole)
  if (!teacher) return { success: false, errorCode: 'FORBIDDEN' }
  const session = db
    .prepare('SELECT status FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId) as { status: string } | undefined
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (session.status === 'REDLINE_HALTED') return { success: false, errorCode: 'SESSION_HALTED' }
  if (session.status !== 'SUSPENDED_REVIEW_REQUIRED') return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  const nextSittingNo = (
    db.prepare('SELECT COALESCE(MAX(sitting_no), 0) + 1 AS next_sitting_no FROM assessment_sitting WHERE session_id = ?')
      .get(params.sessionId) as { next_sitting_no: number }
  ).next_sitting_no
  const startedAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const payload: SittingStartedPayload = {
        session_id: params.sessionId, sitting_no: nextSittingNo,
        started_at: startedAt, started_by: teacher.user_id
      }
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId,
        eventType: 'SITTING_STARTED', payload: payload as unknown as Record<string, unknown>,
        actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
      })
      applyAssessmentEvent(db, event)
    })()
  } catch (error) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, teacher.user_id, {
      operation: 'startNextSitting', error: String(error)
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
  return { success: true, sittingNo: nextSittingNo }
}

/** 教师确认学生无法在当次恢复，结束本坐次而非直接作废整个测评。 */
export function recordEmotionCollapse(
  db: DBAdapter,
  params: RecordEmotionCollapseParams,
  execution: AssessmentMutationExecution
): RecordEmotionCollapseResult {
  const correlationId = correlationFor(execution, 'assessment:recordEmotionCollapse')
  const teacher = requireTeacherCaller(db, params.callerUserId, params.callerRole)
  if (!teacher) return { success: false, errorCode: 'FORBIDDEN' }
  const session = db.prepare(
    'SELECT status, strategy_id, strategy_version FROM assessment_session WHERE session_id = ?'
  ).get(params.sessionId) as { status: string; strategy_id: string; strategy_version: number } | undefined
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (session.status === 'REDLINE_HALTED') return { success: false, errorCode: 'SESSION_HALTED' }
  if (session.status !== 'EMOTION_INTERRUPTED') return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  const sitting = db.prepare(
    'SELECT sitting_no FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL'
  ).get(params.sessionId) as { sitting_no: number } | undefined
  if (!sitting) return { success: false, errorCode: 'ASSESSMENT_FSM_VIOLATION' }
  const thresholdRow = db.prepare(
    'SELECT emotion_collapse_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?'
  ).get(session.strategy_id, session.strategy_version) as { emotion_collapse_threshold: number } | undefined
  const threshold = thresholdRow?.emotion_collapse_threshold ?? 3
  const existing = db.prepare(
    "SELECT COUNT(*) AS count FROM domain_event_projection WHERE aggregate_id = ? AND event_type = 'EMOTION_COLLAPSE_RECORDED'"
  ).get(params.sessionId) as { count: number }
  const collapseCount = existing.count + 1
  const thresholdReached = collapseCount >= threshold
  const occurredAt = new Date().toISOString()
  try {
    db.transaction(() => {
      const endedEvent = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId, eventType: 'SITTING_ENDED',
        payload: {
          session_id: params.sessionId, sitting_no: sitting.sitting_no, ended_at: occurredAt,
          ended_by: teacher.user_id, end_reason: 'ENDED_BY_COLLAPSE',
          current_question_order: params.currentQuestionOrder ?? null
        } as SittingEndedPayload as unknown as Record<string, unknown>,
        actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
      })
      applyAssessmentEvent(db, endedEvent)
      const collapseEvent = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId, eventType: 'EMOTION_COLLAPSE_RECORDED',
        payload: {
          session_id: params.sessionId, sitting_no: sitting.sitting_no, recorded_at: occurredAt,
          current_question_order: params.currentQuestionOrder ?? null
        } as EmotionCollapseRecordedPayload as unknown as Record<string, unknown>,
        actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
      })
      applyAssessmentEvent(db, collapseEvent)
      if (thresholdReached) {
        const thresholdEvent = execution.eventPort.writeEvent({
          aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId,
          eventType: 'EMOTION_COLLAPSE_THRESHOLD_REACHED',
          payload: {
            session_id: params.sessionId, collapse_count: collapseCount, threshold,
            collapse_history: buildCollapseHistory(db, params.sessionId, collapseCount), triggered_at: occurredAt
          } as EmotionCollapseThresholdReachedPayload as unknown as Record<string, unknown>,
          actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
        })
        applyAssessmentEvent(db, thresholdEvent)
        const completedEvent = execution.eventPort.writeEvent({
          aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId, eventType: 'SESSION_COMPLETED',
          payload: {
            session_id: params.sessionId, completed_at: occurredAt, total_online_answered: 0,
            total_offline_scored: 0, has_pending_offline: true
          } as SessionCompletedPayload as unknown as Record<string, unknown>,
          actorId: teacher.user_id, actorRole: 'TEACHER', correlationId
        })
        applyAssessmentEvent(db, completedEvent)
      }
    })()
  } catch (error) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, teacher.user_id, {
      operation: 'recordEmotionCollapse', error: String(error)
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }
  return { success: true, sittingNo: sitting.sitting_no, thresholdReached }
}

// --- abortSession ---

/**
 * 计算 collapse_history：取最近 collapseCount 条未恢复的 EMOTION_INTERRUPTED 事件。
 * FIFO 配对原则下，已恢复的是最早若干条，未恢复的是最后 collapseCount 条。
 * unresolved_since 解释为 interrupted_at（自该中断起一直未恢复）。
 */
function buildCollapseHistory(
  db: DBAdapter,
  sessionId: string,
  collapseCount: number
): CollapseRecord[] {
  if (collapseCount <= 0) return []
  const rows = db
    .prepare(
      `SELECT payload_json FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = 'EMOTION_INTERRUPTED'
        ORDER BY event_sequence DESC LIMIT ?`
    )
    .all(sessionId, collapseCount) as { payload_json: string }[]
  return rows.reverse().map((r) => {
    const p = JSON.parse(r.payload_json) as EmotionInterruptedPayload
    return {
      interrupted_at: p.interrupted_at,
      unresolved_since: p.interrupted_at,
      current_question_order: p.current_question_order ?? null
    }
  })
}

/**
 * assessment:abortSession 核心纯函数（TEACHER）。
 *
 * 教师终止会话。若 collapse_count ≥ emotion_collapse_threshold → 先写
 * EMOTION_COLLAPSE_THRESHOLD_REACHED 再写 SESSION_ABORTED（崩溃兜底）。
 *
 * [!] collapse_count 来源（impl.md Step 7 决策）：事件溯源查询
 *   count(EMOTION_INTERRUPTED) - count(EMOTION_RESUMED)
 *   而非 session.pause_count 冗余字段（投影可重建，符合事件溯源原则）。
 * [!] impl.md "累计未恢复中断数 +1 后达 threshold" 措辞与测试用例矛盾：
 *   测试明确 collapse_count=3,threshold=3 触发；=2 不触发。以测试为准（≥ 触发）。
 *
 * 失败码：FORBIDDEN / NOT_FOUND / SESSION_NOT_ACTIVE / SESSION_HALTED / ASSESSMENT_SYSTEM_ERROR
 */
export function abortSession(
  db: DBAdapter,
  params: AbortSessionParams,
  execution: AssessmentMutationExecution
): AbortSessionResult {
  const correlationId = correlationFor(execution, 'assessment:abortSession')
  // 1. TEACHER 身份校验
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 存在 + 读 status / 策略引用
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  const sess = db
    .prepare('SELECT status, strategy_id, strategy_version FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId) as
    | { status: string; strategy_id: string; strategy_version: number }
    | undefined
  if (!sess) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. status 非终态
  const err = statusToAbortErrorCode(sess.status)
  if (err) {
    return { success: false, errorCode: err }
  }

  // 4. 读 emotion_collapse_threshold（策略锁定值）
  const strat = db
    .prepare('SELECT emotion_collapse_threshold FROM strategy_config WHERE strategy_id = ? AND version = ?')
    .get(sess.strategy_id, sess.strategy_version) as
    | { emotion_collapse_threshold: number }
    | undefined
  const threshold = strat?.emotion_collapse_threshold ?? 3

  // 5. collapse_count = 事件溯源查询（EMOTION_INTERRUPTED - EMOTION_RESUMED）
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'EMOTION_INTERRUPTED' THEN 1 ELSE 0 END) AS interrupted,
         SUM(CASE WHEN event_type = 'EMOTION_RESUMED' THEN 1 ELSE 0 END) AS resumed
       FROM domain_event_projection
       WHERE aggregate_id = ? AND event_type IN ('EMOTION_INTERRUPTED', 'EMOTION_RESUMED')`
    )
    .get(params.sessionId) as { interrupted: number | null; resumed: number | null }
  const collapseCount = (counts.interrupted ?? 0) - (counts.resumed ?? 0)

  // 6. 防御性：是否已写过崩溃事件（abort 后终态，理论不重入；防 collapse_count 越界重复发）
  const collapseAlreadyEmitted = db
    .prepare(
      `SELECT 1 FROM domain_event_projection
        WHERE aggregate_id = ? AND event_type = 'EMOTION_COLLAPSE_THRESHOLD_REACHED'`
    )
    .get(params.sessionId)

  const abortedAt = new Date().toISOString()
  const collapseTriggered = collapseCount >= threshold && !collapseAlreadyEmitted

  // 7. 事务：崩溃事件（如触发）+ SESSION_ABORTED
  try {
    const tx = db.transaction(() => {
      if (collapseTriggered) {
        const collapsePayload: EmotionCollapseThresholdReachedPayload = {
          session_id: params.sessionId,
          collapse_count: collapseCount,
          threshold,
          collapse_history: buildCollapseHistory(db, params.sessionId, collapseCount),
          triggered_at: abortedAt
        }
        const collapseEvent = execution.eventPort.writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: params.sessionId,
          eventType: 'EMOTION_COLLAPSE_THRESHOLD_REACHED',
          payload: collapsePayload as unknown as Record<string, unknown>,
          actorId: caller.row.user_id,
          actorRole: 'TEACHER',
          correlationId
        })
        // reducer 对此事件 no-op（崩溃计数来源于事件流，无投影副作用）
        applyAssessmentEvent(db, collapseEvent)
      }
      const abortPayload: SessionAbortedPayload = {
        session_id: params.sessionId,
        aborted_at: abortedAt,
        aborted_by: caller.row.user_id,
        reason: params.reason ?? null
      }
      const abortEvent = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'SESSION_ABORTED',
        payload: abortPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER',
        correlationId
      })
      applyAssessmentEvent(db, abortEvent)
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'abortSession',
      error: String(e),
      collapseCount,
      threshold
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 8. 审计 SESSION_ABORTED（INFO，TEACHER 关键操作）
  logAssessmentEvent(db, 'SESSION_ABORTED', 'INFO', params.sessionId, caller.row.user_id, {
    collapseTriggered,
    collapseCount,
    threshold
  })

  return { success: true }
}

// --- 红线触发 + 结果落盘共享辅助（triggerRedline / calculateResult 复用） ---

interface SessionForRedlineRow {
  student_id: string
  job_code: string
  task_code: string
  strategy_id: string
  strategy_type: AssessmentStrategyType
  strategy_version: number
  status: string
  redline_incident_id: string | null
}

/**
 * 读 assessment_session 红线落盘所需字段。返回 undefined 表示 session 不存在。
 */
function readSessionForRedline(db: DBAdapter, sessionId: string): SessionForRedlineRow | undefined {
  return db
    .prepare(
      `SELECT student_id, job_code, task_code, strategy_id, strategy_type, strategy_version,
              status, redline_incident_id
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as SessionForRedlineRow | undefined
}

function persistAbilityResult(
  db: DBAdapter,
  session: SessionForRedlineRow,
  sessionId: string,
  triggeredBy: string,
  safetyTriggered: boolean,
  execution: AssessmentMutationExecution,
  correlationId: string
): string {
  const calculation = calculateAbilityScore(db, {
    sessionId,
    strategyId: session.strategy_id,
    strategyVersion: session.strategy_version,
    safetyTriggered
  })
  const resultId = uuidv4()
  const calculatedAt = new Date().toISOString()

  const eventPayload: ResultCalculatedPayload = {
    result_id: resultId,
    result_type: 'ABILITY_SCORE',
    source_type: 'ASSESSMENT_SESSION',
    source_id: sessionId,
    student_id: session.student_id,
    strategy_id: session.strategy_id,
    strategy_type: session.strategy_type,
    job_code: session.job_code,
    task_code: session.task_code,
    module_type: null,
    raw_score: calculation.rawScore,
    max_score: calculation.maxScore,
    normalized_score: calculation.normalizedScore,
    level_result: calculation.levelResult,
    completion_ratio: calculation.completionRatio,
    calculated_at: calculatedAt,
    calculated_by: triggeredBy,
    breakdown: calculation.payload
  }

  // writeEvent + reducer 都加入调用方事务（singleton connection / sql.js 同 conn）
  const event = execution.eventPort.writeEvent({
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId: sessionId,
    eventType: 'RESULT_CALCULATED',
    payload: eventPayload as unknown as Record<string, unknown>,
    actorId: triggeredBy,
    actorRole: 'TEACHER',
    correlationId
  })
  // reducer 内 SELECT session.redline_incident_id 填充 result_record +
  // 写入 result_payload_json（来自 payload.breakdown）
  applyAssessmentEvent(db, event)

  return resultId
}

/**
 * 落盘红线 ABILITY_SCORE。调用前置条件：session 已 REDLINE_HALTED + redline_incident_id 已填。
 */
function persistRedlineResult(
  db: DBAdapter,
  session: SessionForRedlineRow,
  sessionId: string,
  triggeredBy: string,
  execution: AssessmentMutationExecution,
  correlationId: string
): string {
  return persistAbilityResult(
    db,
    session,
    sessionId,
    triggeredBy,
    true,
    execution,
    correlationId
  )
}

function countValidOnlineAbilityAnswers(db: DBAdapter, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM answer_record ar
         JOIN assessment_session_question sq
           ON sq.session_id = ar.session_id
          AND sq.question_id = ar.question_id
        WHERE ar.session_id = ?
          AND ar.status = 'VALID'
          AND ar.score IS NOT NULL
          AND sq.bank_domain = 'BASE_ABILITY'
          AND sq.question_phase = 'ONLINE'
          AND sq.item_usage = 'SCORED_ITEM'`
    )
    .get(sessionId) as { n: number } | undefined
  return row?.n ?? 0
}

function persistCompletedAbilityResult(
  db: DBAdapter,
  session: SessionForRedlineRow,
  sessionId: string,
  triggeredBy: string,
  execution: AssessmentMutationExecution,
  correlationId: string
): string {
  const resultId = persistAbilityResult(
    db,
    session,
    sessionId,
    triggeredBy,
    false,
    execution,
    correlationId
  )
  const completedAt = new Date().toISOString()
  const offlineCompletion = readOfflineAbilityScoringCompletion(db, sessionId)
  const completedPayload: SessionCompletedPayload = {
    session_id: sessionId,
    completed_at: completedAt,
    total_online_answered: countValidOnlineAbilityAnswers(db, sessionId),
    total_offline_scored: offlineCompletion.totalScored,
    has_pending_offline: false
  }
  const completedEvent = execution.eventPort.writeEvent({
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId: sessionId,
    eventType: 'SESSION_COMPLETED',
    payload: completedPayload as unknown as Record<string, unknown>,
    actorId: triggeredBy,
    actorRole: 'TEACHER',
    correlationId
  })
  applyAssessmentEvent(db, completedEvent)
  return resultId
}

/**
 * TEACHER 触发红线路径的 status 映射。
 * 开放态（INIT/ACTIVE/EMOTION_INTERRUPTED/SUSPENDED_REVIEW_REQUIRED/OFFLINE_PENDING）→ 允许；
 * REDLINE_HALTED → SESSION_HALTED；COMPLETED/ABORTED → SESSION_NOT_ACTIVE。
 * 与 statusToAbortErrorCode 同模式，但红线不允许从 OFFLINE_PENDING 之外的待复核态进入
 * （SUSPENDED_REVIEW_REQUIRED 仍可被红线熔断覆盖）。
 */
function statusToRedlineErrorCode(status: string): AssessmentErrorCode | null {
  switch (status) {
    case 'INIT':
    case 'ACTIVE':
    case 'EMOTION_INTERRUPTED':
    case 'SUSPENDED_REVIEW_REQUIRED':
    case 'OFFLINE_PENDING':
      return null
    case 'REDLINE_HALTED':
      return 'SESSION_HALTED'
    default:
      return 'SESSION_NOT_ACTIVE'
  }
}

// --- triggerRedline ---

/**
 * assessment:triggerRedline 核心纯函数（TEACHER / ADMIN）。
 *
 * 触发安全红线 → 批量熔断同 student+job+task 的所有开放 session → 落盘 result_record
 * （LEVEL_FAIL_BY_SAFETY）。
 *
 * [!] schema trigger 链（handler 不重复实现，理解其行为）：
 *   1. handler writeEvent(SAFETY_INCIDENT_CREATED) → INSERT safety_incident(PENDING_DETAIL)
 *   2. trg_safety_incident_bind_open_assessments AFTER INSERT：
 *      批量 UPDATE 同 student+job+task 开放 session → REDLINE_HALTED +
 *      level_result=LEVEL_FAIL_BY_SAFETY + 写 safety_incident_binding
 *   3. trg_assessment_session_redline_incident_same_student_job_task_update BEFORE UPDATE：
 *      校验 REDLINE_HALTED 必须有匹配 incident
 *   4. handler writeEvent(REDLINE_TRIGGERED) + applyReducer（补 redline_incident_id
 *      / 事件指针；session 已被 trigger 改成 REDLINE_HALTED）
 *   5. handler 调 persistRedlineResult → result_record(safety_overridden=1, LEVEL_FAIL_BY_SAFETY)
 *
 * [!] handler **不应**：手动 UPDATE session 为 REDLINE_HALTED（被 trigger 拦）、
 * 不写 safety_incident 直接写 result_record（trigger 校验 redline_incident_id）。
 *
 * [!] 事务边界：所有写操作必须在一个事务内，否则中途失败留下孤岛 safety_incident。
 * MemoryAdapter.transaction 不支持 SAVEPOINT，故 persistRedlineResult 不开自己的事务
 * （由本函数的 transaction 嵌入）。
 *
 * 失败码：
 * - FORBIDDEN：非 TEACHER/ADMIN / 账号非 ACTIVE
 * - NOT_FOUND：session 不存在
 * - VALIDATION_ERROR：reasonCode/contextPhase 不在 schema 枚举内（事务前校验，避免被 CHECK ABORT 后留脏 jsonl）
 * - REDLINE_TRIGGER_SYSTEM_ERROR：事务异常（写审计）
 */
export function triggerRedline(
  db: DBAdapter,
  params: TriggerRedlineParams,
  execution: AssessmentMutationExecution
): TriggerRedlineResult {
  const correlationId = correlationFor(execution, 'assessment:triggerRedline')
  // 1. TEACHER 或 ADMIN 身份校验
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. sessionId 基础校验
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. reasonCode / contextPhase 枚举前置校验（schema CHECK 兜底；前置避免脏 jsonl）
  const reasonCode = params.reasonCode ?? 'OTHER_SAFETY_RISK'
  const contextPhase = params.contextPhase ?? 'OTHER'
  if (!SAFETY_REASON_CODES.has(reasonCode)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (!SAFETY_CONTEXT_PHASES.has(contextPhase)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 4. session 存在 + 反查 student/job/task（safety_incident 必填）
  const session = readSessionForRedline(db, params.sessionId)
  if (!session) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 4.1 status 必须开放态（schema trigger 批量熔断不含终态；对终态 session 触发
  // 红线会让 persistRedlineResult 在事务内抛错回滚，前置校验返回明确错误码）。
  const statusErr = statusToRedlineErrorCode(session.status)
  if (statusErr) {
    return { success: false, errorCode: statusErr }
  }

  const incidentId = uuidv4()
  const occurredAt = new Date().toISOString()

  // 5. 大事务：SAFETY_INCIDENT_CREATED → INSERT safety_incident → REDLINE_TRIGGERED → result_record
  try {
    const tx = db.transaction(() => {
      // 5.1 writeEvent(SAFETY_INCIDENT_CREATED) 拿 event_id（safety_incident.trigger_event_id UNIQUE FK）
      const safetyPayload: SafetyIncidentCreatedPayload = {
        incident_id: incidentId,
        student_id: session.student_id,
        job_code: session.job_code,
        task_code: session.task_code,
        reason_code: reasonCode,
        context_phase: contextPhase,
        occurred_at: occurredAt,
        reported_by: caller.row.user_id
      }
      const safetyEvent = execution.eventPort.writeEvent({
        aggregateType: 'SAFETY_INCIDENT',
        aggregateId: incidentId,
        eventType: 'SAFETY_INCIDENT_CREATED',
        payload: safetyPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN',
        correlationId
      })

      // 5.2 INSERT safety_incident(PENDING_DETAIL) → 触发 schema trigger 批量熔断
      db.prepare(
        `INSERT INTO safety_incident
           (incident_id, student_id, job_code, task_code, trigger_event_id,
            reason_code, triggered_by, context_phase, occurred_at,
            status, requires_review_before_next_session)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DETAIL', 1)`
      ).run(
        incidentId,
        session.student_id,
        session.job_code,
        session.task_code,
        safetyEvent.event_id,
        reasonCode,
        caller.row.user_id,
        contextPhase,
        occurredAt
      )

      // 5.3 writeEvent(REDLINE_TRIGGERED, aggregate=ASSESSMENT_SESSION, payload.incident_id)
      // schema trigger 已熔断 session（status 改 REDLINE_HALTED）；本事件 + reducer
      // 补 redline_incident_id（COALESCE）+ 事件指针。冷启动重放下 reducer 兜底完整熔断。
      const redlinePayload: RedlineTriggeredPayload = {
        session_id: params.sessionId,
        incident_id: incidentId,
        reason_code: reasonCode,
        context_phase: contextPhase,
        triggered_at: occurredAt
      }
      const redlineEvent = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'REDLINE_TRIGGERED',
        payload: redlinePayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN',
        correlationId
      })
      applyAssessmentEvent(db, redlineEvent)

      // 5.4 落盘 result_record（LEVEL_FAIL_BY_SAFETY）。
      // 重读 session 拿 trigger 填充后的 redline_incident_id（reducer 也读，但此处确保 latest）。
      const refreshed = readSessionForRedline(db, params.sessionId)
      if (!refreshed || refreshed.status !== 'REDLINE_HALTED') {
        // 不应发生（trigger 已熔断）；防御性抛错让事务回滚
        throw new Error(
          `triggerRedline: session not REDLINE_HALTED after safety_incident INSERT (status=${refreshed?.status})`
        )
      }
      if (!refreshed.redline_incident_id) {
        throw new Error(
          'triggerRedline: session.redline_incident_id missing after trigger bind'
        )
      }
      persistRedlineResult(
        db,
        refreshed,
        params.sessionId,
        caller.row.user_id,
        execution,
        correlationId
      )
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'REDLINE_TRIGGER_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'triggerRedline',
      error: String(e),
      incidentId,
      reasonCode,
      contextPhase
    })
    return { success: false, errorCode: 'REDLINE_TRIGGER_SYSTEM_ERROR' }
  }

  // 6. 安全红线应用层级联：将该学生同 job/task 的开放训练会话的 IN_PROGRESS 步骤归档为 FAILED
  // （schema trigger 已将 training_session 置 REDLINE_HALTED；本步骤处理步骤级联）
  haltTrainingSessionSteps(db, execution.context)

  // 7. 审计 REDLINE_TRIGGERED（INFO，TEACHER/ADMIN 关键操作）
  logAssessmentEvent(db, 'REDLINE_TRIGGERED', 'INFO', params.sessionId, caller.row.user_id, {
    incidentId,
    reasonCode,
    contextPhase,
    studentId: session.student_id,
    taskCode: session.task_code
  })

  const result: TriggerRedlineSuccess = {
    success: true,
    incidentId,
    sessionId: params.sessionId
  }
  return result
}

// --- calculateResult ---

/**
 * assessment:calculateResult 核心纯函数（TEACHER / ADMIN）。
 *
 * 幂等行为：
 * - 已存在 current ABILITY_SCORE → SELECT 返回已有 resultId
 * - REDLINE_HALTED 且不存在 → 写 RESULT_CALCULATED + applyReducer
 * - OFFLINE_PENDING + OFFLINE_ABILITY 全量评分且不存在 → 写 RESULT_CALCULATED 后写 SESSION_COMPLETED
 *
 * 失败码：
 * - FORBIDDEN：非 TEACHER/ADMIN
 * - NOT_FOUND：session 不存在
 * - SESSION_NOT_ACTIVE：状态不支持结算，或线下基础能力评分未完成
 * - VALIDATION_ERROR：非 BASELINE/MOCK session 试图生成 ABILITY_SCORE
 * - ASSESSMENT_SYSTEM_ERROR：事务异常（写审计）
 */
export function calculateResult(
  db: DBAdapter,
  params: CalculateResultParams,
  execution: AssessmentMutationExecution
): CalculateResultResult {
  const correlationId = correlationFor(execution, 'assessment:calculateResult')
  // 1. TEACHER/ADMIN 身份
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 存在
  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  const session = readSessionForRedline(db, params.sessionId)
  if (!session) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 3. 幂等检查：已有 result_record（同 source_type+source_id+result_type）→ 返回已有。
  // 正常结算完成后 session 会变 COMPLETED，因此必须先查 current result。
  const existing = db
    .prepare(
      `SELECT result_id, level_result, normalized_score
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'
          AND is_current = 1`
    )
    .get(params.sessionId) as
    | { result_id: string; level_result: string; normalized_score: number }
    | undefined

  if (existing) {
    const r: CalculateResultSuccess = {
      success: true,
      resultId: existing.result_id,
      levelResult: existing.level_result,
      normalizedScore: existing.normalized_score
    }
    return r
  }

  if (
    session.strategy_type !== 'BASELINE_ASSESSMENT' &&
    session.strategy_type !== 'MOCK_EXAM'
  ) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const shouldPersistRedline = session.status === 'REDLINE_HALTED'
  let shouldPersistCompleted = false
  if (session.status === 'OFFLINE_PENDING') {
    const offlineCompletion = readOfflineAbilityScoringCompletion(db, params.sessionId)
    if (!offlineCompletion.isComplete) {
      return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
    }
    shouldPersistCompleted = true
  } else if (!shouldPersistRedline) {
    return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  }

  // 5. 事务：落盘 ABILITY_SCORE；正常完成路径随后写 SESSION_COMPLETED。
  try {
    const tx = db.transaction(() => {
      if (shouldPersistRedline) {
        persistRedlineResult(
          db,
          session,
          params.sessionId,
          caller.row.user_id,
          execution,
          correlationId
        )
      } else if (shouldPersistCompleted) {
        persistCompletedAbilityResult(
          db,
          session,
          params.sessionId,
          caller.row.user_id,
          execution,
          correlationId
        )
      }
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'calculateResult',
      error: String(e)
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 6. 读回刚落的行返回
  const fresh = db
    .prepare(
      `SELECT result_id, level_result, normalized_score
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND result_type = 'ABILITY_SCORE'
          AND is_current = 1`
    )
    .get(params.sessionId) as
    | { result_id: string; level_result: string; normalized_score: number }
    | undefined
  if (!fresh) {
    // 事务成功但读不到 —— 不应发生；按系统异常报错
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'calculateResult',
      error: 'result_record missing after calculateResult commit'
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  const result: CalculateResultSuccess = {
    success: true,
    resultId: fresh.result_id,
    levelResult: fresh.level_result,
    normalizedScore: fresh.normalized_score
  }
  return result
}

// ============================================================================
// Step 9b：startSession（STUDENT 推进第一题指针）+ listMySessions（STUDENT 自查列表）
// ============================================================================

/**
 * assessment:startSession 核心纯函数（STUDENT）。
 *
 * 学生首次进入 session（current_question_id=NULL）点"开始答题"。写
 * SESSION_FIRST_QUESTION_ACTIVATED 事件 + reducer 推进 current_question_id 到
 * MIN(question_order) ONLINE 题。
 *
 * [!] reducer applySessionStarted 不设 current_question_id（INSERT 省略该列，默认 NULL）。
 *     仅 applyAnswerSubmitted 推进。本事件填补"学生从未开始"到"答第一题"之间的指针真空，
 *     让 getSession 在 status=ACTIVE 且学生已开始后能返回 currentQuestion 正文。
 *
 * 幂等：current_question_id 已非 NULL（无论被谁设——本事件重放或学生已答过题）→
 *   读现有指针的 question_order，直接返回成功（不写事件）。
 *
 * 失败码：
 * - FORBIDDEN：非 STUDENT / 账号非 ACTIVE / session 不属于 caller
 * - NOT_FOUND：session 不存在
 * - SESSION_NOT_ACTIVE / SESSION_PAUSED / SESSION_HALTED：status 非 ACTIVE
 * - ASSESSMENT_SYSTEM_ERROR：事务异常（写审计）
 */
export function startSession(
  db: DBAdapter,
  params: StartSessionParams,
  execution: AssessmentMutationExecution
): StartSessionResult {
  const correlationId = correlationFor(execution, 'assessment:startSession')
  // 1. STUDENT 身份校验
  const caller = assertStudent(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  // 2. session 所有权（NOT_FOUND / FORBIDDEN）
  const owner = assertSessionOwner(db, caller.row.user_id, params.sessionId)
  if (!owner.ok) {
    return { success: false, errorCode: owner.errorCode }
  }

  // 3. status 必须是 INIT（phase gate 返回 M3 阻断）或 ACTIVE（旧数据/幂等继续）。
  const statusErr = statusToStartSessionErrorCode(owner.sessionRow.status)
  if (statusErr) {
    return { success: false, errorCode: statusErr }
  }

  // 4. 读 delivery_phase/current_question_id（SessionRow 类型只含 session_id/student_id/status）。
  //    assertSessionOwner (step 2) 已确保 session 存在 → pointer 必非 undefined。
  const pointer = db
    .prepare('SELECT current_question_id, delivery_phase FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId) as { current_question_id: string | null; delivery_phase: DeliveryPhase | null }

  if (pointer.delivery_phase === 'PREPARED') {
    return { success: false, errorCode: 'ASSIGNMENT_REQUIRED' }
  }
  if (pointer.delivery_phase === 'ASSIGNED' || pointer.delivery_phase === 'STUDENT_CONFIRMED') {
    return { success: false, errorCode: 'STUDENT_CONFIRMATION_REQUIRED' }
  }

  // 5. 已有题目指针时通常幂等返回。F4 兼容旧会话：旧库中的 ACTIVE 会话
  //    可能没有 sitting 投影，首次继续时补一条可追溯的坐次，再返回既有指针。
  if (pointer.current_question_id) {
    const q = db
      .prepare(
        `SELECT question_order FROM assessment_session_question
          WHERE session_id = ? AND question_id = ?`
      )
      .get(params.sessionId, pointer.current_question_id) as
      | { question_order: number }
      | undefined
    const openSitting = db
      .prepare('SELECT 1 AS present FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL')
      .get(params.sessionId)
    if (!openSitting) {
      try {
        db.transaction(() => {
          const sittingNo = (
            db.prepare('SELECT COALESCE(MAX(sitting_no), 0) + 1 AS next_sitting_no FROM assessment_sitting WHERE session_id = ?')
              .get(params.sessionId) as { next_sitting_no: number }
          ).next_sitting_no
          const event = execution.eventPort.writeEvent({
            aggregateType: 'ASSESSMENT_SESSION', aggregateId: params.sessionId,
            eventType: 'SITTING_STARTED',
            payload: {
              session_id: params.sessionId, sitting_no: sittingNo,
              started_at: new Date().toISOString(), started_by: caller.row.user_id
            },
            actorId: caller.row.user_id, actorRole: 'STUDENT', correlationId
          })
          applyAssessmentEvent(db, event)
        })()
      } catch (error) {
        logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
          operation: 'startSession.ensureSitting', error: String(error)
        })
        return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
      }
    }
    const result: StartSessionSuccess = {
      success: true,
      firstQuestionId: pointer.current_question_id,
      firstQuestionOrder: q?.question_order ?? 1
    }
    return result
  }

  // 6. 查 MIN(question_order) ONLINE 题（首次进入时不可能有任何 answer_record，
  //    不需要 NOT EXISTS 过滤；与 applyAnswerSubmitted 的"下一未答题"查询不同）
  const first = db
    .prepare(
      `SELECT question_id, question_order FROM assessment_session_question
        WHERE session_id = ? AND question_phase = 'ONLINE'
        ORDER BY question_order LIMIT 1`
    )
    .get(params.sessionId) as { question_id: string; question_order: number } | undefined
  if (!first) {
    // 不应发生（session 已有 50 题）；防御性返回 SYSTEM_ERROR
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'startSession',
      error: 'no ONLINE question found for session'
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 6. 事务：首次坐次 + SESSION_FIRST_QUESTION_ACTIVATED。坐次从学生真正开始
  // 施测时起算，不在教师创建 session 时预先生成。
  const payload: SessionFirstQuestionActivatedPayload = {
    session_id: params.sessionId,
    first_question_id: first.question_id,
    first_question_order: first.question_order,
    activated_at: new Date().toISOString()
  }
  try {
    const tx = db.transaction(() => {
      const openSitting = db
        .prepare('SELECT sitting_no FROM assessment_sitting WHERE session_id = ? AND ended_at IS NULL')
        .get(params.sessionId) as { sitting_no: number } | undefined
      if (!openSitting) {
        const sittingPayload: SittingStartedPayload = {
          session_id: params.sessionId,
          sitting_no: (
            db.prepare('SELECT COALESCE(MAX(sitting_no), 0) + 1 AS next_sitting_no FROM assessment_sitting WHERE session_id = ?')
              .get(params.sessionId) as { next_sitting_no: number }
          ).next_sitting_no,
          started_at: payload.activated_at,
          started_by: caller.row.user_id
        }
        const sittingEvent = execution.eventPort.writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: params.sessionId,
          eventType: 'SITTING_STARTED',
          payload: sittingPayload as unknown as Record<string, unknown>,
          actorId: caller.row.user_id,
          actorRole: 'STUDENT',
          correlationId
        })
        applyAssessmentEvent(db, sittingEvent)
      }
      const event = execution.eventPort.writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'SESSION_FIRST_QUESTION_ACTIVATED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT',
        correlationId
      })
      applyAssessmentEvent(db, event)
    })
    tx()
  } catch (err) {
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'startSession',
      error: String(err)
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  const result: StartSessionSuccess = {
    success: true,
    firstQuestionId: first.question_id,
    firstQuestionOrder: first.question_order
  }
  return result
}
