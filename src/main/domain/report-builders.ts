import type { DBAdapter } from '../db/interface'
import { sha256CanonicalJson } from './report-canonical'
import { parseF7EventPayload, parseReportContent } from './report-contract'
import type {
  BaseReportSourceMeta,
  JobModuleCode,
  JobSkillResultPayload,
  JobSkillResultSnapshot,
  PromptLevel,
  ReportAssetReference,
  ReportContentBaseAbility,
  ReportContentJson,
  ReportContentSafetyTermination,
  ReportSittingSnapshot,
  ResponseStatus,
  SafetyBindingMetadata,
  SafetySourceScope,
  TaskResultSnapshot,
  TeacherObservationPayload,
  ValidatedReportContentJobSkill
} from '@shared/types/json-schemas'
import type { TaskClosureConfirmedPayload, TaskClosureReplacedPayload } from '@shared/types/event-payloads'

export const BASE_REPORT_BUILDER_VERSION = 'base-report-builder-v1.0'
export const JOB_REPORT_BUILDER_VERSION = 'job-skill-report-builder-v1.0'
export const SAFETY_REPORT_BUILDER_VERSION = 'safety-report-builder-v1.0'

const JOB_MODULE_CODES: readonly JobModuleCode[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
const MODULE_NAMES: Record<JobModuleCode, string> = {
  M1: '货架整理与价签核对',
  M2: '拆箱补货与先进先出',
  M3: '临期破损商品分拣',
  M4: '库房收纳与简易盘点',
  M5: '突发情况应对',
  M6: '商品识别与分类'
}

type ReportScope = 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'

interface ClosureRow {
  task_closure_id: string
  student_id: string
  job_code: string
  task_code: string
  cycle_no: number
  closure_revision: number
  status: 'CONFIRMED' | 'SUPERSEDED'
  is_cycle_head: number
  confirmed_event_id: string
}

interface AssessmentRow {
  session_id: string
  student_id: string
  job_code: string
  task_code: string
  strategy_id: string
  strategy_type: string
  strategy_version: number
  status: string
  started_at: string | null
  completed_at: string | null
  online_question_count: number
  offline_question_count: number
  online_completed_count: number
  offline_completed_count: number
  last_interruption_reason: string | null
}

interface StrategyRow {
  strategy_id: string
  strategy_type: string
  version: number
  question_policy_json: string
  scoring_policy_json: string
}

interface ResultRow {
  result_id: string
  student_id: string
  result_type: string
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
  source_started_at: string | null
  source_completed_at: string | null
}

interface IncidentRow {
  incident_id: string
  student_id: string
  job_code: string
  task_code: string
  reason_code: string
  context_phase: string
  description: string | null
  triggered_by: string
  occurred_at: string
  status: 'PENDING_DETAIL' | 'CONFIRMED' | 'RESOLVED' | 'VOIDED'
  confirmed_by: string | null
  confirmed_at: string | null
  updated_at: string
  replacement_incident_id: string | null
}

interface BindingRow {
  aggregate_type: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION'
  aggregate_id: string
  pre_status: string
  post_status: 'REDLINE_HALTED'
  created_at: string
}

export interface BuiltReportSnapshot<T extends ReportContentJson = ReportContentJson> {
  scope: ReportScope
  reportType: 'FULL_REPORT' | 'SAFETY_TERMINATION_REPORT'
  reportTitle: string
  studentId: string
  jobCode: string
  taskCode: string
  content: T
  sourceAggregateType: 'ASSESSMENT_SESSION' | 'TRAINING_SESSION' | 'SAFETY_INCIDENT'
  sourceAggregateId: string
  resultIds: string[]
  incidentIds: string[]
  taskClosureId: string | null
  reportSchemaVersion: string
  reportBuilderVersion: string
  lineageKey: string
  sourceSetHash: string
  contentHash: string
}

export class ReportBuilderError extends Error {
  constructor(
    public readonly code:
      | 'SOURCE_NOT_FOUND'
      | 'SOURCE_NOT_READY'
      | 'SOURCE_REDLINE'
      | 'SOURCE_CONTRACT_INVALID'
      | 'REPORT_CONTRACT_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'ReportBuilderError'
  }
}

export function buildBaseAbilityReport(db: DBAdapter, taskClosureId: string, generatedAt: string): BuiltReportSnapshot<ReportContentBaseAbility> {
  const closure = requireClosure(db, taskClosureId)
  if (closure.status !== 'CONFIRMED' || closure.is_cycle_head !== 1) {
    throw new ReportBuilderError('SOURCE_NOT_READY', `Task closure ${taskClosureId} is not the current confirmed head`)
  }
  const payload = readClosureEventPayload(db, closure.confirmed_event_id)
  const snapshots = payload.task_result_snapshots
  const ability = snapshots[0]
  const training = snapshots[1]
  const operation = snapshots[2]
  const assessment = requireAssessment(db, ability.source_aggregate_id)
  const strategy = readStrategy(db, assessment.strategy_id, assessment.strategy_version)
  const sourceMeta: BaseReportSourceMeta = {
    task_closure_id: closure.task_closure_id,
    cycle_no: closure.cycle_no,
    closure_revision: closure.closure_revision,
    task_result_snapshots: snapshots,
    source_set_hash: ''
  }
  sourceMeta.source_set_hash = sha256CanonicalJson({
    task_closure_id: sourceMeta.task_closure_id,
    cycle_no: sourceMeta.cycle_no,
    closure_revision: sourceMeta.closure_revision,
    task_result_snapshots: sourceMeta.task_result_snapshots
  })

  const content: ReportContentBaseAbility = {
    report_schema_version: 'task-report-v1.1',
    report_scope: 'BASE_ABILITY',
    report_type: 'FULL_REPORT',
    generated_at: generatedAt,
    assessment_meta: {
      session_id: assessment.session_id,
      strategy_id: assessment.strategy_id,
      strategy_version: assessment.strategy_version,
      question_bank_version: questionBankVersion(db, assessment.session_id),
      import_batch_ids: importBatchIds(strategy),
      asset_references: assetReferencesForAssessment(db, assessment.session_id),
      scoring_engine_version: scoringEngineVersion(strategy),
      content_schema_version: contentSchemaVersion(strategy, 'task-report-v1.1'),
      scoring_schema_version: scoringSchemaVersion(strategy),
      sitting_count: sittingsForAssessment(db, assessment).length,
      sittings: sittingsForAssessment(db, assessment),
      completion_ratio: ability.completion_ratio ?? 0,
      termination_reason: assessment.last_interruption_reason,
      pilot_mode: true,
      report_usage: 'PILOT_ONLY'
    },
    score_summary: {
      ability_score: summaryItem(ability),
      training_completion: summaryItem(training),
      operation_pass_rate: summaryItem(operation)
    },
    module_profiles: ability.details.module_scores ?? [],
    training: { result_id: training.result_id, ...training.details },
    operation: { result_id: operation.result_id, ...operation.details },
    evidence_summary: {
      evidence_types: ['SELF_REPORT_PLUS_BEHAVIOR', 'DIRECT_PERFORMANCE'],
      observations: []
    },
    support_summary: {
      prompt_level_distribution: {},
      accommodations_used: [],
      instruction_replay_count: 0
    },
    administration_status: {
      status: assessment.status,
      observation_completion_ratio: 1
    },
    behavior_observations: [],
    validity_limitations: ['PILOT_ONLY'],
    safety_summary: {
      safety_incidents: [],
      safety_overridden: false
    },
    placement_advice: {
      enabled: false,
      recommendation: null,
      reason_disabled: 'PILOT_ONLY'
    },
    source_meta: sourceMeta
  }

  assertReportContentValid(content)
  return {
    scope: 'BASE_ABILITY',
    reportType: 'FULL_REPORT',
    reportTitle: `${closure.job_code} 基础能力任务闭环报告`,
    studentId: closure.student_id,
    jobCode: closure.job_code,
    taskCode: closure.task_code,
    content,
    sourceAggregateType: 'ASSESSMENT_SESSION',
    sourceAggregateId: ability.source_aggregate_id,
    resultIds: payload.source_result_ids,
    incidentIds: [],
    taskClosureId: closure.task_closure_id,
    reportSchemaVersion: 'task-report-v1.1',
    reportBuilderVersion: BASE_REPORT_BUILDER_VERSION,
    lineageKey: sha256CanonicalJson({ report_scope: 'BASE_ABILITY', task_closure_id: closure.task_closure_id }),
    sourceSetHash: sourceMeta.source_set_hash,
    contentHash: sha256CanonicalJson(content)
  }
}

export function buildJobSkillReport(db: DBAdapter, resultId: string, generatedAt: string): BuiltReportSnapshot<ValidatedReportContentJobSkill> {
  const result = requireResult(db, resultId)
  if (result.result_type !== 'JOB_SKILL_SCORE' || result.source_aggregate_type !== 'ASSESSMENT_SESSION') {
    throw new ReportBuilderError('SOURCE_NOT_READY', `Result ${resultId} is not a JOB_SKILL_SCORE`)
  }
  if (result.is_current !== 1) throw new ReportBuilderError('SOURCE_NOT_READY', `Result ${resultId} is not current`)
  if (result.safety_overridden === 1 || result.redline_incident_id !== null) {
    throw new ReportBuilderError('SOURCE_REDLINE', `Result ${resultId} is safety-overridden`)
  }
  const assessment = requireAssessment(db, result.source_aggregate_id)
  if (assessment.status !== 'COMPLETED' || assessment.strategy_type !== 'JOB_SKILL_ASSESSMENT') {
    throw new ReportBuilderError('SOURCE_NOT_READY', `JOB_SKILL source session ${assessment.session_id} is not completed`)
  }
  const strategy = readStrategy(db, assessment.strategy_id, assessment.strategy_version)
  const details = parseJson<JobSkillResultPayload>(result.result_payload_json, 'JOB_SKILL result payload')
  const sourceSnapshot: JobSkillResultSnapshot = {
    result_id: result.result_id,
    result_type: 'JOB_SKILL_SCORE',
    source_aggregate_type: 'ASSESSMENT_SESSION',
    source_aggregate_id: result.source_aggregate_id,
    generated_at: result.generated_at,
    strategy_id: result.strategy_id,
    strategy_type: result.strategy_type as JobSkillResultSnapshot['strategy_type'],
    raw_score: result.raw_score,
    max_score: result.max_score,
    normalized_score: result.normalized_score,
    completion_ratio: result.completion_ratio,
    level_result: result.level_result,
    safety_overridden: false,
    redline_incident_id: null,
    source_started_at: result.source_started_at,
    source_completed_at: result.source_completed_at,
    details
  }
  const online = onlineKnowledgeSummary(db, assessment.session_id)
  const offline = offlinePerformanceSummary(db, assessment.session_id)
  const observations = teacherObservations(db, assessment.session_id)
  const content: ValidatedReportContentJobSkill = {
    report_schema_version: 'job-skill-report-v1.0',
    report_scope: 'JOB_SKILL',
    report_type: 'FULL_REPORT',
    generated_at: generatedAt,
    assessment_meta: {
      session_id: assessment.session_id,
      strategy_id: assessment.strategy_id,
      strategy_version: assessment.strategy_version,
      scoring_engine_version: scoringEngineVersion(strategy),
      content_schema_version: contentSchemaVersion(strategy, 'job-skill-report-v1.0'),
      scoring_schema_version: scoringSchemaVersion(strategy),
      report_schema_version: 'job-skill-report-v1.0',
      job_code: assessment.job_code,
      sitting_count: sittingsForAssessment(db, assessment).length,
      completion_ratio: details.overall.completion_ratio,
      observation_completion_ratio: details.observation_completion_ratio
    },
    overall_summary: {
      raw_score: details.overall.raw_score,
      max_score: 48,
      normalized_score: details.overall.normalized_score,
      level_result: result.level_result,
      safety_overridden: false,
      emotion_collapse_triggered: false
    },
    job_module_profiles: JOB_MODULE_CODES.map((code) => {
      const profile = details.job_module_profiles[code]
      return {
        job_module_code: code,
        module_name: MODULE_NAMES[code],
        online_raw_score: profile?.online_raw ?? 0,
        online_max_score: profile?.online_max ?? 0,
        offline_raw_score: profile?.offline_raw ?? 0,
        offline_max_score: profile?.offline_max ?? 0,
        score_rate: profile?.score_rate ?? 0,
        response_status_distribution: responseDistributionForModule(db, assessment.session_id, code),
        key_observations: observations.filter((item) => questionJobModule(db, item.question_id) === code).map((item) => item.observation_note ?? item.observation_code)
      }
    }),
    online_knowledge_summary: online,
    offline_performance_summary: offline,
    administration_summary: {
      report_usage: 'MVP_DEMO_PROFILE_ONLY',
      observation_completion_ratio: details.observation_completion_ratio,
      completion_ratio: details.overall.completion_ratio,
      sittings: sittingsForAssessment(db, assessment),
      termination_reason: assessment.last_interruption_reason
    },
    support_summary: details.support_summary,
    teacher_observations: observations,
    safety_summary: details.safety_summary,
    validity_limitations: details.validity_limitations,
    recommended_training_focus: details.recommended_training_focus,
    recommended_training_tasks: details.recommended_training_focus.map((item) => ({
      job_module_code: item.job_module_code,
      task_code: item.linked_task_code,
      recommendation_text: item.recommendation_text,
      has_existing_training: item.linked_task_code !== null
    })),
    source_meta: {
      result_snapshot: sourceSnapshot,
      question_bank_version: questionBankVersion(db, assessment.session_id),
      import_batch_ids: importBatchIds(strategy),
      asset_references: assetReferencesForAssessment(db, assessment.session_id)
    },
    placement_advice: {
      enabled: false,
      recommendation: null,
      reason_disabled: 'MVP_DEMO_PROFILE_ONLY'
    }
  }

  assertReportContentValid(content)
  return {
    scope: 'JOB_SKILL',
    reportType: 'FULL_REPORT',
    reportTitle: `${assessment.job_code} 专业岗位测评报告`,
    studentId: assessment.student_id,
    jobCode: assessment.job_code,
    taskCode: assessment.task_code,
    content,
    sourceAggregateType: 'ASSESSMENT_SESSION',
    sourceAggregateId: assessment.session_id,
    resultIds: [result.result_id],
    incidentIds: [],
    taskClosureId: null,
    reportSchemaVersion: 'job-skill-report-v1.0',
    reportBuilderVersion: JOB_REPORT_BUILDER_VERSION,
    lineageKey: sha256CanonicalJson({ report_scope: 'JOB_SKILL', result_id: result.result_id }),
    sourceSetHash: sha256CanonicalJson(sourceSnapshot),
    contentHash: sha256CanonicalJson(content)
  }
}

export function buildSafetyReport(db: DBAdapter, incidentId: string, generatedAt: string): BuiltReportSnapshot<ReportContentSafetyTermination> {
  const incident = requireIncident(db, incidentId)
  if (!['CONFIRMED', 'RESOLVED'].includes(incident.status)) {
    throw new ReportBuilderError('SOURCE_NOT_READY', `Safety incident ${incidentId} is not confirmed or resolved`)
  }
  const confirmedAt = incident.confirmed_at ?? incident.updated_at
  if (!incident.confirmed_by || !confirmedAt) {
    throw new ReportBuilderError('SOURCE_NOT_READY', `Safety incident ${incidentId} has no confirmed facts`)
  }
  const bindings = readBindings(db, incidentId)
  const preRecords = preRedlineRecords(db, bindings, incident.occurred_at)
  const sourceScope = safetySourceScope(db, bindings)
  const bindingMetadata = bindings.map((binding) => binding.aggregate_type === 'ASSESSMENT_SESSION'
    ? safetyAssessmentMetadata(db, binding.aggregate_id)
    : safetyTrainingMetadata(db, binding.aggregate_id, incident.occurred_at))
  const content: ReportContentSafetyTermination = {
    report_schema_version: 'safety-termination-report-v1.0',
    report_scope: 'SAFETY',
    source_scope: sourceScope,
    report_type: 'SAFETY_TERMINATION_REPORT',
    generated_at: generatedAt,
    incident_snapshot: {
      incident_id: incident.incident_id,
      student_id: incident.student_id,
      job_code: incident.job_code,
      task_code: incident.task_code,
      status_at_generation: incident.status as 'CONFIRMED' | 'RESOLVED',
      reason_code: incident.reason_code,
      context_phase: incident.context_phase,
      description: incident.description ?? '',
      occurred_at: incident.occurred_at,
      triggered_by: incident.triggered_by,
      confirmed_by: incident.confirmed_by,
      confirmed_at: confirmedAt
    },
    binding_snapshots: bindings.map((binding) => ({
      aggregate_type: binding.aggregate_type,
      aggregate_id: binding.aggregate_id,
      pre_status: binding.pre_status,
      post_status: binding.post_status
    })),
    pre_redline_records: preRecords,
    safety_summary: {
      level_result: 'LEVEL_FAIL_BY_SAFETY',
      ordinary_report_blocked: true
    },
    validity_limitations: sourceScope === 'NO_BOUND_SESSION' ? ['NO_BOUND_SESSION'] : [],
    correction_lineage: {
      root_incident_id: rootIncidentId(db, incident),
      replaces_incident_id: replacedIncidentId(db, incident.incident_id),
      supersedes_report_id: activeSafetyReportId(db, incident.incident_id)
    },
    source_meta: sourceScope === 'NO_BOUND_SESSION'
      ? { metadata_availability: 'NO_BOUND_SESSION', binding_metadata: [] }
      : { metadata_availability: 'BY_BINDING', binding_metadata: bindingMetadata },
    placement_advice: {
      enabled: false,
      recommendation: null,
      reason_disabled: 'SAFETY_TERMINATION'
    }
  }

  assertReportContentValid(content)
  const sourceSetHash = sha256CanonicalJson({
    incident_snapshot: content.incident_snapshot,
    binding_snapshots: content.binding_snapshots,
    pre_redline_records: content.pre_redline_records,
    source_meta: content.source_meta
  })
  return {
    scope: 'SAFETY',
    reportType: 'SAFETY_TERMINATION_REPORT',
    reportTitle: `${incident.job_code} 安全终止报告`,
    studentId: incident.student_id,
    jobCode: incident.job_code,
    taskCode: incident.task_code,
    content,
    sourceAggregateType: 'SAFETY_INCIDENT',
    sourceAggregateId: incident.incident_id,
    resultIds: preRecords.result_ids,
    incidentIds: [incident.incident_id],
    taskClosureId: null,
    reportSchemaVersion: 'safety-termination-report-v1.0',
    reportBuilderVersion: SAFETY_REPORT_BUILDER_VERSION,
    lineageKey: sha256CanonicalJson({ report_scope: 'SAFETY', root_incident_id: content.correction_lineage.root_incident_id }),
    sourceSetHash,
    contentHash: sha256CanonicalJson(content)
  }
}

function requireClosure(db: DBAdapter, taskClosureId: string): ClosureRow {
  const row = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(taskClosureId) as ClosureRow | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Task closure ${taskClosureId} was not found`)
  return row
}

function readClosureEventPayload(db: DBAdapter, eventId: string): TaskClosureConfirmedPayload | TaskClosureReplacedPayload {
  const row = db.prepare('SELECT event_type, payload_json FROM domain_event_projection WHERE event_id = ?').get(eventId) as { event_type: string; payload_json: string } | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Closure event ${eventId} was not found`)
  const parsed = parseF7EventPayload(row.event_type as 'TASK_CLOSURE_CONFIRMED' | 'TASK_CLOSURE_REPLACED', JSON.parse(row.payload_json) as Record<string, unknown>)
  if (!parsed.valid) throw new ReportBuilderError('SOURCE_CONTRACT_INVALID', `Closure event ${eventId} payload is invalid`)
  return parsed.value as TaskClosureConfirmedPayload | TaskClosureReplacedPayload
}

