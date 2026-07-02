// 策略配置 handler 模块。
// 核心逻辑（listStrategies / getStrategy / listVersions / createVersion /
// updateStrategy / setActive）抽成纯函数，接收 DBAdapter；registerStrategyHandlers
// 是薄包装，调 ipcMain.handle 时把 getDb() 的结果传给纯函数。
// 测试直接调纯函数 + 注入 MemoryAdapter（与 student.ts 同模式）。
//
// 单一策略配置源（AGENTS.md）：strategy_config 表是组卷/评分/红线规则唯一定义。
// 写路径全部 ADMIN-only；读路径 TEACHER/ADMIN 均可。审计走 error_event_log
// （error_category='SYSTEM', related_aggregate_type='STRATEGY_CONFIG'），不写
// 领域事件——与 student.ts 决策一致（配置维护非学生行为事实）。

import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { SqliteAdapter } from '../../db/sqlite-adapter'
import { getDatabase } from '../../db/connection'
import { assertCaller } from '../../utils/auth-context'
import { validateQuestionPolicy } from '../../utils/validate-question-policy'
import { validateScoringPolicy } from '../../utils/validate-scoring-policy'
import type {
  StrategyType,
  StrategyOpError,
  StrategyListParams,
  StrategyListResult,
  StrategySummary,
  GetStrategyResult,
  StrategyDetail,
  ListStrategyVersionsResult,
  CreateStrategyVersionParams,
  CreateStrategyVersionResult,
  UpdateStrategyParams,
  UpdateStrategyResult,
  SetStrategyActiveParams,
  SetStrategyActiveResult,
  QuestionPolicyJson,
  ScoringPolicyJson
} from '../../../shared/types/strategy'

const STRATEGY_TYPES: readonly StrategyType[] = [
  'BASELINE_ASSESSMENT',
  'MOCK_EXAM',
  'TRAINING_PRACTICE'
]

// --- 错误码 seed + 审计 ---

/**
 * Seed 策略配置相关错误码（INSERT OR IGNORE，幂等）。
 * error_category='SYSTEM'（schema CHECK 枚举不含 'STRATEGY_CONFIG'，与 student 决策一致）。
 * exported 供测试 seed 后再调纯函数；registerStrategyHandlers 也会调一次。
 */
