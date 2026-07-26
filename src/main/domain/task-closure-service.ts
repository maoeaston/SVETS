import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../db/interface'
import { assertCaller } from '../utils/auth-context'
import { sha256CanonicalJson } from './report-canonical'
import {
  readBaseTaskResultBinding,
  type BaseTaskResultBinding
} from './report-source-reader'
import type { F7EventIntent, ReportCommandCoordinator } from './report-command-coordinator'
import type { TaskClosureConfirmedPayload, TaskClosureReplacedPayload } from '@shared/types/event-payloads'

type ClosureStatus = 'CONFIRMED' | 'SUPERSEDED'
type ActiveReportStatus = 'GENERATED' | 'EXPORTED' | 'LOCKED'

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

interface ConfirmTaskClosureParams {
  callerUserId: string
  callerRole: 'TEACHER'
  resultIds: readonly string[]
  confirmedAt?: string
  correlationId?: string
}

interface ReplaceTaskClosureParams {
  callerUserId: string
  callerRole: 'TEACHER'
  oldTaskClosureId: string
  resultIds: readonly string[]
  correctionReason: string
  replacedAt?: string
  correlationId?: string
}

export interface TaskClosureCommandResult {
  taskClosureId: string
  created: boolean
  eventId: string | null
}

export interface TaskClosureCandidate {
  studentId: string
  jobCode: string
  taskCode: string
  sourceResultIds: [string, string, string]
  existingTaskClosureId: string | null
}

export class TaskClosureServiceError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'CLOSURE_NOT_FOUND'
      | 'RESULT_ALREADY_USED'
      | 'INVALID_REPLACEMENT'
      | 'REPLACEMENT_NOT_ALLOWED',
    message: string
  ) {
    super(message)
    this.name = 'TaskClosureServiceError'
  }
}

export class TaskClosureService {
  constructor(
    private readonly db: DBAdapter,
    private readonly coordinator: ReportCommandCoordinator
  ) {}

  getBaseCandidate(resultIds: readonly string[]): TaskClosureCandidate {
    const binding = readBaseTaskResultBinding(this.db, resultIds)
    const existing = findActiveClosureByFingerprint(this.db, binding)
    return {
      studentId: binding.studentId,
      jobCode: binding.jobCode,
      taskCode: binding.taskCode,
      sourceResultIds: binding.sourceResultIds,
      existingTaskClosureId: existing?.task_closure_id ?? null
    }
  }

  async confirmBaseTaskClosure(params: ConfirmTaskClosureParams): Promise<TaskClosureCommandResult> {
    const teacherId = requireActiveTeacher(this.db, params.callerUserId, params.callerRole)
    const initialBinding = readBaseTaskResultBinding(this.db, params.resultIds)

    return this.coordinator.runSingleEventCommand({
      key: { studentId: initialBinding.studentId, jobCode: initialBinding.jobCode, taskCode: initialBinding.taskCode, scope: 'BASE_ABILITY' },
      areas: ['TASK_CLOSURE', 'TASK_REPORT'],
      buildIntent: () => {
        const binding = readBaseTaskResultBinding(this.db, params.resultIds)
        const existing = findActiveClosureByFingerprint(this.db, binding)
        if (existing) return null
        assertResultsNeverUsed(this.db, binding.sourceResultIds)

        const supersededClosures = activeClosuresForBusinessKey(this.db, binding)
        const cycleNo = maxCycleNo(this.db, binding) + 1
        const closureId = uuidv4()
        const confirmedAt = params.confirmedAt ?? new Date().toISOString()
        const supersededClosureIds = supersededClosures.map((closure) => closure.task_closure_id)
        const payload: TaskClosureConfirmedPayload = {
          task_closure_id: closureId,
          student_id: binding.studentId,
          job_code: binding.jobCode,
          task_code: binding.taskCode,
          cycle_no: cycleNo,
          closure_revision: 1,
          status: 'CONFIRMED',
          is_cycle_head: true,
          source_result_ids: binding.sourceResultIds,
          task_result_snapshots: binding.snapshots,
          confirmed_by: teacherId,
          confirmed_at: confirmedAt,
          superseded_task_closure_ids: supersededClosureIds,
          superseded_report_ids: activeReportIdsForClosures(this.db, supersededClosureIds)
        }
        return {
          aggregateType: 'TASK_CLOSURE',
          aggregateId: closureId,
          eventType: 'TASK_CLOSURE_CONFIRMED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: teacherId,
          actorRole: 'TEACHER',
          correlationId: params.correlationId
        } satisfies F7EventIntent
      },
      mapResult: (event) => {
        if (!event) {
          const binding = readBaseTaskResultBinding(this.db, params.resultIds)
          const existing = findActiveClosureByFingerprint(this.db, binding)
          if (!existing) throw new TaskClosureServiceError('INVALID_REPLACEMENT', 'Idempotent closure lookup failed')
          return { taskClosureId: existing.task_closure_id, created: false, eventId: null }
        }
        return { taskClosureId: event.aggregate_id, created: true, eventId: event.event_id }
      }
    })
  }

