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
import { assertCaller } from '../../utils/auth-context'
import { writeEvent } from '../../domain/event-writer'
import { applyAssessmentEvent } from '../../domain/assessment-reducer'
import {
  generatePaper,
  type QuestionBankRow
} from '../../domain/paper-generator'
import type { AbilityTag, QuestionPolicyJson } from '../../../shared/types/json-schemas'
import type { SessionStartedPayload } from '@shared/types/event-payloads'
import type {
  AssessmentStrategyType,
  CreateSessionParams,
  CreateSessionResult,
  CreateSessionSuccess,
  SessionQuestionView
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
 * Step 6b 仅注册 createSession；getSession / submitAnswer / emotionInterrupt /
 * emotionResume / abortSession / triggerRedline / calculateResult 在 Step 7/8 注册。
 * preload 已声明全部通道，未注册的调用会 reject（标准 Electron 行为）。
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
}