export function seedStrategyErrorCodes(db: DBAdapter): void {
  const codes: Array<[string, 'INFO' | 'ERROR', 'P1' | 'P2' | 'P3', string, string, 0 | 1]> = [
    ['STRATEGY_CONFIG_CREATED', 'INFO', 'P3', '策略配置创建', '管理员新建策略族', 0],
    ['STRATEGY_CONFIG_VERSION_ADDED', 'INFO', 'P3', '策略版本新增', '管理员在已存在族内新增版本', 0],
    ['STRATEGY_CONFIG_UPDATED', 'INFO', 'P3', '策略配置修改', '管理员修改未引用的策略版本', 0],
    ['STRATEGY_CONFIG_ACTIVE_TOGGLED', 'INFO', 'P3', '策略启用状态切换', '管理员切换 is_active', 0],
    ['STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT', 'ERROR', 'P2', '引用策略不可变尝试', '尝试修改已被会话引用的策略版本语义字段', 1],
    ['STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', 'P1', '策略配置系统异常', '策略配置操作异常', 1]
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
 * related_aggregate_id = strategyId + ':' + version（如 'strategy_baseline_shelver:2'）。
 *
 * recovery_status 语义（与 student.ts 一致）：
 * - INFO 审计行用 'IGNORED'
 * - ERROR 异常行用 'UNRESOLVED'
 */
function logStrategyEvent(
  db: DBAdapter,
  code: string,
  severity: 'INFO' | 'ERROR',
  strategyId: string,
  version: number | null,
  callerUserId: string,
  context: Record<string, unknown>
): void {
  const aggId = version === null ? strategyId : `${strategyId}:${version}`
  db.prepare(
    `INSERT INTO error_event_log
       (error_event_id, error_code, severity, error_category,
        related_aggregate_type, related_aggregate_id, message, context_json, recovery_status, created_at)
     VALUES (?, ?, ?, 'SYSTEM', 'STRATEGY_CONFIG', ?, ?, ?, ?, datetime('now'))`
  ).run(
    uuidv4(),
    code,
    severity,
    aggId,
    `${code} strategy=${aggId} by=${callerUserId}`,
    JSON.stringify({ callerUserId, ...context }),
    severity === 'INFO' ? 'IGNORED' : 'UNRESOLVED'
  )
}

// --- 行映射 ---

interface StrategyRow {
  strategy_id: string
  strategy_type: string
  job_code: string
  strategy_name: string
  online_question_count: number
  offline_question_count: number
  max_score: number
  competent_threshold: number
  conditional_threshold: number
  module_veto_threshold: number
  emotion_collapse_threshold: number
  question_policy_json: string
  scoring_policy_json: string
  supports_redline_halt: number
  allows_emotion_interrupt: number
  requires_offline_scoring: number
  version: number
  is_active: number
  created_at: string
  updated_at: string
}

function mapSummary(row: StrategyRow): StrategySummary {
  return {
    strategyId: row.strategy_id,
    strategyType: row.strategy_type as StrategyType,
    jobCode: row.job_code,
    strategyName: row.strategy_name,
    version: row.version,
    isActive: row.is_active === 1,
    competentThreshold: row.competent_threshold,
    conditionalThreshold: row.conditional_threshold,
    moduleVetoThreshold: row.module_veto_threshold,
    emotionCollapseThreshold: row.emotion_collapse_threshold,
    onlineQuestionCount: row.online_question_count,
    offlineQuestionCount: row.offline_question_count,
    maxScore: row.max_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapDetail(row: StrategyRow, questionPolicy: QuestionPolicyJson, scoringPolicy: ScoringPolicyJson): StrategyDetail {
  return {
    ...mapSummary(row),
    questionPolicy,
    scoringPolicy,
    supportsRedlineHalt: row.supports_redline_halt === 1,
    allowsEmotionInterrupt: row.allows_emotion_interrupt === 1,
    requiresOfflineScoring: row.requires_offline_scoring === 1
  }
}

// --- 读路径 ---

/**
 * strategy:list 核心纯函数。
 * - 默认只列 is_active=1；includeInactive=true 时全量；isActive 显式过滤优先级最高
 * - strategyType / jobCode 可选过滤
 * - 排序 strategy_id ASC, version DESC；每页 20 条
 */
export function listStrategies(db: DBAdapter, params: StrategyListParams): StrategyListResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const where: string[] = []
  const args: unknown[] = []

  // isActive 显式过滤优先；否则 includeInactive ? 全量 : is_active=1
  if (typeof params.isActive === 'boolean') {
    where.push('is_active = ?')
    args.push(params.isActive ? 1 : 0)
  } else if (!params.includeInactive) {
    where.push('is_active = 1')
  }

  if (typeof params.strategyType === 'string') {
    where.push('strategy_type = ?')
    args.push(params.strategyType)
  }
  if (typeof params.jobCode === 'string' && params.jobCode.length > 0) {
    where.push('job_code = ?')
    args.push(params.jobCode)
  }

  const rawPage =
    typeof params.page === 'number' && Number.isFinite(params.page) ? params.page : 1
  const safePage = Math.max(1, Math.floor(rawPage))
  const offset = (safePage - 1) * 20
  args.push(offset)

  const sql = `SELECT * FROM strategy_config
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY strategy_id ASC, version DESC
    LIMIT 20 OFFSET ?`

  const rows = db.prepare(sql).all(...args) as StrategyRow[]
  return { success: true, items: rows.map(mapSummary), page: safePage }
}

/**
 * strategy:get 核心纯函数。返回完整 Detail（含 JSON 全文）。
 * - caller 不合法 → FORBIDDEN
 * - (strategyId, version) 不存在 → NOT_FOUND
 * - JSON.parse 失败 → SYSTEM_ERROR（理论不应发生）
 */
export function getStrategy(
  db: DBAdapter,
  params: { callerUserId: unknown; callerRole: unknown; strategyId: unknown; version: unknown }
): GetStrategyResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.version !== 'number' || !Number.isInteger(params.version) || params.version < 1) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const row = db
    .prepare('SELECT * FROM strategy_config WHERE strategy_id = ? AND version = ?')
    .get(params.strategyId, params.version) as StrategyRow | undefined
  if (!row) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  let questionPolicy: QuestionPolicyJson
  let scoringPolicy: ScoringPolicyJson
  try {
    questionPolicy = JSON.parse(row.question_policy_json) as QuestionPolicyJson
    scoringPolicy = JSON.parse(row.scoring_policy_json) as ScoringPolicyJson
  } catch (err) {
    logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', row.strategy_id, row.version, caller.row.user_id, {
      operation: 'get',
      error: String(err)
    })
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }

  return { success: true, strategy: mapDetail(row, questionPolicy, scoringPolicy) }
}

