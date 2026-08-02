import type { DBAdapter } from '../../db/interface'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  COMMAND_PLAN_SCHEMA_VERSION,
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type EventIntentV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import {
  canonicalJson,
  type CanonicalJsonValue
} from '../../domain/event-batch/canonical-json'
import {
  buildBaseAbilityReport,
  buildJobSkillReport,
  buildSafetyReport,
  type BuiltReportSnapshot
} from '../../domain/report-builders'
import { sha256CanonicalJson } from '../../domain/report-canonical'
import { parseReportContent } from '../../domain/report-contract'
import {
  getReportRow,
  isActiveReport,
  parseStoredReportContent,
  reportCommandKeyForRow,
  type ReportRow
} from '../query/reports-query-service'
import {
  REPORT_EVENT_PAYLOAD_VERSION,
  REPORT_GENERATION_SNAPSHOT_VERSION,
  deterministicBatchUuid,
  planReportGenerationFragment,
  reportBatchContext,
  type ReportActorRole,
  type ReportGenerationSnapshotV1
} from './report-plan-fragment'
import { assertFormalAssessmentSession } from '../../domain/preview/preview-session-guard'

export const REPORT_LIFECYCLE_SNAPSHOT_VERSION = 'm5b-report-lifecycle-snapshot-v1'

export const REPORT_PLAN_VERSIONS = Object.freeze({
  'reports:confirmPlacementReview': 'm5b.reports.confirm-placement-review.plan.v1',
  'reports:generate': 'm5b.reports.generate.plan.v1',
  'reports:lock': 'm5b.reports.lock.plan.v1'
} as const)

export const REPORT_RESULT_RECIPE_VERSIONS = Object.freeze({
  'reports:confirmPlacementReview': 'm5b.reports:confirmPlacementReview.result.v1',
  'reports:generate': 'm5b.reports:generate.result.v1',
  'reports:lock': 'm5b.reports:lock.result.v1'
} as const)

type ReportPlannerCommand = keyof typeof REPORT_PLAN_VERSIONS

type ReportLifecycleSnapshotV1 = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof REPORT_LIFECYCLE_SNAPSHOT_VERSION
  kind: 'PLACEMENT_REVIEW' | 'LOCK'
  timestamp: string
  app_version: string
  correlation_id: string
  actor_role: ReportActorRole
  report_id: string
  event_sequence: number
  no_op_result: Readonly<Record<string, CanonicalJsonValue>> | null
  event_facts: Readonly<Record<string, CanonicalJsonValue>> | null
}>

interface ExistingReportRow {
  report_id: string
  status: 'GENERATED' | 'EXPORTED' | 'LOCKED' | 'SUPERSEDED' | 'ARCHIVED' | 'FAILED'
  contract_validation_status: 'VALID' | 'REPAIR_REQUIRED'
  report_content_json: string
  generation_key: string | null
  lineage_key: string | null
  report_revision: number | null
  source_aggregate_type: string | null
  source_aggregate_id: string | null
  task_closure_id: string | null
}

export class ReportPlannerError extends Error {
  constructor(
    public readonly code:
      | 'COMMAND_UNSUPPORTED'
      | 'INVALID_INPUT'
      | 'TARGET_MISMATCH'
      | 'SOURCE_NOT_FOUND'
      | 'REPORT_CONTRACT_INVALID'
      | 'REPORT_STATE_CONFLICT',
    message: string
  ) {
    super(`[m5b-report-planner] ${message}`)
    this.name = 'ReportPlannerError'
  }
}

function canonicalRecord(value: unknown): Record<string, CanonicalJsonValue> {
  const parsed = JSON.parse(canonicalJson(value)) as CanonicalJsonValue
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ReportPlannerError('INVALID_INPUT', 'snapshot value must be an object')
  }
  return parsed
}

function record(value: unknown, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReportPlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Readonly<Record<string, CanonicalJsonValue>>
}

function requiredText(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new ReportPlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function exactTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new ReportPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return value
}

function actorRole(envelope: CommandEnvelopeV2): ReportActorRole {
  if (envelope.actor.kind === 'USER' && envelope.actor.role === 'TEACHER') return 'TEACHER'
  if (envelope.actor.kind === 'SYSTEM') return 'SYSTEM'
  throw new ReportPlannerError('INVALID_INPUT', 'report planning requires a teacher or system actor')
}