function requireAssessment(db: DBAdapter, sessionId: string): AssessmentRow {
  const row = db.prepare('SELECT * FROM assessment_session WHERE session_id = ?').get(sessionId) as AssessmentRow | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Assessment session ${sessionId} was not found`)
  return row
}

function readStrategy(db: DBAdapter, strategyId: string, version: number): StrategyRow | null {
  return db.prepare('SELECT * FROM strategy_config WHERE strategy_id = ? AND version = ?').get(strategyId, version) as StrategyRow | undefined ?? null
}

function requireResult(db: DBAdapter, resultId: string): ResultRow {
  const row = db.prepare(
    `SELECT r.*,
            COALESCE(a.started_at, t.started_at) AS source_started_at,
            COALESCE(a.completed_at, t.completed_at) AS source_completed_at
       FROM result_record r
       LEFT JOIN assessment_session a
         ON r.source_aggregate_type = 'ASSESSMENT_SESSION'
        AND a.session_id = r.source_aggregate_id
       LEFT JOIN training_session t
         ON r.source_aggregate_type = 'TRAINING_SESSION'
        AND t.training_session_id = r.source_aggregate_id
      WHERE r.result_id = ?`
  ).get(resultId) as ResultRow | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Result ${resultId} was not found`)
  return row
}

