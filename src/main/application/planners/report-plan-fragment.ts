import { createHash } from 'crypto'
import type { CommandEnvelopeV2 } from '../command/command-types'
import {
  BATCH_CONTEXT_SCHEMA_VERSION,
  type BatchContextV1,
  type EventIntentV1
} from '../../domain/event-batch/command-plan'
import type { CanonicalJsonValue } from '../../domain/event-batch/canonical-json'

export const REPORT_EVENT_PAYLOAD_VERSION = 2 as const
export const REPORT_GENERATION_SNAPSHOT_VERSION = 'm5b-report-generation-snapshot-v1'

export type ReportActorRole = 'TEACHER' | 'SYSTEM'

export type ReportGenerationSnapshotV1 = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof REPORT_GENERATION_SNAPSHOT_VERSION
  timestamp: string
  app_version: string
  correlation_id: string
  actor_role: ReportActorRole
  existing_report_id: string | null
  report_facts: Readonly<Record<string, CanonicalJsonValue>>
}>

export interface ReportFragmentRootContext {
  readonly envelope: CommandEnvelopeV2
  readonly planVersion: string
  readonly resultRecipeVersion: string
  readonly childOrdinal: number
}

export interface ReportPlanFragmentV1 {
  readonly events: readonly EventIntentV1[]
  readonly reportResult: Readonly<Record<string, CanonicalJsonValue>>
}

function requiredText(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`[report-plan-fragment] ${field} must be a non-empty trimmed string`)
  }
  return value
}

function requiredInteger(value: CanonicalJsonValue | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`[report-plan-fragment] ${field} must be a positive safe integer`)
  }
  return value as number
}

function optionalText(value: CanonicalJsonValue | undefined, field: string): string | null {
  if (value === null) return null
  return requiredText(value, field)
}

function requiredRecord(
  value: CanonicalJsonValue | undefined,
  field: string
): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[report-plan-fragment] ${field} must be an object`)
  }
  return value
}

function requiredArray(value: CanonicalJsonValue | undefined, field: string): CanonicalJsonValue[] {
  if (!Array.isArray(value)) throw new Error(`[report-plan-fragment] ${field} must be an array`)
  return value
}

function exactTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new Error(`[report-plan-fragment] ${field} must be an exact UTC timestamp`)
  }
  return value
}

/** Stable protocol UUID derived only from durable root identity and semantic role. */
export function deterministicBatchUuid(
  rootCommandId: string,
  childOrdinal: number,
  semanticRole: string
): string {
  if (!rootCommandId.trim() || !semanticRole.trim() || !Number.isSafeInteger(childOrdinal) || childOrdinal < 0) {
    throw new Error('[report-plan-fragment] deterministic ID input is invalid')
  }
  const bytes = createHash('sha256')
    .update('svets:event-batch:v1\0', 'utf8')
    .update(rootCommandId, 'utf8')
    .update('\0', 'utf8')
    .update(String(childOrdinal), 'utf8')
    .update('\0', 'utf8')
    .update(semanticRole, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function reportBatchContext(context: ReportFragmentRootContext): BatchContextV1 {
  if (!Number.isSafeInteger(context.childOrdinal) || context.childOrdinal < 0) {
    throw new Error('[report-plan-fragment] child ordinal must be a non-negative safe integer')
  }
  return Object.freeze({
    schema_version: BATCH_CONTEXT_SCHEMA_VERSION,
    plan_version: context.planVersion,
    result_recipe_version: context.resultRecipeVersion,
    root_command_type: context.envelope.commandType,
    root_command_id: context.envelope.commandId,
    child_ordinal: context.childOrdinal
  })
}

/**
 * Produces a child-safe report fragment. It deliberately has no command-store,
 * coordinator, batch, database, clock, file, or random dependency.
 */
export function planReportGenerationFragment(
  snapshot: ReportGenerationSnapshotV1,
  context: ReportFragmentRootContext
): ReportPlanFragmentV1 {
  if (snapshot.schema_version !== REPORT_GENERATION_SNAPSHOT_VERSION) {
    throw new Error('[report-plan-fragment] generation snapshot version mismatch')
  }
  if (snapshot.existing_report_id !== null) {
    return Object.freeze({
      events: Object.freeze([]),
      reportResult: Object.freeze({
        success: true,
        reportId: snapshot.existing_report_id,
        generated: false
      })
    })
  }

  const facts = requiredRecord(snapshot.report_facts, 'report_facts')
  const reportId = deterministicBatchUuid(
    context.envelope.commandId,
    context.childOrdinal,
    'task-report'
  )
  const eventId = deterministicBatchUuid(
    context.envelope.commandId,
    context.childOrdinal,
    'report-generated-event'
  )
  const timestamp = exactTimestamp(snapshot.timestamp, 'timestamp')
  const payload: EventIntentV1['payload'] = {
    event_payload_version: REPORT_EVENT_PAYLOAD_VERSION,
    batch_context: reportBatchContext(context),
    actor_role: snapshot.actor_role,
    app_version: requiredText(snapshot.app_version, 'app_version'),
    correlation_id: requiredText(snapshot.correlation_id, 'correlation_id'),
    report_id: reportId,
    student_id: requiredText(facts.student_id, 'report_facts.student_id'),
    job_code: requiredText(facts.job_code, 'report_facts.job_code'),
    task_code: requiredText(facts.task_code, 'report_facts.task_code'),
    report_type: requiredText(facts.report_type, 'report_facts.report_type'),
    report_scope: requiredText(facts.report_scope, 'report_facts.report_scope'),
    source_aggregate_type: requiredText(facts.source_aggregate_type, 'report_facts.source_aggregate_type'),
    source_aggregate_id: requiredText(facts.source_aggregate_id, 'report_facts.source_aggregate_id'),
    result_ids: requiredArray(facts.result_ids, 'report_facts.result_ids'),
    incident_ids: requiredArray(facts.incident_ids, 'report_facts.incident_ids'),
    report_title: requiredText(facts.report_title, 'report_facts.report_title'),
    report_content: requiredRecord(facts.report_content, 'report_facts.report_content'),
    generated_at: requiredText(facts.generated_at, 'report_facts.generated_at'),
    generated_by: context.envelope.actorId,
    report_revision: requiredInteger(facts.report_revision, 'report_facts.report_revision'),
    report_schema_version: requiredText(facts.report_schema_version, 'report_facts.report_schema_version'),
    report_builder_version: requiredText(facts.report_builder_version, 'report_facts.report_builder_version'),
    lineage_key: requiredText(facts.lineage_key, 'report_facts.lineage_key'),
    source_set_hash: requiredText(facts.source_set_hash, 'report_facts.source_set_hash'),
    content_hash: requiredText(facts.content_hash, 'report_facts.content_hash'),
    generation_key: requiredText(facts.generation_key, 'report_facts.generation_key'),
    generation_reason: requiredText(facts.generation_reason, 'report_facts.generation_reason'),
    task_closure_id: optionalText(facts.task_closure_id, 'report_facts.task_closure_id'),
    repair_of_report_id: optionalText(facts.repair_of_report_id, 'report_facts.repair_of_report_id'),
    superseded_report_ids: requiredArray(facts.superseded_report_ids, 'report_facts.superseded_report_ids')
  }
  return Object.freeze({
    events: Object.freeze([Object.freeze({
      eventId,
      aggregateType: 'TASK_REPORT',
      aggregateId: reportId,
      eventType: 'REPORT_GENERATED',
      eventSequence: 1,
      payload,
      actorId: context.envelope.actorId,
      timestamp
    })]),
    reportResult: Object.freeze({ success: true, reportId, generated: true })
  })
}
