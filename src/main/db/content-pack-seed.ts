import type { DBAdapter } from './interface'
import pilotStrategy from '../../../doc/features/job-skill-shelver-pilot-revision-candidates-v3.json'

export type QuestionBankDomain = 'BASE_ABILITY' | 'JOB_SPECIFIC'

export interface BundledQuestionContract {
  domain: QuestionBankDomain
  expectedCount: number
  sql: string
}

export interface QuestionDomainSeedResult {
  domain: QuestionBankDomain
  seeded: boolean
  count: number
}

export interface JobSkillDemoActivationResult {
  ready: boolean
  activeCount: number
  reason: string | null
}

interface CountRow { count: number }
interface StrategyRow { question_policy_json: string; version: number }
interface QuestionRow {
  question_id: string
  bank_domain: string
  job_module_code: string | null
  question_type: string
  item_usage: string
  status: string
}

const DEMO_STRATEGY_ID = 'strategy_job_skill_shelver_v1'

export function prepareBundledQuestionSql(source: string): string {
  const withoutTransactionOrDomainDelete = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT);\s*$/i.test(line))
    .filter((line) => !/^\s*DELETE\s+FROM\s+question_bank\s+WHERE\s+bank_domain\s*=\s*'[^']+'\s*;\s*$/i.test(line))
    .join('\n')
  if (/\b(?:DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE)\b/i.test(withoutTransactionOrDomainDelete)) {
    throw new Error('bundled question SQL contains a destructive statement')
  }
  return withoutTransactionOrDomainDelete.replaceAll(
    'INSERT INTO domain_event_projection',
    'INSERT OR IGNORE INTO domain_event_projection'
  )
}

export function seedBundledQuestionContent(
  db: DBAdapter,
  contracts: readonly BundledQuestionContract[]
): { domains: readonly QuestionDomainSeedResult[]; jobSkillDemo: JobSkillDemoActivationResult } {
  const results: QuestionDomainSeedResult[] = []
  const failures: Error[] = []

  for (const contract of contracts) {
    try {
      const result = db.transaction(() => {
        const before = questionCount(db, contract.domain)
        if (before > 0) return { domain: contract.domain, seeded: false, count: before }
        db.exec(prepareBundledQuestionSql(contract.sql))
        const after = questionCount(db, contract.domain)
        if (after !== contract.expectedCount) {
          throw new Error(`${contract.domain} content count ${after} != ${contract.expectedCount}`)
        }
        return { domain: contract.domain, seeded: true, count: after }
      })()
      results.push(result)
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'one or more bundled question domains failed to seed')
  }

  const jobSkillDemo = db.transaction(() => activateFixedJobSkillDemoQuestions(db))()
  return { domains: Object.freeze(results), jobSkillDemo }
}

export function activateFixedJobSkillDemoQuestions(db: DBAdapter): JobSkillDemoActivationResult {
  const candidate = pilotStrategy.strategy_candidate
  db.prepare(
    `INSERT OR IGNORE INTO strategy_config (
       strategy_id, strategy_type, job_code, strategy_name,
       online_question_count, offline_question_count, max_score,
       competent_threshold, conditional_threshold, module_veto_threshold,
       emotion_collapse_threshold, question_policy_json, scoring_policy_json,
       supports_redline_halt, allows_emotion_interrupt, requires_offline_scoring,
       version, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    candidate.strategy_id,
    candidate.strategy_type,
    candidate.job_code,
    candidate.strategy_name,
    candidate.online_question_count,
    candidate.offline_question_count,
    candidate.max_score,
    candidate.competent_threshold,
    candidate.conditional_threshold,
    candidate.module_veto_threshold,
    JSON.stringify(candidate.question_policy),
    JSON.stringify(candidate.scoring_policy),
    candidate.supports_redline_halt ? 1 : 0,
    candidate.allows_emotion_interrupt ? 1 : 0,
    candidate.requires_offline_scoring ? 1 : 0,
    candidate.strategy_version
  )
  const strategy = db.prepare(
    `SELECT question_policy_json, version
       FROM strategy_config
      WHERE strategy_id = ? AND version = ?`
  ).get(DEMO_STRATEGY_ID, candidate.strategy_version) as StrategyRow | undefined
  if (!strategy) return { ready: false, activeCount: 0, reason: 'JOB_SKILL_STRATEGY_MISSING' }

  let policy: unknown
  try {
    policy = JSON.parse(strategy.question_policy_json)
  } catch {
    return { ready: false, activeCount: 0, reason: 'JOB_SKILL_POLICY_INVALID' }
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { ready: false, activeCount: 0, reason: 'JOB_SKILL_POLICY_INVALID' }
  }
  const ids = (policy as Record<string, unknown>).fixed_scored_question_ids
  if (
    !Array.isArray(ids)
    || ids.length !== 24
    || ids.some((id) => typeof id !== 'string' || !id)
    || new Set(ids).size !== 24
  ) return { ready: false, activeCount: 0, reason: 'JOB_SKILL_FIXED_SET_INVALID' }

  const placeholders = ids.map(() => '?').join(', ')
  const rows = db.prepare(
    `SELECT question_id, bank_domain, job_module_code, question_type, item_usage, status
       FROM question_bank
      WHERE question_id IN (${placeholders})`
  ).all(...ids) as unknown as QuestionRow[]
  if (rows.length !== 24) return { ready: false, activeCount: 0, reason: 'JOB_SKILL_FIXED_SET_MISSING' }
  if (rows.some((row) =>
    row.bank_domain !== 'JOB_SPECIFIC'
    || row.item_usage !== 'SCORED_ITEM'
    || !row.job_module_code
    || !['DRAFT', 'ACTIVE'].includes(row.status)
  )) return { ready: false, activeCount: 0, reason: 'JOB_SKILL_FIXED_SET_UNAVAILABLE' }

  for (const moduleCode of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']) {
    const moduleRows = rows.filter((row) => row.job_module_code === moduleCode)
    const online = moduleRows.filter((row) => row.question_type !== 'OFFLINE_OPERATION').length
    const offline = moduleRows.filter((row) => row.question_type === 'OFFLINE_OPERATION').length
    if (online !== 3 || offline !== 1) {
      return { ready: false, activeCount: 0, reason: 'JOB_SKILL_FIXED_SET_QUOTA_INVALID' }
    }
  }

  db.prepare(
    `UPDATE strategy_config
        SET is_active = CASE WHEN version = ? THEN 1 ELSE 0 END,
            updated_at = datetime('now')
      WHERE strategy_id = ?`
  ).run(strategy.version, DEMO_STRATEGY_ID)
  db.prepare(
    `UPDATE question_bank
        SET status = 'ACTIVE', updated_at = datetime('now')
      WHERE status = 'DRAFT' AND question_id IN (${placeholders})`
  ).run(...ids)
  const activeCount = (db.prepare(
    `SELECT COUNT(*) AS count
       FROM question_bank
      WHERE status = 'ACTIVE' AND question_id IN (${placeholders})`
  ).get(...ids) as CountRow).count
  return {
    ready: activeCount === 24,
    activeCount,
    reason: activeCount === 24 ? null : 'JOB_SKILL_FIXED_SET_NOT_ACTIVE'
  }
}

function questionCount(db: DBAdapter, domain: QuestionBankDomain): number {
  return (db.prepare(
    'SELECT COUNT(*) AS count FROM question_bank WHERE bank_domain = ?'
  ).get(domain) as CountRow).count
}