/**
 * strategy:listVersions 核心纯函数。返回某 strategy_id 族的所有版本。
 * - 族不存在（0 行）→ NOT_FOUND
 * - 返回所有版本 + family 元信息（取最新版本行作为 familyStrategyType/familyJobCode 来源）
 */
export function listVersions(
  db: DBAdapter,
  params: { callerUserId: unknown; callerRole: unknown; strategyId: unknown }
): ListStrategyVersionsResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const rows = db
    .prepare('SELECT * FROM strategy_config WHERE strategy_id = ? ORDER BY version DESC')
    .all(params.strategyId) as StrategyRow[]
  if (rows.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  // 族元信息：所有行同 strategy_id 必然同 strategy_type/job_code（schema UNIQUE 族约束 + createVersion 校验）
  // 取首行（version 最高）作为代表。
  const head = rows[0]
  return {
    success: true,
    items: rows.map(mapSummary),
    familyStrategyId: head.strategy_id,
    familyStrategyType: head.strategy_type as StrategyType,
    familyJobCode: head.job_code
  }
}

// --- 写路径 ---

/**
 * 基础字段校验（createVersion 专用）。失败返回具体 errorCode，成功返回 null。
 */
function validateStrategyInput(input: unknown): StrategyOpError | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  const s = input as Record<string, unknown>

  if (typeof s.strategyId !== 'string' || s.strategyId.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.strategyType !== 'string' || !STRATEGY_TYPES.includes(s.strategyType as StrategyType)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.jobCode !== 'string' || s.jobCode.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.strategyName !== 'string' || s.strategyName.length === 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.version !== 'number' || !Number.isInteger(s.version) || s.version < 1) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 计数字段
  if (!Number.isInteger(s.onlineQuestionCount) || (s.onlineQuestionCount as number) < 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (!Number.isInteger(s.offlineQuestionCount) || (s.offlineQuestionCount as number) < 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.maxScore !== 'number' || !Number.isFinite(s.maxScore) || s.maxScore <= 0) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 阈值
  const competent = s.competentThreshold
  const conditional = s.conditionalThreshold
  if (typeof competent !== 'number' || typeof conditional !== 'number') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (competent < 0 || competent > 100 || conditional < 0 || conditional > 100) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (competent <= conditional) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.moduleVetoThreshold !== 'number' || s.moduleVetoThreshold < 0 || s.moduleVetoThreshold > 1) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (!Number.isInteger(s.emotionCollapseThreshold) || (s.emotionCollapseThreshold as number) < 1) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // 布尔标志
  if (typeof s.supportsRedlineHalt !== 'boolean' || typeof s.allowsEmotionInterrupt !== 'boolean' || typeof s.requiresOfflineScoring !== 'boolean') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }
  if (typeof s.isActive !== 'boolean') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  // JSON 字段类型存在性（结构由 Step 1 validators 详细校验）
  if (typeof s.questionPolicy !== 'object' || s.questionPolicy === null || Array.isArray(s.questionPolicy)) {
    return { success: false, errorCode: 'INVALID_QUESTION_POLICY' }
  }
  if (typeof s.scoringPolicy !== 'object' || s.scoringPolicy === null || Array.isArray(s.scoringPolicy)) {
    return { success: false, errorCode: 'INVALID_SCORING_POLICY' }
  }

  return null
}

