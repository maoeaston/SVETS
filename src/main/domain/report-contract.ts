import type {
  F7EventPayload,
  PlacementReviewConfirmedV2Payload,
  ReportExportedV2Payload,
  ReportGeneratedV2Payload,
  ReportLockedV2Payload,
  SafetyIncidentReplacedForFactualCorrectionV2Payload,
  SafetyIncidentVoidedV2Payload,
  TaskClosureConfirmedPayload,
  TaskClosureReplacedPayload
} from '@shared/types/event-payloads'
import type {
  AbilityResultSnapshot,
  JobSkillResultSnapshot,
  ReportContentBaseAbility,
  ReportContentJson,
  ReportContentSafetyTermination,
  TaskResultSnapshot,
  TrainingCompletionResultSnapshot,
  OperationPassRateResultSnapshot,
  ValidatedReportContentJobSkill
} from '@shared/types/json-schemas'
import type { GenerateReportParams } from '@shared/types/report'
import { canonicalJson, sha256CanonicalJson } from './report-canonical'
import {
  isAllowedReportExportTransition,
  isAllowedTaskClosureConfirmedState,
  isAllowedTaskClosureReplacementState,
  REPORT_EXPORT_STATUS_AFTER,
  REPORT_EXPORT_STATUS_BEFORE,
  SAFETY_VOID_REASONS
} from './report-lifecycle'

export interface ReportContractError {
  code: 'REQUIRED' | 'TYPE' | 'VALUE' | 'EXTRA_FIELD' | 'DUPLICATE' | 'MISMATCH'
  path: string
}

export type ReportContractResult<T> =
  | { valid: true; value: T }
  | { valid: false; errors: ReportContractError[] }

type JsonRecord = Record<string, unknown>

const BASE_RESULT_TYPES = ['ABILITY_SCORE', 'TRAINING_COMPLETION', 'OPERATION_PASS_RATE'] as const
const JOB_MODULE_CODES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'] as const
const REPORT_SCOPES = ['BASE_ABILITY', 'JOB_SKILL', 'SAFETY'] as const
const REPORT_TYPES = ['FULL_REPORT', 'SAFETY_TERMINATION_REPORT'] as const
const SOURCE_SCOPES = ['BASE_ABILITY', 'JOB_SKILL', 'TRAINING', 'MIXED', 'NO_BOUND_SESSION'] as const
const HASH_PATTERN = /^[0-9a-f]{64}$/

class Collector {
  readonly errors: ReportContractError[] = []

  add(code: ReportContractError['code'], path: string): void {
    this.errors.push({ code, path })
  }

  get valid(): boolean {
    return this.errors.length === 0
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string, c: Collector): JsonRecord | null {
  if (!isRecord(value)) {
    c.add('TYPE', path)
    return null
  }
  return value
}

function required(obj: JsonRecord, key: string, path: string, c: Collector): unknown {
  if (!(key in obj)) {
    c.add('REQUIRED', `${path}.${key}`)
    return undefined
  }
  return obj[key]
}

function text(value: unknown, path: string, c: Collector, allowEmpty = false): string | null {
  if (typeof value !== 'string') {
    c.add('TYPE', path)
    return null
  }
  if (!allowEmpty && value.trim().length === 0) {
    c.add('VALUE', path)
    return null
  }
  return value
}

function nullableText(value: unknown, path: string, c: Collector): string | null | undefined {
  if (value === null) return null
  return text(value, path, c)
}

function boolean(value: unknown, path: string, c: Collector): boolean | null {
  if (typeof value !== 'boolean') {
    c.add('TYPE', path)
    return null
  }
  return value
}

function number(value: unknown, path: string, c: Collector, integer = false): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    c.add('TYPE', path)
    return null
  }
  if (integer && !Number.isInteger(value)) {
    c.add('VALUE', path)
    return null
  }
  return value
}

function nullableNumber(value: unknown, path: string, c: Collector): number | null | undefined {
  if (value === null) return null
  return number(value, path, c)
}

function dateTime(value: unknown, path: string, c: Collector, nullable = false): string | null | undefined {
  if (nullable && value === null) return null
  const result = text(value, path, c)
  if (result !== null && Number.isNaN(Date.parse(result))) c.add('VALUE', path)
  return result
}

function oneOf<T extends readonly string[]>(value: unknown, values: T, path: string, c: Collector): T[number] | null {
  const result = text(value, path, c)
  if (result === null) return null
  if (!(values as readonly string[]).includes(result)) {
    c.add('VALUE', path)
    return null
  }
  return result as T[number]
}

function list(value: unknown, path: string, c: Collector): unknown[] | null {
  if (!Array.isArray(value)) {
    c.add('TYPE', path)
    return null
  }
  return value
}

function stringList(value: unknown, path: string, c: Collector, unique = false): string[] | null {
  const values = list(value, path, c)
  if (!values) return null
  const parsed = values.map((item, index) => text(item, `${path}[${index}]`, c)).filter((item): item is string => item !== null)
  if (unique && new Set(parsed).size !== parsed.length) c.add('DUPLICATE', path)
  return parsed
}

function assertOnlyKeys(obj: JsonRecord, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) c.add('EXTRA_FIELD', `${path}.${key}`)
  }
}