function assertTargetField(
  envelope: CommandEnvelopeV2,
  field: string,
  expected: CanonicalJsonValue
): void {
  if (canonicalJson(envelope.target[field]) !== canonicalJson(expected)) {
    throw new ReportPlannerError('TARGET_MISMATCH', `accepted target field ${field} changed`)
  }
}

function nextEventSequence(db: DBAdapter, aggregateType: string, aggregateId: string): number {
  const row = db.prepare(
    `SELECT MAX(event_sequence) AS max_sequence
       FROM domain_event_projection
      WHERE aggregate_type = ? AND aggregate_id = ?`
  ).get(aggregateType, aggregateId) as { max_sequence: number | null } | undefined
  return (row?.max_sequence ?? 0) + 1
}

function reportContentStillValid(report: ExistingReportRow): boolean {
  if (report.contract_validation_status !== 'VALID') return false
  try {
    return parseReportContent(JSON.parse(report.report_content_json) as unknown).valid
  } catch {
    return false
  }
}

function activeReportsForLineage(db: DBAdapter, lineageKey: string): ExistingReportRow[] {
  return db.prepare(
    `SELECT *
       FROM task_report
      WHERE lineage_key = ?
        AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')
      ORDER BY report_revision ASC, report_id ASC`
  ).all(lineageKey) as ExistingReportRow[]
}

function maxRevision(db: DBAdapter, lineageKey: string): number {
  const row = db.prepare(
    'SELECT MAX(report_revision) AS max_revision FROM task_report WHERE lineage_key = ?'
  ).get(lineageKey) as { max_revision: number | null } | undefined
  return row?.max_revision ?? 0
}

function generationFacts(db: DBAdapter, built: BuiltReportSnapshot): Readonly<{
  generationKey: string
  revision: number
  reason: 'NORMAL' | 'CONTRACT_REPAIR'
  repairOfReportId: string | null
  supersededReportIds: string[]
}> {
  const active = activeReportsForLineage(db, built.lineageKey)
  const invalid = active.find((report) => !reportContentStillValid(report))
  const reason = invalid ? 'CONTRACT_REPAIR' as const : 'NORMAL' as const
  const repairOfReportId = invalid?.report_id ?? null
  const generationKey = sha256CanonicalJson({
    report_scope: built.scope,
    lineage_key: built.lineageKey,
    source_set_hash: built.sourceSetHash,
    report_schema_version: built.reportSchemaVersion,
    report_builder_version: built.reportBuilderVersion,
    generation_reason: reason,
    repair_of_report_id: repairOfReportId
  })
  return Object.freeze({
    generationKey,
    revision: maxRevision(db, built.lineageKey) + 1,
    reason,
    repairOfReportId,
    supersededReportIds: active.map((report) => report.report_id)
  })
}

function validReportForGenerationKey(db: DBAdapter, generationKey: string): ExistingReportRow | null {
  const row = db.prepare(
    'SELECT * FROM task_report WHERE generation_key = ? LIMIT 1'
  ).get(generationKey) as ExistingReportRow | undefined
  return row && reportContentStillValid(row) ? row : null
}

function buildReport(
  db: DBAdapter,
  scope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY',
  sourceId: string,
  generatedAt: string
): BuiltReportSnapshot {
  if (scope === 'BASE_ABILITY') return buildBaseAbilityReport(db, sourceId, generatedAt)
  if (scope === 'JOB_SKILL') return buildJobSkillReport(db, sourceId, generatedAt)
  return buildSafetyReport(db, sourceId, generatedAt)
}

function assertFormalReportInput(
  db: DBAdapter,
  scope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY',
  sourceId: string
): void {
  if (scope !== 'JOB_SKILL') return
  const source = db.prepare(
    `SELECT source_aggregate_type, source_aggregate_id
       FROM result_record
      WHERE result_id = ?`
  ).get(sourceId) as { source_aggregate_type?: string; source_aggregate_id?: string } | undefined
  if (source?.source_aggregate_type === 'ASSESSMENT_SESSION' && typeof source.source_aggregate_id === 'string') {
    assertFormalAssessmentSession(db, source.source_aggregate_id, 'formal report generation')
  }
}