/**
 * strategy:createVersion 核心纯函数（ADMIN-only）。
 *
 * 分支：
 * - version===1 → 新建族：检查 (strategy_type, job_code) 无已存在族
 * - version>=2 → 新增版本：检查 strategy_id 族存在，且 strategyType/jobCode 与族一致，且 version > max(existing)
 *
 * 失败码：
 * - FORBIDDEN：非 ADMIN
 * - VALIDATION_ERROR / INVALID_QUESTION_POLICY / INVALID_SCORING_POLICY：字段或 JSON 校验
 * - DUPLICATE_JOB_STRATEGY：新建族时 (type, job) 已存在；或 UNIQUE(type,job,version) 冲突时 version===1
 * - NOT_FOUND：新增版本时族不存在
 * - STRATEGY_TYPE_MISMATCH / JOB_CODE_MISMATCH / DUPLICATE_VERSION：新增版本时族属性不一致
 * - DUPLICATE_STRATEGY_ID：PRIMARY KEY 冲突
 * - SYSTEM_ERROR：其它异常
 */
export function createVersion(
  db: DBAdapter,
  params: CreateStrategyVersionParams
): CreateStrategyVersionResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  // 写路径额外校验：仅 ADMIN
  if (caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }

  const inputErr = validateStrategyInput(params.strategy)
  if (inputErr) {
    return inputErr
  }
  const s = params.strategy

  // JSON 详细校验（Step 1 validators）
  const qp = validateQuestionPolicy(s.questionPolicy, {
    onlineQuestionCount: s.onlineQuestionCount,
    offlineQuestionCount: s.offlineQuestionCount
  })
  if (!qp.ok) {
    return { success: false, errorCode: 'INVALID_QUESTION_POLICY' }
  }
  const sp = validateScoringPolicy(s.scoringPolicy, {
    strategyCompetentThreshold: s.competentThreshold,
    strategyConditionalThreshold: s.conditionalThreshold
  })
  if (!sp.ok) {
    return { success: false, errorCode: 'INVALID_SCORING_POLICY' }
  }

  // 族分支
  if (s.version === 1) {
    const existing = db
      .prepare('SELECT 1 FROM strategy_config WHERE strategy_type = ? AND job_code = ? LIMIT 1')
      .get(s.strategyType, s.jobCode) as { 1: number } | undefined
    if (existing) {
      return { success: false, errorCode: 'DUPLICATE_JOB_STRATEGY' }
    }
    // 显式 strategy_id 存在检查（v0.1.9 复合 PK 下，PK 冲突错误消息不含
    // "PRIMARY KEY" 字样，无法靠 msg 匹配区分 PK 与 UNIQUE 冲突；前置检查更稳健）
    const existingSid = db
      .prepare('SELECT 1 FROM strategy_config WHERE strategy_id = ? LIMIT 1')
      .get(s.strategyId) as { 1: number } | undefined
    if (existingSid) {
      return { success: false, errorCode: 'DUPLICATE_STRATEGY_ID' }
    }
  } else {
    const family = db
      .prepare(
        `SELECT strategy_type, job_code, MAX(version) AS max_v
           FROM strategy_config
          WHERE strategy_id = ?
          GROUP BY strategy_type, job_code`
      )
      .get(s.strategyId) as { strategy_type: string; job_code: string; max_v: number } | undefined
    if (!family) {
      return { success: false, errorCode: 'NOT_FOUND' }
    }
    if (family.strategy_type !== s.strategyType) {
      return { success: false, errorCode: 'STRATEGY_TYPE_MISMATCH' }
    }
    if (family.job_code !== s.jobCode) {
      return { success: false, errorCode: 'JOB_CODE_MISMATCH' }
    }
    if (s.version <= family.max_v) {
      return { success: false, errorCode: 'DUPLICATE_VERSION' }
    }
  }

  // 事务 INSERT
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO strategy_config
           (strategy_id, strategy_type, job_code, strategy_name,
            online_question_count, offline_question_count, max_score,
            competent_threshold, conditional_threshold,
            module_veto_threshold, emotion_collapse_threshold,
            question_policy_json, scoring_policy_json,
            supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
            version, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        s.strategyId,
        s.strategyType,
        s.jobCode,
        s.strategyName,
        s.onlineQuestionCount,
        s.offlineQuestionCount,
        s.maxScore,
        s.competentThreshold,
        s.conditionalThreshold,
        s.moduleVetoThreshold,
        s.emotionCollapseThreshold,
        JSON.stringify(s.questionPolicy),
        JSON.stringify(s.scoringPolicy),
        s.supportsRedlineHalt ? 1 : 0,
        s.allowsEmotionInterrupt ? 1 : 0,
        s.requiresOfflineScoring ? 1 : 0,
        s.version,
        s.isActive ? 1 : 0
      )
    })
    tx()
  } catch (err) {
    const msg = String(err)
    if (msg.includes('UNIQUE')) {
      // 区分 PK(strategy_id, version) 冲突 vs UNIQUE(strategy_type, job_code, version) 冲突。
      // PK 冲突消息列 strategy_id + version；UNIQUE 约束消息额外含 strategy_type + job_code。
      // 前置检查已显式覆盖，此分支仅作并发 IPC 的 TOCTOU 兜底。
      if (msg.includes('strategy_type')) {
        return {
          success: false,
          errorCode: s.version === 1 ? 'DUPLICATE_JOB_STRATEGY' : 'DUPLICATE_VERSION'
        }
      }
      return { success: false, errorCode: 'DUPLICATE_STRATEGY_ID' }
    }
    logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', s.strategyId, s.version, caller.row.user_id, {
      operation: 'createVersion',
      error: msg
    })
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }

  logStrategyEvent(
    db,
    s.version === 1 ? 'STRATEGY_CONFIG_CREATED' : 'STRATEGY_CONFIG_VERSION_ADDED',
    'INFO',
    s.strategyId,
    s.version,
    caller.row.user_id,
    { strategyType: s.strategyType, jobCode: s.jobCode }
  )
  return { success: true }
}

