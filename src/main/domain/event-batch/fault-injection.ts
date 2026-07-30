export const EVENT_BATCH_FAULT_POINTS = Object.freeze([
  'AFTER_PLAN',
  'BEFORE_PREPARE',
  'AFTER_PREPARE_FSYNC',
  'BEFORE_APPLY',
  'APPLY_EVENT',
  'AFTER_APPLY_COMMIT',
  'BEFORE_CONFIRM',
  'AFTER_COMMITTED_FSYNC',
  'AFTER_SQLITE_CONFIRM',
  'BEFORE_INDEX',
  'AFTER_INDEX',
  'BEFORE_RESULT',
  'AFTER_RESULT'
] as const)

export type EventBatchFaultPoint = (typeof EVENT_BATCH_FAULT_POINTS)[number]

export interface EventBatchFaultContext {
  readonly commandId: string
  readonly batchId: string
  readonly eventIndex?: number
}

const injectorBrand: unique symbol = Symbol('m5b-test-fault-injector')

export interface EventBatchFaultInjector {
  readonly [injectorBrand]: true
  hit(point: EventBatchFaultPoint, context: EventBatchFaultContext): void
  history(): readonly Readonly<{ point: EventBatchFaultPoint; eventIndex: number | null }>[]
}

export class InjectedEventBatchFault extends Error {
  constructor(
    public readonly point: EventBatchFaultPoint,
    public readonly eventIndex: number | null
  ) {
    super(`[event-batch-fault] injected ${point}${eventIndex === null ? '' : ` at event ${eventIndex}`}`)
    this.name = 'InjectedEventBatchFault'
  }
}

export function createEventBatchFaultInjectorForTests(options: {
  failAt: EventBatchFaultPoint | null
  eventIndex?: number
  onHit?: (point: EventBatchFaultPoint, context: EventBatchFaultContext) => void
}): EventBatchFaultInjector {
  if (options.failAt !== null && !EVENT_BATCH_FAULT_POINTS.includes(options.failAt)) {
    throw new Error('[event-batch-fault] unknown fault point')
  }
  if (options.eventIndex !== undefined && (!Number.isSafeInteger(options.eventIndex) || options.eventIndex < 0)) {
    throw new Error('[event-batch-fault] eventIndex must be a non-negative safe integer')
  }
  const entries: Array<Readonly<{ point: EventBatchFaultPoint; eventIndex: number | null }>> = []
  let fired = false
  return Object.freeze({
    [injectorBrand]: true as const,
    hit(point, context) {
      const eventIndex = context.eventIndex ?? null
      entries.push(Object.freeze({ point, eventIndex }))
      options.onHit?.(point, context)
      if (
        !fired
        && point === options.failAt
        && (point !== 'APPLY_EVENT' || options.eventIndex === undefined || options.eventIndex === eventIndex)
      ) {
        fired = true
        throw new InjectedEventBatchFault(point, eventIndex)
      }
    },
    history: () => Object.freeze([...entries])
  })
}

export function noEventBatchFaultsForTests(): EventBatchFaultInjector {
  return createEventBatchFaultInjectorForTests({ failAt: null })
}
