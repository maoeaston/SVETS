// BASE_ABILITY result calculation. Read-only domain logic: no event writes here.

import type { DBAdapter } from '../db/interface'
import type { AbilityTag } from '../../shared/types/json-schemas'
import type { AbilityScorePayload, ModuleScore } from '@shared/types/event-payloads'
import { judgeLevel, type ModuleScoreInput } from './level-judge'

const ABILITY_MODULES: AbilityTag[] = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

const ONLINE_MODULE_MAX_SCORE = 14
const ABILITY_MAX_SCORE = 100

export interface AbilityScoreCalculationInput {
  sessionId: string
  strategyId: string
  strategyVersion: number
  safetyTriggered: boolean
}

export interface OfflineAbilityScoringCompletion {
  totalRequired: number
  totalScored: number
  isComplete: boolean
}

export interface AbilityScoreCalculation {
  payload: AbilityScorePayload
  moduleScores: ModuleScoreInput[]
  rawScore: number
  maxScore: number
  normalizedScore: number
  levelResult: 'LEVEL_COMPETENT' | 'LEVEL_CONDITIONAL' | 'LEVEL_NOT_COMPETENT' | 'LEVEL_FAIL_BY_SAFETY'
  completionRatio: number
  onlineRawScore: number
  offlineRawScore: number
  questionCount: number
  answeredCount: number
  offlineCompletion: OfflineAbilityScoringCompletion
}

interface StrategyThresholdRow {
  module_veto_threshold: number
  emotion_collapse_threshold: number
  competent_threshold: number
  conditional_threshold: number
}

interface SessionCountRow {
  online_question_count: number
  offline_question_count: number
}

interface OnlineScoreRow {
  module_type: AbilityTag
  score: number
}

