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
      score_values: [0, 1, 2],
      normalization: 'raw_score/max_score*100',
      safety_override_enabled: true,
      level_rules: [
        { min: 0, max: 59, level: 'LEVEL_NOT_COMPETENT' },
        { min: 60, max: 79, level: 'LEVEL_CONDITIONAL' },
        { min: 80, max: 100, level: 'LEVEL_COMPETENT' }
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
    db.prepare(
      `INSERT INTO assessment_session
         (session_id, student_id, strategy_id, strategy_type, job_code, task_code,
          strategy_version, status, online_question_count, offline_question_count, created_by)
       VALUES (?, ?, ?, ?, ?, 'test-task',
          ?, 'COMPLETED', ?, ?, ?)`
    ).run(
      uuidv4(),
      studentId,
      strategyId,
      sc.strategy_type,
      sc.job_code,
      version,
      sc.online_question_count,
      sc.offline_question_count,
      studentId
    )
  } else {
    db.prepare(
      `INSERT INTO training_session
         (training_session_id, student_id, job_code, task_code, strategy_id, strategy_type,
          strategy_version, status, module_type, total_step_count, completed_step_count, created_by)
       VALUES (?, ?, ?, 'test-task', ?, ?, ?, 'COMPLETED', 'FINE_MOTOR', 1, 0, ?)`
    ).run(uuidv4(), studentId, sc.job_code, strategyId, sc.strategy_type, version, studentId)
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
       (question_id, job_code, module_type, question_type, content_json, scoring_rule_json)
     VALUES (?, ?, ?, ?, '{"seed":true}', '{"seed":true}')`
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
