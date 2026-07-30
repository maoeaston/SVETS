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
import { sha256CanonicalJson } from '../../domain/report-canonical'
import {
  readBaseTaskResultBinding,
  type BaseTaskResultBinding
} from '../../domain/report-source-reader'
import {
  REPORT_EVENT_PAYLOAD_VERSION,
  deterministicBatchUuid,
  reportBatchContext
} from './report-plan-fragment'

export const TASK_CLOSURE_SNAPSHOT_VERSION = 'm5b-task-closure-snapshot-v1'

export const TASK_CLOSURE_PLAN_VERSIONS = Object.freeze({
  'reports:confirmTaskClosure': 'm5b.reports.confirm-task-closure.plan.v1',
  'reports:replaceTaskClosure': 'm5b.reports.replace-task-closure.plan.v1'
} as const)

export const TASK_CLOSURE_RESULT_RECIPE_VERSIONS = Object.freeze({
  'reports:confirmTaskClosure': 'm5b.reports:confirmTaskClosure.result.v1',
  'reports:replaceTaskClosure': 'm5b.reports:replaceTaskClosure.result.v1'
} as const)

type TaskClosureCommand = keyof typeof TASK_CLOSURE_PLAN_VERSIONS
type ClosureStatus = 'CONFIRMED' | 'SUPERSEDED'

interface ClosureRow {
  task_closure_id: string
  student_id: string
  job_code: string
  task_code: string
  cycle_no: number
  closure_revision: number
  status: ClosureStatus
  is_cycle_head: number
  ability_result_id: string
  training_completion_result_id: string
  operation_pass_rate_result_id: string
  replaces_task_closure_id: string | null
  replacement_task_closure_id: string | null
}

type TaskClosureSnapshotV1 = Readonly<Record<string, CanonicalJsonValue> & {
  schema_version: typeof TASK_CLOSURE_SNAPSHOT_VERSION
  kind: 'CONFIRM' | 'REPLACE'
  timestamp: string
  app_version: string
  correlation_id: string
  actor_role: 'TEACHER'
  binding: Readonly<Record<string, CanonicalJsonValue>>
  no_op_result: Readonly<Record<string, CanonicalJsonValue>> | null
  event_facts: Readonly<Record<string, CanonicalJsonValue>> | null
}>

export class TaskClosurePlannerError extends Error {
  constructor(
    public readonly code:
      | 'COMMAND_UNSUPPORTED'
      | 'INVALID_INPUT'
      | 'TARGET_MISMATCH'
      | 'CLOSURE_NOT_FOUND'
      | 'RESULT_ALREADY_USED'
      | 'INVALID_REPLACEMENT'
      | 'REPLACEMENT_NOT_ALLOWED',
    message: string
  ) {
    super(`[m5b-task-closure-planner] ${message}`)
    this.name = 'TaskClosurePlannerError'
  }
}

function canonicalRecord(value: unknown): Record<string, CanonicalJsonValue> {
  const parsed = JSON.parse(canonicalJson(value)) as CanonicalJsonValue
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TaskClosurePlannerError('INVALID_INPUT', 'snapshot value must be an object')
  }
  return parsed
}

function record(value: unknown, field: string): Readonly<Record<string, CanonicalJsonValue>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TaskClosurePlannerError('INVALID_INPUT', `${field} must be an object`)
  }
  return value as Readonly<Record<string, CanonicalJsonValue>>
}

function requiredText(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new TaskClosurePlannerError('INVALID_INPUT', `${field} must be a non-empty trimmed string`)
  }
  return value
}

function requiredInteger(value: CanonicalJsonValue | undefined, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TaskClosurePlannerError('INVALID_INPUT', `${field} must be a positive safe integer`)
  }
  return value as number
}

function requiredBoolean(value: CanonicalJsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TaskClosurePlannerError('INVALID_INPUT', `${field} must be a boolean`)
  }
  return value
}

function requiredArray(value: CanonicalJsonValue | undefined, field: string): CanonicalJsonValue[] {
  if (!Array.isArray(value)) throw new TaskClosurePlannerError('INVALID_INPUT', `${field} must be an array`)
  return value
}

function exactTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new TaskClosurePlannerError('INVALID_INPUT', 'timestamp must be exact UTC milliseconds')
  }
  return value
}

function assertTeacher(envelope: CommandEnvelopeV2): void {
  if (envelope.actor.kind !== 'USER' || envelope.actor.role !== 'TEACHER' || envelope.actor.userId !== envelope.actorId) {
    throw new TaskClosurePlannerError('INVALID_INPUT', 'task closure planning requires the accepted teacher actor')
  }
}