export function loadReportGenerationSnapshotValue(
  db: DBAdapter,
  input: Readonly<{
    reportScope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
    sourceId: string
    actorRole: ReportActorRole
    timestamp: string
    appVersion: string
    correlationId: string
  }>
): ReportGenerationSnapshotV1 {
  const timestamp = exactTimestamp(input.timestamp, 'timestamp')
  assertFormalReportInput(db, input.reportScope, input.sourceId)
  const built = buildReport(db, input.reportScope, input.sourceId, timestamp)
  if (built.sourceAggregateType === 'ASSESSMENT_SESSION') {
    assertFormalAssessmentSession(db, built.sourceAggregateId, 'formal report generation')
  }
  const generation = generationFacts(db, built)
  const existing = validReportForGenerationKey(db, generation.generationKey)
  return canonicalRecord({
    schema_version: REPORT_GENERATION_SNAPSHOT_VERSION,
    timestamp,
    app_version: input.appVersion,
    correlation_id: input.correlationId,
    actor_role: input.actorRole,
    existing_report_id: existing?.report_id ?? null,
    report_facts: {
      student_id: built.studentId,
      job_code: built.jobCode,
      task_code: built.taskCode,
      report_type: built.reportType,
      report_scope: built.scope,
      source_aggregate_type: built.sourceAggregateType,
      source_aggregate_id: built.sourceAggregateId,
      result_ids: built.resultIds,
      incident_ids: built.incidentIds,
      report_title: built.reportTitle,
      report_content: built.content,
      generated_at: built.content.generated_at,
      report_revision: generation.revision,
      report_schema_version: built.reportSchemaVersion,
      report_builder_version: built.reportBuilderVersion,
      lineage_key: built.lineageKey,
      source_set_hash: built.sourceSetHash,
      content_hash: built.contentHash,
      generation_key: generation.generationKey,
      generation_reason: generation.reason,
      task_closure_id: built.taskClosureId,
      repair_of_report_id: generation.repairOfReportId,
      superseded_report_ids: generation.supersededReportIds
    }
  }) as ReportGenerationSnapshotV1
}

function assertReportTarget(db: DBAdapter, row: ReportRow, envelope: CommandEnvelopeV2): void {
  const key = reportCommandKeyForRow(db, row)
  assertTargetField(envelope, 'aggregate_type', 'TASK_REPORT')
  assertTargetField(envelope, 'report_id', row.report_id)
  assertTargetField(envelope, 'student_id', row.student_id)
  if (envelope.target.job_code !== undefined) assertTargetField(envelope, 'job_code', key.jobCode)
  if (envelope.target.task_code !== undefined) assertTargetField(envelope, 'task_code', key.taskCode)
}

function lifecycleSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): ReportLifecycleSnapshotV1 {
  const reportId = requiredText(envelope.target.report_id, 'target.report_id')
  const row = getReportRow(db, reportId)
  if (!row) throw new ReportPlannerError('SOURCE_NOT_FOUND', `report ${reportId} was not found`)
  assertReportTarget(db, row, envelope)
  const parsed = parseStoredReportContent(row)
  const common = {
    schema_version: REPORT_LIFECYCLE_SNAPSHOT_VERSION,
    timestamp: exactTimestamp(options.timestamp, 'timestamp'),
    app_version: options.appVersion,
    correlation_id: envelope.correlationId,
    actor_role: actorRole(envelope),
    report_id: row.report_id,
    event_sequence: nextEventSequence(db, 'TASK_REPORT', row.report_id)
  }

  if (envelope.commandType === 'reports:confirmPlacementReview') {
    if (!parsed.valid || row.contract_validation_status !== 'VALID') {
      throw new ReportPlannerError('REPORT_CONTRACT_INVALID', 'placement review requires a valid report contract')
    }
    if (!parsed.value.placement_advice.enabled) {
      throw new ReportPlannerError('REPORT_STATE_CONFLICT', 'placement advice is not enabled')
    }
    if (row.placement_review_by !== null || row.placement_review_at !== null) {
      if (row.placement_review_by !== envelope.actorId) {
        throw new ReportPlannerError('REPORT_STATE_CONFLICT', 'report was reviewed by another teacher')
      }
      return canonicalRecord({
        ...common,
        kind: 'PLACEMENT_REVIEW',
        no_op_result: { success: true, reportId: row.report_id, status: row.status },
        event_facts: null
      }) as ReportLifecycleSnapshotV1
    }
    if (!isActiveReport(row.status)) {
      throw new ReportPlannerError('REPORT_STATE_CONFLICT', 'placement review requires an active report')
    }
    return canonicalRecord({
      ...common,
      kind: 'PLACEMENT_REVIEW',
      no_op_result: null,
      event_facts: {
        reviewed_at: common.timestamp,
        placement_advice_hash: sha256CanonicalJson(parsed.value.placement_advice),
        result_status: row.status
      }
    }) as ReportLifecycleSnapshotV1
  }

  if (envelope.commandType !== 'reports:lock') {
    throw new ReportPlannerError('COMMAND_UNSUPPORTED', `unsupported lifecycle command ${envelope.commandType}`)
  }
  if (row.status === 'LOCKED') {
    return canonicalRecord({
      ...common,
      kind: 'LOCK',
      no_op_result: { success: true, reportId: row.report_id, status: 'LOCKED' },
      event_facts: null
    }) as ReportLifecycleSnapshotV1
  }
  if (!parsed.valid || row.contract_validation_status !== 'VALID' || !row.content_hash) {
    throw new ReportPlannerError('REPORT_CONTRACT_INVALID', 'report lock requires a valid report contract and content hash')
  }
  if (row.status !== 'GENERATED' && row.status !== 'EXPORTED') {
    throw new ReportPlannerError('REPORT_STATE_CONFLICT', `report status ${row.status} cannot be locked`)
  }
  if (parsed.value.placement_advice.enabled && (!row.placement_review_by || !row.placement_review_at)) {
    throw new ReportPlannerError('REPORT_STATE_CONFLICT', 'placement review is required before lock')
  }
  const lockReason = envelope.payload.lockReason
  if (lockReason !== undefined && lockReason !== null && typeof lockReason !== 'string') {
    throw new ReportPlannerError('INVALID_INPUT', 'lockReason must be a string or null')
  }
  return canonicalRecord({
    ...common,
    kind: 'LOCK',
    no_op_result: null,
    event_facts: {
      locked_at: common.timestamp,
      lock_reason: lockReason ?? null,
      content_hash: row.content_hash,
      status_before: row.status,
      status_after: 'LOCKED'
    }
  }) as ReportLifecycleSnapshotV1
}

export function loadReportPlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  if (envelope.commandType === 'reports:generate') {
    const scope = requiredText(envelope.target.report_scope, 'target.report_scope')
    if (scope !== 'BASE_ABILITY' && scope !== 'JOB_SKILL' && scope !== 'SAFETY') {
      throw new ReportPlannerError('INVALID_INPUT', `unsupported report scope ${scope}`)
    }
    const sourceId = requiredText(envelope.target.source_id, 'target.source_id')
    const snapshot = loadReportGenerationSnapshotValue(db, {
      reportScope: scope,
      sourceId,
      actorRole: actorRole(envelope),
      timestamp: options.timestamp,
      appVersion: options.appVersion,
      correlationId: envelope.correlationId
    })
    const facts = snapshot.report_facts
    assertTargetField(envelope, 'aggregate_type', 'TASK_REPORT')
    assertTargetField(envelope, 'report_scope', facts.report_scope)
    assertTargetField(envelope, 'source_id', sourceId)
    assertTargetField(envelope, 'student_id', facts.student_id)
    assertTargetField(envelope, 'job_code', facts.job_code)
    assertTargetField(envelope, 'task_code', facts.task_code)
    return createPlannerReadSnapshot(snapshot)
  }
  if (envelope.commandType !== 'reports:confirmPlacementReview' && envelope.commandType !== 'reports:lock') {
    throw new ReportPlannerError('COMMAND_UNSUPPORTED', `unsupported report command ${envelope.commandType}`)
  }
  return createPlannerReadSnapshot(lifecycleSnapshot(db, envelope, options))
}

