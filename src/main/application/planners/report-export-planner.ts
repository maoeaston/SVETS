import type { DBAdapter } from '../../db/interface'
import { DurableCommandStore, type DurableCommandRow } from '../command/durable-command-store'
import { createCommandResultJson, parseCommandResultJson } from '../command/command-result'
import {
  createPlannerReadSnapshot,
  type CommandPlanV1,
  type CommandPlannerV1,
  type PlannerReadSnapshot
} from '../../domain/event-batch/command-plan'
import { canonicalJson, type CanonicalJsonValue } from '../../domain/event-batch/canonical-json'
import {
  artifactTargetIdentity,
  assertArtifactInteractionTarget,
  probeArtifactTarget,
  type ArtifactInteractionTarget,
  type ArtifactTargetIdentity
} from '../../domain/event-batch/artifact-probe'
import { prepareReportHtmlExport } from '../../domain/report-export'
import { deterministicBatchUuid, reportBatchContext } from './report-plan-fragment'
import type { CommandEnvelopeV2 } from '../command/command-types'

export const REPORT_EXPORT_SNAPSHOT_VERSION = 'm5b-report-export-snapshot-v1'
export const REPORT_EXPORT_EVENT_PAYLOAD_VERSION = 3 as const
export const REPORT_EXPORT_PLAN_VERSION = 'm5b.reports.export.plan.v1'
export const REPORT_EXPORT_RESULT_RECIPE_VERSION = 'm5b.reports:export.result.v1'
export const REPORT_EXPORT_PRE_APPLY_EFFECT = Object.freeze({
  effectType: 'REPORT_ARTIFACT_PUBLISH',
  effectVersion: 1
})

type PlanningClone = DBAdapter & { close?: () => void }
type CloneablePlanningDatabase = DBAdapter & { cloneForPlanning?: () => Promise<PlanningClone> }

export interface ReportExportInteraction extends ArtifactInteractionTarget {
  readonly targetIdentity: ArtifactTargetIdentity
}

export type ReportExportCancellation = Readonly<{
  command: DurableCommandRow
  publicResult: Readonly<Record<string, CanonicalJsonValue>>
}>

type ReportExportSnapshot = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof REPORT_EXPORT_SNAPSHOT_VERSION
  timestamp: string
  app_version: string
  correlation_id: string
  report_id: string
  student_id: string
  status_before: 'GENERATED' | 'EXPORTED' | 'LOCKED'
  status_after: 'EXPORTED' | 'LOCKED'
  content_hash: string
  presentation_hash: string
  target_path: string
  artifact_id: string
  html_bytes_base64: string
  file_hash: string
  file_size_bytes: number
  target_identity: ArtifactTargetIdentity
  event_sequence: number
}>

export class ReportExportPlannerError extends Error {
  constructor(
    public readonly code: 'COMMAND_UNSUPPORTED' | 'INVALID_INPUT' | 'PLANNING_ADAPTER_REQUIRED',
    message: string
  ) {
    super(`[m5b-report-export-planner] ${message}`)
    this.name = 'ReportExportPlannerError'
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new ReportExportPlannerError('INVALID_INPUT', `${field} is invalid`)
  }
  return value
}

function integer(value: unknown, field: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new ReportExportPlannerError('INVALID_INPUT', `${field} is invalid`)
  }
  return value as number
}

function record(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReportExportPlannerError('INVALID_INPUT', `${field} is invalid`)
  }
  return value as Record<string, CanonicalJsonValue>
}

function canonicalRecord(value: unknown, field: string): Record<string, CanonicalJsonValue> {
  return record(JSON.parse(canonicalJson(value)), field)
}

function exactTimestamp(value: unknown, field: string): string {
  const timestamp = text(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) || new Date(timestamp).toISOString() !== timestamp) {
    throw new ReportExportPlannerError('INVALID_INPUT', `${field} must be an exact UTC timestamp`)
  }
  return timestamp
}

function reportId(envelope: CommandEnvelopeV2): string {
  if (envelope.commandType !== 'reports:export') {
    throw new ReportExportPlannerError('COMMAND_UNSUPPORTED', `unsupported command ${envelope.commandType}`)
  }
  if (envelope.actor.kind !== 'USER' || envelope.actor.userId !== envelope.actorId || envelope.actor.role !== 'TEACHER') {
    throw new ReportExportPlannerError('INVALID_INPUT', 'report export requires the accepted teacher actor')
  }
  return text(envelope.target.report_id, 'target.report_id')
}

function assertCurrentCancellationEnvelope(envelope: CommandEnvelopeV2, command: DurableCommandRow): void {
  if (
    command.commandId !== envelope.commandId
    || command.eventBatchId !== envelope.eventBatchId
    || command.commandType !== envelope.commandType
    || command.requestHash !== envelope.requestHash
    || command.clientInstanceId !== envelope.clientInstanceId
    || command.idempotencyKey !== envelope.idempotencyKey
    || command.actorId !== envelope.actorId
    || command.deviceId !== envelope.deviceId
    || command.authSessionId !== envelope.authSessionId
    || command.leaseOwner !== envelope.leaseOwner
    || command.currentLeaseGeneration !== envelope.leaseGeneration
  ) throw new ReportExportPlannerError('INVALID_INPUT', 'cancellation envelope does not match the current durable command')
}

