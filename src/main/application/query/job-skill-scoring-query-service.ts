import type { DBAdapter } from '../../db/interface'
import { assertCaller, assertSessionOwner, assertStudent } from '../../utils/auth-context'
import type {
  GetJobSkillOfflineScoresParams,
  GetJobSkillOfflineScoresResult,
  GetSessionScoringQuestionsParams,
  GetSessionScoringQuestionsResult,
  JobSkillOfflineScoreView,
  SessionScoringQuestion
} from '../../../shared/types/job-skill-scoring'

type JsonObject = Record<string, unknown>
type ScoreAnchors = { '0': string; '1': string; '2': string }

function parseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {}
  } catch {
    return {}
  }
}

function objectAt(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function textAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function parseScoreAnchors(content: JsonObject, scoring: JsonObject): ScoreAnchors | null {
  const rubric = objectAt(content.rubric)
  const candidates = [rubric.anchors, scoring.anchors, scoring.score_anchors, scoring.score_labels]
  for (const candidate of candidates) {
    const record = objectAt(candidate)
    const zero = textAt(record['0'])
    const one = textAt(record['1'])
    const two = textAt(record['2'])
    if (zero && one && two) return { '0': zero, '1': one, '2': two }
  }

  const scoringCriteria = Array.isArray(scoring.criteria) ? scoring.criteria : []
  if (scoringCriteria.length > 0) {
    const build = (score: 0 | 1 | 2): string => scoringCriteria
      .map((raw) => objectAt(raw))
      .map((criterion) => textAt(criterion[`description_${score}`]) ?? textAt(criterion[`score_${score}`]))
      .filter((description): description is string => Boolean(description))
      .join('；')
    const anchors = { '0': build(0), '1': build(1), '2': build(2) }
    if (anchors['0'] && anchors['1'] && anchors['2']) return anchors
  }
  return null
}

function buildScoringQuestion(
  row: {
    question_id: string
    job_module_code: string
    question_type: string
    version: number
    content_json: string
    scoring_rule_json: string
  },
  includeTeacherFields: boolean
): SessionScoringQuestion {
  const content = parseObject(row.content_json)
  const scoring = parseObject(row.scoring_rule_json)
  const tools = objectAt(content.tools)
  const rubric = objectAt(content.rubric)
  const safety = objectAt(content.safety)
  const rawCriteria = Array.isArray(content.rubric_criteria)
    ? content.rubric_criteria
    : Array.isArray(rubric.criteria) ? rubric.criteria : []
  const scoreAnchors = parseScoreAnchors(content, scoring)

  return {
    questionId: row.question_id,
    jobModuleCode: row.job_module_code,
    questionVersion: row.version,
    questionType: row.question_type,
    prompt: textAt(content.prompt) ?? '',
    toolBrief: textAt(content.offline_tool_brief) ?? textAt(tools.brief),
    rubricCriteria: includeTeacherFields
      ? rawCriteria.map((raw) => objectAt(raw)).map((criterion) => ({
          criterionId: textAt(criterion.criterion_id) ?? '',
          description: textAt(criterion.description) ?? ''
        })).filter((criterion) => criterion.description.length > 0)
      : [],
    scoreAnchors: includeTeacherFields ? scoreAnchors : null,
    safetyStopConditions: textAt(safety.proposed_stop_conditions)
      ?? textAt(content.safety_stop_conditions)
      ?? textAt(objectAt(content.termination_policy).safety_stop_description),
    anchorVersion: `${row.question_id}@${row.version}`,
    sealedAdminConfig: includeTeacherFields
      ? objectAt(rubric.sealed_admin_config ?? content.sealed_admin_config)
      : null
  }
}

export function getJobSkillOfflineScores(
  db: DBAdapter,
  params: GetJobSkillOfflineScoresParams
): GetJobSkillOfflineScoresResult {
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
      `SELECT question_id, score, scoring_rubric_json, observation_note, scored_at
         FROM offline_score_record
        WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'
        ORDER BY rowid`
    )
    .all(params.sessionId) as Array<{
      question_id: string
      score: 0 | 1 | 2
      scoring_rubric_json: string | null
      observation_note: string | null
      scored_at: string
    }>

  const items: JobSkillOfflineScoreView[] = rows.map((row) => {
    const rubric = parseObject(row.scoring_rubric_json ?? '{}')
    return {
      questionId: row.question_id,
      score: row.score,
      anchorVersion: textAt(rubric.anchor_version),
      selectedAnchor: textAt(rubric.selected_anchor),
      observationNote: row.observation_note,
      scoredAt: row.scored_at
    }
  })

  return { success: true, items }
}

export function getSessionScoringQuestions(
  db: DBAdapter,
  params: GetSessionScoringQuestionsParams
): GetSessionScoringQuestionsResult {
  let includeTeacherFields = false
  if (params.callerRole === 'STUDENT') {
    const student = assertStudent(db, params.callerUserId, params.callerRole)
    if (!student.ok) return { success: false, errorCode: 'FORBIDDEN' }
    const owner = assertSessionOwner(db, student.row.user_id, params.sessionId)
    if (!owner.ok) return { success: false, errorCode: owner.errorCode }
  } else {
    const caller = assertCaller(db, params.callerUserId, params.callerRole)
    if (!caller.ok) return { success: false, errorCode: 'FORBIDDEN' }
    includeTeacherFields = true
  }

  if (typeof params.sessionId !== 'string' || params.sessionId.length === 0) {
    return { success: false, errorCode: 'NOT_FOUND' }
  }
  const sessionExists = db
    .prepare('SELECT 1 FROM assessment_session WHERE session_id = ?')
    .get(params.sessionId)
  if (!sessionExists) return { success: false, errorCode: 'NOT_FOUND' }

  const offlineRows = db
    .prepare(
      `SELECT sq.question_id, sq.job_module_code, sq.question_type,
              qb.version, qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_phase = 'OFFLINE' AND sq.item_usage = 'SCORED_ITEM'
        ORDER BY question_order`
    )
    .all(params.sessionId) as Array<{
      question_id: string
      job_module_code: string
      question_type: string
      version: number
      content_json: string
      scoring_rule_json: string
    }>

  const observationRows = db
    .prepare(
      `SELECT sq.question_id, sq.job_module_code, sq.question_type,
              qb.version, qb.content_json, qb.scoring_rule_json
         FROM assessment_session_question sq
         JOIN question_bank qb ON qb.question_id = sq.question_id
        WHERE sq.session_id = ? AND sq.question_phase = 'OBSERVATION'
        ORDER BY question_order`
    )
    .all(params.sessionId) as typeof offlineRows

  return {
    success: true,
    offlineQuestions: offlineRows.map((row) => buildScoringQuestion(row, includeTeacherFields)),
    observationQuestions: observationRows.map((row) => buildScoringQuestion(row, includeTeacherFields))
  }
}