function assertHash(value: unknown, path: string, c: Collector): string | null {
  const result = text(value, path, c)
  if (result !== null && !HASH_PATTERN.test(result)) c.add('VALUE', path)
  return result
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function parseAssetReferences(value: unknown, path: string, c: Collector): void {
  const items = list(value, path, c)
  if (!items) return
  for (let index = 0; index < items.length; index += 1) {
    const itemPath = `${path}[${index}]`
    const item = record(items[index], itemPath, c)
    if (!item) continue
    text(required(item, 'asset_id', itemPath, c), `${itemPath}.asset_id`, c)
    assertHash(required(item, 'file_hash', itemPath, c), `${itemPath}.file_hash`, c)
    nullableText(required(item, 'content_pack_version', itemPath, c), `${itemPath}.content_pack_version`, c)
  }
}

function parseSittings(value: unknown, path: string, c: Collector): void {
  const items = list(value, path, c)
  if (!items) return
  const seen = new Set<number>()
  for (let index = 0; index < items.length; index += 1) {
    const itemPath = `${path}[${index}]`
    const item = record(items[index], itemPath, c)
    if (!item) continue
    const sittingNo = number(required(item, 'sitting_no', itemPath, c), `${itemPath}.sitting_no`, c, true)
    if (sittingNo !== null && (sittingNo < 1 || seen.has(sittingNo))) c.add(seen.has(sittingNo) ? 'DUPLICATE' : 'VALUE', `${itemPath}.sitting_no`)
    if (sittingNo !== null) seen.add(sittingNo)
    dateTime(required(item, 'started_at', itemPath, c), `${itemPath}.started_at`, c)
    dateTime(required(item, 'ended_at', itemPath, c), `${itemPath}.ended_at`, c, true)
    nullableNumber(required(item, 'duration_seconds', itemPath, c), `${itemPath}.duration_seconds`, c)
    const endReason = required(item, 'end_reason', itemPath, c)
    if (endReason !== null) oneOf(endReason, ['COMPLETED_NORMALLY', 'PAUSED_BY_PLAN', 'ENDED_BY_COLLAPSE'] as const, `${itemPath}.end_reason`, c)
  }
}

function parseAbilityDetails(value: unknown, path: string, c: Collector): void {
  const details = record(value, path, c)
  if (!details) return
  if (required(details, 'result_type', path, c) !== 'ABILITY_SCORE') c.add('VALUE', `${path}.result_type`)
  for (const key of ['online_raw_score', 'offline_raw_score', 'question_count', 'answered_count', 'emotion_collapse_count']) {
    number(required(details, key, path, c), `${path}.${key}`, c)
  }
  const completion = required(details, 'completion_ratio', path, c)
  if (completion !== undefined && completion !== null) number(completion, `${path}.completion_ratio`, c)
  const modules = required(details, 'module_scores', path, c)
  if (modules !== undefined && modules !== null) {
    const items = list(modules, `${path}.module_scores`, c)
    if (items) {
      for (let index = 0; index < items.length; index += 1) {
        const itemPath = `${path}.module_scores[${index}]`
        const item = record(items[index], itemPath, c)
        if (!item) continue
        oneOf(required(item, 'module_type', itemPath, c), ['FINE_MOTOR', 'COGNITION', 'RULE_EXECUTION', 'EMOTION_REGULATION', 'BASIC_SOCIAL', 'SAFETY_OPERATION'] as const, `${itemPath}.module_type`, c)
        number(required(item, 'raw_score', itemPath, c), `${itemPath}.raw_score`, c)
        number(required(item, 'max_score', itemPath, c), `${itemPath}.max_score`, c)
        number(required(item, 'normalized_score', itemPath, c), `${itemPath}.normalized_score`, c)
      }
    }
  }
}

function parseTrainingDetails(value: unknown, path: string, c: Collector): void {
  const details = record(value, path, c)
  if (!details) return
  for (const key of ['total_steps', 'completed_steps', 'skipped_steps', 'failed_steps', 'completion_rate']) {
    const parsed = number(required(details, key, path, c), `${path}.${key}`, c)
    if (parsed !== null && parsed < 0) c.add('VALUE', `${path}.${key}`)
  }
  dateTime(required(details, 'completed_at', path, c), `${path}.completed_at`, c)
}

function parseOperationDetails(value: unknown, path: string, c: Collector): void {
  const details = record(value, path, c)
  if (!details) return
  if (required(details, 'result_type', path, c) !== 'OPERATION_PASS_RATE') c.add('VALUE', `${path}.result_type`)
  number(required(details, 'raw_score', path, c), `${path}.raw_score`, c)
  if (required(details, 'max_score', path, c) !== 18) c.add('VALUE', `${path}.max_score`)
  if (required(details, 'total_items', path, c) !== 9) c.add('VALUE', `${path}.total_items`)
  dateTime(required(details, 'scored_at', path, c), `${path}.scored_at`, c)
  const items = list(required(details, 'items', path, c), `${path}.items`, c)
  if (!items) return
  if (items.length !== 9) c.add('VALUE', `${path}.items`)
  const codes = new Set<string>()
  for (let index = 0; index < items.length; index += 1) {
    const itemPath = `${path}.items[${index}]`
    const item = record(items[index], itemPath, c)
    if (!item) continue
    const code = text(required(item, 'task_operation_code', itemPath, c), `${itemPath}.task_operation_code`, c)
    if (code !== null && codes.has(code)) c.add('DUPLICATE', `${itemPath}.task_operation_code`)
    if (code !== null) codes.add(code)
    const score = number(required(item, 'score', itemPath, c), `${itemPath}.score`, c, true)
    if (score !== null && ![0, 1, 2].includes(score)) c.add('VALUE', `${itemPath}.score`)
  }
}

function parseJobSkillDetails(value: unknown, path: string, c: Collector): void {
  const details = record(value, path, c)
  if (!details) return
  if (required(details, 'result_schema_version', path, c) !== 'job-skill-result-v1.0') c.add('VALUE', `${path}.result_schema_version`)
  const overall = record(required(details, 'overall', path, c), `${path}.overall`, c)
  if (overall) {
    number(required(overall, 'raw_score', `${path}.overall`, c), `${path}.overall.raw_score`, c)
    if (required(overall, 'max_score', `${path}.overall`, c) !== 48) c.add('VALUE', `${path}.overall.max_score`)
    number(required(overall, 'normalized_score', `${path}.overall`, c), `${path}.overall.normalized_score`, c)
    number(required(overall, 'completion_ratio', `${path}.overall`, c), `${path}.overall.completion_ratio`, c)
  }
  const profiles = record(required(details, 'job_module_profiles', path, c), `${path}.job_module_profiles`, c)
  if (!profiles) return
  for (const code of JOB_MODULE_CODES) {
    const profile = record(required(profiles, code, `${path}.job_module_profiles`, c), `${path}.job_module_profiles.${code}`, c)
    if (!profile) continue
    for (const key of ['online_raw', 'online_max', 'offline_raw', 'offline_max', 'score_rate']) {
      number(required(profile, key, `${path}.job_module_profiles.${code}`, c), `${path}.job_module_profiles.${code}.${key}`, c)
    }
  }
}

function parseResultSnapshot(value: unknown, path: string, c: Collector): TaskResultSnapshot | JobSkillResultSnapshot | null {
  const snapshot = record(value, path, c)
  if (!snapshot) return null
  const resultType = oneOf(required(snapshot, 'result_type', path, c), ['ABILITY_SCORE', 'TRAINING_COMPLETION', 'OPERATION_PASS_RATE', 'JOB_SKILL_SCORE'] as const, `${path}.result_type`, c)
  text(required(snapshot, 'result_id', path, c), `${path}.result_id`, c)
  const sourceType = oneOf(required(snapshot, 'source_aggregate_type', path, c), ['ASSESSMENT_SESSION', 'TRAINING_SESSION'] as const, `${path}.source_aggregate_type`, c)
  text(required(snapshot, 'source_aggregate_id', path, c), `${path}.source_aggregate_id`, c)
  dateTime(required(snapshot, 'generated_at', path, c), `${path}.generated_at`, c)
  nullableText(required(snapshot, 'strategy_id', path, c), `${path}.strategy_id`, c)
  const strategyType = required(snapshot, 'strategy_type', path, c)
  if (strategyType !== null) oneOf(strategyType, ['BASELINE_ASSESSMENT', 'MOCK_EXAM', 'TRAINING_PRACTICE', 'JOB_SKILL_ASSESSMENT'] as const, `${path}.strategy_type`, c)
  nullableNumber(required(snapshot, 'raw_score', path, c), `${path}.raw_score`, c)
  nullableNumber(required(snapshot, 'max_score', path, c), `${path}.max_score`, c)
  number(required(snapshot, 'normalized_score', path, c), `${path}.normalized_score`, c)
  nullableNumber(required(snapshot, 'completion_ratio', path, c), `${path}.completion_ratio`, c)
  text(required(snapshot, 'level_result', path, c), `${path}.level_result`, c)
  boolean(required(snapshot, 'safety_overridden', path, c), `${path}.safety_overridden`, c)
  nullableText(required(snapshot, 'redline_incident_id', path, c), `${path}.redline_incident_id`, c)
  dateTime(required(snapshot, 'source_started_at', path, c), `${path}.source_started_at`, c, true)
  dateTime(required(snapshot, 'source_completed_at', path, c), `${path}.source_completed_at`, c, true)

  if (resultType === 'ABILITY_SCORE') {
    if (sourceType !== 'ASSESSMENT_SESSION') c.add('MISMATCH', `${path}.source_aggregate_type`)
    parseAbilityDetails(required(snapshot, 'details', path, c), `${path}.details`, c)
  } else if (resultType === 'TRAINING_COMPLETION') {
    if (sourceType !== 'TRAINING_SESSION') c.add('MISMATCH', `${path}.source_aggregate_type`)
    parseTrainingDetails(required(snapshot, 'details', path, c), `${path}.details`, c)
  } else if (resultType === 'OPERATION_PASS_RATE') {
    if (sourceType !== 'ASSESSMENT_SESSION') c.add('MISMATCH', `${path}.source_aggregate_type`)
    parseOperationDetails(required(snapshot, 'details', path, c), `${path}.details`, c)
  } else if (resultType === 'JOB_SKILL_SCORE') {
    if (sourceType !== 'ASSESSMENT_SESSION') c.add('MISMATCH', `${path}.source_aggregate_type`)
    parseJobSkillDetails(required(snapshot, 'details', path, c), `${path}.details`, c)
  }

  return c.valid ? (snapshot as unknown as TaskResultSnapshot | JobSkillResultSnapshot) : null
}

function parsePlacementAdvice(value: unknown, path: string, c: Collector, requireDisabled: boolean): boolean | null {
  const advice = record(value, path, c)
  if (!advice) return null
  const enabled = boolean(required(advice, 'enabled', path, c), `${path}.enabled`, c)
  if (enabled === true) {
    if (requireDisabled) c.add('VALUE', `${path}.enabled`)
    const recommendation = record(required(advice, 'recommendation', path, c), `${path}.recommendation`, c)
    if (recommendation) {
      text(required(recommendation, 'recommendation_code', `${path}.recommendation`, c), `${path}.recommendation.recommendation_code`, c)
      text(required(recommendation, 'recommendation_text', `${path}.recommendation`, c), `${path}.recommendation.recommendation_text`, c)
      stringList(required(recommendation, 'conditions', `${path}.recommendation`, c), `${path}.recommendation.conditions`, c)
    }
    if (required(advice, 'reason_disabled', path, c) !== null) c.add('MISMATCH', `${path}.reason_disabled`)
  } else if (enabled === false) {
    if (required(advice, 'recommendation', path, c) !== null) c.add('MISMATCH', `${path}.recommendation`)
    text(required(advice, 'reason_disabled', path, c), `${path}.reason_disabled`, c)
  }
  return enabled
}

function parseBaseContent(input: JsonRecord, c: Collector): ReportContentBaseAbility | null {
  const path = '$'
  if (required(input, 'report_schema_version', path, c) !== 'task-report-v1.1') c.add('VALUE', '$.report_schema_version')
  if (required(input, 'report_scope', path, c) !== 'BASE_ABILITY') c.add('VALUE', '$.report_scope')
  if (required(input, 'report_type', path, c) !== 'FULL_REPORT') c.add('VALUE', '$.report_type')
  dateTime(required(input, 'generated_at', path, c), '$.generated_at', c)

  const meta = record(required(input, 'assessment_meta', path, c), '$.assessment_meta', c)
  if (meta) {
    for (const key of ['session_id', 'strategy_id', 'scoring_engine_version', 'content_schema_version', 'scoring_schema_version']) {
      text(required(meta, key, '$.assessment_meta', c), `$.assessment_meta.${key}`, c)
    }
    number(required(meta, 'strategy_version', '$.assessment_meta', c), '$.assessment_meta.strategy_version', c, true)
    number(required(meta, 'question_bank_version', '$.assessment_meta', c), '$.assessment_meta.question_bank_version', c, true)
    stringList(required(meta, 'import_batch_ids', '$.assessment_meta', c), '$.assessment_meta.import_batch_ids', c)
    parseAssetReferences(required(meta, 'asset_references', '$.assessment_meta', c), '$.assessment_meta.asset_references', c)
    const count = number(required(meta, 'sitting_count', '$.assessment_meta', c), '$.assessment_meta.sitting_count', c, true)
    const sittings = list(required(meta, 'sittings', '$.assessment_meta', c), '$.assessment_meta.sittings', c)
    if (count !== null && sittings && count !== sittings.length) c.add('MISMATCH', '$.assessment_meta.sitting_count')
    parseSittings(sittings, '$.assessment_meta.sittings', c)
    number(required(meta, 'completion_ratio', '$.assessment_meta', c), '$.assessment_meta.completion_ratio', c)
    nullableText(required(meta, 'termination_reason', '$.assessment_meta', c), '$.assessment_meta.termination_reason', c)
    const pilot = boolean(required(meta, 'pilot_mode', '$.assessment_meta', c), '$.assessment_meta.pilot_mode', c)
    const usage = oneOf(required(meta, 'report_usage', '$.assessment_meta', c), ['PILOT_ONLY', 'FORMAL'] as const, '$.assessment_meta.report_usage', c)
    if (pilot === true && usage !== 'PILOT_ONLY') c.add('MISMATCH', '$.assessment_meta.report_usage')
    if (pilot === false && usage !== 'FORMAL') c.add('MISMATCH', '$.assessment_meta.report_usage')
  }

  const sourceMeta = record(required(input, 'source_meta', path, c), '$.source_meta', c)
  let snapshots: Array<TaskResultSnapshot | JobSkillResultSnapshot> | null = null
  if (sourceMeta) {
    text(required(sourceMeta, 'task_closure_id', '$.source_meta', c), '$.source_meta.task_closure_id', c)
    number(required(sourceMeta, 'cycle_no', '$.source_meta', c), '$.source_meta.cycle_no', c, true)
    number(required(sourceMeta, 'closure_revision', '$.source_meta', c), '$.source_meta.closure_revision', c, true)
    const sourceSetHash = assertHash(required(sourceMeta, 'source_set_hash', '$.source_meta', c), '$.source_meta.source_set_hash', c)
    const values = list(required(sourceMeta, 'task_result_snapshots', '$.source_meta', c), '$.source_meta.task_result_snapshots', c)
    if (values) {
      if (values.length !== 3) c.add('VALUE', '$.source_meta.task_result_snapshots')
      snapshots = values.map((item, index) => parseResultSnapshot(item, `$.source_meta.task_result_snapshots[${index}]`, c)).filter((item): item is TaskResultSnapshot | JobSkillResultSnapshot => item !== null)
      const types = snapshots.map((snapshot) => snapshot.result_type)
      if (!sameJson(types, BASE_RESULT_TYPES)) c.add('MISMATCH', '$.source_meta.task_result_snapshots')
      const ids = snapshots.map((snapshot) => snapshot.result_id)
      if (new Set(ids).size !== ids.length) c.add('DUPLICATE', '$.source_meta.task_result_snapshots')
      if (sourceSetHash !== null) {
        const expected = sha256CanonicalJson({
          task_closure_id: sourceMeta.task_closure_id,
          cycle_no: sourceMeta.cycle_no,
          closure_revision: sourceMeta.closure_revision,
          task_result_snapshots: values
        })
        if (sourceSetHash !== expected) c.add('MISMATCH', '$.source_meta.source_set_hash')
      }
    }
  }

  const scoreSummary = record(required(input, 'score_summary', path, c), '$.score_summary', c)
  const profileValues = list(required(input, 'module_profiles', path, c), '$.module_profiles', c)
  const training = record(required(input, 'training', path, c), '$.training', c)
  const operation = record(required(input, 'operation', path, c), '$.operation', c)
  if (snapshots && snapshots.length === 3 && scoreSummary) {
    const summaryKeys = ['ability_score', 'training_completion', 'operation_pass_rate'] as const
    for (let index = 0; index < snapshots.length; index += 1) {
      const item = record(required(scoreSummary, summaryKeys[index], '$.score_summary', c), `$.score_summary.${summaryKeys[index]}`, c)
      if (!item) continue
      const snapshot = snapshots[index]
      for (const key of ['result_id', 'raw_score', 'max_score', 'normalized_score', 'completion_ratio', 'level_result'] as const) {
        if (!sameJson(item[key], snapshot[key])) c.add('MISMATCH', `$.score_summary.${summaryKeys[index]}.${key}`)
      }
    }
    const ability = snapshots[0] as AbilityResultSnapshot
    const trainingSnapshot = snapshots[1] as TrainingCompletionResultSnapshot
    const operationSnapshot = snapshots[2] as OperationPassRateResultSnapshot
    if (profileValues && !sameJson(profileValues, (ability.details as { module_scores?: unknown[] }).module_scores ?? [])) c.add('MISMATCH', '$.module_profiles')
    if (training && !sameJson(training, { result_id: trainingSnapshot.result_id, ...(trainingSnapshot.details as object) })) c.add('MISMATCH', '$.training')
    if (operation && !sameJson(operation, { result_id: operationSnapshot.result_id, ...(operationSnapshot.details as object) })) c.add('MISMATCH', '$.operation')
  }

  const evidence = record(required(input, 'evidence_summary', path, c), '$.evidence_summary', c)
  if (evidence) {
    const types = list(required(evidence, 'evidence_types', '$.evidence_summary', c), '$.evidence_summary.evidence_types', c)
    if (types) for (let index = 0; index < types.length; index += 1) oneOf(types[index], ['SOFTWARE_BEHAVIOR', 'SITUATIONAL_JUDGMENT', 'DIRECT_PERFORMANCE', 'SELF_REPORT', 'SELF_REPORT_PLUS_BEHAVIOR', 'EMBEDDED_OBSERVATION'] as const, `$.evidence_summary.evidence_types[${index}]`, c)
    stringList(required(evidence, 'observations', '$.evidence_summary', c), '$.evidence_summary.observations', c)
  }
  const support = record(required(input, 'support_summary', path, c), '$.support_summary', c)
  if (support) {
    const distribution = record(required(support, 'prompt_level_distribution', '$.support_summary', c), '$.support_summary.prompt_level_distribution', c)
    if (distribution) for (const key of Object.keys(distribution)) oneOf(key, ['P0', 'P1', 'P2', 'P3'] as const, `$.support_summary.prompt_level_distribution.${key}`, c)
    stringList(required(support, 'accommodations_used', '$.support_summary', c), '$.support_summary.accommodations_used', c)
    number(required(support, 'instruction_replay_count', '$.support_summary', c), '$.support_summary.instruction_replay_count', c, true)
  }
  const administration = record(required(input, 'administration_status', path, c), '$.administration_status', c)
  if (administration) {
    text(required(administration, 'status', '$.administration_status', c), '$.administration_status.status', c)
    number(required(administration, 'observation_completion_ratio', '$.administration_status', c), '$.administration_status.observation_completion_ratio', c)
  }
  const observations = list(required(input, 'behavior_observations', path, c), '$.behavior_observations', c)
  if (observations) for (let index = 0; index < observations.length; index += 1) {
    const item = record(observations[index], `$.behavior_observations[${index}]`, c)
    if (!item) continue
    text(required(item, 'observation_code', `$.behavior_observations[${index}]`, c), `$.behavior_observations[${index}].observation_code`, c)
    boolean(required(item, 'observed', `$.behavior_observations[${index}]`, c), `$.behavior_observations[${index}].observed`, c)
    stringList(required(item, 'behavior_codes', `$.behavior_observations[${index}]`, c), `$.behavior_observations[${index}].behavior_codes`, c)
    const promptLevel = required(item, 'prompt_level', `$.behavior_observations[${index}]`, c)
    if (promptLevel !== null) oneOf(promptLevel, ['P0', 'P1', 'P2', 'P3'] as const, `$.behavior_observations[${index}].prompt_level`, c)
  }
  stringList(required(input, 'validity_limitations', path, c), '$.validity_limitations', c)
  const safety = record(required(input, 'safety_summary', path, c), '$.safety_summary', c)
  if (safety) {
    const incidents = list(required(safety, 'safety_incidents', '$.safety_summary', c), '$.safety_summary.safety_incidents', c)
    if (incidents) for (let index = 0; index < incidents.length; index += 1) {
      const incident = record(incidents[index], `$.safety_summary.safety_incidents[${index}]`, c)
      if (!incident) continue
      text(required(incident, 'incident_id', `$.safety_summary.safety_incidents[${index}]`, c), `$.safety_summary.safety_incidents[${index}].incident_id`, c)
      text(required(incident, 'reason_code', `$.safety_summary.safety_incidents[${index}]`, c), `$.safety_summary.safety_incidents[${index}].reason_code`, c)
      dateTime(required(incident, 'occurred_at', `$.safety_summary.safety_incidents[${index}]`, c), `$.safety_summary.safety_incidents[${index}].occurred_at`, c)
    }
    const overridden = boolean(required(safety, 'safety_overridden', '$.safety_summary', c), '$.safety_summary.safety_overridden', c)
    if (overridden === true) c.add('VALUE', '$.safety_summary.safety_overridden')
  }
  const placementEnabled = parsePlacementAdvice(required(input, 'placement_advice', path, c), '$.placement_advice', c, false)
  const completionRatio = meta ? number(meta.completion_ratio, '$.assessment_meta.completion_ratio', c) : null
  const pilotMode = meta ? boolean(meta.pilot_mode, '$.assessment_meta.pilot_mode', c) : null
  if ((pilotMode === true || (completionRatio !== null && completionRatio < 1)) && placementEnabled === true) c.add('VALUE', '$.placement_advice.enabled')

  return c.valid ? (input as unknown as ReportContentBaseAbility) : null
}

function parseJobSkillContent(input: JsonRecord, c: Collector): ValidatedReportContentJobSkill | null {
  if (required(input, 'report_schema_version', '$', c) !== 'job-skill-report-v1.0') c.add('VALUE', '$.report_schema_version')
  if (required(input, 'report_scope', '$', c) !== 'JOB_SKILL') c.add('VALUE', '$.report_scope')
  if (required(input, 'report_type', '$', c) !== 'FULL_REPORT') c.add('VALUE', '$.report_type')
  dateTime(required(input, 'generated_at', '$', c), '$.generated_at', c)
  const meta = record(required(input, 'assessment_meta', '$', c), '$.assessment_meta', c)
  if (meta) {
    for (const key of ['session_id', 'strategy_id', 'scoring_engine_version', 'content_schema_version', 'scoring_schema_version', 'report_schema_version', 'job_code']) {
      text(required(meta, key, '$.assessment_meta', c), `$.assessment_meta.${key}`, c)
    }
    number(required(meta, 'strategy_version', '$.assessment_meta', c), '$.assessment_meta.strategy_version', c, true)
    number(required(meta, 'sitting_count', '$.assessment_meta', c), '$.assessment_meta.sitting_count', c, true)
    number(required(meta, 'completion_ratio', '$.assessment_meta', c), '$.assessment_meta.completion_ratio', c)
    number(required(meta, 'observation_completion_ratio', '$.assessment_meta', c), '$.assessment_meta.observation_completion_ratio', c)
  }
  const profiles = list(required(input, 'job_module_profiles', '$', c), '$.job_module_profiles', c)
  if (profiles) {
    if (profiles.length !== 6) c.add('VALUE', '$.job_module_profiles')
    const codes = new Set<string>()
    for (let index = 0; index < profiles.length; index += 1) {
      const item = record(profiles[index], `$.job_module_profiles[${index}]`, c)
      if (!item) continue
      const code = oneOf(required(item, 'job_module_code', `$.job_module_profiles[${index}]`, c), JOB_MODULE_CODES, `$.job_module_profiles[${index}].job_module_code`, c)
      if (code !== null && codes.has(code)) c.add('DUPLICATE', `$.job_module_profiles[${index}].job_module_code`)
      if (code !== null) codes.add(code)
      for (const key of ['module_name', 'online_raw_score', 'online_max_score', 'offline_raw_score', 'offline_max_score', 'score_rate', 'response_status_distribution', 'key_observations']) {
        required(item, key, `$.job_module_profiles[${index}]`, c)
      }
    }
  }
  const online = record(required(input, 'online_knowledge_summary', '$', c), '$.online_knowledge_summary', c)
  if (online) for (const key of ['raw_score', 'max_score', 'normalized_score']) number(required(online, key, '$.online_knowledge_summary', c), `$.online_knowledge_summary.${key}`, c)
  const offline = record(required(input, 'offline_performance_summary', '$', c), '$.offline_performance_summary', c)
  if (offline) for (const key of ['raw_score', 'max_score', 'normalized_score', 'completed_item_count', 'total_item_count']) number(required(offline, key, '$.offline_performance_summary', c), `$.offline_performance_summary.${key}`, c)
  const administration = record(required(input, 'administration_summary', '$', c), '$.administration_summary', c)
  if (administration) {
    if (required(administration, 'report_usage', '$.administration_summary', c) !== 'MVP_DEMO_PROFILE_ONLY') c.add('VALUE', '$.administration_summary.report_usage')
    number(required(administration, 'observation_completion_ratio', '$.administration_summary', c), '$.administration_summary.observation_completion_ratio', c)
    number(required(administration, 'completion_ratio', '$.administration_summary', c), '$.administration_summary.completion_ratio', c)
    parseSittings(required(administration, 'sittings', '$.administration_summary', c), '$.administration_summary.sittings', c)
    nullableText(required(administration, 'termination_reason', '$.administration_summary', c), '$.administration_summary.termination_reason', c)
  }
  const source = record(required(input, 'source_meta', '$', c), '$.source_meta', c)
  if (source) {
    const snapshot = parseResultSnapshot(required(source, 'result_snapshot', '$.source_meta', c), '$.source_meta.result_snapshot', c)
    if (!snapshot || snapshot.result_type !== 'JOB_SKILL_SCORE') c.add('MISMATCH', '$.source_meta.result_snapshot')
    number(required(source, 'question_bank_version', '$.source_meta', c), '$.source_meta.question_bank_version', c, true)
    stringList(required(source, 'import_batch_ids', '$.source_meta', c), '$.source_meta.import_batch_ids', c)
    parseAssetReferences(required(source, 'asset_references', '$.source_meta', c), '$.source_meta.asset_references', c)
  }
  parsePlacementAdvice(required(input, 'placement_advice', '$', c), '$.placement_advice', c, true)
  for (const key of ['overall_summary', 'support_summary', 'teacher_observations', 'safety_summary', 'validity_limitations', 'recommended_training_focus', 'recommended_training_tasks']) required(input, key, '$', c)
  return c.valid ? (input as unknown as ValidatedReportContentJobSkill) : null
}

function preRecordsEmpty(value: JsonRecord): boolean {
  return Object.values(value).every((entry) => Array.isArray(entry) ? entry.length === 0 : isRecord(entry) ? Object.keys(entry).length === 0 : false)
}

function parseSafetyBindingMetadata(value: unknown, path: string, c: Collector): void {
  const metadata = record(value, path, c)
  if (!metadata) return
  const aggregateType = oneOf(required(metadata, 'aggregate_type', path, c), ['ASSESSMENT_SESSION', 'TRAINING_SESSION'] as const, `${path}.aggregate_type`, c)
  text(required(metadata, 'aggregate_id', path, c), `${path}.aggregate_id`, c)
  if (aggregateType === 'ASSESSMENT_SESSION') {
    assertOnlyKeys(metadata, ['aggregate_type', 'aggregate_id', 'strategy_id', 'strategy_version', 'question_bank_version', 'import_batch_ids', 'asset_references', 'scoring_engine_version', 'content_schema_version', 'scoring_schema_version', 'sittings', 'completion_ratio', 'started_at', 'completed_at'], path, c)
    for (const key of ['strategy_id', 'scoring_engine_version', 'content_schema_version', 'scoring_schema_version']) text(required(metadata, key, path, c), `${path}.${key}`, c)
    for (const key of ['strategy_version', 'question_bank_version']) number(required(metadata, key, path, c), `${path}.${key}`, c, true)
    stringList(required(metadata, 'import_batch_ids', path, c), `${path}.import_batch_ids`, c)
    parseAssetReferences(required(metadata, 'asset_references', path, c), `${path}.asset_references`, c)
    parseSittings(required(metadata, 'sittings', path, c), `${path}.sittings`, c)
    number(required(metadata, 'completion_ratio', path, c), `${path}.completion_ratio`, c)
    dateTime(required(metadata, 'started_at', path, c), `${path}.started_at`, c, true)
    dateTime(required(metadata, 'completed_at', path, c), `${path}.completed_at`, c, true)
  } else if (aggregateType === 'TRAINING_SESSION') {
    assertOnlyKeys(metadata, ['aggregate_type', 'aggregate_id', 'strategy_availability', 'strategy_id', 'strategy_version', 'asset_references', 'started_at', 'completed_at', 'step_status_summary', 'pre_redline_steps'], path, c)
    const availability = oneOf(required(metadata, 'strategy_availability', path, c), ['CONFIGURED', 'NOT_CONFIGURED'] as const, `${path}.strategy_availability`, c)
    if (availability === 'CONFIGURED') {
      text(required(metadata, 'strategy_id', path, c), `${path}.strategy_id`, c)
      number(required(metadata, 'strategy_version', path, c), `${path}.strategy_version`, c, true)
    } else if (availability === 'NOT_CONFIGURED') {
      if (required(metadata, 'strategy_id', path, c) !== null) c.add('MISMATCH', `${path}.strategy_id`)
      if (required(metadata, 'strategy_version', path, c) !== null) c.add('MISMATCH', `${path}.strategy_version`)
    }
    parseAssetReferences(required(metadata, 'asset_references', path, c), `${path}.asset_references`, c)
    dateTime(required(metadata, 'started_at', path, c), `${path}.started_at`, c, true)
    dateTime(required(metadata, 'completed_at', path, c), `${path}.completed_at`, c, true)
    const summary = record(required(metadata, 'step_status_summary', path, c), `${path}.step_status_summary`, c)
    if (summary) for (const key of Object.keys(summary)) number(summary[key], `${path}.step_status_summary.${key}`, c)
    const steps = list(required(metadata, 'pre_redline_steps', path, c), `${path}.pre_redline_steps`, c)
    if (steps) for (let index = 0; index < steps.length; index += 1) {
      const step = record(steps[index], `${path}.pre_redline_steps[${index}]`, c)
      if (!step) continue
      text(required(step, 'step_record_id', `${path}.pre_redline_steps[${index}]`, c), `${path}.pre_redline_steps[${index}].step_record_id`, c)
      text(required(step, 'status', `${path}.pre_redline_steps[${index}]`, c), `${path}.pre_redline_steps[${index}].status`, c)
      number(required(step, 'attempt_count', `${path}.pre_redline_steps[${index}]`, c), `${path}.pre_redline_steps[${index}].attempt_count`, c, true)
      dateTime(required(step, 'occurred_at', `${path}.pre_redline_steps[${index}]`, c), `${path}.pre_redline_steps[${index}].occurred_at`, c)
    }
  }
}

function parseSafetyContent(input: JsonRecord, c: Collector): ReportContentSafetyTermination | null {
  if (required(input, 'report_schema_version', '$', c) !== 'safety-termination-report-v1.0') c.add('VALUE', '$.report_schema_version')
  if (required(input, 'report_scope', '$', c) !== 'SAFETY') c.add('VALUE', '$.report_scope')
  if (required(input, 'report_type', '$', c) !== 'SAFETY_TERMINATION_REPORT') c.add('VALUE', '$.report_type')
  const sourceScope = oneOf(required(input, 'source_scope', '$', c), SOURCE_SCOPES, '$.source_scope', c)
  dateTime(required(input, 'generated_at', '$', c), '$.generated_at', c)
  const incident = record(required(input, 'incident_snapshot', '$', c), '$.incident_snapshot', c)
  if (incident) {
    for (const key of ['incident_id', 'student_id', 'job_code', 'task_code', 'reason_code', 'context_phase', 'description', 'triggered_by', 'confirmed_by']) text(required(incident, key, '$.incident_snapshot', c), `$.incident_snapshot.${key}`, c)
    oneOf(required(incident, 'status_at_generation', '$.incident_snapshot', c), ['CONFIRMED', 'RESOLVED'] as const, '$.incident_snapshot.status_at_generation', c)
    dateTime(required(incident, 'occurred_at', '$.incident_snapshot', c), '$.incident_snapshot.occurred_at', c)
    dateTime(required(incident, 'confirmed_at', '$.incident_snapshot', c), '$.incident_snapshot.confirmed_at', c)
  }
  const bindings = list(required(input, 'binding_snapshots', '$', c), '$.binding_snapshots', c)
  if (bindings) for (let index = 0; index < bindings.length; index += 1) {
    const binding = record(bindings[index], `$.binding_snapshots[${index}]`, c)
    if (!binding) continue
    oneOf(required(binding, 'aggregate_type', `$.binding_snapshots[${index}]`, c), ['ASSESSMENT_SESSION', 'TRAINING_SESSION'] as const, `$.binding_snapshots[${index}].aggregate_type`, c)
    text(required(binding, 'aggregate_id', `$.binding_snapshots[${index}]`, c), `$.binding_snapshots[${index}].aggregate_id`, c)
    text(required(binding, 'pre_status', `$.binding_snapshots[${index}]`, c), `$.binding_snapshots[${index}].pre_status`, c)
    if (required(binding, 'post_status', `$.binding_snapshots[${index}]`, c) !== 'REDLINE_HALTED') c.add('VALUE', `$.binding_snapshots[${index}].post_status`)
  }
  const preRecords = record(required(input, 'pre_redline_records', '$', c), '$.pre_redline_records', c)
  if (preRecords) {
    stringList(required(preRecords, 'result_ids', '$.pre_redline_records', c), '$.pre_redline_records.result_ids', c, true)
    for (const key of ['answer_summary', 'offline_score_summary', 'training_step_summary']) {
      const item = record(required(preRecords, key, '$.pre_redline_records', c), `$.pre_redline_records.${key}`, c)
      if (item) for (const itemKey of Object.keys(item)) number(item[itemKey], `$.pre_redline_records.${key}.${itemKey}`, c)
    }
  }
  const safety = record(required(input, 'safety_summary', '$', c), '$.safety_summary', c)
  if (safety) {
    if (required(safety, 'level_result', '$.safety_summary', c) !== 'LEVEL_FAIL_BY_SAFETY') c.add('VALUE', '$.safety_summary.level_result')
    if (required(safety, 'ordinary_report_blocked', '$.safety_summary', c) !== true) c.add('VALUE', '$.safety_summary.ordinary_report_blocked')
  }
  stringList(required(input, 'validity_limitations', '$', c), '$.validity_limitations', c)
  const lineage = record(required(input, 'correction_lineage', '$', c), '$.correction_lineage', c)
  if (lineage) {
    text(required(lineage, 'root_incident_id', '$.correction_lineage', c), '$.correction_lineage.root_incident_id', c)
    nullableText(required(lineage, 'replaces_incident_id', '$.correction_lineage', c), '$.correction_lineage.replaces_incident_id', c)
    nullableText(required(lineage, 'supersedes_report_id', '$.correction_lineage', c), '$.correction_lineage.supersedes_report_id', c)
  }
  const sourceMeta = record(required(input, 'source_meta', '$', c), '$.source_meta', c)
  if (sourceMeta) {
    const availability = oneOf(required(sourceMeta, 'metadata_availability', '$.source_meta', c), ['NO_BOUND_SESSION', 'BY_BINDING'] as const, '$.source_meta.metadata_availability', c)
    const metadata = list(required(sourceMeta, 'binding_metadata', '$.source_meta', c), '$.source_meta.binding_metadata', c)
    if (metadata) for (let index = 0; index < metadata.length; index += 1) parseSafetyBindingMetadata(metadata[index], `$.source_meta.binding_metadata[${index}]`, c)
    if (sourceScope === 'NO_BOUND_SESSION') {
      if (availability !== 'NO_BOUND_SESSION') c.add('MISMATCH', '$.source_meta.metadata_availability')
      if ((bindings?.length ?? 0) !== 0) c.add('MISMATCH', '$.binding_snapshots')
      if ((metadata?.length ?? 0) !== 0) c.add('MISMATCH', '$.source_meta.binding_metadata')
      if (preRecords && !preRecordsEmpty(preRecords)) c.add('MISMATCH', '$.pre_redline_records')
    } else {
      if (availability !== 'BY_BINDING') c.add('MISMATCH', '$.source_meta.metadata_availability')
      if ((bindings?.length ?? 0) === 0) c.add('VALUE', '$.binding_snapshots')
      if ((metadata?.length ?? 0) !== (bindings?.length ?? 0)) c.add('MISMATCH', '$.source_meta.binding_metadata')
      const bindingKeys = (bindings ?? []).flatMap((binding) => {
        if (!isRecord(binding) || typeof binding.aggregate_type !== 'string' || typeof binding.aggregate_id !== 'string') return []
        return [`${binding.aggregate_type}:${binding.aggregate_id}`]
      })
      const metadataKeys = (metadata ?? []).flatMap((item) => {
        if (!isRecord(item) || typeof item.aggregate_type !== 'string' || typeof item.aggregate_id !== 'string') return []
        return [`${item.aggregate_type}:${item.aggregate_id}`]
      })
      if (new Set(bindingKeys).size !== bindingKeys.length) c.add('DUPLICATE', '$.binding_snapshots')
      if (new Set(metadataKeys).size !== metadataKeys.length || !sameJson([...bindingKeys].sort(), [...metadataKeys].sort())) {
        c.add('MISMATCH', '$.source_meta.binding_metadata')
      }
      const bindingTypes = new Set(bindingKeys.map((key) => key.split(':', 1)[0]))
      if ((sourceScope === 'BASE_ABILITY' || sourceScope === 'JOB_SKILL') && [...bindingTypes].some((type) => type !== 'ASSESSMENT_SESSION')) {
        c.add('MISMATCH', '$.binding_snapshots')
      }
      if (sourceScope === 'TRAINING' && [...bindingTypes].some((type) => type !== 'TRAINING_SESSION')) {
        c.add('MISMATCH', '$.binding_snapshots')
      }
      if (sourceScope === 'MIXED' && (!bindingTypes.has('ASSESSMENT_SESSION') || !bindingTypes.has('TRAINING_SESSION'))) {
        c.add('MISMATCH', '$.binding_snapshots')
      }
    }
  }
  parsePlacementAdvice(required(input, 'placement_advice', '$', c), '$.placement_advice', c, true)
  return c.valid ? (input as unknown as ReportContentSafetyTermination) : null
}

export function parseReportContent(input: unknown): ReportContractResult<ReportContentJson> {
  const c = new Collector()
  const report = record(input, '$', c)
  if (!report) return { valid: false, errors: c.errors }
  const type = required(report, 'report_type', '$', c)
  let value: ReportContentJson | null = null
  if (type === 'SAFETY_TERMINATION_REPORT') value = parseSafetyContent(report, c)
  else if (report.report_scope === 'JOB_SKILL') value = parseJobSkillContent(report, c)
  else value = parseBaseContent(report, c)
  return c.valid && value ? { valid: true, value } : { valid: false, errors: c.errors }
}

export function parseSourceResultIds(input: unknown, allowEmpty = false): ReportContractResult<string[]> {
  const c = new Collector()
  const ids = stringList(input, '$', c, true)
  if (ids && ids.length === 0 && !allowEmpty) c.add('VALUE', '$')
  return c.valid && ids ? { valid: true, value: ids } : { valid: false, errors: c.errors }
}

export function validateReportSourceResultIds(
  report: ReportContentJson,
  input: unknown
): ReportContractResult<string[]> {
  const parsed = parseSourceResultIds(input, report.report_scope === 'SAFETY')
  if (!parsed.valid) return parsed
  const expected = report.report_scope === 'BASE_ABILITY'
    ? report.source_meta.task_result_snapshots.map((snapshot) => snapshot.result_id)
    : report.report_scope === 'JOB_SKILL'
      ? [report.source_meta.result_snapshot.result_id]
      : report.pre_redline_records.result_ids
  if (!sameJson(expected, parsed.value)) {
    return { valid: false, errors: [{ code: 'MISMATCH', path: '$' }] }
  }
  return parsed
}

export function parseGenerateReportParams(input: unknown): ReportContractResult<GenerateReportParams> {
  const c = new Collector()
  const params = record(input, '$', c)
  if (!params) return { valid: false, errors: c.errors }
  text(required(params, 'callerUserId', '$', c), '$.callerUserId', c)
  text(required(params, 'callerRole', '$', c), '$.callerRole', c)
  const scope = oneOf(required(params, 'reportScope', '$', c), REPORT_SCOPES, '$.reportScope', c)
  const targetKey = scope === 'BASE_ABILITY' ? 'taskClosureId' : scope === 'JOB_SKILL' ? 'resultId' : scope === 'SAFETY' ? 'incidentId' : null
  if (targetKey) {
    assertOnlyKeys(params, ['callerUserId', 'callerRole', 'reportScope', targetKey], '$', c)
    text(required(params, targetKey, '$', c), `$.${targetKey}`, c)
  }
  return c.valid
    ? { valid: true, value: params as unknown as GenerateReportParams }
    : { valid: false, errors: c.errors }
}

function parseTaskClosurePayload(value: unknown, eventType: 'TASK_CLOSURE_CONFIRMED' | 'TASK_CLOSURE_REPLACED'): ReportContractResult<TaskClosureConfirmedPayload | TaskClosureReplacedPayload> {
  const c = new Collector()
  const payload = record(value, '$', c)
  if (!payload) return { valid: false, errors: c.errors }
  const prefix = eventType === 'TASK_CLOSURE_CONFIRMED' ? 'task_closure_id' : 'new_task_closure_id'
  for (const key of [prefix, 'student_id', 'job_code', 'task_code']) text(required(payload, key, '$', c), `$.${key}`, c)
  number(required(payload, 'cycle_no', '$', c), '$.cycle_no', c, true)
  const revision = number(required(payload, 'closure_revision', '$', c), '$.closure_revision', c, true)
  if (revision !== null && revision < 1) c.add('VALUE', '$.closure_revision')
  if (eventType === 'TASK_CLOSURE_CONFIRMED' && payload.closure_revision !== 1) c.add('VALUE', '$.closure_revision')
  const status = oneOf(required(payload, 'status', '$', c), ['CONFIRMED', 'SUPERSEDED'] as const, '$.status', c)
  const isCycleHead = boolean(required(payload, 'is_cycle_head', '$', c), '$.is_cycle_head', c)
  if (eventType === 'TASK_CLOSURE_CONFIRMED') {
    if (!isAllowedTaskClosureConfirmedState(status, isCycleHead)) c.add('MISMATCH', '$.status')
  } else if (!isAllowedTaskClosureReplacementState(status, isCycleHead)) {
    c.add('MISMATCH', '$.is_cycle_head')
  }
  const ids = parseSourceResultIds(required(payload, 'source_result_ids', '$', c))
  if (!ids.valid || ids.value.length !== 3) c.add('VALUE', '$.source_result_ids')
  const snapshots = list(required(payload, 'task_result_snapshots', '$', c), '$.task_result_snapshots', c)
  if (snapshots) {
    if (snapshots.length !== 3) c.add('VALUE', '$.task_result_snapshots')
    const parsedSnapshots = snapshots.map((snapshot, index) => parseResultSnapshot(snapshot, `$.task_result_snapshots[${index}]`, c)).filter((snapshot): snapshot is TaskResultSnapshot | JobSkillResultSnapshot => snapshot !== null)
    if (!sameJson(parsedSnapshots.map((snapshot) => snapshot.result_type), BASE_RESULT_TYPES)) c.add('MISMATCH', '$.task_result_snapshots')
    if (ids.valid && !sameJson(ids.value, parsedSnapshots.map((snapshot) => snapshot.result_id))) c.add('MISMATCH', '$.source_result_ids')
  }
  if (eventType === 'TASK_CLOSURE_CONFIRMED') {
    text(required(payload, 'confirmed_by', '$', c), '$.confirmed_by', c)
    dateTime(required(payload, 'confirmed_at', '$', c), '$.confirmed_at', c)
    stringList(required(payload, 'superseded_task_closure_ids', '$', c), '$.superseded_task_closure_ids', c, true)
    stringList(required(payload, 'superseded_report_ids', '$', c), '$.superseded_report_ids', c, true)
  } else {
    text(required(payload, 'old_task_closure_id', '$', c), '$.old_task_closure_id', c)
    text(required(payload, 'correction_reason', '$', c), '$.correction_reason', c)
    stringList(required(payload, 'reused_result_ids', '$', c), '$.reused_result_ids', c, true)
    stringList(required(payload, 'new_result_ids', '$', c), '$.new_result_ids', c, true)
    text(required(payload, 'replaced_by', '$', c), '$.replaced_by', c)
    dateTime(required(payload, 'replaced_at', '$', c), '$.replaced_at', c)
    stringList(required(payload, 'archived_report_ids', '$', c), '$.archived_report_ids', c, true)
  }
  return c.valid
    ? { valid: true, value: payload as unknown as TaskClosureConfirmedPayload | TaskClosureReplacedPayload }
    : { valid: false, errors: c.errors }
}

function parseReportGeneratedPayload(value: unknown): ReportContractResult<ReportGeneratedV2Payload> {
  const c = new Collector()
  const payload = record(value, '$', c)
  if (!payload) return { valid: false, errors: c.errors }
  for (const key of ['report_id', 'student_id', 'job_code', 'task_code', 'report_title', 'generated_by', 'report_schema_version', 'report_builder_version', 'lineage_key', 'source_set_hash', 'content_hash', 'generation_key']) text(required(payload, key, '$', c), `$.${key}`, c)
  const sourceAggregateId = text(required(payload, 'source_aggregate_id', '$', c), '$.source_aggregate_id', c)
  const reportType = oneOf(required(payload, 'report_type', '$', c), REPORT_TYPES, '$.report_type', c)
  const scope = oneOf(required(payload, 'report_scope', '$', c), REPORT_SCOPES, '$.report_scope', c)
  const sourceAggregateType = oneOf(required(payload, 'source_aggregate_type', '$', c), ['ASSESSMENT_SESSION', 'TRAINING_SESSION', 'SAFETY_INCIDENT'] as const, '$.source_aggregate_type', c)
  const resultIds = stringList(required(payload, 'result_ids', '$', c), '$.result_ids', c, true)
  const incidentIds = stringList(required(payload, 'incident_ids', '$', c), '$.incident_ids', c, true)
  dateTime(required(payload, 'generated_at', '$', c), '$.generated_at', c)
  number(required(payload, 'report_revision', '$', c), '$.report_revision', c, true)
  assertHash(required(payload, 'lineage_key', '$', c), '$.lineage_key', c)
  assertHash(required(payload, 'source_set_hash', '$', c), '$.source_set_hash', c)
  const contentHash = assertHash(required(payload, 'content_hash', '$', c), '$.content_hash', c)
  assertHash(required(payload, 'generation_key', '$', c), '$.generation_key', c)
  oneOf(required(payload, 'generation_reason', '$', c), ['NORMAL', 'CONTRACT_REPAIR', 'FACTUAL_CORRECTION', 'DUPLICATE_MERGE'] as const, '$.generation_reason', c)
  nullableText(required(payload, 'task_closure_id', '$', c), '$.task_closure_id', c)
  nullableText(required(payload, 'repair_of_report_id', '$', c), '$.repair_of_report_id', c)
  stringList(required(payload, 'superseded_report_ids', '$', c), '$.superseded_report_ids', c, true)
  const content = parseReportContent(required(payload, 'report_content', '$', c))
  if (!content.valid) c.errors.push(...content.errors.map((error) => ({ ...error, path: `$.report_content${error.path.slice(1)}` })))
  if (content.valid) {
    if (scope !== content.value.report_scope) c.add('MISMATCH', '$.report_scope')
    if (reportType !== content.value.report_type) c.add('MISMATCH', '$.report_type')
    if (payload.report_schema_version !== content.value.report_schema_version) c.add('MISMATCH', '$.report_schema_version')
    if (contentHash !== sha256CanonicalJson(content.value)) c.add('MISMATCH', '$.content_hash')
    const sourceIds = validateReportSourceResultIds(content.value, payload.result_ids)
    if (!sourceIds.valid) c.errors.push(...sourceIds.errors.map((error) => ({ ...error, path: `$.result_ids${error.path === '$' ? '' : error.path}` })))
    if (content.value.report_scope === 'BASE_ABILITY') {
      if (sourceAggregateType !== 'ASSESSMENT_SESSION') c.add('MISMATCH', '$.source_aggregate_type')
      if (sourceAggregateId !== content.value.source_meta.task_result_snapshots[0].source_aggregate_id) c.add('MISMATCH', '$.source_aggregate_id')
      if (payload.task_closure_id !== content.value.source_meta.task_closure_id) c.add('MISMATCH', '$.task_closure_id')
      if (payload.source_set_hash !== content.value.source_meta.source_set_hash) c.add('MISMATCH', '$.source_set_hash')
      if ((incidentIds?.length ?? 0) !== 0) c.add('MISMATCH', '$.incident_ids')
    } else if (content.value.report_scope === 'JOB_SKILL') {
      if (sourceAggregateType !== 'ASSESSMENT_SESSION') c.add('MISMATCH', '$.source_aggregate_type')
      if (sourceAggregateId !== content.value.source_meta.result_snapshot.source_aggregate_id) c.add('MISMATCH', '$.source_aggregate_id')
      if (payload.task_closure_id !== null) c.add('MISMATCH', '$.task_closure_id')
      if ((resultIds?.length ?? 0) !== 1) c.add('MISMATCH', '$.result_ids')
      if ((incidentIds?.length ?? 0) !== 0) c.add('MISMATCH', '$.incident_ids')
    } else {
      if (sourceAggregateType !== 'SAFETY_INCIDENT') c.add('MISMATCH', '$.source_aggregate_type')
      if (sourceAggregateId !== content.value.incident_snapshot.incident_id) c.add('MISMATCH', '$.source_aggregate_id')
      if (sourceAggregateId === null || !incidentIds?.includes(sourceAggregateId)) c.add('MISMATCH', '$.incident_ids')
      if (payload.task_closure_id !== null) c.add('MISMATCH', '$.task_closure_id')
    }
  }
  return c.valid
    ? { valid: true, value: payload as unknown as ReportGeneratedV2Payload }
    : { valid: false, errors: c.errors }
}

function parseLifecyclePayload<T extends F7EventPayload>(value: unknown, type: 'PLACEMENT_REVIEW_CONFIRMED' | 'REPORT_LOCKED' | 'REPORT_EXPORTED' | 'SAFETY_INCIDENT_VOIDED' | 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'): ReportContractResult<T> {
  const c = new Collector()
  const payload = record(value, '$', c)
  if (!payload) return { valid: false, errors: c.errors }
  if (type === 'PLACEMENT_REVIEW_CONFIRMED') {
    text(required(payload, 'report_id', '$', c), '$.report_id', c)
    text(required(payload, 'reviewed_by', '$', c), '$.reviewed_by', c)
    dateTime(required(payload, 'reviewed_at', '$', c), '$.reviewed_at', c)
    assertHash(required(payload, 'placement_advice_hash', '$', c), '$.placement_advice_hash', c)
  } else if (type === 'REPORT_LOCKED') {
    text(required(payload, 'report_id', '$', c), '$.report_id', c)
    text(required(payload, 'locked_by', '$', c), '$.locked_by', c)
    dateTime(required(payload, 'locked_at', '$', c), '$.locked_at', c)
    nullableText(required(payload, 'lock_reason', '$', c), '$.lock_reason', c)
    assertHash(required(payload, 'content_hash', '$', c), '$.content_hash', c)
    oneOf(required(payload, 'status_before', '$', c), ['GENERATED', 'EXPORTED'] as const, '$.status_before', c)
    if (required(payload, 'status_after', '$', c) !== 'LOCKED') c.add('VALUE', '$.status_after')
  } else if (type === 'REPORT_EXPORTED') {
    for (const key of ['report_id', 'export_path', 'exported_by', 'file_asset_id']) text(required(payload, key, '$', c), `$.${key}`, c)
    if (required(payload, 'export_format', '$', c) !== 'HTML') c.add('VALUE', '$.export_format')
    dateTime(required(payload, 'exported_at', '$', c), '$.exported_at', c)
    assertHash(required(payload, 'file_hash', '$', c), '$.file_hash', c)
    number(required(payload, 'file_size_bytes', '$', c), '$.file_size_bytes', c, true)
    if (required(payload, 'mime_type', '$', c) !== 'text/html') c.add('VALUE', '$.mime_type')
    assertHash(required(payload, 'content_hash', '$', c), '$.content_hash', c)
    const statusBefore = oneOf(required(payload, 'status_before', '$', c), REPORT_EXPORT_STATUS_BEFORE, '$.status_before', c)
    const statusAfter = oneOf(required(payload, 'status_after', '$', c), REPORT_EXPORT_STATUS_AFTER, '$.status_after', c)
    if (statusBefore !== null && statusAfter !== null && !isAllowedReportExportTransition(statusBefore, statusAfter)) {
      c.add('MISMATCH', '$.status_after')
    }
  } else if (type === 'SAFETY_INCIDENT_VOIDED') {
    for (const key of ['incident_id', 'voided_by']) text(required(payload, key, '$', c), `$.${key}`, c)
    dateTime(required(payload, 'voided_at', '$', c), '$.voided_at', c)
    oneOf(required(payload, 'void_reason', '$', c), SAFETY_VOID_REASONS, '$.void_reason', c)
    nullableText(required(payload, 'void_notes', '$', c), '$.void_notes', c)
    nullableText(required(payload, 'replacement_incident_id', '$', c), '$.replacement_incident_id', c)
    stringList(required(payload, 'archived_report_ids', '$', c), '$.archived_report_ids', c, true)
    stringList(required(payload, 'superseded_report_ids', '$', c), '$.superseded_report_ids', c, true)
    nullableText(required(payload, 'primary_incident_id', '$', c), '$.primary_incident_id', c)
    if (payload.void_reason === 'DUPLICATE_RECORD' && payload.primary_incident_id !== payload.replacement_incident_id) {
      c.add('MISMATCH', '$.primary_incident_id')
    }
    if (payload.void_reason !== 'DUPLICATE_RECORD' && payload.primary_incident_id !== null) {
      c.add('MISMATCH', '$.primary_incident_id')
    }
  } else {
    for (const key of ['root_incident_id', 'old_incident_id', 'new_incident_id', 'student_id', 'job_code', 'task_code', 'reason_code', 'context_phase', 'full_description', 'triggered_by', 'confirmed_by', 'correction_reason', 'replaced_by']) text(required(payload, key, '$', c), `$.${key}`, c)
    dateTime(required(payload, 'occurred_at', '$', c), '$.occurred_at', c)
    dateTime(required(payload, 'confirmed_at', '$', c), '$.confirmed_at', c)
    if (required(payload, 'old_status', '$', c) !== 'CONFIRMED') c.add('VALUE', '$.old_status')
    if (required(payload, 'old_status_after', '$', c) !== 'VOIDED') c.add('VALUE', '$.old_status_after')
    if (required(payload, 'void_reason', '$', c) !== 'FACTUAL_CORRECTION') c.add('VALUE', '$.void_reason')
    dateTime(required(payload, 'replaced_at', '$', c), '$.replaced_at', c)
    stringList(required(payload, 'superseded_report_ids', '$', c), '$.superseded_report_ids', c, true)
    if (payload.old_incident_id === payload.new_incident_id) c.add('MISMATCH', '$.new_incident_id')
  }
  return c.valid ? { valid: true, value: payload as unknown as T } : { valid: false, errors: c.errors }
}

export function parseF7EventPayload(
  eventType: string,
  payload: unknown
): ReportContractResult<F7EventPayload> {
  if (eventType === 'TASK_CLOSURE_CONFIRMED' || eventType === 'TASK_CLOSURE_REPLACED') {
    return parseTaskClosurePayload(payload, eventType)
  }
  if (eventType === 'REPORT_GENERATED') return parseReportGeneratedPayload(payload)
  if (eventType === 'PLACEMENT_REVIEW_CONFIRMED') return parseLifecyclePayload<PlacementReviewConfirmedV2Payload>(payload, eventType)
  if (eventType === 'REPORT_LOCKED') return parseLifecyclePayload<ReportLockedV2Payload>(payload, eventType)
  if (eventType === 'REPORT_EXPORTED') return parseLifecyclePayload<ReportExportedV2Payload>(payload, eventType)
  if (eventType === 'SAFETY_INCIDENT_VOIDED') return parseLifecyclePayload<SafetyIncidentVoidedV2Payload>(payload, eventType)
  if (eventType === 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION') {
    return parseLifecyclePayload<SafetyIncidentReplacedForFactualCorrectionV2Payload>(payload, eventType)
  }
  return { valid: false, errors: [{ code: 'VALUE', path: '$.event_type' }] }
}