function assertTargetField(
  envelope: CommandEnvelopeV2,
  field: string,
  expected: CanonicalJsonValue
): void {
  if (canonicalJson(envelope.target[field]) !== canonicalJson(expected)) {
    throw new TaskClosurePlannerError('TARGET_MISMATCH', `accepted target field ${field} changed`)
  }
}

function closureResultIds(row: ClosureRow): [string, string, string] {
  return [row.ability_result_id, row.training_completion_result_id, row.operation_pass_rate_result_id]
}

function fingerprintForIds(ids: readonly string[]): string {
  return sha256CanonicalJson([
    { result_type: 'ABILITY_SCORE', result_id: ids[0] },
    { result_type: 'TRAINING_COMPLETION', result_id: ids[1] },
    { result_type: 'OPERATION_PASS_RATE', result_id: ids[2] }
  ])
}

function bindingMatches(row: ClosureRow, binding: BaseTaskResultBinding): boolean {
  return fingerprintForIds(closureResultIds(row)) === fingerprintForIds(binding.sourceResultIds)
}

function closureView(row: ClosureRow): Record<string, CanonicalJsonValue> {
  return {
    taskClosureId: row.task_closure_id,
    studentId: row.student_id,
    jobCode: row.job_code,
    taskCode: row.task_code,
    cycleNo: row.cycle_no,
    closureRevision: row.closure_revision,
    status: row.status,
    isCycleHead: row.is_cycle_head === 1,
    resultIds: closureResultIds(row)
  }
}

function requireClosure(db: DBAdapter, closureId: string): ClosureRow {
  const row = db.prepare(
    'SELECT * FROM task_closure WHERE task_closure_id = ?'
  ).get(closureId) as ClosureRow | undefined
  if (!row) {
    throw new TaskClosurePlannerError('CLOSURE_NOT_FOUND', `task closure ${closureId} was not found`)
  }
  return row
}

function activeClosures(db: DBAdapter, binding: BaseTaskResultBinding): ClosureRow[] {
  return db.prepare(
    `SELECT * FROM task_closure
      WHERE student_id = ? AND job_code = ? AND task_code = ?
        AND status = 'CONFIRMED' AND is_cycle_head = 1
      ORDER BY cycle_no ASC, closure_revision ASC, task_closure_id ASC`
  ).all(binding.studentId, binding.jobCode, binding.taskCode) as ClosureRow[]
}

function activeClosureByFingerprint(db: DBAdapter, binding: BaseTaskResultBinding): ClosureRow | null {
  return activeClosures(db, binding).find((row) => bindingMatches(row, binding)) ?? null
}

function directReplacementByFingerprint(
  db: DBAdapter,
  oldClosureId: string,
  binding: BaseTaskResultBinding
): ClosureRow | null {
  const rows = db.prepare(
    'SELECT * FROM task_closure WHERE replaces_task_closure_id = ? ORDER BY closure_revision, task_closure_id'
  ).all(oldClosureId) as ClosureRow[]
  return rows.find((row) => bindingMatches(row, binding)) ?? null
}

function maxCycleNo(db: DBAdapter, binding: BaseTaskResultBinding): number {
  const row = db.prepare(
    `SELECT MAX(cycle_no) AS max_cycle
       FROM task_closure
      WHERE student_id = ? AND job_code = ? AND task_code = ?`
  ).get(binding.studentId, binding.jobCode, binding.taskCode) as { max_cycle: number | null } | undefined
  return row?.max_cycle ?? 0
}

function activeReportIds(db: DBAdapter, closureIds: readonly string[]): string[] {
  const result: string[] = []
  for (const closureId of closureIds) {
    const rows = db.prepare(
      `SELECT report_id FROM task_report
        WHERE task_closure_id = ?
          AND status IN ('GENERATED', 'EXPORTED', 'LOCKED')
        ORDER BY report_id`
    ).all(closureId) as Array<{ report_id: string }>
    result.push(...rows.map((row) => row.report_id))
  }
  return result
}

function assertResultsNeverUsed(db: DBAdapter, resultIds: readonly string[]): void {
  for (const resultId of resultIds) {
    const row = db.prepare(
      `SELECT task_closure_id FROM task_closure
        WHERE ability_result_id = ?
           OR training_completion_result_id = ?
           OR operation_pass_rate_result_id = ?
        LIMIT 1`
    ).get(resultId, resultId, resultId) as { task_closure_id: string } | undefined
    if (row) {
      throw new TaskClosurePlannerError('RESULT_ALREADY_USED', `result ${resultId} was already bound`)
    }
  }
}

