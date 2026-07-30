import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import type {
  GetOperationScoresParams,
  GetOperationScoresResult,
  OperationScoreItem,
  TaskOperationCode
} from '../../../shared/types/operation-scoring'

export function getOperationScores(
  db: DBAdapter,
  params: GetOperationScoresParams
): GetOperationScoresResult {
  const caller = assertCaller(db, params.callerUserId, params.callerRole)
  if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }

  const sessionExists = db
    .prepare('SELECT 1 FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId)
  if (!sessionExists) return { success: false, errorCode: 'NOT_FOUND' }

  const rows = db
    .prepare(
      `SELECT task_operation_code, score, observation_note, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TASK_OPERATION' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as Array<{
      task_operation_code: string
      score: 0 | 1 | 2
      observation_note: string | null
      scored_at: string
    }>

  const items: OperationScoreItem[] = rows.map((row) => ({
    taskOperationCode: row.task_operation_code as TaskOperationCode,
    score: row.score,
    observationNote: row.observation_note,
    scoredAt: row.scored_at
  }))

  const result = db
    .prepare(
      `SELECT result_id, normalized_score, level_result
         FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE' AND is_current = 1
        LIMIT 1`
    )
    .get(params.sessionId) as
    | { result_id: string; normalized_score: number; level_result: string }
    | undefined

  return {
    success: true,
    items,
    resultId: result?.result_id,
    normalizedScore: result?.normalized_score,
    levelResult: result?.level_result
  }
}
