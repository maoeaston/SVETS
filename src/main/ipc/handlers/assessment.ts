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
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import {
  generatePaper,
  type QuestionBankRow
} from '../../domain/paper-generator'
import type { AbilityTag, QuestionPolicyJson } from '../../../shared/types/json-schemas'
import type {
  SessionStartedPayload,
  AnswerSubmittedPayload,
  EmotionInterruptedPayload,
  EmotionResumedPayload,
  EmotionCollapseThresholdReachedPayload,
  CollapseRecord,
  SessionAbortedPayload
} from '@shared/types/event-payloads'
import type {
  AssessmentStrategyType,
  CreateSessionParams,
  CreateSessionResult,
  CreateSessionSuccess,
  SessionQuestionView,
  SubmitAnswerParams,
  SubmitAnswerResult,
  SubmitAnswerSuccess,
  EmotionInterruptParams,
  EmotionInterruptResult,
  EmotionResumeParams,
  EmotionResumeResult,
  AbortSessionParams,
  AbortSessionResult,
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

  // 4. 校验 strategy_type（assessment 仅接受 BASELINE/MOCK；TRAINING_PRACTICE 走训练功能）
  if (strategy.strategy_type !== 'BASELINE_ASSESSMENT' && strategy.strategy_type !== 'MOCK_EXAM') {
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

  // 8. 解析 question_policy_json + 查 ACTIVE question_bank
  let questionPolicy: QuestionPolicyJson
  try {
    questionPolicy = JSON.parse(strategy.question_policy_json) as QuestionPolicyJson
  } catch (err) {
    const sessionId = uuidv4() // 审计需要 aggId，用临时 UUID 占位（事务尚未开始）
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

  // 9. 组卷
  const paper = generatePaper({
    onlineQuestionCount: strategy.online_question_count,
    offlineQuestionCount: strategy.offline_question_count,
    questionRatio: questionPolicy.question_ratio,
    requiredModules,
    questionBankRows: qbRows,
    sensoryFilterMode: questionPolicy.sensory_filter_mode ?? 'SOFT'
  })
  if (!paper.ok) {
    // INVALID_POLICY → 策略配置异常（question_ratio 之和与 count 不符），属系统级
    // QUESTION_BANK_INSUFFICIENT → 题库未配足，运营需补题（写审计给运营可见性）
    if (paper.errorCode === 'QUESTION_BANK_INSUFFICIENT') {
      logAssessmentEvent(
        db,
        'QUESTION_BANK_INSUFFICIENT',
        'ERROR',
        'unknown',
        caller.row.user_id,
        {
          operation: 'createSession',
          strategyId: params.strategyId,
          strategyVersion: params.strategyVersion,
          studentId: params.studentId,
          activeQuestionCount: qbRows.length
        }
      )
      return { success: false, errorCode: 'QUESTION_BANK_INSUFFICIENT' }
    }
    // INVALID_POLICY
    const sessionId = uuidv4()
    logAssessmentEvent(db, 'ASSESSMENT_SYSTEM_ERROR', 'ERROR', sessionId, caller.row.user_id, {
      operation: 'createSession',
      error: `generatePaper INVALID_POLICY`,
      strategyId: params.strategyId,
      strategyVersion: params.strategyVersion
    })
    return { success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' }
  }

  // 10. 事务：writeEvent(SESSION_STARTED) + applyAssessmentEvent
  //     reducer applySessionStarted 承担 INSERT assessment_session（status=ACTIVE）
  //     + 50 行 assessment_session_question。
  const sessionId = uuidv4()
  const questionIds = paper.questions.map((q) => q.questionId)
  const payload: SessionStartedPayload = {
    session_id: sessionId,
    student_id: params.studentId,
    strategy_id: params.strategyId,
    strategy_type: strategyType,
    strategy_version: params.strategyVersion,
    job_code: strategy.job_code,
    task_code: params.taskCode,
    online_question_count: strategy.online_question_count,
    offline_question_count: strategy.offline_question_count,
    question_ids: questionIds
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

  // 12. 返回（仅 ONLINE 题，学生立即可答；OFFLINE 题由线下评分流程处理）
  const onlineQuestions: SessionQuestionView[] = paper.questions
    .filter((q) => q.questionPhase === 'ONLINE')
    .map((q) => ({
      questionId: q.questionId,
      questionOrder: q.questionOrder,
      questionPhase: 'ONLINE',
      moduleType: q.moduleType,
      questionType: q.questionType as 'TRUE_FALSE' | 'SINGLE_CHOICE' | 'DRAG'
    }))

  const result: CreateSessionSuccess = {
    success: true,
    sessionId,
    questions: onlineQuestions
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
 * [!] 计分逻辑按题型硬编码（doc §2：exact 2/0、drag partial 2/1/0），
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
              qb.content_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_id = ?`
    )
    .get(params.sessionId, params.questionId) as
    | { question_phase: string; sq_type: string; question_order: number; content_json: string }
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

  let isCorrect: boolean
  let score: 0 | 1 | 2

  if (payload.question_type === 'TRUE_FALSE') {
    if (typeof payload.selected !== 'boolean') {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (typeof content.expected_answer !== 'boolean') {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    isCorrect = payload.selected === content.expected_answer
    score = isCorrect ? 2 : 0
  } else if (payload.question_type === 'SINGLE_CHOICE') {
    if (typeof payload.selected !== 'string' || payload.selected.length === 0) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (
      !Array.isArray(content.options) ||
      !content.options.every(
        (o) => o !== null && typeof o === 'object' && typeof (o as { key?: unknown }).key === 'string'
      )
    ) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const validKeys = (content.options as { key: string }[]).map((o) => o.key)
    if (!validKeys.includes(payload.selected)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    if (typeof content.expected_answer !== 'string') {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    isCorrect = payload.selected === content.expected_answer
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
    if (!Array.isArray(content.drag_items) || !Array.isArray(content.drop_zones)) {
      return { success: false, errorCode: 'VALIDATION_ERROR' }
    }
    const dragItems = content.drag_items as { item_id?: unknown }[]
    const dropZones = content.drop_zones as { zone_id?: unknown; accepts?: unknown }[]
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
    if (allCorrect) {
      score = 2
    } else if (content.scoring_mode === 'PARTIAL_CREDIT' && correctCount > total / 2) {
      score = 1
    } else {
      score = 0
    }
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
 * emotionResume / abortSession；getSession / triggerRedline / calculateResult
 * 在 Step 8 注册。preload 已声明全部通道，未注册的调用会 reject（标准 Electron 行为）。
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
}