function requireIncident(db: DBAdapter, incidentId: string): IncidentRow {
  const row = db.prepare('SELECT * FROM safety_incident WHERE incident_id = ?').get(incidentId) as IncidentRow | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Safety incident ${incidentId} was not found`)
  return row
}

function parseJson<T>(input: string | null, label: string): T {
  if (!input) throw new ReportBuilderError('SOURCE_CONTRACT_INVALID', `${label} is missing`)
  try {
    return JSON.parse(input) as T
  } catch {
    throw new ReportBuilderError('SOURCE_CONTRACT_INVALID', `${label} is invalid JSON`)
  }
}

function assertReportContentValid(content: ReportContentJson): void {
  const parsed = parseReportContent(content)
  if (!parsed.valid) {
    throw new ReportBuilderError('REPORT_CONTRACT_INVALID', parsed.errors.map((error) => error.path).join(', '))
  }
}

function summaryItem(snapshot: TaskResultSnapshot) {
  return {
    result_id: snapshot.result_id,
    raw_score: snapshot.raw_score,
    max_score: snapshot.max_score,
    normalized_score: snapshot.normalized_score,
    completion_ratio: snapshot.completion_ratio,
    level_result: snapshot.level_result
  }
}

function scoringEngineVersion(strategy: StrategyRow | null): string {
  const scoring = strategy ? parseJson<Record<string, unknown>>(strategy.scoring_policy_json, 'strategy scoring policy') : {}
  return typeof scoring.scoring_engine_version === 'string' ? scoring.scoring_engine_version : 'local-scoring-engine-v0.1.16'
}

function scoringSchemaVersion(strategy: StrategyRow | null): string {
  const scoring = strategy ? parseJson<Record<string, unknown>>(strategy.scoring_policy_json, 'strategy scoring policy') : {}
  return typeof scoring.schema_version === 'string' ? scoring.schema_version : 'scoring-policy-unrecorded'
}

function contentSchemaVersion(strategy: StrategyRow | null, fallback: string): string {
  const policy = strategy ? parseJson<Record<string, unknown>>(strategy.question_policy_json, 'strategy question policy') : {}
  return typeof policy.schema_version === 'string' ? policy.schema_version : fallback
}

function importBatchIds(strategy: StrategyRow | null): string[] {
  if (!strategy) return []
  const policy = parseJson<Record<string, unknown>>(strategy.question_policy_json, 'strategy question policy')
  const value = policy.import_batch_ids
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function questionBankVersion(db: DBAdapter, sessionId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(q.version), 1) AS version
       FROM assessment_session_question sq
       JOIN question_bank q ON q.question_id = sq.question_id
      WHERE sq.session_id = ?`
  ).get(sessionId) as { version: number | null } | undefined
  return row?.version ?? 1
}

