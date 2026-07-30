import type { DBAdapter } from '../../db/interface'
import { assertCaller } from '../../utils/auth-context'
import type { TeacherObservationPayload } from '@shared/types/json-schemas'
import type {
  GetTeacherObservationsParams,
  GetTeacherObservationsResult,
  TeacherObservationRecord
} from '@shared/types/teacher-observation'

export function getTeacherObservations(
  db: DBAdapter,
  params: GetTeacherObservationsParams
): GetTeacherObservationsResult {
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
      `SELECT question_id, offline_score_id, observation_payload_json, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as Array<{
      question_id: string
      offline_score_id: string
      observation_payload_json: string
      scored_at: string
    }>

  const records: TeacherObservationRecord[] = rows.map((row) => ({
    questionId: row.question_id,
    offlineScoreId: row.offline_score_id,
    observationPayload: JSON.parse(row.observation_payload_json) as TeacherObservationPayload,
    recordedAt: row.scored_at
  }))

  return { success: true, records }
}
