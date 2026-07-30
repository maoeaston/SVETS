export class WriterMutexError extends Error {
  constructor(message: string) {
    super(`[event-batch-writer-mutex] ${message}`)
    this.name = 'WriterMutexError'
  }
}

const releaseBrand: unique symbol = Symbol('event-batch-writer-release')

export interface WriterMutexLease {
  readonly owner: string
  readonly ticket: number
  release(): void
  readonly [releaseBrand]: true
}

interface Waiter {
  readonly owner: string
  readonly ticket: number
  readonly resolve: (lease: WriterMutexLease) => void
}

function validOwner(owner: string): string {
  if (
    typeof owner !== 'string'
    || !owner.length
    || owner !== owner.trim()
    || Buffer.byteLength(owner, 'utf8') > 512
  ) throw new WriterMutexError('owner is invalid')
  return owner
}

/**
 * Current-process FIFO writer serialization. This is deliberately not an
 * operating-system or cross-process lock; M5C owns that later boundary.
 */
export class FairWriterMutex {
  private active: { owner: string; ticket: number } | null = null
  private readonly waiters: Waiter[] = []
  private nextTicket = 1

  acquire(ownerValue: string): Promise<WriterMutexLease> {
    const owner = validOwner(ownerValue)
    if (this.active?.owner === owner || this.waiters.some((waiter) => waiter.owner === owner)) {
      throw new WriterMutexError(`owner ${owner} attempted a reentrant acquisition`)
    }
    const ticket = this.nextTicket
    this.nextTicket += 1
    return new Promise((resolve) => {
      const waiter = { owner, ticket, resolve }
      this.waiters.push(waiter)
      this.grantNext()
    })
  }

  async withLock<T>(owner: string, operation: () => T | Promise<T>): Promise<T> {
    const lease = await this.acquire(owner)
    try {
      return await operation()
    } finally {
      lease.release()
    }
  }

  snapshot(): Readonly<{
    activeOwner: string | null
    activeTicket: number | null
    queuedOwners: readonly string[]
    queuedTickets: readonly number[]
  }> {
    return Object.freeze({
      activeOwner: this.active?.owner ?? null,
      activeTicket: this.active?.ticket ?? null,
      queuedOwners: Object.freeze(this.waiters.map((waiter) => waiter.owner)),
      queuedTickets: Object.freeze(this.waiters.map((waiter) => waiter.ticket))
    })
  }

  private grantNext(): void {
    if (this.active || this.waiters.length === 0) return
    const waiter = this.waiters.shift()!
    this.active = { owner: waiter.owner, ticket: waiter.ticket }
    let released = false
    const lease: WriterMutexLease = Object.freeze({
      owner: waiter.owner,
      ticket: waiter.ticket,
      [releaseBrand]: true as const,
      release: () => {
        if (released) throw new WriterMutexError(`ticket ${waiter.ticket} was released more than once`)
        if (this.active?.ticket !== waiter.ticket || this.active.owner !== waiter.owner) {
          throw new WriterMutexError(`ticket ${waiter.ticket} is not the active lease`)
        }
        released = true
        this.active = null
        this.grantNext()
      }
    })
    waiter.resolve(lease)
  }
}

export const processWideEventBatchWriterMutex = new FairWriterMutex()