function assetReferencesForAssessment(db: DBAdapter, sessionId: string): ReportAssetReference[] {
  const rows = db.prepare(
    `SELECT DISTINCT ar.asset_id, ar.file_hash
       FROM assessment_session_question sq
       JOIN question_bank q ON q.question_id = sq.question_id
       JOIN asset_resource ar
         ON ar.asset_id = q.media_asset_id
       WHERE sq.session_id = ?
      ORDER BY ar.asset_id`
  ).all(sessionId) as Array<{ asset_id: string; file_hash: string }>
  return rows.map((row) => ({ asset_id: row.asset_id, file_hash: row.file_hash, content_pack_version: null }))
}

function sittingsForAssessment(db: DBAdapter, assessment: AssessmentRow): ReportSittingSnapshot[] {
  const rows = db.prepare(
    `SELECT event_type, sitting_no, payload_json, created_at
       FROM domain_event_projection
      WHERE aggregate_type = 'ASSESSMENT_SESSION'
        AND aggregate_id = ?
        AND event_type IN ('SITTING_STARTED', 'SITTING_ENDED')
      ORDER BY event_sequence`
  ).all(assessment.session_id) as Array<{ event_type: string; sitting_no: number | null; payload_json: string; created_at: string }>
  const bySitting = new Map<number, ReportSittingSnapshot>()
  for (const row of rows) {
    const sittingNo = row.sitting_no ?? 1
    const existing = bySitting.get(sittingNo) ?? {
      sitting_no: sittingNo,
      started_at: assessment.started_at ?? row.created_at,
      ended_at: null,
      duration_seconds: null,
      end_reason: null
    }
    if (row.event_type === 'SITTING_STARTED') existing.started_at = row.created_at
    if (row.event_type === 'SITTING_ENDED') {
      existing.ended_at = row.created_at
      existing.end_reason = 'COMPLETED_NORMALLY'
    }
    bySitting.set(sittingNo, existing)
  }
  const values = [...bySitting.values()]
  if (values.length > 0) return values
  return [{
    sitting_no: 1,
    started_at: assessment.started_at ?? assessment.completed_at ?? new Date(0).toISOString(),
    ended_at: assessment.completed_at,
    duration_seconds: null,
    end_reason: assessment.status === 'COMPLETED' ? 'COMPLETED_NORMALLY' : null
  }]
}