// 字段白名单：键为 API 字段名（UpdateStrategyParams.patch），值为 DB 列名。
// [!] 安全要点：绝不能把 patch 的 key 直接拼入 SQL（注入风险）。
// strategyId / version / strategyType / jobCode 不在白名单（静默忽略，与 student.ts 一致）。
const UPDATE_FIELDS = {
  strategyName: 'strategy_name',
  onlineQuestionCount: 'online_question_count',
  offlineQuestionCount: 'offline_question_count',
  maxScore: 'max_score',
  competentThreshold: 'competent_threshold',
  conditionalThreshold: 'conditional_threshold',
  moduleVetoThreshold: 'module_veto_threshold',
  emotionCollapseThreshold: 'emotion_collapse_threshold',
  questionPolicy: 'question_policy_json',
  scoringPolicy: 'scoring_policy_json',
  supportsRedlineHalt: 'supports_redline_halt',
  allowsEmotionInterrupt: 'allows_emotion_interrupt',
  requiresOfflineScoring: 'requires_offline_scoring'
} as const
type UpdateKey = keyof typeof UPDATE_FIELDS

// 影响 scoring_policy_json 一致性的字段（改这些必须用合并后值重新校验 scoringPolicy）
const SCORING_REVALIDATE_KEYS: ReadonlySet<UpdateKey> = new Set([
  'competentThreshold',
  'conditionalThreshold',
  'moduleVetoThreshold',
  'emotionCollapseThreshold',
  'scoringPolicy'
])
// 影响 question_policy_json 一致性的字段
const QUESTION_REVALIDATE_KEYS: ReadonlySet<UpdateKey> = new Set([
  'onlineQuestionCount',
  'offlineQuestionCount',
  'questionPolicy'
])

