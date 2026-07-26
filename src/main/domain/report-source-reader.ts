import type { DBAdapter } from '../db/interface'
import type {
  AbilityResultSnapshot,
  OperationPassRateResultSnapshot,
  TaskResultSnapshot,
  TrainingCompletionResultSnapshot
} from '@shared/types/json-schemas'

type BaseResultType = 'ABILITY_SCORE' | 'TRAINING_COMPLETION' | 'OPERATION_PASS_RATE'

const BASE_RESULT_ORDER: readonly BaseResultType[] = [
  'ABILITY_SCORE',
  'TRAINING_COMPLETION',
  'OPERATION_PASS_RATE'
]

type ResultRow = {
  result_id: string
  student_id: string
  result_type: BaseResultType | 'JOB_SKILL_SCORE'
  source_aggregate_type: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION'
  source_aggregate_id: string
  strategy_id: string | null
  strategy_type: string | null
  job_code: string
  raw_score: number | null
  max_score: number | null
  normalized_score: number
  completion_ratio: number | null
  level_result: string
  safety_overridden: number
  redline_incident_id: string | null
  result_payload_json: string | null
  generated_at: string
  is_current: number
  task_code: string
  source_status: string
  source_started_at: string | null
  source_completed_at: string | null
  total_step_count?: number
  completed_step_count?: number
}

export type BaseTaskResultSnapshots = [
  AbilityResultSnapshot,
  TrainingCompletionResultSnapshot,
  OperationPassRateResultSnapshot
]

export interface BaseTaskResultBinding {
  studentId: string
  jobCode: string
  taskCode: string
  sourceResultIds: [string, string, string]
  snapshots: BaseTaskResultSnapshots
}

export class ReportSourceReaderError extends Error {
  constructor(
    public readonly code:
      | 'MISSING_RESULT'
      | 'INVALID_RESULT_SET'
      | 'BUSINESS_KEY_MISMATCH'
      | 'SOURCE_NOT_TERMINAL'
      | 'SOURCE_REDLINE'
      | 'RESULT_NOT_CURRENT'
      | 'SNAPSHOT_DETAILS_MISSING',
    message: string
  ) {
    super(message)
    this.name = 'ReportSourceReaderError'
  }
}

export function fixedBaseResultIdsByType(input: readonly string[]): [string, string, string] {
  if (input.length !== 3) {
    throw new ReportSourceReaderError('INVALID_RESULT_SET', 'BASE task closure requires exactly three result IDs')
  }
  const seen = new Set(input)
  if (seen.size !== input.length) {
    throw new ReportSourceReaderError('INVALID_RESULT_SET', 'BASE task closure result IDs must be unique')
  }
  return input as [string, string, string]
}

export function readBaseTaskResultBinding(
  db: DBAdapter,
  resultIds: readonly string[],
  options: { allowHistoricalResultIds?: ReadonlySet<string> } = {}
): BaseTaskResultBinding {
  fixedBaseResultIdsByType(resultIds)
  const rows = resultIds.map((resultId) => readResultRow(db, resultId))
  const byType = new Map<BaseResultType, ResultRow>()

  for (const row of rows) {
    if (!BASE_RESULT_ORDER.includes(row.result_type as BaseResultType)) {
      throw new ReportSourceReaderError('INVALID_RESULT_SET', `Unsupported BASE result type: ${row.result_type}`)
    }
    const resultType = row.result_type as BaseResultType
    if (byType.has(resultType)) {
      throw new ReportSourceReaderError('INVALID_RESULT_SET', `Duplicate BASE result type: ${resultType}`)
    }
    byType.set(resultType, row)
  }

  const ordered = BASE_RESULT_ORDER.map((resultType) => {
    const row = byType.get(resultType)
    if (!row) throw new ReportSourceReaderError('INVALID_RESULT_SET', `Missing BASE result type: ${resultType}`)
    return row
  }) as [ResultRow, ResultRow, ResultRow]

  const first = ordered[0]
  for (const row of ordered) {
    if (row.student_id !== first.student_id || row.job_code !== first.job_code || row.task_code !== first.task_code) {
      throw new ReportSourceReaderError('BUSINESS_KEY_MISMATCH', 'BASE result business keys do not match')
    }
    if (!isTerminalSource(row)) {
      throw new ReportSourceReaderError('SOURCE_NOT_TERMINAL', `Result ${row.result_id} source is not terminal`)
    }
    if (row.safety_overridden === 1 || row.redline_incident_id !== null || row.source_status === 'REDLINE_HALTED') {
      throw new ReportSourceReaderError('SOURCE_REDLINE', `Result ${row.result_id} is safety-overridden or redline-bound`)
    }
    if (row.is_current !== 1 && !options.allowHistoricalResultIds?.has(row.result_id)) {
      throw new ReportSourceReaderError('RESULT_NOT_CURRENT', `Result ${row.result_id} is not current`)
    }
  }

  const snapshots = [
    toAbilitySnapshot(ordered[0]),
    toTrainingSnapshot(ordered[1]),
    toOperationSnapshot(ordered[2])
  ] satisfies BaseTaskResultSnapshots

  return {
    studentId: first.student_id,
    jobCode: first.job_code,
    taskCode: first.task_code,
    sourceResultIds: snapshots.map((snapshot) => snapshot.result_id) as [string, string, string],
    snapshots
  }
}