function onlineKnowledgeSummary(db: DBAdapter, sessionId: string) {
  const rows = db.prepare(
    `SELECT response_status, COALESCE(score, 0) AS score
       FROM answer_record
      WHERE session_id = ? AND status = 'VALID'`
  ).all(sessionId) as Array<{ response_status: ResponseStatus; score: number }>
  const max = rows.length * 2
  const raw = rows.reduce((sum, row) => sum + row.score, 0)
  return {
    raw_score: raw,
    max_score: max,
    normalized_score: max > 0 ? (raw / max) * 100 : 0,
    response_status_distribution: countBy(rows.map((row) => row.response_status)) as Partial<Record<ResponseStatus, number>>
  }
}

function offlinePerformanceSummary(db: DBAdapter, sessionId: string) {
  const rows = db.prepare(
    `SELECT response_status, score
       FROM offline_score_record
      WHERE session_id = ? AND score_scope = 'JOB_SKILL' AND status = 'VALID'`
  ).all(sessionId) as Array<{ response_status: ResponseStatus; score: number | null }>
  const answered = rows.filter((row) => row.score !== null)
  const max = rows.length * 2
  const raw = answered.reduce((sum, row) => sum + (row.score ?? 0), 0)
  return {
    raw_score: raw,
    max_score: max,
    normalized_score: max > 0 ? (raw / max) * 100 : 0,
    completed_item_count: answered.length,
    total_item_count: rows.length
  }
}

