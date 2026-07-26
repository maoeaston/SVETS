import type { AggregateType, EventType } from '@shared/types/event-payloads'

export type F7WriteArea = 'TASK_CLOSURE' | 'RESULT' | 'TASK_REPORT' | 'SAFETY_INCIDENT'

export const F7_WRITE_AREAS: readonly F7WriteArea[] = [
  'TASK_CLOSURE',
  'RESULT',
  'TASK_REPORT',
  'SAFETY_INCIDENT'
]

let blockedReason: Error | null = null

export class ReportWriteBlockedError extends Error {
  constructor(public readonly causeMessage: string) {
    super('F7 report-related writes are blocked until event recovery succeeds')
    this.name = 'ReportWriteBlockedError'
  }
}

export function f7WriteAreaForEvent(
  aggregateType: AggregateType,
  eventType: EventType
): F7WriteArea | null {
  if (aggregateType === 'TASK_CLOSURE') return 'TASK_CLOSURE'
  if (aggregateType === 'TASK_REPORT') return 'TASK_REPORT'
  if (aggregateType === 'SAFETY_INCIDENT') return 'SAFETY_INCIDENT'
  if (eventType === 'RESULT_CALCULATED') return 'RESULT'
  return null
}

export function assertF7WriteAllowed(area: F7WriteArea): void {
  if (!F7_WRITE_AREAS.includes(area)) throw new Error(`Unknown F7 write area: ${area}`)
  if (blockedReason) throw new ReportWriteBlockedError(blockedReason.message)
}

export function blockF7Writes(reason: Error): void {
  blockedReason = reason
}

export function clearF7WriteBlockAfterRecovery(): void {
  blockedReason = null
}
