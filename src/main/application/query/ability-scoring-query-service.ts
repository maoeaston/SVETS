import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import type {
  AbilityOfflineScoreView,
  GetOfflineAbilityScoresParams,
  GetOfflineAbilityScoresResult
} from '../../../shared/types/ability-scoring'

interface AbilitySessionRow {
  session_id: string
  strategy_type: string
}

const ABILITY_STRATEGY_TYPES = new Set<string>(['BASELINE_ASSESSMENT', 'MOCK_EXAM'])

function readAbilitySession(db: DBAdapter, sessionId: unknown): AbilitySessionRow | null {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  return (db
    .prepare(
      `SELECT session_id, strategy_type
         FROM assessment_session
        WHERE session_id = ?`
    )
    .get(sessionId) as AbilitySessionRow | undefined) ?? null
}

function countRequiredOfflineAbilityQuestions(db: DBAdapter, sessionId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM assessment_session_question
        WHERE session_id = ?
          AND bank_domain = 'BASE_ABILITY'
          AND question_phase = 'OFFLINE'
          AND item_usage = 'SCORED_ITEM'`
    )
    .get(sessionId) as { total: number } | undefined
  return row?.total ?? 0
}

function readScoreRows(db: DBAdapter, sessionId: string): AbilityOfflineScoreView[] {
  const rows = db
    .prepare(
      `SELECT question_id, score, scoring_rubric_json, observation_note,
              tool_checklist_confirmed, scored_at
         FROM offline_score_record
        WHERE session_id = ?
          AND score_scope = 'OFFLINE_ABILITY'
          AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(sessionId) as Array<{
      question_id: string
      score: 0 | 1 | 2
      scoring_rubric_json: string
      observation_note: string | null
      tool_checklist_confirmed: number
      scored_at: string
    }>

  return rows.map((row) => ({
    questionId: row.question_id,
    score: row.score,
    scoringRubricJson: row.scoring_rubric_json,
    observationNote: row.observation_note,
    toolChecklistConfirmed: row.tool_checklist_confirmed === 1,
    scoredAt: row.scored_at
  }))
}

export function getOfflineAbilityScores(
  db: DBAdapter,
  params: GetOfflineAbilityScoresParams
): GetOfflineAbilityScoresResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  const session = readAbilitySession(db, params.sessionId)
  if (!session) return { success: false, errorCode: 'NOT_FOUND' }
  if (!ABILITY_STRATEGY_TYPES.has(session.strategy_type)) {
    return { success: false, errorCode: 'VALIDATION_ERROR' }
  }

  const totalRequired = countRequiredOfflineAbilityQuestions(db, session.session_id)
  const items = readScoreRows(db, session.session_id)
  return {
    success: true,
    items,
    totalScored: items.length,
    totalRequired,
    isComplete: totalRequired > 0 && items.length === totalRequired
  }
}
