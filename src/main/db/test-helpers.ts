// 测试专用 DB helper。仅被 *.test.ts 导入；生产代码不引用，故不进入 Electron 打包。
// createTestDb 用 MemoryAdapter（sql.js / WASM SQLite）+ 加载 schema 源文件，
// 供 handler 集成测试。完全不触碰 better-sqlite3 原生模块，规避 Node/Electron ABI 不匹配。

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { hashPassword } from '../utils/password'
import { MemoryAdapter } from './memory-adapter'
import type { DBAdapter } from './interface'
import type { StrategyInput } from '../../shared/types/strategy'
import type { AbilityTag } from '../../shared/types/json-schemas'

type BusinessSessionType = 'ASSESSMENT' | 'TRAINING'

export type AssessmentFixtureStatus =
  | 'INIT'
  | 'ACTIVE'
  | 'EMOTION_INTERRUPTED'
  | 'SUSPENDED_REVIEW_REQUIRED'
  | 'OFFLINE_PENDING'
  | 'COMPLETED'
  | 'REDLINE_HALTED'
  | 'ABORTED'

export type AssessmentFixtureDeliveryPhase =
  | 'PREPARED'
  | 'ONLINE_IN_PROGRESS'
  | 'ONLINE_COMPLETED'
  | 'OFFLINE_SCORING'
  | 'OBSERVATION'
  | 'READY_TO_FINALIZE'
  | 'FINALIZED'

// 指向生产 schema 的单一源（src/main/db/schema.sql），与 connection.ts 同源。
// [!] 历史教训：曾指向 doc/ 镜像副本，v0.1.8 迁移时漏改导致测试 schema 滞后于
// 生产（pass_threshold vs competent_threshold）。统一指向 src/main/db/schema.sql
// 消除漂移——测试与生产加载同一文件。
const SCHEMA_PATH = resolve(process.cwd(), 'src/main/db/schema.sql')

/**
 * 创建内存 SQLite（sql.js）并加载完整 schema。
 * sql.js 需先异步加载 WASM，故为 async 工厂；测试在 beforeAll 内 await 调用。
 */
export async function createTestDb(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(SCHEMA_PATH, 'utf-8'))
  return db
}

/**
 * 插入一个 ACTIVE 的 TEACHER（默认）或 ADMIN 账号，返回 userId 供测试调用 handler。
 */
export function seedCaller(db: DBAdapter, role: 'TEACHER' | 'ADMIN' = 'TEACHER'): string {
  const userId = uuidv4()
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE')`
  ).run(userId, `caller_${role.toLowerCase()}_${userId.slice(0, 8)}`, hashPassword('x'), role, '测试调用者')
  return userId
}

/**
 * 插入一个 DISABLED 账号（用于测试 caller 状态非 ACTIVE 的拒绝路径）。
 */