/**
 * 引用检查：目标版本是否被任何 assessment_session 或 training_session 引用。
 * 镜像 schema 触发器 trg_strategy_config_referenced_version_semantic_immutable 的 WHEN 逻辑。
 */
function isStrategyReferenced(db: DBAdapter, strategyId: string, version: number): boolean {
  const row = db
    .prepare(
      `SELECT
         (EXISTS (SELECT 1 FROM assessment_session s
                   WHERE s.strategy_id = ? AND s.strategy_version = ?)
          OR EXISTS (SELECT 1 FROM training_session t
                      WHERE t.strategy_id = ? AND t.strategy_version = ?)) AS referenced`
    )
    .get(strategyId, version, strategyId, version) as { referenced: number } | undefined
  return row?.referenced === 1
}

/**
 * strategy:update 核心纯函数（ADMIN-only）。
 *
 * [!] 关键设计：patch 内任何影响 scoring_policy_json 一致性的字段都必须**组一起**
 * 重新校验。先 SELECT 完整 target 行，把 patch 叠加得到「合并后的逻辑策略」，
 * 再用合并值组 ctx 调 validateScoringPolicy，防止「只改表列不改 JSON level_rules min」
 * 导致表列与 level_rules 漂移。
 *
 * 失败码：
 * - FORBIDDEN：非 ADMIN
 * - NOT_FOUND：目标 (strategyId, version) 不存在
 * - INVALID_QUESTION_POLICY / INVALID_SCORING_POLICY：合并后 JSON 校验失败
 * - REFERENCED_IMMUTABLE：目标已被会话引用且 patch 含语义字段
 * - SYSTEM_ERROR：触发器 ABORT 或其它异常
 *
 * 空 patch（或只含非白名单字段）→ success，不写审计（无变更）。
 */