  async replaceBaseTaskClosure(params: ReplaceTaskClosureParams): Promise<TaskClosureCommandResult> {
    const teacherId = requireActiveTeacher(this.db, params.callerUserId, params.callerRole)
    const oldClosure = requireClosure(this.db, params.oldTaskClosureId)

    return this.coordinator.runSingleEventCommand({
      key: { studentId: oldClosure.student_id, jobCode: oldClosure.job_code, taskCode: oldClosure.task_code, scope: 'BASE_ABILITY' },
      areas: ['TASK_CLOSURE', 'TASK_REPORT'],
      buildIntent: () => {
        const old = requireClosure(this.db, params.oldTaskClosureId)
        const oldIds = closureResultIds(old)
        const binding = readBaseTaskResultBinding(this.db, params.resultIds, {
          allowHistoricalResultIds: new Set(oldIds)
        })
        assertSameBusinessKey(old, binding)

        const idempotentReplacement = findDirectReplacementByFingerprint(this.db, old.task_closure_id, binding)
        if (idempotentReplacement) return null
        if (fingerprintForIds(oldIds) === fingerprintForIds(binding.sourceResultIds)) return null

        const reason = params.correctionReason.trim()
        if (reason.length === 0) {
          throw new TaskClosureServiceError('INVALID_REPLACEMENT', 'Replacement requires a correction reason')
        }
        assertReplacementTargetAllowed(old)
        assertDirectOldOrNewOnly(this.db, oldIds, binding.sourceResultIds)

        const highestCycle = maxCycleNo(this.db, binding)
        const isReplacingCurrentHead = old.status === 'CONFIRMED' && old.is_cycle_head === 1 && old.cycle_no === highestCycle
        const closureId = uuidv4()
        const replacedAt = params.replacedAt ?? new Date().toISOString()
        const payload: TaskClosureReplacedPayload = isReplacingCurrentHead ? {
          old_task_closure_id: old.task_closure_id,
          new_task_closure_id: closureId,
          student_id: binding.studentId,
          job_code: binding.jobCode,
          task_code: binding.taskCode,
          cycle_no: old.cycle_no,
          closure_revision: old.closure_revision + 1,
          status: 'CONFIRMED',
          is_cycle_head: true,
          correction_reason: reason,
          source_result_ids: binding.sourceResultIds,
          task_result_snapshots: binding.snapshots,
          reused_result_ids: binding.sourceResultIds.filter((id) => oldIds.includes(id)),
          new_result_ids: binding.sourceResultIds.filter((id) => !oldIds.includes(id)),
          replaced_by: teacherId,
          replaced_at: replacedAt,
          archived_report_ids: activeReportIdsForClosures(this.db, [old.task_closure_id])
        } : {
          old_task_closure_id: old.task_closure_id,
          new_task_closure_id: closureId,
          student_id: binding.studentId,
          job_code: binding.jobCode,
          task_code: binding.taskCode,
          cycle_no: old.cycle_no,
          closure_revision: old.closure_revision + 1,
          status: 'SUPERSEDED',
          is_cycle_head: false,
          correction_reason: reason,
          source_result_ids: binding.sourceResultIds,
          task_result_snapshots: binding.snapshots,
          reused_result_ids: binding.sourceResultIds.filter((id) => oldIds.includes(id)),
          new_result_ids: binding.sourceResultIds.filter((id) => !oldIds.includes(id)),
          replaced_by: teacherId,
          replaced_at: replacedAt,
          archived_report_ids: activeReportIdsForClosures(this.db, [old.task_closure_id])
        }
        return {
          aggregateType: 'TASK_CLOSURE',
          aggregateId: closureId,
          eventType: 'TASK_CLOSURE_REPLACED',
          payload: payload as unknown as Record<string, unknown>,
          actorId: teacherId,
          actorRole: 'TEACHER',
          correlationId: params.correlationId
        } satisfies F7EventIntent
      },
      mapResult: (event) => {
        if (event) return { taskClosureId: event.aggregate_id, created: true, eventId: event.event_id }
        const old = requireClosure(this.db, params.oldTaskClosureId)
        const binding = readBaseTaskResultBinding(this.db, params.resultIds, {
          allowHistoricalResultIds: new Set(closureResultIds(old))
        })
        const direct = findDirectReplacementByFingerprint(this.db, old.task_closure_id, binding)
        return {
          taskClosureId: direct?.task_closure_id ?? old.task_closure_id,
          created: false,
          eventId: null
        }
      }
    })
  }
}

function requireActiveTeacher(db: DBAdapter, callerUserId: string, callerRole: 'TEACHER'): string {
  const caller = assertCaller(db, callerUserId, callerRole)
  if (!caller.ok || caller.row.role !== 'TEACHER') {
    throw new TaskClosureServiceError('FORBIDDEN', 'Task closure operations require an ACTIVE TEACHER')
  }
  return caller.row.user_id
}

function requireClosure(db: DBAdapter, closureId: string): ClosureRow {
  const closure = db.prepare('SELECT * FROM task_closure WHERE task_closure_id = ?').get(closureId) as ClosureRow | undefined
  if (!closure) throw new TaskClosureServiceError('CLOSURE_NOT_FOUND', `Task closure ${closureId} was not found`)
  return closure
}