function readResultRow(db: DBAdapter, resultId: string): ResultRow {
  const row = db.prepare(
    `SELECT r.result_id, r.student_id, r.result_type, r.source_aggregate_type, r.source_aggregate_id,
            r.strategy_id, r.strategy_type, r.job_code, r.raw_score, r.max_score, r.normalized_score,
            r.completion_ratio, r.level_result, r.safety_overridden, r.redline_incident_id,
            r.result_payload_json, r.generated_at, r.is_current,
            COALESCE(a.task_code, t.task_code) AS task_code,
            COALESCE(a.status, t.status) AS source_status,
            COALESCE(a.started_at, t.started_at) AS source_started_at,
            COALESCE(a.completed_at, t.completed_at) AS source_completed_at,
            t.total_step_count,
            t.completed_step_count
       FROM result_record r
       LEFT JOIN assessment_session a
         ON r.source_aggregate_type = 'ASSESSMENT_SESSION'
        AND a.session_id = r.source_aggregate_id
       LEFT JOIN training_session t
         ON r.source_aggregate_type = 'TRAINING_SESSION'
        AND t.training_session_id = r.source_aggregate_id
      WHERE r.result_id = ?`
  ).get(resultId) as ResultRow | undefined

  if (!row || !row.task_code || !row.source_status) {
    throw new ReportSourceReaderError('MISSING_RESULT', `Result ${resultId} does not exist or has no source session`)
  }
  return row
}

function isTerminalSource(row: ResultRow): boolean {
  return row.source_status === 'COMPLETED'
}

function parseDetails(row: ResultRow): Record<string, unknown> {
  if (!row.result_payload_json) {
    throw new ReportSourceReaderError('SNAPSHOT_DETAILS_MISSING', `Result ${row.result_id} has no payload details`)
  }
  try {
    const parsed = JSON.parse(row.result_payload_json) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch {
    throw new ReportSourceReaderError('SNAPSHOT_DETAILS_MISSING', `Result ${row.result_id} payload details are invalid JSON`)
  }
}

function baseSnapshot(row: ResultRow): Omit<TaskResultSnapshot, 'details'> {
  return {
    result_id: row.result_id,
    result_type: row.result_type as BaseResultType,
    source_aggregate_type: row.source_aggregate_type,
    source_aggregate_id: row.source_aggregate_id,
    generated_at: row.generated_at,
    strategy_id: row.strategy_id,
    strategy_type: row.strategy_type as TaskResultSnapshot['strategy_type'],
    raw_score: row.raw_score,
    max_score: row.max_score,
    normalized_score: row.normalized_score,
    completion_ratio: row.completion_ratio,
    level_result: row.level_result,
    safety_overridden: row.safety_overridden === 1,
    redline_incident_id: row.redline_incident_id,
    source_started_at: row.source_started_at,
    source_completed_at: row.source_completed_at
  }
}

function toAbilitySnapshot(row: ResultRow): AbilityResultSnapshot {
  return {
    ...baseSnapshot(row),
    result_type: 'ABILITY_SCORE',
    source_aggregate_type: 'ASSESSMENT_SESSION',
    details: parseDetails(row) as unknown as AbilityResultSnapshot['details']
  }
}

function toTrainingSnapshot(row: ResultRow): TrainingCompletionResultSnapshot {
  return {
    ...baseSnapshot(row),
    result_type: 'TRAINING_COMPLETION',
    source_aggregate_type: 'TRAINING_SESSION',
    details: {
      total_steps: row.total_step_count ?? 0,
      completed_steps: row.completed_step_count ?? 0,
      skipped_steps: Math.max((row.total_step_count ?? 0) - (row.completed_step_count ?? 0), 0),
      failed_steps: 0,
      completion_rate: row.normalized_score,
      completed_at: row.source_completed_at ?? row.generated_at
    }
  }
}

function toOperationSnapshot(row: ResultRow): OperationPassRateResultSnapshot {
  const details = parseDetails(row)
  return {
    ...baseSnapshot(row),
    result_type: 'OPERATION_PASS_RATE',
    source_aggregate_type: 'ASSESSMENT_SESSION',
    details: {
      ...details,
      scored_at: typeof details.scored_at === 'string' ? details.scored_at : row.generated_at
    } as OperationPassRateResultSnapshot['details']
  }
}