function cloneDatabase(database: DBAdapter): Promise<PlanningClone> {
  const cloneable = database as CloneablePlanningDatabase
  if (typeof cloneable.cloneForPlanning !== 'function') {
    throw new ReportExportPlannerError(
      'PLANNING_ADAPTER_REQUIRED',
      'report export prepared-fact planning requires an isolated cloned database adapter'
    )
  }
  return cloneable.cloneForPlanning()
}

function nextSequence(database: DBAdapter, aggregateId: string): number {
  const row = database.prepare(
    `SELECT MAX(event_sequence) AS max_sequence
       FROM domain_event_projection
      WHERE aggregate_type = 'TASK_REPORT' AND aggregate_id = ?`
  ).get(aggregateId) as { max_sequence: number | null } | undefined
  return (row?.max_sequence ?? 0) + 1
}

function artifactId(envelope: CommandEnvelopeV2): string {
  return deterministicBatchUuid(envelope.commandId, 0, 'report-export-artifact')
}

function sameArtifactTargetIdentity(left: ArtifactTargetIdentity, right: ArtifactTargetIdentity): boolean {
  return left.artifact_root.path === right.artifact_root.path
    && left.artifact_root.device === right.artifact_root.device
    && left.artifact_root.inode === right.artifact_root.inode
    && left.target_parent.path === right.target_parent.path
    && left.target_parent.device === right.target_parent.device
    && left.target_parent.inode === right.target_parent.inode
}

function artifactIdentityValue(identity: ArtifactTargetIdentity): Record<string, CanonicalJsonValue> {
  return {
    artifact_root: {
      path: identity.artifact_root.path,
      device: identity.artifact_root.device,
      inode: identity.artifact_root.inode
    },
    target_parent: {
      path: identity.target_parent.path,
      device: identity.target_parent.device,
      inode: identity.target_parent.inode
    }
  }
}

export function prepareReportExportInteraction(
  envelope: CommandEnvelopeV2,
  input: Omit<ArtifactInteractionTarget, 'artifactId'>
): Readonly<ReportExportInteraction> {
  reportId(envelope)
  const verified = probeArtifactTarget({ ...input, artifactId: artifactId(envelope) })
  return Object.freeze({
    artifactRoot: verified.artifactRoot,
    targetPath: verified.targetPath,
    artifactId: artifactId(envelope),
    targetIdentity: verified.targetIdentity
  })
}

/** Completes a post-claim dialog cancellation without creating a durable EVENT batch. */
export function completeReportExportCancellation(options: Readonly<{
  commandStore: DurableCommandStore
  envelope: CommandEnvelopeV2
  completedAt: string
}>): ReportExportCancellation {
  reportId(options.envelope)
  const completedAt = exactTimestamp(options.completedAt, 'completedAt')
  const current = options.commandStore.assertLease({
    commandId: options.envelope.commandId,
    leaseOwner: options.envelope.leaseOwner,
    generation: options.envelope.leaseGeneration,
    now: completedAt
  })
  assertCurrentCancellationEnvelope(options.envelope, current)
  const resultJson = createCommandResultJson({ success: true, canceled: true })
  const command = options.commandStore.completeSucceeded({
    commandId: options.envelope.commandId,
    leaseOwner: options.envelope.leaseOwner,
    generation: options.envelope.leaseGeneration,
    resultJson,
    now: completedAt
  })
  return Object.freeze({
    command,
    publicResult: parseCommandResultJson(resultJson).public_result
  })
}

export async function loadReportExportPlannerSnapshot(
  database: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{
    timestamp: string
    appVersion: string
    interaction: ReportExportInteraction
  }>
): Promise<PlannerReadSnapshot<ReportExportSnapshot>> {
  const expectedReportId = reportId(envelope)
  const timestamp = exactTimestamp(options.timestamp, 'timestamp')
  const verified = assertArtifactInteractionTarget(options.interaction)
  if (options.interaction.artifactId !== artifactId(envelope)) {
    throw new ReportExportPlannerError('INVALID_INPUT', 'interaction artifact identity conflicts with command')
  }
  if (!sameArtifactTargetIdentity(artifactTargetIdentity(options.interaction.targetIdentity), verified.targetIdentity)) {
    throw new ReportExportPlannerError('INVALID_INPUT', 'interaction artifact directory identity changed before planning')
  }
  const clone = await cloneDatabase(database)
  try {
    const prepared = prepareReportHtmlExport(clone, expectedReportId, timestamp)
    const sequence = nextSequence(clone, prepared.reportId)
    const statusAfter = prepared.status === 'LOCKED' ? 'LOCKED' : 'EXPORTED'
    return createPlannerReadSnapshot(canonicalRecord({
      schema_version: REPORT_EXPORT_SNAPSHOT_VERSION,
      timestamp,
      app_version: text(options.appVersion, 'appVersion'),
      correlation_id: envelope.correlationId,
      report_id: prepared.reportId,
      student_id: prepared.studentId,
      status_before: prepared.status,
      status_after: statusAfter,
      content_hash: prepared.contentHash,
      presentation_hash: prepared.presentationHash,
      target_path: verified.targetPath,
      artifact_id: artifactId(envelope),
      html_bytes_base64: prepared.htmlBytes.toString('base64'),
      file_hash: prepared.fileHash,
      file_size_bytes: prepared.fileSizeBytes,
      target_identity: verified.targetIdentity,
      event_sequence: sequence
    }, 'snapshot') as ReportExportSnapshot)
  } finally {
    clone.close?.()
  }
}

