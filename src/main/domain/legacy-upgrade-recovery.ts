import type { ActionLogEntry } from '@shared/types/event-payloads'
import type { DBAdapter } from '../db/interface'
import {
  readActionLog,
  reconcileActionLogEventGroup,
  type ReadActionLogOptions,
  type ReadActionLogResult
} from './recovery'

export type StartupRecoveryRequiredCode =
  | 'FRESH_DATABASE_WITH_ACTION_LOG'
  | 'SCHEMA_V2_EVENT_BEFORE_F7'
  | 'AMBIGUOUS_LEGACY_EVENT_PREFIX'
  | 'LEGACY_RECONCILE_FAILED'
  | 'F7_MIGRATION_FAILED'
  | 'M4_MIGRATION_FAILED'
  | 'M4_SCHEMA_DRIFT'

export class StartupRecoveryRequiredError extends Error {
  constructor(
    public readonly code: StartupRecoveryRequiredCode,
    message: string
  ) {
    super(message)
    this.name = 'StartupRecoveryRequiredError'
  }
}

export interface LegacyPreReconcileResult extends ReadActionLogResult {
  replayedEventCount: number
  skippedEventCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function isLegacyCorrectionCreated(event: ActionLogEntry): boolean {
  return event.event_type === 'SAFETY_INCIDENT_CREATED'
    && event.actor_role === 'ADMIN'
    && isRecord(event.payload)
    && text(event.payload, 'incident_id') === event.aggregate_id
    && text(event.payload, 'brief_description') !== null
    && text(event.payload, 'reported_by') === event.actor_id
}

function isCompleteCorrectionTriplet(events: ActionLogEntry[], index: number): boolean {
  const created = events[index]
  const replaced = events[index + 1]
  const voided = events[index + 2]
  if (!created || !replaced || !voided || !isLegacyCorrectionCreated(created)) return false
  if (replaced.event_type !== 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION' || !isRecord(replaced.payload)) return false
  if (voided.event_type !== 'SAFETY_INCIDENT_VOIDED' || !isRecord(voided.payload)) return false
  const oldId = text(replaced.payload, 'old_incident_id')
  const newId = text(replaced.payload, 'new_incident_id')
  return oldId !== null
    && newId === created.aggregate_id
    && replaced.aggregate_id === oldId
    && text(voided.payload, 'incident_id') === oldId
    && voided.aggregate_id === oldId
    && text(voided.payload, 'replacement_incident_id') === newId
    && text(voided.payload, 'void_reason') === 'FACTUAL_CORRECTION'
}

function groupLegacyEvents(events: ActionLogEntry[]): ActionLogEntry[][] {
  const groups: ActionLogEntry[][] = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (isLegacyCorrectionCreated(event)) {
      if (!isCompleteCorrectionTriplet(events, index)) {
        throw new StartupRecoveryRequiredError(
          'AMBIGUOUS_LEGACY_EVENT_PREFIX',
          'A legacy factual-correction event prefix is incomplete or inconsistent'
        )
      }
      groups.push([event, events[index + 1], events[index + 2]])
      index += 2
      continue
    }
    if (event.event_type === 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION'
      || (event.event_type === 'SAFETY_INCIDENT_VOIDED'
        && isRecord(event.payload)
        && text(event.payload, 'void_reason') === 'FACTUAL_CORRECTION')) {
      throw new StartupRecoveryRequiredError(
        'AMBIGUOUS_LEGACY_EVENT_PREFIX',
        'A legacy factual-correction event is missing its complete append group'
      )
    }
    groups.push([event])
  }
  return groups
}

/**
 * F7 schema migration must never infer from a schema-v2 event or a partial v1 safety
 * correction. This bridge runs against the v0.1.15 structure before F7 DDL is applied.
 */
export function preReconcileLegacyActionLog(
  db: DBAdapter,
  options: ReadActionLogOptions
): LegacyPreReconcileResult {
  const log = readActionLog(options)
  if (log.events.some((event) => event.schema_version !== 1)) {
    throw new StartupRecoveryRequiredError(
      'SCHEMA_V2_EVENT_BEFORE_F7',
      'The pre-F7 database contains an event that is not schema version 1'
    )
  }

  let replayedEventCount = 0
  let skippedEventCount = 0
  try {
    for (const group of groupLegacyEvents(log.events)) {
      const result = reconcileActionLogEventGroup(db, group, options.logPath)
      replayedEventCount += result.replayedEventCount
      skippedEventCount += result.skippedEventCount
    }
  } catch (error) {
    if (error instanceof StartupRecoveryRequiredError) throw error
    throw new StartupRecoveryRequiredError('LEGACY_RECONCILE_FAILED', 'Legacy event reconciliation failed safely')
  }

  const missing = log.events.filter((event) => !db
    .prepare('SELECT 1 FROM domain_event_projection WHERE event_id = ?')
    .get(event.event_id))
  if (missing.length > 0) {
    throw new StartupRecoveryRequiredError('LEGACY_RECONCILE_FAILED', 'Legacy reconciliation left missing event projections')
  }
  return { ...log, replayedEventCount, skippedEventCount }
}