function responseDistributionForModule(db: DBAdapter, sessionId: string, moduleCode: JobModuleCode): Partial<Record<ResponseStatus, number>> {
  const rows = db.prepare(
    `SELECT ar.response_status
       FROM answer_record ar
       JOIN question_bank q ON q.question_id = ar.question_id
      WHERE ar.session_id = ? AND q.job_module_code = ? AND ar.status = 'VALID'
      UNION ALL
     SELECT os.response_status
       FROM offline_score_record os
       JOIN question_bank q ON q.question_id = os.question_id
      WHERE os.session_id = ? AND q.job_module_code = ? AND os.status = 'VALID' AND os.score_scope = 'JOB_SKILL'`
  ).all(sessionId, moduleCode, sessionId, moduleCode) as Array<{ response_status: ResponseStatus }>
  return countBy(rows.map((row) => row.response_status)) as Partial<Record<ResponseStatus, number>>
}

function teacherObservations(db: DBAdapter, sessionId: string) {
  const rows = db.prepare(
    `SELECT question_id, observation_payload_json
       FROM offline_score_record
      WHERE session_id = ? AND score_scope = 'TEACHER_OBSERVATION' AND status = 'VALID'
      ORDER BY scored_at ASC, question_id ASC`
  ).all(sessionId) as Array<{ question_id: string; observation_payload_json: string }>
  return rows.map((row) => {
    const parsed = parseJson<Partial<TeacherObservationPayload>>(row.observation_payload_json, 'teacher observation payload')
    return {
      question_id: row.question_id,
      observation_code: parsed.observation_code ?? '',
      observed: parsed.observed ?? false,
      behavior_codes: parsed.behavior_codes ?? [],
      prompt_level: (parsed.prompt_level ?? null) as PromptLevel | null,
      observation_note: parsed.observation_note ?? null
    }
  })
}

