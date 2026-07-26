import type { DBAdapter } from '../db/interface'
import { writeEvent, type WriteEventParams } from './event-writer'
import { reconcileActionLog } from './recovery'
import { parseF7EventPayload } from './report-contract'
import { applyReportEvent, markReportEventApplied } from './report-reducer'
import {
  assertF7WriteAllowed,
  blockF7Writes,
  clearF7WriteBlockAfterRecovery,
  F7_WRITE_AREAS,
  type F7WriteArea,
  ReportWriteBlockedError
} from './report-write-gate'
import type { ActionLogEntry, AggregateType, ActorRole, EventType } from '@shared/types/event-payloads'

export { F7_WRITE_AREAS, type F7WriteArea }

export interface ReportCommandKey {
  studentId: string
  jobCode: string
  taskCode: string
  scope: 'BASE_ABILITY' | 'JOB_SKILL' | 'SAFETY'
}

export interface F7EventIntent {
  aggregateType: AggregateType
  aggregateId: string
  eventType: EventType
  payload: Record<string, unknown>
  actorId: string
  actorRole: ActorRole
  correlationId?: string
}

export interface RunSingleEventCommandOptions<T> {
  key: ReportCommandKey
  areas: readonly F7WriteArea[]
  buildIntent: () => F7EventIntent | null | Promise<F7EventIntent | null>
  mapResult: (event: ActionLogEntry | null) => T
}

export interface RunSingleEventCommandSyncOptions<T> {
  key: ReportCommandKey
  areas: readonly F7WriteArea[]
  buildIntent: () => F7EventIntent | null
  mapResult: (event: ActionLogEntry | null) => T
}

export class ReportRecoveryRequiredError extends ReportWriteBlockedError {
  constructor(causeMessage: string) {
    super(causeMessage)
    this.name = 'ReportRecoveryRequiredError'
  }
}

export class ReportCommandValidationError extends Error {
  constructor(eventType: string) {
    super(`Invalid schema-v2 F7 payload for ${eventType}`)
    this.name = 'ReportCommandValidationError'
  }
}

type EventWriter = (params: WriteEventParams) => ActionLogEntry
type PendingRecovery = (db: DBAdapter, actionLogPath: string) => void

export interface ReportCommandCoordinatorOptions {
  db: DBAdapter
  actionLogPath: string
  eventWriter?: EventWriter
  recoverPending?: PendingRecovery
}

/**
 * Serializes F7 mutations at the report business-key boundary. It deliberately has
 * no IPC dependency so task closure, result, report, and safety services share one gate.
 */
export class ReportCommandCoordinator {
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly syncActiveKeys = new Set<string>()
  private readonly eventWriter: EventWriter
  private readonly recoverPending: PendingRecovery

  constructor(private readonly options: ReportCommandCoordinatorOptions) {
    this.eventWriter = options.eventWriter ?? writeEvent
    this.recoverPending = options.recoverPending ?? ((db, actionLogPath) => {
      reconcileActionLog(db, { logPath: actionLogPath })
    })
  }

  assertWriteAllowed(area: F7WriteArea): void {
    try {
      assertF7WriteAllowed(area)
    } catch (error) {
      if (error instanceof ReportWriteBlockedError) throw new ReportRecoveryRequiredError(error.causeMessage)
      throw error
    }
  }

  async recoverPendingF7EventsOrThrow(): Promise<void> {
    try {
      this.recoverPending(this.options.db, this.options.actionLogPath)
      clearF7WriteBlockAfterRecovery()
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      blockF7Writes(reason)
      throw new ReportRecoveryRequiredError(reason.message)
    }
  }

  async runSingleEventCommand<T>(options: RunSingleEventCommandOptions<T>): Promise<T> {
    const queueKey = reportCommandKey(options.key)
    const previous = this.queues.get(queueKey) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      await this.recoverPendingF7EventsOrThrow()
      for (const area of options.areas) this.assertWriteAllowed(area)
      const intent = await options.buildIntent()
      if (!intent) return options.mapResult(null)
      const parsedPayload = parseF7EventPayload(intent.eventType, intent.payload)
      if (!parsedPayload.valid) throw new ReportCommandValidationError(intent.eventType)

      try {
        const event = this.options.db.transaction(() => {
          const written = this.eventWriter({
            ...intent,
            schemaVersion: 2,
            database: this.options.db,
            actionLogPath: this.options.actionLogPath
          })
          applyReportEvent(this.options.db, written)
          markReportEventApplied(this.options.db, written)
          return written
        })()
        return options.mapResult(event)
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error))
        blockF7Writes(reason)
        throw new ReportRecoveryRequiredError(reason.message)
      }
    })

    this.queues.set(queueKey, current)
    try {
      return (await current) as T
    } finally {
      if (this.queues.get(queueKey) === current) this.queues.delete(queueKey)
    }
  }

  runSingleEventCommandSync<T>(options: RunSingleEventCommandSyncOptions<T>): T {
    const queueKey = reportCommandKey(options.key)
    if (this.syncActiveKeys.has(queueKey)) {
      throw new ReportRecoveryRequiredError(`Concurrent F7 command is already running for ${queueKey}`)
    }
    this.syncActiveKeys.add(queueKey)
    try {
      this.recoverPendingF7EventsOrThrowSync()
      for (const area of options.areas) this.assertWriteAllowed(area)
      const intent = options.buildIntent()
      if (!intent) return options.mapResult(null)
      const parsedPayload = parseF7EventPayload(intent.eventType, intent.payload)
      if (!parsedPayload.valid) throw new ReportCommandValidationError(intent.eventType)

      try {
        const event = this.options.db.transaction(() => {
          const written = this.eventWriter({
            ...intent,
            schemaVersion: 2,
            database: this.options.db,
            actionLogPath: this.options.actionLogPath
          })
          applyReportEvent(this.options.db, written)
          markReportEventApplied(this.options.db, written)
          return written
        })()
        return options.mapResult(event)
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error))
        blockF7Writes(reason)
        throw new ReportRecoveryRequiredError(reason.message)
      }
    } finally {
      this.syncActiveKeys.delete(queueKey)
    }
  }

  private recoverPendingF7EventsOrThrowSync(): void {
    try {
      this.recoverPending(this.options.db, this.options.actionLogPath)
      clearF7WriteBlockAfterRecovery()
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      blockF7Writes(reason)
      throw new ReportRecoveryRequiredError(reason.message)
    }
  }
}

export function reportCommandKey(key: ReportCommandKey): string {
  return JSON.stringify([key.studentId, key.jobCode, key.taskCode, key.scope])
}