export function updateStrategy(db: DBAdapter, params: UpdateStrategyParams): UpdateStrategyResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.version !== 'number' || !Number.isInteger(params.version) || params.version < 1) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const target = db
    .prepare('SELECT * FROM strategy_config WHERE strategy_id = ? AND version = ?')
    .get(params.strategyId, params.version) as StrategyRow | undefined
  if (!target) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const patch = params.patch ?? {}
  const patchKeys = Object.keys(patch) as UpdateKey[]
  const whitelistedKeys = patchKeys.filter((k) => k in UPDATE_FIELDS)

  if (whitelistedKeys.length === 0) {
    // 空 patch 或只含非白名单字段 → 幂等 success，不写审计
    return { success: true }
  }

  // 构造「合并后的逻辑策略」用于重新校验
  const mergedQuestionCount =
    patchKeys.includes('onlineQuestionCount')
      ? (patch.onlineQuestionCount as number)
      : target.online_question_count
  const mergedOfflineCount =
    patchKeys.includes('offlineQuestionCount')
      ? (patch.offlineQuestionCount as number)
      : target.offline_question_count
  const mergedCompetent =
    patchKeys.includes('competentThreshold')
      ? (patch.competentThreshold as number)
      : target.competent_threshold
  const mergedConditional =
    patchKeys.includes('conditionalThreshold')
      ? (patch.conditionalThreshold as number)
      : target.conditional_threshold

  // scoring 一致性重新校验（合并值组 ctx）
  const touchesScoring = whitelistedKeys.some((k) => SCORING_REVALIDATE_KEYS.has(k))
  if (touchesScoring) {
    let mergedScoringPolicy: ScoringPolicyJson
    if (patchKeys.includes('scoringPolicy')) {
      mergedScoringPolicy = patch.scoringPolicy as ScoringPolicyJson
    } else {
      try {
        mergedScoringPolicy = JSON.parse(target.scoring_policy_json) as ScoringPolicyJson
      } catch (err) {
        logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', target.strategy_id, target.version, caller.row.user_id, {
          operation: 'update',
          error: `parse existing scoring_policy_json: ${String(err)}`
        })
        return { success: false, errorCode: 'SYSTEM_ERROR' }
      }
    }
    const sp = validateScoringPolicy(mergedScoringPolicy, {
      strategyCompetentThreshold: mergedCompetent,
      strategyConditionalThreshold: mergedConditional
    })
    if (!sp.ok) {
      return { success: false, errorCode: 'INVALID_SCORING_POLICY' }
    }
  }

  // question 一致性重新校验（合并值组 ctx）
  const touchesQuestion = whitelistedKeys.some((k) => QUESTION_REVALIDATE_KEYS.has(k))
  if (touchesQuestion) {
    let mergedQuestionPolicy: QuestionPolicyJson
    if (patchKeys.includes('questionPolicy')) {
      mergedQuestionPolicy = patch.questionPolicy as QuestionPolicyJson
    } else {
      try {
        mergedQuestionPolicy = JSON.parse(target.question_policy_json) as QuestionPolicyJson
      } catch (err) {
        logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', target.strategy_id, target.version, caller.row.user_id, {
          operation: 'update',
          error: `parse existing question_policy_json: ${String(err)}`
        })
        return { success: false, errorCode: 'SYSTEM_ERROR' }
      }
    }
    const qp = validateQuestionPolicy(mergedQuestionPolicy, {
      onlineQuestionCount: mergedQuestionCount,
      offlineQuestionCount: mergedOfflineCount
    })
    if (!qp.ok) {
      return { success: false, errorCode: 'INVALID_QUESTION_POLICY' }
    }
  }

  // 引用不可变检查（所有白名单字段都是语义字段 → 任一存在即触发）
  if (isStrategyReferenced(db, params.strategyId, params.version)) {
    logStrategyEvent(
      db,
      'STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT',
      'ERROR',
      params.strategyId,
      params.version,
      caller.row.user_id,
      { fields: whitelistedKeys }
    )
    return { success: false, errorCode: 'REFERENCED_IMMUTABLE' }
  }

  // 逐字段 UPDATE（字段名来自固定常量 UPDATE_FIELDS，不来自 patch 的 key）
  const applied: UpdateKey[] = []
  try {
    for (const key of whitelistedKeys) {
      let value: unknown = patch[key]

      // JSON 字段 stringify
      if (key === 'questionPolicy' || key === 'scoringPolicy') {
        value = JSON.stringify(value)
      }
      // 布尔 → 0/1
      if (
        key === 'supportsRedlineHalt' ||
        key === 'allowsEmotionInterrupt' ||
        key === 'requiresOfflineScoring'
      ) {
        value = value ? 1 : 0
      }

      db.prepare(
        `UPDATE strategy_config SET ${UPDATE_FIELDS[key]} = ?, updated_at = datetime('now')
          WHERE strategy_id = ? AND version = ?`
      ).run(value, params.strategyId, params.version)
      applied.push(key)
    }
  } catch (err) {
    const msg = String(err)
    // 触发器兜底：已被引用版本的语义字段 UPDATE 会 ABORT
    if (msg.includes('immutable') || msg.includes('referenced')) {
      logStrategyEvent(
        db,
        'STRATEGY_CONFIG_REFERENCED_IMMUTABLE_ATTEMPT',
        'ERROR',
        params.strategyId,
        params.version,
        caller.row.user_id,
        { fields: applied, triggerError: msg }
      )
      return { success: false, errorCode: 'REFERENCED_IMMUTABLE' }
    }
    logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', params.strategyId, params.version, caller.row.user_id, {
      operation: 'update',
      error: msg,
      appliedFields: applied
    })
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }

  logStrategyEvent(db, 'STRATEGY_CONFIG_UPDATED', 'INFO', params.strategyId, params.version, caller.row.user_id, {
    fields: applied
  })
  return { success: true }
}