function questionJobModule(db: DBAdapter, questionId: string): JobModuleCode | null {
  const row = db.prepare('SELECT job_module_code FROM question_bank WHERE question_id = ?').get(questionId) as { job_module_code: JobModuleCode | null } | undefined
  return row?.job_module_code ?? null
}

function readBindings(db: DBAdapter, incidentId: string): BindingRow[] {
  return db.prepare(
    `SELECT aggregate_type, aggregate_id, pre_status, post_status, created_at
       FROM safety_incident_binding
      WHERE incident_id = ?
      ORDER BY aggregate_type ASC, aggregate_id ASC`
  ).all(incidentId) as BindingRow[]
}

function preRedlineRecords(db: DBAdapter, bindings: BindingRow[], occurredAt: string) {
  const assessmentIds = bindings.filter((binding) => binding.aggregate_type === 'ASSESSMENT_SESSION').map((binding) => binding.aggregate_id)
  const trainingIds = bindings.filter((binding) => binding.aggregate_type === 'TRAINING_SESSION').map((binding) => binding.aggregate_id)
  const answerSummary: Record<string, number> = {}
  const offlineScoreSummary: Record<string, number> = {}
  const trainingStepSummary: Record<string, number> = {}
  const resultIds: string[] = []
  for (const sessionId of assessmentIds) {
    for (const row of db.prepare(
      `SELECT response_status
         FROM answer_record
        WHERE session_id = ? AND submitted_at < ? AND status = 'VALID'
        ORDER BY submitted_at ASC, question_type ASC, answer_id ASC`
    ).all(sessionId, occurredAt) as Array<{ response_status: string }>) {
      answerSummary[row.response_status] = (answerSummary[row.response_status] ?? 0) + 1
    }
    for (const row of db.prepare(
      `SELECT score_scope, response_status
         FROM offline_score_record
        WHERE session_id = ? AND scored_at < ? AND status = 'VALID'
        ORDER BY scored_at ASC, score_scope ASC, offline_score_id ASC`
    ).all(sessionId, occurredAt) as Array<{ score_scope: string; response_status: string }>) {
      const key = `${row.score_scope}:${row.response_status}`
      offlineScoreSummary[key] = (offlineScoreSummary[key] ?? 0) + 1
    }
    for (const row of db.prepare(
      `SELECT result_id
         FROM result_record
        WHERE source_aggregate_type = 'ASSESSMENT_SESSION'
          AND source_aggregate_id = ?
          AND generated_at < ?
        ORDER BY generated_at ASC, result_type ASC, result_id ASC`
    ).all(sessionId, occurredAt) as Array<{ result_id: string }>) {
      resultIds.push(row.result_id)
    }
  }
  for (const trainingId of trainingIds) {
    for (const row of db.prepare(
      // training_step_record has no occurred_at column. Rows are created during
      // training-session initialization, so created_at is the durable evidence
      // that a step record existed before a redline.
      `SELECT status
         FROM training_step_record
        WHERE training_session_id = ? AND created_at < ?
        ORDER BY created_at ASC, step_type ASC, training_step_record_id ASC`
    ).all(trainingId, occurredAt) as Array<{ status: string }>) {
      trainingStepSummary[row.status] = (trainingStepSummary[row.status] ?? 0) + 1
    }
    for (const row of db.prepare(
      `SELECT result_id
         FROM result_record
        WHERE source_aggregate_type = 'TRAINING_SESSION'
          AND source_aggregate_id = ?
          AND generated_at < ?
        ORDER BY generated_at ASC, result_type ASC, result_id ASC`
    ).all(trainingId, occurredAt) as Array<{ result_id: string }>) {
      resultIds.push(row.result_id)
    }
  }
  return { result_ids: resultIds, answer_summary: answerSummary, offline_score_summary: offlineScoreSummary, training_step_summary: trainingStepSummary }
}