function closureResultIds(closure: ClosureRow): [string, string, string] {
  return [closure.ability_result_id, closure.training_completion_result_id, closure.operation_pass_rate_result_id]
}

function fingerprintForIds(ids: readonly string[]): string {
  return sha256CanonicalJson([
    { result_type: 'ABILITY_SCORE', result_id: ids[0] },
    { result_type: 'TRAINING_COMPLETION', result_id: ids[1] },
    { result_type: 'OPERATION_PASS_RATE', result_id: ids[2] }
  ])
}

function bindingMatches(closure: ClosureRow, binding: BaseTaskResultBinding): boolean {
  return fingerprintForIds(closureResultIds(closure)) === fingerprintForIds(binding.sourceResultIds)
}

function assertSameBusinessKey(closure: ClosureRow, binding: BaseTaskResultBinding): void {
  if (
    closure.student_id !== binding.studentId
    || closure.job_code !== binding.jobCode
    || closure.task_code !== binding.taskCode
  ) {
    throw new TaskClosureServiceError('INVALID_REPLACEMENT', 'Replacement result business key does not match old closure')
  }
}

function findActiveClosureByFingerprint(db: DBAdapter, binding: BaseTaskResultBinding): ClosureRow | null {
  const rows = db.prepare(
    `SELECT * FROM task_closure
      WHERE student_id = ? AND job_code = ? AND task_code = ?
        AND status = 'CONFIRMED' AND is_cycle_head = 1`
  ).all(binding.studentId, binding.jobCode, binding.taskCode) as ClosureRow[]
  return rows.find((row) => bindingMatches(row, binding)) ?? null
}

function findDirectReplacementByFingerprint(db: DBAdapter, oldClosureId: string, binding: BaseTaskResultBinding): ClosureRow | null {
  const rows = db.prepare('SELECT * FROM task_closure WHERE replaces_task_closure_id = ?').all(oldClosureId) as ClosureRow[]
  return rows.find((row) => bindingMatches(row, binding)) ?? null
}

function activeClosuresForBusinessKey(db: DBAdapter, binding: BaseTaskResultBinding): ClosureRow[] {
  return db.prepare(
    `SELECT * FROM task_closure
      WHERE student_id = ? AND job_code = ? AND task_code = ?
        AND status = 'CONFIRMED' AND is_cycle_head = 1
      ORDER BY cycle_no ASC, closure_revision ASC`
  ).all(binding.studentId, binding.jobCode, binding.taskCode) as ClosureRow[]
}

function maxCycleNo(db: DBAdapter, binding: Pick<BaseTaskResultBinding, 'studentId' | 'jobCode' | 'taskCode'>): number {
  const row = db.prepare(
    `SELECT MAX(cycle_no) AS max_cycle
       FROM task_closure
      WHERE student_id = ? AND job_code = ? AND task_code = ?`
  ).get(binding.studentId, binding.jobCode, binding.taskCode) as { max_cycle: number | null } | undefined
  return row?.max_cycle ?? 0
}

function activeReportIdsForClosures(db: DBAdapter, closureIds: readonly string[]): string[] {
  if (closureIds.length === 0) return []
  const activeStatuses: ActiveReportStatus[] = ['GENERATED', 'EXPORTED', 'LOCKED']
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
  void activeStatuses
  return result
}

function assertResultsNeverUsed(db: DBAdapter, ids: readonly string[]): void {
  for (const resultId of ids) {
    const row = db.prepare(
      `SELECT task_closure_id FROM task_closure
        WHERE ability_result_id = ?
           OR training_completion_result_id = ?
           OR operation_pass_rate_result_id = ?
        LIMIT 1`
    ).get(resultId, resultId, resultId) as { task_closure_id: string } | undefined
    if (row) {
      throw new TaskClosureServiceError('RESULT_ALREADY_USED', `Result ${resultId} has already been bound to a task closure`)
    }
  }
}

function assertReplacementTargetAllowed(old: ClosureRow): void {
  if (old.status === 'CONFIRMED' && old.is_cycle_head === 1) return
  if (old.status === 'SUPERSEDED' && old.is_cycle_head === 0 && old.replacement_task_closure_id === null) return
  throw new TaskClosureServiceError('REPLACEMENT_NOT_ALLOWED', 'Only a current head or unreplaced historical closure can be replaced')
}

function assertDirectOldOrNewOnly(db: DBAdapter, oldIds: readonly string[], requestedIds: readonly string[]): void {
  for (const resultId of requestedIds) {
    if (oldIds.includes(resultId)) continue
    const used = db.prepare(
      `SELECT task_closure_id FROM task_closure
        WHERE ability_result_id = ?
           OR training_completion_result_id = ?
           OR operation_pass_rate_result_id = ?
        LIMIT 1`
    ).get(resultId, resultId, resultId) as { task_closure_id: string } | undefined
    if (used) {
      throw new TaskClosureServiceError('INVALID_REPLACEMENT', `Replacement result ${resultId} is not new`)
    }
  }
}