function assertSameBusinessKey(row: ClosureRow, binding: BaseTaskResultBinding): void {
  if (
    row.student_id !== binding.studentId
    || row.job_code !== binding.jobCode
    || row.task_code !== binding.taskCode
  ) {
    throw new TaskClosurePlannerError('INVALID_REPLACEMENT', 'replacement result business key changed')
  }
}

function assertReplacementAllowed(row: ClosureRow): void {
  if (row.status === 'CONFIRMED' && row.is_cycle_head === 1) return
  if (row.status === 'SUPERSEDED' && row.is_cycle_head === 0 && row.replacement_task_closure_id === null) return
  throw new TaskClosurePlannerError(
    'REPLACEMENT_NOT_ALLOWED',
    'only a current head or unreplaced historical closure can be replaced'
  )
}

function assertDirectOldOrNewOnly(
  db: DBAdapter,
  oldResultIds: readonly string[],
  requestedResultIds: readonly string[]
): void {
  for (const resultId of requestedResultIds) {
    if (oldResultIds.includes(resultId)) continue
    const row = db.prepare(
      `SELECT task_closure_id FROM task_closure
        WHERE ability_result_id = ?
           OR training_completion_result_id = ?
           OR operation_pass_rate_result_id = ?
        LIMIT 1`
    ).get(resultId, resultId, resultId) as { task_closure_id: string } | undefined
    if (row) {
      throw new TaskClosurePlannerError('INVALID_REPLACEMENT', `replacement result ${resultId} is not new`)
    }
  }
}

function bindingSnapshot(binding: BaseTaskResultBinding): Record<string, CanonicalJsonValue> {
  return canonicalRecord({
    student_id: binding.studentId,
    job_code: binding.jobCode,
    task_code: binding.taskCode,
    source_result_ids: binding.sourceResultIds,
    task_result_snapshots: binding.snapshots
  })
}

function confirmSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  timestamp: string,
  appVersion: string
): TaskClosureSnapshotV1 {
  const resultIds = envelope.target.source_result_ids
  if (!Array.isArray(resultIds) || resultIds.length !== 3 || resultIds.some((value) => typeof value !== 'string')) {
    throw new TaskClosurePlannerError('INVALID_INPUT', 'target.source_result_ids must contain three IDs')
  }
  const binding = readBaseTaskResultBinding(db, resultIds as string[])
  assertTargetField(envelope, 'aggregate_type', 'TASK_CLOSURE')
  assertTargetField(envelope, 'student_id', binding.studentId)
  assertTargetField(envelope, 'job_code', binding.jobCode)
  assertTargetField(envelope, 'task_code', binding.taskCode)
  assertTargetField(envelope, 'source_result_ids', binding.sourceResultIds)
  const existing = activeClosureByFingerprint(db, binding)
  if (existing) {
    return canonicalRecord({
      schema_version: TASK_CLOSURE_SNAPSHOT_VERSION,
      kind: 'CONFIRM',
      timestamp,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      actor_role: 'TEACHER',
      binding: bindingSnapshot(binding),
      no_op_result: { success: true, taskClosure: closureView(existing) },
      event_facts: null
    }) as TaskClosureSnapshotV1
  }
  assertResultsNeverUsed(db, binding.sourceResultIds)
  const superseded = activeClosures(db, binding)
  const supersededIds = superseded.map((row) => row.task_closure_id)
  return canonicalRecord({
    schema_version: TASK_CLOSURE_SNAPSHOT_VERSION,
    kind: 'CONFIRM',
    timestamp,
    app_version: appVersion,
    correlation_id: envelope.correlationId,
    actor_role: 'TEACHER',
    binding: bindingSnapshot(binding),
    no_op_result: null,
    event_facts: {
      cycle_no: maxCycleNo(db, binding) + 1,
      closure_revision: 1,
      status: 'CONFIRMED',
      is_cycle_head: true,
      superseded_task_closure_ids: supersededIds,
      superseded_report_ids: activeReportIds(db, supersededIds)
    }
  }) as TaskClosureSnapshotV1
}

function replaceSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  timestamp: string,
  appVersion: string
): TaskClosureSnapshotV1 {
  const closureId = requiredText(envelope.target.task_closure_id, 'target.task_closure_id')
  const old = requireClosure(db, closureId)
  const resultIds = envelope.target.source_result_ids
  if (!Array.isArray(resultIds) || resultIds.length !== 3 || resultIds.some((value) => typeof value !== 'string')) {
    throw new TaskClosurePlannerError('INVALID_INPUT', 'target.source_result_ids must contain three IDs')
  }
  const oldIds = closureResultIds(old)
  const binding = readBaseTaskResultBinding(db, resultIds as string[], {
    allowHistoricalResultIds: new Set(oldIds)
  })
  assertSameBusinessKey(old, binding)
  assertTargetField(envelope, 'aggregate_type', 'TASK_CLOSURE')
  assertTargetField(envelope, 'task_closure_id', old.task_closure_id)
  assertTargetField(envelope, 'student_id', binding.studentId)
  assertTargetField(envelope, 'job_code', binding.jobCode)
  assertTargetField(envelope, 'task_code', binding.taskCode)
  assertTargetField(envelope, 'source_result_ids', binding.sourceResultIds)
  const direct = directReplacementByFingerprint(db, old.task_closure_id, binding)
  if (direct || fingerprintForIds(oldIds) === fingerprintForIds(binding.sourceResultIds)) {
    return canonicalRecord({
      schema_version: TASK_CLOSURE_SNAPSHOT_VERSION,
      kind: 'REPLACE',
      timestamp,
      app_version: appVersion,
      correlation_id: envelope.correlationId,
      actor_role: 'TEACHER',
      binding: bindingSnapshot(binding),
      no_op_result: { success: true, taskClosure: closureView(direct ?? old) },
      event_facts: null
    }) as TaskClosureSnapshotV1
  }
  const correctionReason = envelope.payload.correctionReason
  if (typeof correctionReason !== 'string' || correctionReason.trim().length === 0) {
    throw new TaskClosurePlannerError('INVALID_REPLACEMENT', 'replacement requires a correction reason')
  }
  assertReplacementAllowed(old)
  assertDirectOldOrNewOnly(db, oldIds, binding.sourceResultIds)
  const isReplacingCurrentHead = old.status === 'CONFIRMED'
    && old.is_cycle_head === 1
    && old.cycle_no === maxCycleNo(db, binding)
  return canonicalRecord({
    schema_version: TASK_CLOSURE_SNAPSHOT_VERSION,
    kind: 'REPLACE',
    timestamp,
    app_version: appVersion,
    correlation_id: envelope.correlationId,
    actor_role: 'TEACHER',
    binding: bindingSnapshot(binding),
    no_op_result: null,
    event_facts: {
      old_task_closure_id: old.task_closure_id,
      cycle_no: old.cycle_no,
      closure_revision: old.closure_revision + 1,
      status: isReplacingCurrentHead ? 'CONFIRMED' : 'SUPERSEDED',
      is_cycle_head: isReplacingCurrentHead,
      correction_reason: correctionReason.trim(),
      reused_result_ids: binding.sourceResultIds.filter((id) => oldIds.includes(id)),
      new_result_ids: binding.sourceResultIds.filter((id) => !oldIds.includes(id)),
      archived_report_ids: activeReportIds(db, [old.task_closure_id])
    }
  }) as TaskClosureSnapshotV1
}

export function loadTaskClosurePlannerSnapshot(
  db: DBAdapter,
  envelope: CommandEnvelopeV2,
  options: Readonly<{ timestamp: string; appVersion: string }>
): PlannerReadSnapshot<CanonicalJsonValue> {
  assertTeacher(envelope)
  const timestamp = exactTimestamp(options.timestamp)
  if (!options.appVersion.trim()) throw new TaskClosurePlannerError('INVALID_INPUT', 'appVersion is required')
  if (envelope.commandType === 'reports:confirmTaskClosure') {
    return createPlannerReadSnapshot(confirmSnapshot(db, envelope, timestamp, options.appVersion))
  }
  if (envelope.commandType === 'reports:replaceTaskClosure') {
    return createPlannerReadSnapshot(replaceSnapshot(db, envelope, timestamp, options.appVersion))
  }
  throw new TaskClosurePlannerError('COMMAND_UNSUPPORTED', `unsupported task closure command ${envelope.commandType}`)
}