export function seedDisabledCaller(db: DBAdapter, role: 'TEACHER' | 'ADMIN' = 'TEACHER'): string {
  const userId = uuidv4()
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, ?, ?, 'DISABLED')`
  ).run(userId, `disabled_${role.toLowerCase()}_${userId.slice(0, 8)}`, hashPassword('x'), role, '停用调用者')
  return userId
}

/**
 * 策略输入工厂（跨 4 个 strategy 测试文件共享，避免 4 处 25 行重复）。
 * 默认值与 schema seed 一致：BASELINE_ASSESSMENT / SUPERMARKET_SHELVER /
 * 42+8 题 / max100 / competent80 / conditional60 / moduleVeto0.5 / emotion3 /
 * level_rules [0,59]/[60,79]/[80,100]。
 * strategyId 默认每次随机，避免跨用例碰撞。
 */
export function baseStrategyInput(over: Partial<StrategyInput> = {}): StrategyInput {
  return {
    strategyId: `test-strategy-${uuidv4().slice(0, 8)}`,
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    strategyName: '测试策略',
    onlineQuestionCount: 42,
    offlineQuestionCount: 8,
    maxScore: 100,
    competentThreshold: 80,
    conditionalThreshold: 60,
    moduleVetoThreshold: 0.5,
    emotionCollapseThreshold: 3,
    questionPolicy: {
      module_scope: 'CROSS_MODULE',
      question_ratio: { TRUE_FALSE: 14, SINGLE_CHOICE: 14, DRAG: 14, OFFLINE_OPERATION: 8 }
    },
    scoringPolicy: {
      schema_version: 'scoring-policy-v1.1' as const,
      online_score_values: [0, 2] as [0, 2],
      offline_score_values: [0, 1, 2] as [0, 1, 2],
      normalization: 'raw_score/max_score*100' as const,
      safety_override_enabled: true,
      placement_advice_enabled: false,
      score_values: [0, 1, 2] as [0, 1, 2],
      level_rules: [
        { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' as const },
        { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' as const },
        { min: 80, max: 100, level: 'LEVEL_COMPETENT' as const }
      ]
    },
    supportsRedlineHalt: true,
    allowsEmotionInterrupt: true,
    requiresOfflineScoring: true,
    version: 1,
    isActive: true,
    ...over
  }
}

function tableExists(db: DBAdapter, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { present: number } | undefined
  return Boolean(row)
}

function tableColumns(db: DBAdapter, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function columnExists(db: DBAdapter, tableName: string, columnName: string): boolean {
  return tableColumns(db, tableName).has(columnName)
}

function insertRow(db: DBAdapter, tableName: string, values: Record<string, unknown>): void {
  const columns = Object.keys(values)
  const placeholders = columns.map(() => '?').join(', ')
  db.prepare(
    `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`
  ).run(...columns.map((column) => values[column]))
}

function assertBusinessSessionMatch(
  row: Record<string, unknown>,
  expected: {
    businessSessionId: string
    sessionType: BusinessSessionType
    studentId: string
    jobCode: string
    taskCode: string
  }
): void {
  const mismatches = [
    row.session_type === expected.sessionType,
    row.student_id === expected.studentId,
    row.job_code === expected.jobCode,
    row.task_code === expected.taskCode
  ]
  if (mismatches.every(Boolean)) return
  throw new Error(
    `seedBusinessSessionFixture: existing parent ${expected.businessSessionId} conflicts with child fixture`
  )
}

/**
 * M2 前向兼容父会话夹具。当前 v0.1.13 没有 business_session 时为 no-op；
 * 后续测试 schema 存在父表时，先插入四键匹配的父记录。
 */
export function seedBusinessSessionFixture(
  db: DBAdapter,
  params: {
    businessSessionId: string
    sessionType: BusinessSessionType
    studentId: string
    jobCode: string
    taskCode: string
    createdBy?: string
  }
): void {
  if (!tableExists(db, 'business_session')) return

  const existing = db
    .prepare('SELECT * FROM business_session WHERE business_session_id = ?')
    .get(params.businessSessionId) as Record<string, unknown> | undefined
  if (existing) {
    assertBusinessSessionMatch(existing, params)
    return
  }

  const columns = tableColumns(db, 'business_session')
  const values: Record<string, unknown> = {}
  const candidateValues: Record<string, unknown> = {
    business_session_id: params.businessSessionId,
    session_type: params.sessionType,
    student_id: params.studentId,
    job_code: params.jobCode,
    task_code: params.taskCode,
    created_by: params.createdBy ?? params.studentId
  }
  for (const [column, value] of Object.entries(candidateValues)) {
    if (columns.has(column)) values[column] = value
  }
  insertRow(db, 'business_session', values)
}

function resolveAssessmentDeliveryPhase(
  status: AssessmentFixtureStatus,
  requested?: AssessmentFixtureDeliveryPhase | null
): AssessmentFixtureDeliveryPhase | null {
  if (status === 'COMPLETED') return 'FINALIZED'
  if (requested !== undefined) return requested
  if (status === 'ACTIVE') return 'ONLINE_IN_PROGRESS'
  if (status === 'OFFLINE_PENDING') return 'OFFLINE_SCORING'
  return 'PREPARED'
}

/**
 * 直接插入 assessment_session 的测试夹具。M2 列存在时自动写：
 * business_session_id=session_id、event_sequence_version=0，以及合理 delivery_phase。
 */
export function seedAssessmentSessionFixture(
  db: DBAdapter,
  params: {
    sessionId?: string
    studentId: string
    strategyId: string
    strategyType?: string
    jobCode?: string
    taskCode?: string
    strategyVersion?: number
    status?: AssessmentFixtureStatus
    onlineQuestionCount?: number
    offlineQuestionCount?: number
    createdBy: string
    currentQuestionId?: string | null
    deliveryPhase?: AssessmentFixtureDeliveryPhase | null
    observationTemplateId?: string | null
  }
): string {
  const sessionId = params.sessionId ?? uuidv4()
  const strategyType = params.strategyType ?? 'BASELINE_ASSESSMENT'
  const jobCode = params.jobCode ?? 'SUPERMARKET_SHELVER'
  const taskCode = params.taskCode ?? 'SHELVE_TASK'
  const status = params.status ?? 'ACTIVE'
  const strategyVersion = params.strategyVersion ?? 1

  seedBusinessSessionFixture(db, {
    businessSessionId: sessionId,
    sessionType: 'ASSESSMENT',
    studentId: params.studentId,
    jobCode,
    taskCode,
    createdBy: params.createdBy
  })

  const columns = tableColumns(db, 'assessment_session')
  const values: Record<string, unknown> = {
    session_id: sessionId,
    student_id: params.studentId,
    strategy_id: params.strategyId,
    strategy_type: strategyType,
    job_code: jobCode,
    task_code: taskCode,
    strategy_version: strategyVersion,
    status,
    online_question_count: params.onlineQuestionCount ?? 42,
    offline_question_count: params.offlineQuestionCount ?? 8,
    created_by: params.createdBy
  }
  if (params.currentQuestionId !== undefined) {
    values.current_question_id = params.currentQuestionId
  }
  if (columns.has('business_session_id')) {
    values.business_session_id = sessionId
  }
  if (columns.has('delivery_phase')) {
    values.delivery_phase = resolveAssessmentDeliveryPhase(status, params.deliveryPhase)
  }
  if (columns.has('event_sequence_version')) {
    values.event_sequence_version = 0
  }
  if (columns.has('observation_template_id')) {
    values.observation_template_id = params.observationTemplateId ?? null
  }

  insertRow(db, 'assessment_session', values)
  return sessionId
}

/**
 * 测试中把 assessment_session 改成终态时使用。M2 下 COMPLETED 必须同条 UPDATE
 * 写 FINALIZED；ABORTED/REDLINE_HALTED 等异常终态不伪造 FINALIZED。
 */
export function setAssessmentSessionStateFixture(
  db: DBAdapter,
  sessionId: string,
  status: AssessmentFixtureStatus,
  deliveryPhase?: AssessmentFixtureDeliveryPhase | null
): void {
  if (columnExists(db, 'assessment_session', 'delivery_phase')) {
    const phase = resolveAssessmentDeliveryPhase(status, deliveryPhase)
    if (status === 'COMPLETED' || deliveryPhase !== undefined) {
      db.prepare(
        'UPDATE assessment_session SET status = ?, delivery_phase = ? WHERE session_id = ?'
      ).run(status, phase, sessionId)
      return
    }
  }
  db.prepare('UPDATE assessment_session SET status = ? WHERE session_id = ?').run(status, sessionId)
}

function seedTrainingSessionFixture(
  db: DBAdapter,
  params: {
    trainingSessionId?: string
    studentId: string
    jobCode: string
    taskCode?: string
    strategyId: string
    strategyType: string
    strategyVersion: number
    status?: string
    moduleType?: string
    totalStepCount?: number
    completedStepCount?: number
    createdBy: string
  }
): string {
  const trainingSessionId = params.trainingSessionId ?? uuidv4()
  const taskCode = params.taskCode ?? 'test-task'

  seedBusinessSessionFixture(db, {
    businessSessionId: trainingSessionId,
    sessionType: 'TRAINING',
    studentId: params.studentId,
    jobCode: params.jobCode,
    taskCode,
    createdBy: params.createdBy
  })

  const columns = tableColumns(db, 'training_session')
  const values: Record<string, unknown> = {
    training_session_id: trainingSessionId,
    student_id: params.studentId,
    job_code: params.jobCode,
    task_code: taskCode,
    strategy_id: params.strategyId,
    strategy_type: params.strategyType,
    strategy_version: params.strategyVersion,
    status: params.status ?? 'COMPLETED',
    module_type: params.moduleType ?? 'FINE_MOTOR',
    total_step_count: params.totalStepCount ?? 1,
    completed_step_count: params.completedStepCount ?? 0,
    created_by: params.createdBy
  }
  if (columns.has('business_session_id')) {
    values.business_session_id = trainingSessionId
  }

  insertRow(db, 'training_session', values)
  return trainingSessionId
}

/**
 * 在测试 DB 中制造一条对 (strategyId, version) 的引用，用于 REFERENCED_IMMUTABLE /
 * 已引用版本 setActive 测试。自动前置插好 student_profile + user_account(STUDENT)。
 *
 * - via='assessment'：插 assessment_session（strategy_type CHECK 只允许
 *   BASELINE_ASSESSMENT/MOCK_EXAM，故仅用于这两类策略）
 * - via='training'：插 training_session（strategy_type 强制 TRAINING_PRACTICE，
 *   故仅用于 TRAINING_PRACTICE 策略）
 *
 * handler 引用检查与 schema 触发器都按 (strategy_id, strategy_version) 匹配，
 * 故同一 via 类型可用于该 via 兼容的任意策略族。
 */
export function seedStrategyReference(
  db: DBAdapter,
  strategyId: string,
  version: number,
  via: 'assessment' | 'training'
): void {
  // 从 strategy_config 查实际 (type, job_code)，保证 session 行通过
  // trg_*_strategy_config_match_insert 触发器的 4 列一致性校验。
  const sc = db
    .prepare('SELECT strategy_type, job_code, online_question_count, offline_question_count FROM strategy_config WHERE strategy_id = ? AND version = ?')
    .get(strategyId, version) as {
    strategy_type: string
    job_code: string
    online_question_count: number
    offline_question_count: number
  } | undefined
  if (!sc) {
    throw new Error(
      `seedStrategyReference: strategy_config (${strategyId}, v${version}) 不存在；测试需先建策略再制造引用`
    )
  }

  // via 必须与策略 strategy_type 兼容：
  // - assessment → BASELINE_ASSESSMENT / MOCK_EXAM（schema CHECK）
  // - training → TRAINING_PRACTICE（schema CHECK 强制）
  if (via === 'assessment' && sc.strategy_type === 'TRAINING_PRACTICE') {
    throw new Error('seedStrategyReference(via=assessment) 不兼容 TRAINING_PRACTICE 策略')
  }
  if (via === 'training' && sc.strategy_type !== 'TRAINING_PRACTICE') {
    throw new Error('seedStrategyReference(via=training) 仅兼容 TRAINING_PRACTICE 策略')
  }

  // 前置：seed student_profile + user_account(STUDENT)（同 UUID 复用，与 student.ts 一致）
  const studentId = uuidv4()
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, 'STUDENT', ?, 'ACTIVE')`
  ).run(studentId, `student_${studentId.slice(0, 8)}`, hashPassword('x'), '引用测试学生')
  db.prepare(
    `INSERT INTO student_profile (student_id, student_name, status)
     VALUES (?, ?, 'ACTIVE')`
  ).run(studentId, '引用测试学生')

  if (via === 'assessment') {
    seedAssessmentSessionFixture(db, {
      studentId,
      strategyId,
      strategyType: sc.strategy_type,
      jobCode: sc.job_code,
      taskCode: 'test-task',
      strategyVersion: version,
      status: 'COMPLETED',
      onlineQuestionCount: sc.online_question_count,
      offlineQuestionCount: sc.offline_question_count,
      createdBy: studentId
    })
  } else {
    seedTrainingSessionFixture(db, {
      studentId,
      jobCode: sc.job_code,
      strategyId,
      strategyType: sc.strategy_type,
      strategyVersion: version,
      createdBy: studentId
    })
  }
}

