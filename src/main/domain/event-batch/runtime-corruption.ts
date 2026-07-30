import { createHash } from 'crypto'

export type EventBatchRuntimeState = 'OPEN' | 'CORRUPTION_READ_ONLY'

export interface RuntimeCorruptionSnapshot {
  readonly state: EventBatchRuntimeState
  readonly code: string | null
  readonly evidenceDigest: string | null
  readonly detectedAt: string | null
}

export class EventBatchRuntimeReadOnlyError extends Error {
  constructor(public readonly snapshot: RuntimeCorruptionSnapshot) {
    super(`[event-batch-runtime] mutations are closed: ${snapshot.code ?? 'CORRUPTION_READ_ONLY'}`)
    this.name = 'EventBatchRuntimeReadOnlyError'
  }
}

function exactTimestamp(value: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value
  ) throw new Error('[event-batch-runtime] detectedAt must be an exact UTC timestamp')
  return value
}

function corruptionCode(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(value)) {
    throw new Error('[event-batch-runtime] corruption code is invalid')
  }
  return value
}

/** Monotonic in-memory transition used before the M5B-14 health wiring. */
export class RuntimeCorruptionState {
  private current: RuntimeCorruptionSnapshot = Object.freeze({
    state: 'OPEN',
    code: null,
    evidenceDigest: null,
    detectedAt: null
  })

  snapshot(): RuntimeCorruptionSnapshot {
    return this.current
  }

  assertWritable(): void {
    if (this.current.state !== 'OPEN') throw new EventBatchRuntimeReadOnlyError(this.current)
  }

  transition(options: {
    code: string
    evidence: string
    detectedAt: string
  }): RuntimeCorruptionSnapshot {
    if (this.current.state === 'CORRUPTION_READ_ONLY') return this.current
    if (typeof options.evidence !== 'string' || !options.evidence.length) {
      throw new Error('[event-batch-runtime] corruption evidence must be non-empty')
    }
    this.current = Object.freeze({
      state: 'CORRUPTION_READ_ONLY',
      code: corruptionCode(options.code),
      evidenceDigest: createHash('sha256').update(options.evidence, 'utf8').digest('hex'),
      detectedAt: exactTimestamp(options.detectedAt)
    })
    return this.current
  }
}