interface OfflineScoreRow {
  score: number
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function readStrategyThresholds(
  db: DBAdapter,
  strategyId: string,
  strategyVersion: number
): StrategyThresholdRow {
  const row = db
    .prepare(
      `SELECT module_veto_threshold, emotion_collapse_threshold,
              competent_threshold, conditional_threshold
         FROM strategy_config
        WHERE strategy_id = ? AND version = ?`
    )
    .get(strategyId, strategyVersion) as StrategyThresholdRow | undefined
  if (!row) {
    throw new Error(`calculateAbilityScore: strategy_config missing (${strategyId} v${strategyVersion})`)
  }
  return row
}

function readSessionCounts(db: DBAdapter, sessionId: string): SessionCountRow {
  const row = db
    .prepare(
      `SELECT online_question_count, offline_question_count
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as SessionCountRow | undefined
  if (!row) throw new Error(`calculateAbilityScore: session ${sessionId} missing`)
  return row
}

function readOnlineScores(db: DBAdapter, sessionId: string): OnlineScoreRow[] {
  const rows = db
    .prepare(
      `SELECT sq.module_type, ar.score
         FROM assessment_session_question sq
         JOIN answer_record ar
           ON ar.session_id = sq.session_id
          AND ar.question_id = sq.question_id
          AND ar.status = 'VALID'
          AND ar.score IS NOT NULL
        WHERE sq.session_id = ?
          AND sq.bank_domain = 'BASE_ABILITY'
          AND sq.question_phase = 'ONLINE'
          AND sq.item_usage = 'SCORED_ITEM'`
    )
    .all(sessionId) as OnlineScoreRow[]

  for (const row of rows) {
    if (row.score !== 0 && row.score !== 2) {
      throw new Error(`calculateAbilityScore: invalid online BASE_ABILITY score ${row.score}`)
    }
  }
  return rows
}

function readOfflineAbilityScores(db: DBAdapter, sessionId: string): OfflineScoreRow[] {
  const rows = db
    .prepare(
      `SELECT os.score
         FROM offline_score_record os
         JOIN assessment_session_question sq
           ON sq.session_id = os.session_id
          AND sq.question_id = os.question_id
        WHERE os.session_id = ?
          AND os.score_scope = 'OFFLINE_ABILITY'
          AND os.status = 'VALID'
          AND os.score IS NOT NULL
          AND sq.bank_domain = 'BASE_ABILITY'
          AND sq.question_phase = 'OFFLINE'
          AND sq.item_usage = 'SCORED_ITEM'`
    )
    .all(sessionId) as OfflineScoreRow[]

  for (const row of rows) {
    if (row.score !== 0 && row.score !== 1 && row.score !== 2) {
      throw new Error(`calculateAbilityScore: invalid OFFLINE_ABILITY score ${row.score}`)
    }
  }
  return rows
}

function countActiveEmotionCollapses(db: DBAdapter, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN event_type = 'EMOTION_INTERRUPTED' THEN 1 ELSE 0 END) AS interrupted,
         SUM(CASE WHEN event_type = 'EMOTION_RESUMED' THEN 1 ELSE 0 END) AS resumed
       FROM domain_event_projection
       WHERE aggregate_id = ?
         AND aggregate_type = 'ASSESSMENT_SESSION'
         AND event_type IN ('EMOTION_INTERRUPTED', 'EMOTION_RESUMED')`
    )
    .get(sessionId) as { interrupted: number | null; resumed: number | null } | undefined
  return Math.max(0, (row?.interrupted ?? 0) - (row?.resumed ?? 0))
}

export function readOfflineAbilityScoringCompletion(
  db: DBAdapter,
  sessionId: string
): OfflineAbilityScoringCompletion {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*)
            FROM assessment_session_question
           WHERE session_id = ?
             AND bank_domain = 'BASE_ABILITY'
             AND question_phase = 'OFFLINE'
             AND item_usage = 'SCORED_ITEM') AS totalRequired,
         (SELECT COUNT(*)
            FROM offline_score_record os
            JOIN assessment_session_question sq
              ON sq.session_id = os.session_id
             AND sq.question_id = os.question_id
           WHERE os.session_id = ?
             AND os.score_scope = 'OFFLINE_ABILITY'
             AND os.status = 'VALID'
             AND os.score IS NOT NULL
             AND sq.bank_domain = 'BASE_ABILITY'
             AND sq.question_phase = 'OFFLINE'
             AND sq.item_usage = 'SCORED_ITEM') AS totalScored`
    )
    .get(sessionId, sessionId) as { totalRequired: number; totalScored: number } | undefined

  const totalRequired = row?.totalRequired ?? 0
  const totalScored = row?.totalScored ?? 0
  return {
    totalRequired,
    totalScored,
    isComplete: totalRequired > 0 && totalScored === totalRequired
  }
}

export function calculateAbilityScore(
  db: DBAdapter,
  input: AbilityScoreCalculationInput
): AbilityScoreCalculation {
  const strategy = readStrategyThresholds(db, input.strategyId, input.strategyVersion)
  const sessionCounts = readSessionCounts(db, input.sessionId)
  const onlineScores = readOnlineScores(db, input.sessionId)
  const offlineScores = readOfflineAbilityScores(db, input.sessionId)
  const offlineCompletion = readOfflineAbilityScoringCompletion(db, input.sessionId)

  const rawByModule = new Map<AbilityTag, number>()
  for (const tag of ABILITY_MODULES) rawByModule.set(tag, 0)
  for (const row of onlineScores) {
    rawByModule.set(row.module_type, (rawByModule.get(row.module_type) ?? 0) + row.score)
  }

  const moduleScores: ModuleScoreInput[] = ABILITY_MODULES.map((module) => ({
    module,
    raw: rawByModule.get(module) ?? 0,
    max: ONLINE_MODULE_MAX_SCORE
  }))
  const modulePayload: ModuleScore[] = moduleScores.map((score) => ({
    module_type: score.module,
    raw_score: score.raw,
    max_score: score.max,
    normalized_score: score.max > 0 ? (score.raw / score.max) * 100 : 0
  }))

  const onlineRawScore = onlineScores.reduce((sum, row) => sum + row.score, 0)
  const offlineRawScore = offlineScores.reduce((sum, row) => sum + row.score, 0)
  const rawScore = onlineRawScore + offlineRawScore
  const maxScore = ABILITY_MAX_SCORE
  const normalizedScore = clampScore((rawScore / maxScore) * 100)
  const questionCount = sessionCounts.online_question_count + sessionCounts.offline_question_count
  const answeredCount = onlineScores.length + offlineScores.length
  const completionRatio = questionCount > 0 ? answeredCount / questionCount : 0
  const emotionCollapseCount = countActiveEmotionCollapses(db, input.sessionId)

  const judge = judgeLevel({
    moduleScores,
    emotionCollapseCount,
    emotionCollapseThreshold: strategy.emotion_collapse_threshold,
    moduleVetoThreshold: strategy.module_veto_threshold,
    competentThreshold: strategy.competent_threshold,
    conditionalThreshold: strategy.conditional_threshold,
    safetyTriggered: input.safetyTriggered,
    normalizedScoreOverride: normalizedScore
  })

  const payload: AbilityScorePayload = {
    result_type: 'ABILITY_SCORE',
    module_scores: modulePayload,
    online_raw_score: onlineRawScore,
    offline_raw_score: offlineRawScore,
    question_count: questionCount,
    answered_count: answeredCount,
    completion_ratio: completionRatio,
    emotion_collapse_count: emotionCollapseCount,
    module_veto_triggered_by: judge.moduleVetoTriggeredBy,
    level_forced_by: judge.levelForcedBy
  }

  return {
    payload,
    moduleScores,
    rawScore,
    maxScore,
    normalizedScore,
    levelResult: judge.levelResult,
    completionRatio,
    onlineRawScore,
    offlineRawScore,
    questionCount,
    answeredCount,
    offlineCompletion
  }
}