function planLifecycle(
  envelope: CommandEnvelopeV2,
  snapshot: ReportLifecycleSnapshotV1,
  planVersion: string,
  resultRecipeVersion: string
): CommandPlanV1 {
  if (snapshot.no_op_result !== null) {
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: envelope.commandId,
      commandType: envelope.commandType,
      planVersion,
      resultRecipeVersion,
      events: [],
      operationalEffects: [],
      noOpResult: snapshot.no_op_result
    }
  }
  if (!snapshot.event_facts) throw new ReportPlannerError('INVALID_INPUT', 'event lifecycle snapshot has no facts')
  const facts = snapshot.event_facts
  const eventType = snapshot.kind === 'PLACEMENT_REVIEW' ? 'PLACEMENT_REVIEW_CONFIRMED' : 'REPORT_LOCKED'
  const eventId = deterministicBatchUuid(envelope.commandId, 0, `${eventType.toLowerCase()}-event`)
  const context = { envelope, planVersion, resultRecipeVersion, childOrdinal: 0 }
  const metadata = {
    event_payload_version: REPORT_EVENT_PAYLOAD_VERSION,
    batch_context: reportBatchContext(context),
    actor_role: snapshot.actor_role,
    app_version: snapshot.app_version,
    correlation_id: snapshot.correlation_id
  }
  const payload: EventIntentV1['payload'] = snapshot.kind === 'PLACEMENT_REVIEW'
    ? {
        ...metadata,
        report_id: snapshot.report_id,
        reviewed_by: envelope.actorId,
        reviewed_at: requiredText(facts.reviewed_at, 'event_facts.reviewed_at'),
        placement_advice_hash: requiredText(facts.placement_advice_hash, 'event_facts.placement_advice_hash'),
        result_status: requiredText(facts.result_status, 'event_facts.result_status')
      }
    : {
        ...metadata,
        report_id: snapshot.report_id,
        locked_by: envelope.actorId,
        locked_at: requiredText(facts.locked_at, 'event_facts.locked_at'),
        lock_reason: facts.lock_reason ?? null,
        content_hash: requiredText(facts.content_hash, 'event_facts.content_hash'),
        status_before: requiredText(facts.status_before, 'event_facts.status_before'),
        status_after: 'LOCKED'
      }
  const event: EventIntentV1 = {
    eventId,
    aggregateType: 'TASK_REPORT',
    aggregateId: snapshot.report_id,
    eventType,
    eventSequence: snapshot.event_sequence,
    payload,
    actorId: envelope.actorId,
    timestamp: exactTimestamp(snapshot.timestamp, 'snapshot.timestamp')
  }
  return {
    schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
    commandId: envelope.commandId,
    commandType: envelope.commandType,
    planVersion,
    resultRecipeVersion,
    events: [event],
    operationalEffects: [],
    noOpResult: null
  }
}

export class ReportPlanner {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<CanonicalJsonValue>
  }>): CommandPlanV1 {
    const command = input.envelope.commandType as ReportPlannerCommand
    const planVersion = REPORT_PLAN_VERSIONS[command]
    const resultRecipeVersion = REPORT_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) {
      throw new ReportPlannerError('COMMAND_UNSUPPORTED', `unsupported report command ${input.envelope.commandType}`)
    }
    const value = record(input.snapshot.value, 'snapshot')
    if (command === 'reports:generate') {
      if (value.schema_version !== REPORT_GENERATION_SNAPSHOT_VERSION) {
        throw new ReportPlannerError('INVALID_INPUT', 'report generation snapshot version mismatch')
      }
      const fragment = planReportGenerationFragment(value as ReportGenerationSnapshotV1, {
        envelope: input.envelope,
        planVersion,
        resultRecipeVersion,
        childOrdinal: 0
      })
      return {
        schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
        commandId: input.envelope.commandId,
        commandType: input.envelope.commandType,
        planVersion,
        resultRecipeVersion,
        events: fragment.events,
        operationalEffects: [],
        noOpResult: fragment.events.length === 0 ? fragment.reportResult : null
      }
    }
    if (value.schema_version !== REPORT_LIFECYCLE_SNAPSHOT_VERSION) {
      throw new ReportPlannerError('INVALID_INPUT', 'report lifecycle snapshot version mismatch')
    }
    return planLifecycle(
      input.envelope,
      value as ReportLifecycleSnapshotV1,
      planVersion,
      resultRecipeVersion
    )
  }
}