/**
 * strategy:setActive 核心纯函数（ADMIN-only）。
 * schema 触发器 trg_strategy_config_referenced_version_semantic_immutable 白名单
 * 显式允许 is_active 变更——已引用版本也可切换启用状态（不影响历史可重现性）。
 */
export function setActive(db: DBAdapter, params: SetStrategyActiveParams): SetStrategyActiveResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (caller.row.role !== 'ADMIN') {
    return { success: false, errorCode: 'FORBIDDEN' }
  }
  if (typeof params.strategyId !== 'string' || params.strategyId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.version !== 'number' || !Number.isInteger(params.version) || params.version < 1) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  if (typeof params.isActive !== 'boolean') {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const target = db
    .prepare('SELECT 1 FROM strategy_config WHERE strategy_id = ? AND version = ?')
    .get(params.strategyId, params.version) as { 1: number } | undefined
  if (!target) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  try {
    db.prepare(
      `UPDATE strategy_config
          SET is_active = ?, updated_at = datetime('now')
        WHERE strategy_id = ? AND version = ?`
    ).run(params.isActive ? 1 : 0, params.strategyId, params.version)
  } catch (err) {
    logStrategyEvent(db, 'STRATEGY_CONFIG_SYSTEM_ERROR', 'ERROR', params.strategyId, params.version, caller.row.user_id, {
      operation: 'setActive',
      error: String(err)
    })
    return { success: false, errorCode: 'SYSTEM_ERROR' }
  }

  logStrategyEvent(db, 'STRATEGY_CONFIG_ACTIVE_TOGGLED', 'INFO', params.strategyId, params.version, caller.row.user_id, {
    isActive: params.isActive
  })
  return { success: true }
}

// 生产默认 getDb：用 SqliteAdapter 包装 better-sqlite3 singleton。
// Adapter 是无状态薄包装，不缓存（每次 IPC 新建一个，开销可忽略）。
function defaultGetDb(): DBAdapter {
  return new SqliteAdapter(getDatabase())
}

export function registerStrategyHandlers(getDb: () => DBAdapter = defaultGetDb): void {
  // 延迟到首次 IPC 调用时 seed。registerStrategyHandlers 由 import './ipc' 在模块
  // 加载阶段触发，早于 app.whenReady → initDatabase()，故注册时不能立即访问 DB
  //（否则 getDatabase 抛 "Not initialized"）。与 student.ts 同模式。
  let codesSeeded = false
  function ensureSeeded(): DBAdapter {
    const db = getDb()
    if (!codesSeeded) {
      seedStrategyErrorCodes(db)
      codesSeeded = true
    }
    return db
  }

  ipcMain.handle('strategy:list', (_e, params: StrategyListParams) => {
    return listStrategies(ensureSeeded(), params)
  })
  ipcMain.handle(
    'strategy:get',
    (_e, params: { callerUserId: string; callerRole: string; strategyId: string; version: number }) => {
      return getStrategy(ensureSeeded(), params)
    }
  )
  ipcMain.handle(
    'strategy:listVersions',
    (_e, params: { callerUserId: string; callerRole: string; strategyId: string }) => {
      return listVersions(ensureSeeded(), params)
    }
  )
  ipcMain.handle('strategy:createVersion', (_e, params: CreateStrategyVersionParams) => {
    return createVersion(ensureSeeded(), params)
  })
  ipcMain.handle('strategy:update', (_e, params: UpdateStrategyParams) => {
    return updateStrategy(ensureSeeded(), params)
  })
  ipcMain.handle('strategy:setActive', (_e, params: SetStrategyActiveParams) => {
    return setActive(ensureSeeded(), params)
  })
}
