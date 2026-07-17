// 测评会话（assessment_session）handler 模块。
// 核心逻辑（createSession）抽成纯函数，接收 DBAdapter；registerAssessmentHandlers
// 是薄包装，调 ipcMain.handle 时把 getDb() 的结果传给纯函数。测试直接调纯函数 +
// 注入 MemoryAdapter（与 student.ts / strategy.ts 同模式）。
//
// [!] 架构决策（.continue-here.md Key Decisions）：
//   reducer 是投影唯一写入者——applySessionStarted 承担 INSERT assessment_session
//   + 50 行 assessment_session_question + status=ACTIVE（无独立 SESSION_ACTIVATED
//   事件，保冷启动重放忠实）。handler 只调 writeEvent(SESSION_STARTED) +
//   applyAssessmentEvent，不另 INSERT / UPDATE。这与 impl.md Step 6b 文本（描述
//   handler 做 INSERT）有冲突，以 reducer 实际实现 + 决策记录为准。
//
// 事务边界（impl.md「事件写入事务边界」决策）：
//   db.transaction(() => { writeEvent(...); applyAssessmentEvent(...) })。
//   writeEvent 内部 getDatabase() 返回 better-sqlite3 singleton connection，
//   自动加入调用者事务；jsonl appendFileSync 不可回滚（接受的边界，由 reducer
//   幂等性 + 冷启动重放兜底）。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller, assertStudent, assertSessionOwner } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { haltTrainingSessionSteps } from './training'
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
  EmotionCollapseThresholdReachedPayload,
  CollapseRecord,
  SessionAbortedPayload,
  RedlineTriggeredPayload,
  ResultCalculatedPayload,
  SafetyIncidentCreatedPayload,
  AbilityScorePayload,
  ModuleScore
} from '@shared/types/event-payloads'
import { judgeLevel, type ModuleScoreInput, type JudgeLevelInput } from '../../domain/level-judge'
import {
  SAFETY_REASON_CODES as SAFETY_REASON_CODES_SRC,
  SAFETY_CONTEXT_PHASES as SAFETY_CONTEXT_PHASES_SRC
} from '../../../shared/types/safety'
import type {
  AssessmentStrategyType,
  CreateSessionParams,
  CreateSessionResult,
  CreateSessionSuccess,
  SessionQuestionView,
  SessionDetail,
  SessionStatus,
  DeliveryPhase,
  SessionQuestionContent,
  GetSessionParams,
  GetSessionResult,
  GetSessionSuccess,
  ListSessionsParams,
  ListSessionsResult,
  ListSessionsSuccess,
  SessionListItem,
  SubmitAnswerParams,
  SubmitAnswerResult,
  SubmitAnswerSuccess,
  StartSessionParams,
  StartSessionResult,
  StartSessionSuccess,
  ListMySessionsParams,
  ListMySessionsResult,
  ListMySessionsSuccess,
  EmotionInterruptParams,
  EmotionInterruptResult,
  EmotionResumeParams,
  EmotionResumeResult,
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

// 每道 ONLINE 题的最高分（doc §2：TRUE_FALSE/SINGLE_CHOICE/DRAG 均为二值 2/0）。
// 用于从 answer_record.score 反推题数（max_score = answered * MAX_SCORE_PER_QUESTION）。
const MAX_SCORE_PER_QUESTION = 2
const BASE_ABILITY_MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

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
 * exported 供测试 seed 后再调纯函数；registerAssessmentHandlers 也会调一次。
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
export function createSession(db: DBAdapter, params: CreateSessionParams): CreateSessionResult {
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

  // 6. 校验无开放 session（schema partial unique index 兜底；前置 SELECT 返回友好错误码）
  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const openSession = db
    .prepare(
      `SELECT session_id FROM assessment_session
        WHERE student_id = ? AND task_code = ? AND strategy_type = ?
          AND status IN (${placeholders})
        LIMIT 1`
    )
    .get(
      params.studentId,
      params.taskCode,
      strategyType,
      ...OPEN_SESSION_STATUSES
    ) as { session_id: string } | undefined
  if (openSession) {
    return { success: false, errorCode: 'SESSION_ALREADY_OPEN' }
  }

  // 7. 校验无未解决安全事件（schema trigger trg_assessment_session_block_unresolved_safety_incident
  //    是兜底 BEFORE INSERT ABORT；handler 前置 SELECT 返回友好错误码，避免进事务后才发现）
  const blocked = db
    .prepare(
      `SELECT 1 FROM safety_incident
        WHERE student_id = ? AND task_code = ?
          AND requires_review_before_next_session = 1
          AND status IN ('PENDING_DETAIL', 'CONFIRMED')
        LIMIT 1`
    )
    .get(params.studentId, params.taskCode) as { 1: number } | undefined
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
    }
    const allCandidateIds = [...scoredIds, ...obsIds]
    const placeholders = allCandidateIds.map(() => '?').join(',')
    const fixedQbRows = db
      .prepare(
        `SELECT question_id, status, question_type, item_usage, job_module_code
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
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: sessionId,
        eventType: 'SESSION_STARTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER'
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
export function submitAnswer(db: DBAdapter, params: SubmitAnswerParams): SubmitAnswerResult {
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
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'ANSWER_SUBMITTED',
        payload: eventPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT'
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
export function emotionInterrupt(db: DBAdapter, params: EmotionInterruptParams): EmotionInterruptResult {
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
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'EMOTION_INTERRUPTED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT'
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
 * assessment:emotionResume 核心纯函数（TEACHER）。
 *
 * 教师安抚后恢复。仅 EMOTION_INTERRUPTED 态可恢复；其余 → SESSION_NOT_ACTIVE。
 * reducer applyEmotionResumed 承担 status=ACTIVE + 清 pause_started_at。
 *
 * 失败码：FORBIDDEN / NOT_FOUND / SESSION_NOT_ACTIVE / EMOTION_TRANSITION_FAILED
 */
export function emotionResume(db: DBAdapter, params: EmotionResumeParams): EmotionResumeResult {
  // 1. TEACHER 身份校验
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
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
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'EMOTION_RESUMED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER'
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
export function abortSession(db: DBAdapter, params: AbortSessionParams): AbortSessionResult {
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
        const collapseEvent = writeEvent({
          aggregateType: 'ASSESSMENT_SESSION',
          aggregateId: params.sessionId,
          eventType: 'EMOTION_COLLAPSE_THRESHOLD_REACHED',
          payload: collapsePayload as unknown as Record<string, unknown>,
          actorId: caller.row.user_id,
          actorRole: 'TEACHER'
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
      const abortEvent = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'SESSION_ABORTED',
        payload: abortPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'TEACHER'
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
      `SELECT student_id, job_code, task_code, strategy_id, strategy_version,
              status, redline_incident_id
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as SessionForRedlineRow | undefined
}

/**
 * 计算红线场景的 moduleScores：从 answer_record 求每模块 raw / max。
 * 红线场景下 levelResult 强制 LEVEL_FAIL_BY_SAFETY，但 normalizedScore 仍需真实值
 * （写入 result_record.normalized_score CHECK 0-100）。
 *
 * 线下评分未到时不计入 OFFLINE_OPERATION；只统计 ONLINE 题已答记录。
 * 未答模块返回 raw=0/max=0（不进 moduleScores 数组，避免 max=0 除零）。
 */
function computeRedlineModuleScores(
  db: DBAdapter,
  sessionId: string
): ModuleScoreInput[] {
  const rows = db
    .prepare(
      `SELECT sq.module_type,
              COALESCE(SUM(ar.score), 0) AS raw,
              COUNT(ar.question_id) AS answered
         FROM assessment_session_question sq
         LEFT JOIN answer_record ar
           ON ar.session_id = sq.session_id
          AND ar.question_id = sq.question_id
          AND ar.status = 'VALID'
        WHERE sq.session_id = ? AND sq.question_phase = 'ONLINE'
        GROUP BY sq.module_type`
    )
    .all(sessionId) as { module_type: string; raw: number; answered: number }[]

  const byModule = new Map(rows.map((r) => [r.module_type, r.raw]))
  return BASE_ABILITY_MODULES.map((module) => ({
    module,
    raw: byModule.get(module) ?? 0,
    max: 7 * MAX_SCORE_PER_QUESTION
  }))
}

/**
 * 读红线 result_record 落盘所需的 strategy_config 字段（judgeLevel 全部入参）。
 * 红线场景下 safetyTriggered=true 直接返回 LEVEL_FAIL_BY_SAFETY，
 * 但 JudgeLevelInput 仍要求 emotionCollapseThreshold / moduleVetoThreshold 等。
 */
function readStrategyForJudge(
  db: DBAdapter,
  strategyId: string,
  strategyVersion: number
): JudgeLevelInput | null {
  const s = db
    .prepare(
      `SELECT module_veto_threshold, emotion_collapse_threshold,
              competent_threshold, conditional_threshold
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(strategyId, strategyVersion) as
    | {
        module_veto_threshold: number
        emotion_collapse_threshold: number
        competent_threshold: number
        conditional_threshold: number
      }
    | undefined
  if (!s) return null
  return {
    moduleScores: [],
    emotionCollapseCount: 0,
    emotionCollapseThreshold: s.emotion_collapse_threshold,
    moduleVetoThreshold: s.module_veto_threshold,
    competentThreshold: s.competent_threshold,
    conditionalThreshold: s.conditional_threshold,
    safetyTriggered: true
  }
}

/**
 * 落盘红线 result_record + 写 RESULT_CALCULATED 事件 + applyReducer。
 * **不开事务**——由调用方（triggerRedline / calculateResult）的 transaction 包裹。
 * 复用 reduce 路径 applyResultCalculated（幂等：result_id 存在则 skip）。
 *
 * 调用前置条件：session 已 REDLINE_HALTED + redline_incident_id 已填。
 *
 * result_payload_json 通过 ResultCalculatedPayload.breakdown 流入事件 payload，
 * reducer applyResultCalculated 在 INSERT 时一并写入（事件溯源原则：投影可从事件流
 * 重建，避免 handler 事务后 UPDATE 在回滚后留下 NULL 字段）。
 *
 * @returns resultId（用于 calculateResult 返回值）或抛错（事务由调用方回滚）。
 */
function persistRedlineResult(
  db: DBAdapter,
  session: SessionForRedlineRow,
  sessionId: string,
  triggeredBy: string
): string {
  const strategyInput = readStrategyForJudge(db, session.strategy_id, session.strategy_version)
  if (!strategyInput) {
    throw new Error(
      `persistRedlineResult: strategy_config (${session.strategy_id}, v${session.strategy_version}) missing`
    )
  }
  // 注入真实 moduleScores（红线场景下 level 强制 FAIL_BY_SAFETY，但 normalizedScore 用真实分）
  strategyInput.moduleScores = computeRedlineModuleScores(db, sessionId)

  const judge = judgeLevel(strategyInput)
  const resultId = uuidv4()
  const calculatedAt = new Date().toISOString()

  // question_count 从 session 行读（红线可能在中途触发，已答题数 < 总题数）。
  // completion_ratio 按 50 题总量计算，未答/未评计 0。
  const sessionCounts = db
    .prepare(
      `SELECT (s.online_question_count + s.offline_question_count) AS total,
              (SELECT COUNT(*) FROM answer_record ar
                WHERE ar.session_id = s.session_id AND ar.status = 'VALID')
              +
              (SELECT COUNT(*) FROM offline_score_record os
                WHERE os.session_id = s.session_id AND os.status = 'VALID'
                  AND os.score_scope = 'OFFLINE_ABILITY') AS answered
         FROM assessment_session s
        WHERE s.session_id = ?`
    )
    .get(sessionId) as { total: number; answered: number } | undefined
  if (!sessionCounts) {
    throw new Error(`persistRedlineResult: session ${sessionId} missing during count`)
  }
  const offlineScore = db
    .prepare(
      `SELECT COALESCE(SUM(score), 0) AS raw
         FROM offline_score_record
        WHERE session_id = ?
          AND status = 'VALID'
          AND score_scope = 'OFFLINE_ABILITY'`
    )
    .get(sessionId) as { raw: number } | undefined
  const offlineRawScore = offlineScore?.raw ?? 0

  // result_payload_json（AbilityScorePayload）：红线场景下仍记真实模块分快照。
  // 红线场景 judge.moduleVetoTriggeredBy 永远 null（safetyTriggered 优先级最高），
  // module_scores 直接填充。
  const onlineRawScore = strategyInput.moduleScores.reduce((s, m) => s + m.raw, 0)
  const rawScore = onlineRawScore + offlineRawScore
  const normalizedScore = Math.max(0, Math.min(100, rawScore))
  const abilityPayload: AbilityScorePayload = {
    result_type: 'ABILITY_SCORE',
    module_scores: strategyInput.moduleScores.map(
      (m): ModuleScore => ({
        module_type: m.module,
        raw_score: m.raw,
        max_score: m.max,
        normalized_score: m.max > 0 ? (m.raw / m.max) * 100 : 0
      })
    ),
    online_raw_score: onlineRawScore,
    // 仅计入基础能力线下评分；TASK_OPERATION 属 OPERATION_PASS_RATE，不进入 ABILITY_SCORE。
    offline_raw_score: offlineRawScore,
    question_count: sessionCounts.total,
    answered_count: sessionCounts.answered,
    completion_ratio: sessionCounts.total > 0 ? sessionCounts.answered / sessionCounts.total : 0,
    emotion_collapse_count: 0,
    module_veto_triggered_by: judge.moduleVetoTriggeredBy,
    level_forced_by: judge.levelForcedBy
  }

  const eventPayload: ResultCalculatedPayload = {
    result_id: resultId,
    result_type: 'ABILITY_SCORE',
    source_type: 'ASSESSMENT_SESSION',
    source_id: sessionId,
    student_id: session.student_id,
    job_code: session.job_code,
    task_code: session.task_code,
    raw_score: rawScore,
    max_score: 100,
    normalized_score: normalizedScore,
    level_result: judge.levelResult,
    completion_ratio: abilityPayload.completion_ratio,
    calculated_at: calculatedAt,
    calculated_by: triggeredBy,
    breakdown: abilityPayload
  }

  // writeEvent + reducer 都加入调用方事务（singleton connection / sql.js 同 conn）
  const event = writeEvent({
    aggregateType: 'ASSESSMENT_SESSION',
    aggregateId: sessionId,
    eventType: 'RESULT_CALCULATED',
    payload: eventPayload as unknown as Record<string, unknown>,
    actorId: triggeredBy,
    actorRole: 'TEACHER'
  })
  // reducer 内 SELECT session.redline_incident_id 填充 result_record +
  // 写入 result_payload_json（来自 payload.breakdown）
  applyAssessmentEvent(db, event)

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
 * 触发安全红线 → 批量熔断同 student+task 的所有开放 session → 落盘 result_record
 * （LEVEL_FAIL_BY_SAFETY）。
 *
 * [!] schema trigger 链（handler 不重复实现，理解其行为）：
 *   1. handler writeEvent(SAFETY_INCIDENT_CREATED) → INSERT safety_incident(PENDING_DETAIL)
 *   2. trg_safety_incident_bind_open_assessments AFTER INSERT：
 *      批量 UPDATE 同 student+task 开放 session → REDLINE_HALTED +
 *      level_result=LEVEL_FAIL_BY_SAFETY + 写 safety_incident_binding
 *   3. trg_assessment_session_redline_incident_same_student_task_update AFTER UPDATE：
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
export function triggerRedline(db: DBAdapter, params: TriggerRedlineParams): TriggerRedlineResult {
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
  if (!SAFETY_REASON_CODES.has(params.reasonCode)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (!SAFETY_CONTEXT_PHASES.has(params.contextPhase)) {
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
        reason_code: params.reasonCode,
        context_phase: params.contextPhase,
        occurred_at: occurredAt,
        reported_by: caller.row.user_id
      }
      const safetyEvent = writeEvent({
        aggregateType: 'SAFETY_INCIDENT',
        aggregateId: incidentId,
        eventType: 'SAFETY_INCIDENT_CREATED',
        payload: safetyPayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN'
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
        params.reasonCode,
        caller.row.user_id,
        params.contextPhase,
        occurredAt
      )

      // 5.3 writeEvent(REDLINE_TRIGGERED, aggregate=ASSESSMENT_SESSION, payload.incident_id)
      // schema trigger 已熔断 session（status 改 REDLINE_HALTED）；本事件 + reducer
      // 补 redline_incident_id（COALESCE）+ 事件指针。冷启动重放下 reducer 兜底完整熔断。
      const redlinePayload: RedlineTriggeredPayload = {
        session_id: params.sessionId,
        incident_id: incidentId,
        reason_code: params.reasonCode,
        context_phase: params.contextPhase,
        triggered_at: occurredAt
      }
      const redlineEvent = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'REDLINE_TRIGGERED',
        payload: redlinePayload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: caller.row.role as 'TEACHER' | 'ADMIN'
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
      persistRedlineResult(db, refreshed, params.sessionId, caller.row.user_id)
    })
    tx()
  } catch (e) {
    logAssessmentEvent(db, 'REDLINE_TRIGGER_SYSTEM_ERROR', 'ERROR', params.sessionId, caller.row.user_id, {
      operation: 'triggerRedline',
      error: String(e),
      incidentId,
      reasonCode: params.reasonCode,
      contextPhase: params.contextPhase
    })
    return { success: false, errorCode: 'REDLINE_TRIGGER_SYSTEM_ERROR' }
  }

  // 6. 安全红线应用层级联：将该学生同任务的开放训练会话的 IN_PROGRESS 步骤归档为 FAILED
  // （schema trigger 已将 training_session 置 REDLINE_HALTED；本步骤处理步骤级联）
  haltTrainingSessionSteps(db, session.student_id, session.task_code)

  // 7. 审计 REDLINE_TRIGGERED（INFO，TEACHER/ADMIN 关键操作）
  logAssessmentEvent(db, 'REDLINE_TRIGGERED', 'INFO', params.sessionId, caller.row.user_id, {
    incidentId,
    reasonCode: params.reasonCode,
    contextPhase: params.contextPhase,
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
 * MVP Step 8 仅支持红线场景：session.status === 'REDLINE_HALTED'。
 * 正常完成路径（COMPLETED + 线下评分）由后续 Step 扩展。
 *
 * 幂等行为：
 * - 已存在 result_record（triggerRedline 已落）→ SELECT 返回已有 resultId
 * - 不存在 → 写 RESULT_CALCULATED + applyReducer
 *
 * 失败码：
 * - FORBIDDEN：非 TEACHER/ADMIN
 * - NOT_FOUND：session 不存在
 * - SESSION_NOT_ACTIVE：status 非 REDLINE_HALTED（MVP 范围只支持红线场景）
 * - ASSESSMENT_SYSTEM_ERROR：事务异常（写审计）
 */
export function calculateResult(db: DBAdapter, params: CalculateResultParams): CalculateResultResult {
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

  // 3. MVP 仅支持红线场景
  if (session.status !== 'REDLINE_HALTED') {
    return { success: false, errorCode: 'SESSION_NOT_ACTIVE' }
  }

  // 4. 幂等检查：已有 result_record（同 source_type+source_id+result_type）→ 返回已有
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

  // 5. 事务：落盘 result_record（红线场景）
  try {
    const tx = db.transaction(() => {
      persistRedlineResult(db, session, params.sessionId, caller.row.user_id)
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
      error: 'result_record missing after persistRedlineResult commit'
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
// Step 9a：Read handlers — getSession + listSessions（纯读路径，不写事件）
// ============================================================================

interface SessionFullRow {
  session_id: string
  business_session_id: string
  student_id: string
  strategy_id: string
  strategy_type: string
  strategy_version: number
  job_code: string
  task_code: string
  status: string
  delivery_phase: string | null
  event_sequence_version: number
  observation_template_id: string | null
  online_question_count: number
  offline_question_count: number
  online_completed_count: number
  current_question_id: string | null
  pause_count: number
  pause_started_at: string | null
  last_interruption_reason: string | null
  redline_incident_id: string | null
  level_result: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

interface SessionQuestionJoinRow {
  question_id: string
  question_order: number
  question_phase: string
  module_type: string
  question_type: string
  content_json: string
  media_asset_id: string | null
}

interface SessionListJoinRow {
  session_id: string
  business_session_id: string
  student_id: string
  student_name: string
  strategy_id: string
  strategy_type: string
  strategy_version: number
  job_code: string
  task_code: string
  status: string
  delivery_phase: string | null
  assignment_id: string | null
  assignment_status: string | null
  event_sequence_version: number
  observation_template_id: string | null
  online_question_count: number
  online_completed_count: number
  current_question_id: string | null
  pause_count: number
  redline_incident_id: string | null
  last_interruption_reason: string | null
  created_at: string
  started_at: string | null
}

/** SessionListJoinRow → SessionListItem 映射（listSessions / listMySessions 共用）。 */
function mapSessionListRow(r: SessionListJoinRow): SessionListItem {
  return {
    sessionId: r.session_id,
    businessSessionId: r.business_session_id,
    studentId: r.student_id,
    studentName: r.student_name,
    strategyId: r.strategy_id,
    strategyType: r.strategy_type as AssessmentStrategyType,
    strategyVersion: r.strategy_version,
    jobCode: r.job_code,
    taskCode: r.task_code,
    status: r.status as SessionStatus,
    deliveryPhase: r.delivery_phase as DeliveryPhase | null,
    assignmentId: r.assignment_id,
    assignmentStatus: r.assignment_status as SessionListItem['assignmentStatus'],
    eventSequenceVersion: r.event_sequence_version,
    observationTemplateId: r.observation_template_id,
    onlineQuestionCount: r.online_question_count,
    onlineCompletedCount: r.online_completed_count,
    currentQuestionId: r.current_question_id,
    pauseCount: r.pause_count,
    redlineIncidentId: r.redline_incident_id,
    lastInterruptionReason: r.last_interruption_reason,
    createdAt: r.created_at,
    startedAt: r.started_at
  }
}

/**
 * 读当前题目正文（脱敏后）。expected_answer / is_correct 由本函数剥离。
 * content_json 损坏或题型不匹配 → null（不破坏 getSession）。
 */
function readCurrentQuestionContent(
  db: DBAdapter,
  sessionId: string,
  questionId: string
): SessionQuestionContent | null {
  const row = db
    .prepare(
      `SELECT sq.question_id, sq.question_order, sq.question_phase, sq.module_type,
              sq.question_type, qb.content_json, qb.media_asset_id
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_id = ?`
    )
    .get(sessionId, questionId) as SessionQuestionJoinRow | undefined
  if (!row) return null

  let content: Record<string, unknown>
  try {
    content = JSON.parse(row.content_json)
  } catch {
    console.warn(`[getSession] content_json parse failed: questionId=${questionId}`)
    return null
  }

  const interactionConfig =
    content.interaction != null &&
    typeof content.interaction === 'object' &&
    'config' in (content.interaction as Record<string, unknown>)
      ? ((content.interaction as Record<string, unknown>).config as Record<string, unknown>)
      : ({} as Record<string, unknown>)

  const base = {
    questionId: row.question_id,
    questionOrder: row.question_order,
    questionPhase: row.question_phase as 'ONLINE' | 'OFFLINE',
    moduleType: row.module_type as AbilityTag,
    questionType: row.question_type as 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG',
    prompt: typeof content.prompt === 'string' ? content.prompt : '',
    assessmentPoint: typeof content.assessment_point === 'string' ? content.assessment_point : '',
    mediaAssetId: row.media_asset_id ?? null,
    mediaBrief: typeof content.media_brief === 'string' ? content.media_brief : null
  }

  if (base.questionType === 'TRUE_FALSE') {
    const variants = Array.isArray(content.variants)
      ? content.variants
          .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object')
          .map((v) => ({
            variantId: typeof v.variant_id === 'string' ? v.variant_id : '',
            mediaAssetId:
              v.media_asset_id != null && typeof v.media_asset_id === 'string'
                ? v.media_asset_id
                : null,
            mediaBrief: typeof v.media_brief === 'string' ? v.media_brief : ''
            // [!] 刻意不读 v.expected_answer —— 脱敏
          }))
      : undefined
    return { ...base, variants }
  }

  if (base.questionType === 'SINGLE_CHOICE') {
    const rawOpts = Array.isArray(interactionConfig.options)
      ? interactionConfig.options
      : Array.isArray(content.options)
        ? content.options
        : []
    const options = rawOpts
          .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object')
          .map((o) => ({
            key: typeof o.key === 'string' ? o.key : '',
            text: typeof o.text === 'string' ? o.text : '',
            imageAssetId:
              o.image_asset_id != null && typeof o.image_asset_id === 'string'
                ? o.image_asset_id
                : null
            // [!] 刻意不读 o.is_correct —— 脱敏
          }))
    return { ...base, options }
  }

  if (base.questionType === 'DRAG') {
    const rawItems = Array.isArray(interactionConfig.items)
      ? interactionConfig.items
      : Array.isArray(content.drag_items)
        ? content.drag_items
        : []
    const dragItems = rawItems
          .filter((d): d is Record<string, unknown> => d !== null && typeof d === 'object')
          .map((d) => ({
            itemId: typeof d.item_id === 'string' ? d.item_id : '',
            label: typeof d.label === 'string' ? d.label : '',
            imageAssetId:
              d.image_asset_id != null && typeof d.image_asset_id === 'string'
                ? d.image_asset_id
                : null
          }))
    const rawZones = Array.isArray(interactionConfig.zones)
      ? interactionConfig.zones
      : Array.isArray(content.drop_zones)
        ? content.drop_zones
        : []
    const dropZones = rawZones
          .filter((z): z is Record<string, unknown> => z !== null && typeof z === 'object')
          .map((z) => ({
            zoneId: typeof z.zone_id === 'string' ? z.zone_id : '',
            label: typeof z.label === 'string' ? z.label : ''
          }))
    const scoringMode =
      content.scoring_mode === 'ALL_OR_NOTHING' || content.scoring_mode === 'PARTIAL_CREDIT'
        ? content.scoring_mode
        : undefined
    return { ...base, dragItems, dropZones, scoringMode }
  }

  // OFFLINE_OPERATION 不应出现在 currentQuestion（线上答题路径）
  return null
}

/**
 * 读单个 session + 当前题目正文。
 * - STUDENT 仅可读自己的 session（assertStudent + assertSessionOwner）
 * - TEACHER/ADMIN 可读任意 session
 * - 不基于 status 拦截；终态 session 仍可读
 * - content_json 损坏 → currentQuestion = null（不破坏读路径）
 */
export function getSession(db: DBAdapter, params: GetSessionParams): GetSessionResult {
  if (params.callerRole === 'STUDENT') {
    const stu = assertStudent(db, params.callerUserId, params.callerRole)
    if (!stu.ok) return { success: false, errorCode: 'FORBIDDEN' }
    const owner = assertSessionOwner(db, stu.row.user_id, params.sessionId)
    if (!owner.ok) return { success: false, errorCode: owner.errorCode }
  } else {
    const call = assertCaller(db, params.callerUserId, params.callerRole)
    if (!call.ok) return { success: false, errorCode: 'FORBIDDEN' }
  }

  const row = db
    .prepare(
      // [!] schema assessment_session 无 created_at 列（v0.1.9 遗漏）；用 updated_at
      // 替代。updated_at 默认 datetime('now') 且无 trigger 自动刷新，等同创建时间。
      `SELECT session_id, student_id, strategy_id, strategy_type, strategy_version,
              business_session_id, job_code, task_code, status, delivery_phase,
              event_sequence_version, observation_template_id,
              online_question_count, offline_question_count, online_completed_count,
              current_question_id, pause_count, pause_started_at,
              last_interruption_reason, redline_incident_id, level_result,
              started_at, completed_at, updated_at AS created_at
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(params.sessionId) as SessionFullRow | undefined
  if (!row) return { success: false, errorCode: 'NOT_FOUND' }

  const session: SessionDetail = {
    sessionId: row.session_id,
    businessSessionId: row.business_session_id,
    studentId: row.student_id,
    strategyId: row.strategy_id,
    strategyType: row.strategy_type as AssessmentStrategyType,
    strategyVersion: row.strategy_version,
    jobCode: row.job_code,
    taskCode: row.task_code,
    status: row.status as SessionStatus,
    deliveryPhase: row.delivery_phase as DeliveryPhase | null,
    eventSequenceVersion: row.event_sequence_version,
    observationTemplateId: row.observation_template_id,
    onlineQuestionCount: row.online_question_count,
    offlineQuestionCount: row.offline_question_count,
    onlineCompletedCount: row.online_completed_count,
    currentQuestionId: row.current_question_id,
    pauseCount: row.pause_count,
    pauseStartedAt: row.pause_started_at,
    lastInterruptionReason: row.last_interruption_reason,
    redlineIncidentId: row.redline_incident_id,
    levelResult: row.level_result,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  }

  let currentQuestion: SessionQuestionContent | null = null
  if (row.current_question_id) {
    currentQuestion = readCurrentQuestionContent(db, params.sessionId, row.current_question_id)
  }

  const result: GetSessionSuccess = { success: true, session, currentQuestion }
  return result
}

/**
 * 列出全部非终态 session（OPEN_SESSION_STATUSES）。
 * TEACHER/ADMIN only；STUDENT → FORBIDDEN。
 * 可选 studentId 筛选；不传 = 全部学生。
 */
export function listSessions(db: DBAdapter, params: ListSessionsParams): ListSessionsResult {
  const call = assertCaller(db, params.callerUserId, params.callerRole)
  if (!call.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const statusWhere = `s.status IN (${placeholders})`
  const selectClause = `SELECT s.session_id, s.student_id, sp.student_name,
              s.strategy_id, s.strategy_type, s.strategy_version,
              s.business_session_id, s.job_code, s.task_code, s.status,
              s.delivery_phase, bsa.assignment_id, bsa.status AS assignment_status,
              s.event_sequence_version, s.observation_template_id,
              s.online_question_count, s.online_completed_count,
              s.current_question_id, s.pause_count,
              s.redline_incident_id, s.last_interruption_reason,
              s.updated_at AS created_at, s.started_at
         FROM assessment_session s
         JOIN student_profile sp ON sp.student_id = s.student_id
         LEFT JOIN business_session_assignment bsa
                ON bsa.business_session_id = s.business_session_id
               AND bsa.status IN ('PENDING_CONFIRM', 'ACTIVE')`
  const orderClause = `ORDER BY s.updated_at DESC`

  const rows = params.studentId
    ? (db
        .prepare(`${selectClause} WHERE s.student_id = ? AND ${statusWhere} ${orderClause}`)
        .all(params.studentId, ...OPEN_SESSION_STATUSES) as SessionListJoinRow[])
    : (db
        .prepare(`${selectClause} WHERE ${statusWhere} ${orderClause}`)
        .all(...OPEN_SESSION_STATUSES) as SessionListJoinRow[])

  const items: SessionListItem[] = rows.map(mapSessionListRow)

  const result: ListSessionsSuccess = { success: true, items }
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
export function startSession(db: DBAdapter, params: StartSessionParams): StartSessionResult {
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

  // 5. 幂等：current_question_id 已非 NULL → 直接返回，不写事件
  if (pointer.current_question_id) {
    const q = db
      .prepare(
        `SELECT question_order FROM assessment_session_question
          WHERE session_id = ? AND question_id = ?`
      )
      .get(params.sessionId, pointer.current_question_id) as
      | { question_order: number }
      | undefined
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

  // 6. 事务：writeEvent(SESSION_FIRST_QUESTION_ACTIVATED) + applyAssessmentEvent
  const payload: SessionFirstQuestionActivatedPayload = {
    session_id: params.sessionId,
    first_question_id: first.question_id,
    first_question_order: first.question_order,
    activated_at: new Date().toISOString()
  }
  try {
    const tx = db.transaction(() => {
      const event = writeEvent({
        aggregateType: 'ASSESSMENT_SESSION',
        aggregateId: params.sessionId,
        eventType: 'SESSION_FIRST_QUESTION_ACTIVATED',
        payload: payload as unknown as Record<string, unknown>,
        actorId: caller.row.user_id,
        actorRole: 'STUDENT'
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

/**
 * assessment:listMySessions 核心纯函数（STUDENT）。
 *
 * 学生自查非终态 session 列表（OPEN_SESSION_STATUSES 全集）。
 * 复用 listSessions 的 SELECT + 行映射；仅 WHERE 改为 student_id = caller.userId
 * （assertStudent 已校验 caller.userId 是 STUDENT 账号的 user_id，与 student_id 同值）。
 *
 * 失败码：FORBIDDEN（非 STUDENT）
 */
export function listMySessions(db: DBAdapter, params: ListMySessionsParams): ListMySessionsResult {
  const stu = assertStudent(db, params.callerUserId, params.callerRole)
  if (!stu.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const placeholders = OPEN_SESSION_STATUSES.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT s.session_id, s.student_id, sp.student_name,
              s.strategy_id, s.strategy_type, s.strategy_version,
              s.business_session_id, s.job_code, s.task_code, s.status,
              s.delivery_phase, bsa.assignment_id, bsa.status AS assignment_status,
              s.event_sequence_version, s.observation_template_id,
              s.online_question_count, s.online_completed_count,
              s.current_question_id, s.pause_count,
              s.redline_incident_id, s.last_interruption_reason,
              s.updated_at AS created_at, s.started_at
         FROM assessment_session s
         JOIN student_profile sp ON sp.student_id = s.student_id
         LEFT JOIN business_session_assignment bsa
                ON bsa.business_session_id = s.business_session_id
               AND bsa.status IN ('PENDING_CONFIRM', 'ACTIVE')
        WHERE s.student_id = ? AND s.status IN (${placeholders})
        ORDER BY s.updated_at DESC`
    )
    .all(stu.row.user_id, ...OPEN_SESSION_STATUSES) as SessionListJoinRow[]

  const items: SessionListItem[] = rows.map(mapSessionListRow)

  const result: ListMySessionsSuccess = { success: true, items }
  return result
}

// 生产默认 getDb：用 SqliteAdapter 包装 better-sqlite3 singleton。
// Adapter 是无状态薄包装，不缓存（每次 IPC 新建一个，开销可忽略）。
function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

/**
 * 注册 assessment:* IPC handler。
 *
 * 延迟 seed error codes：registerAssessmentHandlers 由 import './ipc' 在模块加载
 * 阶段触发，早于 app.whenReady → initDatabase()，故注册时不能立即访问 DB
 * （否则 getDatabase 抛 "Not initialized"）。与 student.ts / strategy.ts 同模式。
 *
 * Step 6b 注册 createSession；Step 7 注册 submitAnswer / emotionInterrupt /
 * emotionResume / abortSession；Step 8 注册 triggerRedline / calculateResult；
 * Step 9a 注册 getSession / listSessions（纯读路径）。
 */
export function registerAssessmentHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  let codesSeeded = false
  function ensureSeeded(): DBAdapter {
    const db = getDb()
    if (!codesSeeded) {
      seedAssessmentErrorCodes(db)
      codesSeeded = true
    }
    return db
  }

  ipcMain.handle('assessment:createSession', (_e, params: CreateSessionParams) => {
    return createSession(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:submitAnswer', (_e, params: SubmitAnswerParams) => {
    return submitAnswer(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:emotionInterrupt', (_e, params: EmotionInterruptParams) => {
    return emotionInterrupt(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:emotionResume', (_e, params: EmotionResumeParams) => {
    return emotionResume(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:abortSession', (_e, params: AbortSessionParams) => {
    return abortSession(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:triggerRedline', (_e, params: TriggerRedlineParams) => {
    return triggerRedline(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:calculateResult', (_e, params: CalculateResultParams) => {
    return calculateResult(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:getSession', (_e, params: GetSessionParams) => {
    return getSession(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:listSessions', (_e, params: ListSessionsParams) => {
    return listSessions(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:startSession', (_e, params: StartSessionParams) => {
    return startSession(ensureSeeded(), params)
  })

  ipcMain.handle('assessment:listMySessions', (_e, params: ListMySessionsParams) => {
    return listMySessions(ensureSeeded(), params)
  })
}