function safetySourceScope(db: DBAdapter, bindings: BindingRow[]): SafetySourceScope {
  if (bindings.length === 0) return 'NO_BOUND_SESSION'
  const types = new Set(bindings.map((binding) => binding.aggregate_type))
  if (types.size > 1) return 'MIXED'
  if (types.has('TRAINING_SESSION')) return 'TRAINING'
  const assessments = bindings.map((binding) => requireAssessment(db, binding.aggregate_id))
  return assessments.every((assessment) => assessment.strategy_type === 'JOB_SKILL_ASSESSMENT') ? 'JOB_SKILL' : 'BASE_ABILITY'
}

function safetyAssessmentMetadata(db: DBAdapter, sessionId: string): SafetyBindingMetadata {
  const assessment = requireAssessment(db, sessionId)
  const strategy = readStrategy(db, assessment.strategy_id, assessment.strategy_version)
  return {
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: sessionId,
    strategy_id: assessment.strategy_id,
    strategy_version: assessment.strategy_version,
    question_bank_version: questionBankVersion(db, sessionId),
    import_batch_ids: importBatchIds(strategy),
    asset_references: assetReferencesForAssessment(db, sessionId),
    scoring_engine_version: scoringEngineVersion(strategy),
    content_schema_version: contentSchemaVersion(strategy, 'safety-termination-report-v1.0'),
    scoring_schema_version: scoringSchemaVersion(strategy),
    sittings: sittingsForAssessment(db, assessment),
    completion_ratio: completionRatioForAssessment(assessment),
    started_at: assessment.started_at,
    completed_at: assessment.completed_at
  }
}

function safetyTrainingMetadata(db: DBAdapter, trainingId: string, occurredAt: string): SafetyBindingMetadata {
  const row = db.prepare('SELECT * FROM training_session WHERE training_session_id = ?').get(trainingId) as {
    training_session_id: string
    strategy_id: string | null
    strategy_version: number | null
    started_at: string | null
    completed_at: string | null
  } | undefined
  if (!row) throw new ReportBuilderError('SOURCE_NOT_FOUND', `Training session ${trainingId} was not found`)
  const stepRows = db.prepare(
    `SELECT training_step_record_id, status, attempt_count, created_at
       FROM training_step_record
      WHERE training_session_id = ?
      ORDER BY created_at ASC, step_order ASC, training_step_record_id ASC`
  ).all(trainingId) as Array<{ training_step_record_id: string; status: string; attempt_count: number; created_at: string }>
  const base = {
    aggregate_type: 'TRAINING_SESSION' as const,
    aggregate_id: trainingId,
    asset_references: [],
    started_at: row.started_at,
    completed_at: row.completed_at,
    step_status_summary: countBy(stepRows.map((step) => step.status)),
    pre_redline_steps: stepRows
      .filter((step) => step.created_at < occurredAt)
      .map((step) => ({
        step_record_id: step.training_step_record_id,
        status: step.status,
        attempt_count: step.attempt_count,
        occurred_at: step.created_at
      }))
  }
  if (row.strategy_id && row.strategy_version) {
    return { ...base, strategy_availability: 'CONFIGURED', strategy_id: row.strategy_id, strategy_version: row.strategy_version }
  }
  return { ...base, strategy_availability: 'NOT_CONFIGURED', strategy_id: null, strategy_version: null }
}

function completionRatioForAssessment(assessment: AssessmentRow): number {
  const total = assessment.online_question_count + assessment.offline_question_count
  if (total === 0) return 0
  return (assessment.online_completed_count + assessment.offline_completed_count) / total
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function rootIncidentId(db: DBAdapter, incident: IncidentRow): string {
  const replaced = replacedIncidentId(db, incident.incident_id)
  return replaced ? rootIncidentId(db, requireIncident(db, replaced)) : incident.incident_id
}

function replacedIncidentId(db: DBAdapter, incidentId: string): string | null {
  const row = db.prepare('SELECT incident_id FROM safety_incident WHERE replacement_incident_id = ? LIMIT 1').get(incidentId) as { incident_id: string } | undefined
  return row?.incident_id ?? null
}

function activeSafetyReportId(db: DBAdapter, incidentId: string): string | null {
  const row = db.prepare(
    `SELECT report_id
       FROM task_report
      WHERE source_aggregate_type = 'SAFETY_INCIDENT'
        AND source_aggregate_id = ?
        AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')
      ORDER BY report_revision DESC
      LIMIT 1`
  ).get(incidentId) as { report_id: string } | undefined
  return row?.report_id ?? null
}