function planEvent(
  envelope: CommandEnvelopeV2,
  snapshot: TaskClosureSnapshotV1,
  planVersion: string,
  resultRecipeVersion: string
): EventIntentV1 {
  if (!snapshot.event_facts) throw new TaskClosurePlannerError('INVALID_INPUT', 'event snapshot has no facts')
  const facts = snapshot.event_facts
  const binding = snapshot.binding
  const eventType = snapshot.kind === 'CONFIRM' ? 'TASK_CLOSURE_CONFIRMED' : 'TASK_CLOSURE_REPLACED'
  const newClosureId = deterministicBatchUuid(envelope.commandId, 0, 'task-closure')
  const metadata = {
    event_payload_version: REPORT_EVENT_PAYLOAD_VERSION,
    batch_context: reportBatchContext({ envelope, planVersion, resultRecipeVersion, childOrdinal: 0 }),
    actor_role: snapshot.actor_role,
    app_version: snapshot.app_version,
    correlation_id: snapshot.correlation_id
  }
  const common = {
    student_id: requiredText(binding.student_id, 'binding.student_id'),
    job_code: requiredText(binding.job_code, 'binding.job_code'),
    task_code: requiredText(binding.task_code, 'binding.task_code'),
    cycle_no: requiredInteger(facts.cycle_no, 'event_facts.cycle_no'),
    closure_revision: requiredInteger(facts.closure_revision, 'event_facts.closure_revision'),
    status: requiredText(facts.status, 'event_facts.status'),
    is_cycle_head: requiredBoolean(facts.is_cycle_head, 'event_facts.is_cycle_head'),
    source_result_ids: requiredArray(binding.source_result_ids, 'binding.source_result_ids'),
    task_result_snapshots: requiredArray(binding.task_result_snapshots, 'binding.task_result_snapshots')
  }
  const payload: EventIntentV1['payload'] = snapshot.kind === 'CONFIRM'
    ? {
        ...metadata,
        task_closure_id: newClosureId,
        ...common,
        confirmed_by: envelope.actorId,
        confirmed_at: snapshot.timestamp,
        superseded_task_closure_ids: requiredArray(
          facts.superseded_task_closure_ids,
          'event_facts.superseded_task_closure_ids'
        ),
        superseded_report_ids: requiredArray(
          facts.superseded_report_ids,
          'event_facts.superseded_report_ids'
        )
      }
    : {
        ...metadata,
        old_task_closure_id: requiredText(facts.old_task_closure_id, 'event_facts.old_task_closure_id'),
        new_task_closure_id: newClosureId,
        ...common,
        correction_reason: requiredText(facts.correction_reason, 'event_facts.correction_reason'),
        reused_result_ids: requiredArray(facts.reused_result_ids, 'event_facts.reused_result_ids'),
        new_result_ids: requiredArray(facts.new_result_ids, 'event_facts.new_result_ids'),
        replaced_by: envelope.actorId,
        replaced_at: snapshot.timestamp,
        archived_report_ids: requiredArray(facts.archived_report_ids, 'event_facts.archived_report_ids')
      }
  return {
    eventId: deterministicBatchUuid(envelope.commandId, 0, `${eventType.toLowerCase()}-event`),
    aggregateType: 'TASK_CLOSURE',
    aggregateId: newClosureId,
    eventType,
    eventSequence: 1,
    payload,
    actorId: envelope.actorId,
    timestamp: snapshot.timestamp
  }
}

export class TaskClosurePlanner {
  plan(input: Readonly<{
    envelope: CommandEnvelopeV2
    snapshot: PlannerReadSnapshot<CanonicalJsonValue>
  }>): CommandPlanV1 {
    const command = input.envelope.commandType as TaskClosureCommand
    const planVersion = TASK_CLOSURE_PLAN_VERSIONS[command]
    const resultRecipeVersion = TASK_CLOSURE_RESULT_RECIPE_VERSIONS[command]
    if (!planVersion || !resultRecipeVersion) {
      throw new TaskClosurePlannerError('COMMAND_UNSUPPORTED', `unsupported task closure command ${input.envelope.commandType}`)
    }
    const value = record(input.snapshot.value, 'snapshot')
    if (value.schema_version !== TASK_CLOSURE_SNAPSHOT_VERSION) {
      throw new TaskClosurePlannerError('INVALID_INPUT', 'task closure snapshot version mismatch')
    }
    const snapshot = value as TaskClosureSnapshotV1
    const events = snapshot.no_op_result === null
      ? [planEvent(input.envelope, snapshot, planVersion, resultRecipeVersion)]
      : []
    return {
      schemaVersion: COMMAND_PLAN_SCHEMA_VERSION,
      commandId: input.envelope.commandId,
      commandType: input.envelope.commandType,
      planVersion,
      resultRecipeVersion,
      events,
      operationalEffects: [],
      noOpResult: events.length === 0 ? snapshot.no_op_result : null
    }
  }
}