/**
 * 插入 user_account(STUDENT) + student_profile（同 UUID 复用，与 student.ts createStudent 一致），
 * 返回 studentId（= userId）。over.userStatus 用于测 assertStudent 的 DISABLED 拒绝路径。
 */
export function seedStudent(
  db: DBAdapter,
  over: { studentName?: string; userStatus?: 'ACTIVE' | 'DISABLED' | 'ARCHIVED' } = {}
): string {
  const studentId = uuidv4()
  const studentName = over.studentName ?? '测试学生'
  const userStatus = over.userStatus ?? 'ACTIVE'
  db.prepare(
    `INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
     VALUES (?, ?, ?, 'STUDENT', ?, ?)`
  ).run(studentId, `student_${studentId.slice(0, 8)}`, hashPassword('x'), studentName, userStatus)
  db.prepare(
    `INSERT INTO student_profile (student_id, student_name, status)
     VALUES (?, ?, 'ACTIVE')`
  ).run(studentId, studentName)
  return studentId
}

/**
 * 批量 seed ACTIVE question_bank 行（mock 题库）。
 * 默认：6 模块 × {online 3 题型 × 5 道 + OFFLINE_OPERATION × 3 道} = 108 道，
 * 覆盖 baseStrategyInput 组卷需求（42 online + 8 offline）含余量。
 * content_json / scoring_rule_json 为 seed 占位（schema 仅 NOT NULL，详细结构由 app 层校验）。
 */
