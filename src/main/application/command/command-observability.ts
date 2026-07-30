import { sha256CanonicalJson } from '../../domain/report-canonical'
import type {
  CommandActor,
  CommandEnvelope,
  CommandPreflightReason,
  CommandSource,
  CommandTraceRecord,
  CommandTraceSink
} from './command-types'

export const NOOP_COMMAND_TRACE_SINK: CommandTraceSink = Object.freeze({
  emit: () => undefined
})

function digest(value: unknown): string {
  return sha256CanonicalJson(value).slice(0, 16)
}

function actorReference(actor: CommandActor): string {
  if (actor.kind === 'USER') return `USER:${actor.role}:${digest([actor.userId, actor.authSessionId])}`
  if (actor.kind === 'SYSTEM') return `SYSTEM:${actor.phase}`
  return 'UNAUTHENTICATED'
}

export class CommandObservability {
  constructor(
    private readonly sink: CommandTraceSink = NOOP_COMMAND_TRACE_SINK,
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  start(): number {
    return this.nowMs()
  }

  rejected(params: {
    commandType: string
    source: CommandSource
    reason: CommandPreflightReason
    publicErrorCode?: string
    startedAt: number
  }): void {
    this.emit({
      phase: 'REJECTED',
      commandType: params.commandType,
      source: params.source,
      reason: params.reason,
      publicErrorCode: params.publicErrorCode,
      durationMs: Math.max(0, this.nowMs() - params.startedAt)
    })
  }

  accepted(envelope: CommandEnvelope, concurrencyKey: string): void {
    this.emit({
      phase: 'ACCEPTED',
      commandType: envelope.commandType,
      source: envelope.source,
      commandId: envelope.commandId,
      correlationId: envelope.correlationId,
      actorRef: actorReference(envelope.actor),
      targetDigest: digest(envelope.target),
      requestHashPrefix: envelope.requestHash.slice(0, 16),
      concurrencyKeyDigest: digest(concurrencyKey)
    })
  }

  completed(envelope: CommandEnvelope, startedAt: number): void {
    this.emit({
      phase: 'COMPLETED',
      commandType: envelope.commandType,
      source: envelope.source,
      commandId: envelope.commandId,
      correlationId: envelope.correlationId,
      actorRef: actorReference(envelope.actor),
      targetDigest: digest(envelope.target),
      requestHashPrefix: envelope.requestHash.slice(0, 16),
      durationMs: Math.max(0, this.nowMs() - startedAt)
    })
  }

  executionFailed(envelope: CommandEnvelope, error: unknown, startedAt: number): void {
    this.emit({
      phase: 'EXECUTION_FAILED',
      commandType: envelope.commandType,
      source: envelope.source,
      commandId: envelope.commandId,
      correlationId: envelope.correlationId,
      actorRef: actorReference(envelope.actor),
      targetDigest: digest(envelope.target),
      requestHashPrefix: envelope.requestHash.slice(0, 16),
      durationMs: Math.max(0, this.nowMs() - startedAt),
      errorName: error instanceof Error ? error.name : typeof error
    })
  }

  private emit(record: CommandTraceRecord): void {
    try {
      this.sink.emit(Object.freeze(record))
    } catch {
      // Runtime observability must never gain command capability or alter command outcome.
    }
  }
}