export class ReportExportPlanner implements CommandPlannerV1<ReportExportSnapshot> {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<ReportExportSnapshot>
  }>): CommandPlanV1 {
    const expectedReportId = reportId(input.envelope)
    const snapshot = record(input.snapshot.value, 'snapshot')
    if (snapshot.schema_version !== REPORT_EXPORT_SNAPSHOT_VERSION) {
      throw new ReportExportPlannerError('INVALID_INPUT', 'snapshot schema version is invalid')
    }
    const snapshotReportId = text(snapshot.report_id, 'snapshot.report_id')
    if (snapshotReportId !== expectedReportId) throw new ReportExportPlannerError('INVALID_INPUT', 'snapshot report identity conflicts')
    const statusBefore = text(snapshot.status_before, 'snapshot.status_before')
    const statusAfter = text(snapshot.status_after, 'snapshot.status_after')
    if (!['GENERATED', 'EXPORTED', 'LOCKED'].includes(statusBefore) || !['EXPORTED', 'LOCKED'].includes(statusAfter)) {
      throw new ReportExportPlannerError('INVALID_INPUT', 'snapshot report status is invalid')
    }
    const timestamp = exactTimestamp(snapshot.timestamp, 'snapshot.timestamp')
    const assetId = text(snapshot.artifact_id, 'snapshot.artifact_id')
    const targetIdentity = artifactTargetIdentity(snapshot.target_identity)
    const result = {
      success: true as const,
      reportId: snapshotReportId,
      status: statusAfter as 'EXPORTED' | 'LOCKED',
      exportPath: text(snapshot.target_path, 'snapshot.target_path'),
      fileAssetId: assetId,
      fileHash: text(snapshot.file_hash, 'snapshot.file_hash'),
      fileSizeBytes: integer(snapshot.file_size_bytes, 'snapshot.file_size_bytes', 0),
      canceled: false as const
    }
    const eventId = deterministicBatchUuid(input.envelope.commandId, 0, 'report-export-event')
    const payload = {
      event_payload_version: REPORT_EXPORT_EVENT_PAYLOAD_VERSION,
      batch_context: reportBatchContext({
        envelope: input.envelope,
        planVersion: REPORT_EXPORT_PLAN_VERSION,
        resultRecipeVersion: REPORT_EXPORT_RESULT_RECIPE_VERSION,
        childOrdinal: 0
      }),
      actor_role: 'TEACHER',
      app_version: text(snapshot.app_version, 'snapshot.app_version'),
      correlation_id: text(snapshot.correlation_id, 'snapshot.correlation_id'),
      report_id: snapshotReportId,
      export_format: 'HTML',
      export_path: result.exportPath,
      exported_at: timestamp,
      exported_by: input.envelope.actorId,
      file_asset_id: assetId,
      file_hash: result.fileHash,
      file_size_bytes: result.fileSizeBytes,
      mime_type: 'text/html',
      content_hash: text(snapshot.content_hash, 'snapshot.content_hash'),
      status_before: statusBefore,
      status_after: statusAfter,
      artifact: {
        schema_version: 'report-export-artifact-v1',
        artifact_id: assetId,
        target_identity: artifactIdentityValue(targetIdentity),
        artifact_bytes_base64: text(snapshot.html_bytes_base64, 'snapshot.html_bytes_base64'),
        file_hash: result.fileHash,
        file_size_bytes: result.fileSizeBytes,
        mime_type: 'text/html'
      },
      root_result: result
    }
    return {
      schemaVersion: 'command-plan-v1',
      commandId: input.envelope.commandId,
      commandType: input.envelope.commandType,
      planVersion: REPORT_EXPORT_PLAN_VERSION,
      resultRecipeVersion: REPORT_EXPORT_RESULT_RECIPE_VERSION,
      events: [{
        eventId,
        aggregateType: 'TASK_REPORT',
        aggregateId: snapshotReportId,
        eventType: 'REPORT_EXPORTED',
        eventSequence: integer(snapshot.event_sequence, 'snapshot.event_sequence'),
        payload,
        actorId: input.envelope.actorId,
        timestamp
      }],
      operationalEffects: [],
      preApplyEffects: [{
        sourceEventId: eventId,
        eventType: 'REPORT_EXPORTED',
        effectType: REPORT_EXPORT_PRE_APPLY_EFFECT.effectType,
        effectVersion: REPORT_EXPORT_PRE_APPLY_EFFECT.effectVersion
      }],
      noOpResult: null
    }
  }
}