const SEED_MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]
const SEED_ONLINE_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG'] as const

export function seedQuestionBank(
  db: DBAdapter,
  over: { jobCode?: string; onlinePerModule?: number; offlinePerModule?: number } = {}
): void {
  const jobCode = over.jobCode ?? 'SUPERMARKET_SHELVER'
  const onlineN = over.onlinePerModule ?? 5
  const offlineN = over.offlinePerModule ?? 3
  const stmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, module_type, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, ?, 'BASE_ABILITY', ?, ?, 'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'DRAFT')`
  )
  for (const moduleType of SEED_MODULES) {
    for (const questionType of SEED_ONLINE_TYPES) {
      for (let i = 0; i < onlineN; i++) {
        stmt.run(uuidv4(), jobCode, moduleType, questionType)
      }
    }
    for (let i = 0; i < offlineN; i++) {
      stmt.run(uuidv4(), jobCode, moduleType, 'OFFLINE_OPERATION')
    }
  }
  // v0.1.12: 激活所有 DRAFT 题，满足 trg_assessment_session_question_insert_validation
  db.prepare("UPDATE question_bank SET status = 'ACTIVE' WHERE status = 'DRAFT'").run()
}

/**
 * 与 seedQuestionBank 相同，但保持 DRAFT 状态不激活。
 * 用于需要在激活前修改 content_json 的测试（如 assessment-answer.test.ts）。
 * 调用方负责在组卷前执行 UPDATE question_bank SET status='ACTIVE' WHERE status='DRAFT'。
 */
export function seedQuestionBankDraft(
  db: DBAdapter,
  over: { jobCode?: string; onlinePerModule?: number; offlinePerModule?: number } = {}
): void {
  const jobCode = over.jobCode ?? 'SUPERMARKET_SHELVER'
  const onlineN = over.onlinePerModule ?? 5
  const offlineN = over.offlinePerModule ?? 3
  const stmt = db.prepare(
    `INSERT INTO question_bank
       (question_id, job_code, bank_domain, module_type, question_type, item_usage,
        content_json, scoring_rule_json, status)
     VALUES (?, ?, 'BASE_ABILITY', ?, ?, 'SCORED_ITEM', '{"seed":true}', '{"seed":true}', 'DRAFT')`
  )
  for (const moduleType of SEED_MODULES) {
    for (const questionType of SEED_ONLINE_TYPES) {
      for (let i = 0; i < onlineN; i++) {
        stmt.run(uuidv4(), jobCode, moduleType, questionType)
      }
    }
    for (let i = 0; i < offlineN; i++) {
      stmt.run(uuidv4(), jobCode, moduleType, 'OFFLINE_OPERATION')
    }
  }
}
