import type { DBAdapter } from '../../db/interface'
import { parseCommandResultJson } from './command-result'

export const COMMAND_LEASE_DURATION_MS = 30_000
export const COMMAND_LEASE_RENEW_INTERVAL_MS = 10_000
export const COMMAND_MAX_ATTEMPTS = 3

export type DurableCommandStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

export interface DurableCommandRow {
  readonly commandId: string
  readonly idempotencyKey: string
  readonly clientInstanceId: string
  readonly commandType: string
  readonly actorId: string
  readonly deviceId: string | null
  readonly authSessionId: string | null
  readonly requestHash: string
  readonly eventBatchId: string
  readonly status: DurableCommandStatus
  readonly resultJson: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly leaseOwner: string | null
  readonly currentLeaseGeneration: number
  readonly leaseExpiresAt: string | null
  readonly workerId: string | null
  readonly attemptCount: number
  readonly lastAttemptAt: string | null
  readonly maxAttempts: 3
  readonly createdAt: string
  readonly completedAt: string | null
  readonly updatedAt: string
}

export interface RegisterDurableCommandInput {
  readonly commandId: string
  readonly idempotencyKey: string
  readonly clientInstanceId: string
  readonly commandType: string
  readonly actorId: string
  readonly deviceId: string | null
  readonly authSessionId: string | null
  readonly requestHash: string
  readonly eventBatchId: string
  readonly createdAt: string
  readonly maxAttempts: 3
}

export class DurableCommandStoreError extends Error {
  constructor(
    public readonly code:
      | 'ROW_INVALID'
      | 'LEASE_CONFLICT'
      | 'FENCED'
      | 'RESULT_INVALID'
      | 'PRE_PONR_REQUIRED',
    message: string
  ) {
    super(`[durable-command-store] ${message}`)
    this.name = 'DurableCommandStoreError'
  }
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function exactTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string'
    || !TIMESTAMP_PATTERN.test(value)
    || new Date(value).toISOString() !== value
  ) throw new DurableCommandStoreError('ROW_INVALID', `${field} is not an exact UTC timestamp`)
  return value
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : exactTimestamp(value, field)
}

function text(value: unknown, field: string, maximumBytes = 512): string {
  if (
    typeof value !== 'string'
    || !value.length
    || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) throw new DurableCommandStoreError('ROW_INVALID', `${field} is invalid`)
  return value
}

function nullableText(value: unknown, field: string, maximumBytes = 512): string | null {
  return value === null ? null : text(value, field, maximumBytes)
}

function uuid(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (!UUID_V4_PATTERN.test(parsed)) throw new DurableCommandStoreError('ROW_INVALID', `${field} is not UUID v4`)
  return parsed
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DurableCommandStoreError('ROW_INVALID', `${field} is invalid`)
  }
  return value as number
}

function rawField(row: Record<string, unknown>, field: string): unknown {
  if (!Object.hasOwn(row, field)) throw new DurableCommandStoreError('ROW_INVALID', `missing ${field}`)
  return row[field]
}

export function parseDurableCommandRow(value: unknown): DurableCommandRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DurableCommandStoreError('ROW_INVALID', 'command row must be an object')
  }
  const row = value as Record<string, unknown>
  const status = rawField(row, 'status')
  if (!['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'].includes(String(status))) {
    throw new DurableCommandStoreError('ROW_INVALID', 'status is invalid')
  }
  const requestHash = text(rawField(row, 'request_hash'), 'request_hash')
  if (!SHA256_PATTERN.test(requestHash)) throw new DurableCommandStoreError('ROW_INVALID', 'request_hash is invalid')
  const resultJson = nullableText(rawField(row, 'result_json'), 'result_json', 8 * 1024 * 1024)
  if (resultJson !== null) {
    try {
      parseCommandResultJson(resultJson)
    } catch (error) {
      throw new DurableCommandStoreError('RESULT_INVALID', error instanceof Error ? error.message : String(error))
    }
  }
  const currentLeaseGeneration = nonNegativeInteger(
    rawField(row, 'current_lease_generation'),
    'current_lease_generation'
  )
  const attemptCount = nonNegativeInteger(rawField(row, 'attempt_count'), 'attempt_count')
  const maxAttempts = nonNegativeInteger(rawField(row, 'max_attempts'), 'max_attempts')
  if (maxAttempts !== COMMAND_MAX_ATTEMPTS || attemptCount > maxAttempts) {
    throw new DurableCommandStoreError('ROW_INVALID', 'attempt contract is invalid')
  }
  const parsed: DurableCommandRow = {
    commandId: uuid(rawField(row, 'command_id'), 'command_id'),
    idempotencyKey: uuid(rawField(row, 'idempotency_key'), 'idempotency_key'),
    clientInstanceId: uuid(rawField(row, 'client_instance_id'), 'client_instance_id'),
    commandType: text(rawField(row, 'command_type'), 'command_type'),
    actorId: text(rawField(row, 'actor_id'), 'actor_id'),
    deviceId: nullableText(rawField(row, 'device_id'), 'device_id'),
    authSessionId: nullableText(rawField(row, 'auth_session_id'), 'auth_session_id'),
    requestHash,
    eventBatchId: uuid(rawField(row, 'event_batch_id'), 'event_batch_id'),
    status: status as DurableCommandStatus,
    resultJson,
    errorCode: nullableText(rawField(row, 'error_code'), 'error_code'),
    errorMessage: nullableText(rawField(row, 'error_message'), 'error_message', 2048),
    leaseOwner: nullableText(rawField(row, 'lease_owner'), 'lease_owner'),
    currentLeaseGeneration,
    leaseExpiresAt: nullableTimestamp(rawField(row, 'lease_expires_at'), 'lease_expires_at'),
    workerId: nullableText(rawField(row, 'worker_id'), 'worker_id'),
    attemptCount,
    lastAttemptAt: nullableTimestamp(rawField(row, 'last_attempt_at'), 'last_attempt_at'),
    maxAttempts: COMMAND_MAX_ATTEMPTS,
    createdAt: exactTimestamp(rawField(row, 'created_at'), 'created_at'),
    completedAt: nullableTimestamp(rawField(row, 'completed_at'), 'completed_at'),
    updatedAt: exactTimestamp(rawField(row, 'updated_at'), 'updated_at')
  }
  if (parsed.updatedAt < parsed.createdAt) throw new DurableCommandStoreError('ROW_INVALID', 'updated_at predates created_at')
  if (parsed.status === 'PENDING') {
    if (parsed.resultJson !== null || parsed.completedAt !== null || parsed.leaseOwner !== null || parsed.leaseExpiresAt !== null) {
      throw new DurableCommandStoreError('ROW_INVALID', 'PENDING row contains terminal or lease state')
    }
  }
  if (parsed.status === 'PROCESSING') {
    if (
      parsed.resultJson !== null
      || parsed.completedAt !== null
      || parsed.leaseOwner === null
      || parsed.workerId === null
      || parsed.leaseExpiresAt === null
      || parsed.attemptCount < 1
    ) throw new DurableCommandStoreError('ROW_INVALID', 'PROCESSING row is incomplete')
  }
  if (parsed.status === 'SUCCEEDED') {
    if (parsed.resultJson === null || parsed.completedAt === null || parsed.errorCode !== null) {
      throw new DurableCommandStoreError('ROW_INVALID', 'SUCCEEDED row is incomplete')
    }
  }
  if (parsed.status === 'FAILED') {
    if (
      parsed.resultJson !== null
      || parsed.completedAt !== null
      || parsed.errorCode === null
      || parsed.leaseOwner !== null
      || parsed.leaseExpiresAt !== null
    ) throw new DurableCommandStoreError('ROW_INVALID', 'FAILED row is inconsistent')
  }
  return Object.freeze(parsed)
}

function assertRegistration(input: RegisterDurableCommandInput): void {
  uuid(input.commandId, 'commandId')
  uuid(input.idempotencyKey, 'idempotencyKey')
  uuid(input.clientInstanceId, 'clientInstanceId')
  uuid(input.eventBatchId, 'eventBatchId')
  text(input.commandType, 'commandType')
  text(input.actorId, 'actorId')
  if (input.deviceId !== null) text(input.deviceId, 'deviceId')
  if (input.authSessionId !== null) text(input.authSessionId, 'authSessionId')
  if (!SHA256_PATTERN.test(input.requestHash)) throw new DurableCommandStoreError('ROW_INVALID', 'requestHash is invalid')
  exactTimestamp(input.createdAt, 'createdAt')
  if (input.maxAttempts !== COMMAND_MAX_ATTEMPTS) throw new DurableCommandStoreError('ROW_INVALID', 'maxAttempts must be 3')
}

function leaseExpiry(now: string): string {
  return new Date(new Date(exactTimestamp(now, 'now')).getTime() + COMMAND_LEASE_DURATION_MS).toISOString()
}

export class DurableCommandStore {
  constructor(private readonly database: DBAdapter) {}

  private row(sql: string, params: readonly unknown[]): DurableCommandRow | null {
    const value = this.database.prepare(sql).get(...params)
    return value === undefined ? null : parseDurableCommandRow(value)
  }

  private run(sql: string, params: readonly unknown[]): void {
    this.database.prepare(sql).run(...params)
  }

  private updateOne(sql: string, params: readonly unknown[], commandId: string): DurableCommandRow | null {
    this.run(sql, params)
    const changes = this.database.prepare('SELECT changes() AS count').get() as { count?: unknown } | undefined
    if (!changes || !Number.isSafeInteger(changes.count) || (changes.count as number) < 0 || (changes.count as number) > 1) {
      throw new DurableCommandStoreError('ROW_INVALID', 'mutation returned an invalid affected-row count')
    }
    if (changes.count === 0) return null
    const row = this.row('SELECT * FROM command_log WHERE command_id = ?', [commandId])
    if (!row) throw new DurableCommandStoreError('ROW_INVALID', 'updated command could not be reloaded')
    return row
  }

  private immediate<T>(operation: () => T): T {
    return this.database.immediateTransaction(operation)()
  }

  findByIdempotency(clientInstanceId: string, idempotencyKey: string): DurableCommandRow | null {
    uuid(clientInstanceId, 'clientInstanceId')
    uuid(idempotencyKey, 'idempotencyKey')
    return this.row(
      `SELECT * FROM command_log
        WHERE client_instance_id = ? AND idempotency_key = ?`,
      [clientInstanceId, idempotencyKey]
    )
  }

  findByCommandId(commandId: string): DurableCommandRow | null {
    uuid(commandId, 'commandId')
    return this.row('SELECT * FROM command_log WHERE command_id = ?', [commandId])
  }

  listProcessing(): readonly DurableCommandRow[] {
    return Object.freeze(this.database.prepare(
      `SELECT * FROM command_log
        WHERE status = 'PROCESSING'
        ORDER BY created_at, command_id`
    ).all().map(parseDurableCommandRow))
  }

  registerOrLoad(input: RegisterDurableCommandInput): { row: DurableCommandRow; inserted: boolean } {
    assertRegistration(input)
    return this.immediate(() => {
      this.run(
        `INSERT OR IGNORE INTO command_log (
           command_id, idempotency_key, client_instance_id, command_type,
           actor_id, device_id, auth_session_id, request_hash, event_batch_id,
           status, current_lease_generation, attempt_count, max_attempts,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 0, ?, ?, ?)`,
        [
          input.commandId,
          input.idempotencyKey,
          input.clientInstanceId,
          input.commandType,
          input.actorId,
          input.deviceId,
          input.authSessionId,
          input.requestHash,
          input.eventBatchId,
          input.maxAttempts,
          input.createdAt,
          input.createdAt
        ]
      )
      const row = this.row(
        `SELECT * FROM command_log
          WHERE client_instance_id = ? AND idempotency_key = ?`,
        [input.clientInstanceId, input.idempotencyKey]
      )
      if (!row) throw new DurableCommandStoreError('ROW_INVALID', 'inserted command could not be reloaded')
      return { row, inserted: row.commandId === input.commandId }
    })
  }

  acquireLease(options: {
    commandId: string
    seenGeneration: number
    workerId: string
    now: string
    allowFailed: boolean
  }): DurableCommandRow | null {
    uuid(options.commandId, 'commandId')
    nonNegativeInteger(options.seenGeneration, 'seenGeneration')
    text(options.workerId, 'workerId')
    const expiresAt = leaseExpiry(options.now)
    return this.immediate(() => this.updateOne(
      `UPDATE command_log
          SET status = 'PROCESSING',
              lease_owner = ?,
              worker_id = ?,
              current_lease_generation = current_lease_generation + 1,
              lease_expires_at = ?,
              attempt_count = attempt_count + 1,
              last_attempt_at = ?,
              error_code = NULL,
              error_message = NULL,
              updated_at = ?
        WHERE command_id = ?
          AND current_lease_generation = ?
          AND attempt_count < max_attempts
          AND (
            status = 'PENDING'
            OR (status = 'FAILED' AND ? = 1)
            OR (status = 'PROCESSING' AND lease_expires_at <= ?)
          )
      `,
      [
        options.workerId,
        options.workerId,
        expiresAt,
        options.now,
        options.now,
        options.commandId,
        options.seenGeneration,
        options.allowFailed ? 1 : 0,
        options.now
      ],
      options.commandId
    ))
  }

  takeoverPreparedLease(options: {
    commandId: string
    batchId: string
    requestHash: string
    preparedLeaseGeneration: number
    seenGeneration: number
    workerId: string
    now: string
  }): DurableCommandRow | null {
    uuid(options.commandId, 'commandId')
    uuid(options.batchId, 'batchId')
    if (!SHA256_PATTERN.test(options.requestHash)) throw new DurableCommandStoreError('ROW_INVALID', 'requestHash is invalid')
    nonNegativeInteger(options.preparedLeaseGeneration, 'preparedLeaseGeneration')
    nonNegativeInteger(options.seenGeneration, 'seenGeneration')
    if (options.preparedLeaseGeneration > options.seenGeneration) {
      throw new DurableCommandStoreError('ROW_INVALID', 'prepared generation is ahead of the observed command generation')
    }
    text(options.workerId, 'workerId')
    const expiresAt = leaseExpiry(options.now)
    return this.immediate(() => this.updateOne(
      `UPDATE command_log
          SET lease_owner = ?,
              worker_id = ?,
              current_lease_generation = current_lease_generation + 1,
              lease_expires_at = ?,
              updated_at = ?
        WHERE command_id = ?
          AND event_batch_id = ?
          AND request_hash = ?
          AND status = 'PROCESSING'
          AND current_lease_generation = ?
          AND current_lease_generation >= ?
          AND lease_expires_at <= ?
      `,
      [
        options.workerId,
        options.workerId,
        expiresAt,
        options.now,
        options.commandId,
        options.batchId,
        options.requestHash,
        options.seenGeneration,
        options.preparedLeaseGeneration,
        options.now
      ],
      options.commandId
    ))
  }

  resetExpiredPrePonrForRecovery(options: {
    commandId: string
    seenGeneration: number
    now: string
    stage: 'RECOVERY_VERIFIED_NO_PREPARE'
  }): DurableCommandRow | null {
    if (options.stage !== 'RECOVERY_VERIFIED_NO_PREPARE') {
      throw new DurableCommandStoreError('PRE_PONR_REQUIRED', 'recovery reset requires verified absence of PREPARE')
    }
    uuid(options.commandId, 'commandId')
    nonNegativeInteger(options.seenGeneration, 'seenGeneration')
    exactTimestamp(options.now, 'now')
    return this.immediate(() => this.updateOne(
      `UPDATE command_log
          SET status = CASE WHEN attempt_count < max_attempts THEN 'PENDING' ELSE 'FAILED' END,
              result_json = NULL,
              error_code = CASE WHEN attempt_count < max_attempts THEN NULL ELSE 'ATTEMPT_LIMIT' END,
              error_message = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              completed_at = NULL,
              updated_at = ?
        WHERE command_id = ?
          AND status = 'PROCESSING'
          AND current_lease_generation = ?
          AND lease_expires_at <= ?
      `,
      [options.now, options.commandId, options.seenGeneration, options.now],
      options.commandId
    ))
  }

  renewLease(options: {
    commandId: string
    leaseOwner: string
    generation: number
    now: string
  }): DurableCommandRow {
    uuid(options.commandId, 'commandId')
    text(options.leaseOwner, 'leaseOwner')
    nonNegativeInteger(options.generation, 'generation')
    const expiresAt = leaseExpiry(options.now)
    const updated = this.immediate(() => this.updateOne(
      `UPDATE command_log
          SET lease_expires_at = ?, updated_at = ?
        WHERE command_id = ?
          AND status = 'PROCESSING'
          AND lease_owner = ?
          AND current_lease_generation = ?
          AND lease_expires_at > ?
      `,
      [expiresAt, options.now, options.commandId, options.leaseOwner, options.generation, options.now],
      options.commandId
    ))
    if (!updated) throw new DurableCommandStoreError('FENCED', 'lease renewal was fenced')
    return updated
  }

  assertLease(options: {
    commandId: string
    leaseOwner: string
    generation: number
    now: string
  }): DurableCommandRow {
    const row = this.findByCommandId(options.commandId)
    if (
      !row
      || row.status !== 'PROCESSING'
      || row.leaseOwner !== options.leaseOwner
      || row.currentLeaseGeneration !== options.generation
      || row.leaseExpiresAt === null
      || row.leaseExpiresAt <= exactTimestamp(options.now, 'now')
    ) throw new DurableCommandStoreError('FENCED', 'command lease is no longer current')
    return row
  }

  completeSucceeded(options: {
    commandId: string
    leaseOwner: string
    generation: number
    resultJson: string
    now: string
  }): DurableCommandRow {
    return this.immediate(() => this.completeSucceededWithinTransaction(options))
  }

  /**
   * Caller-owned IMMEDIATE transaction variant. Gate-only commands use this to
   * commit business DML and immutable command result as one SQLite unit.
   */
  completeSucceededWithinTransaction(options: {
    commandId: string
    leaseOwner: string
    generation: number
    resultJson: string
    now: string
  }): DurableCommandRow {
    try {
      parseCommandResultJson(options.resultJson)
    } catch (error) {
      throw new DurableCommandStoreError('RESULT_INVALID', error instanceof Error ? error.message : String(error))
    }
    const updated = this.updateOne(
      `UPDATE command_log
          SET status = 'SUCCEEDED',
              result_json = ?,
              error_code = NULL,
              error_message = NULL,
              completed_at = ?,
              updated_at = ?
        WHERE command_id = ?
          AND status = 'PROCESSING'
          AND result_json IS NULL
          AND lease_owner = ?
          AND current_lease_generation = ?
          AND lease_expires_at > ?
      `,
      [
        options.resultJson,
        options.now,
        options.now,
        options.commandId,
        options.leaseOwner,
        options.generation,
        options.now
      ],
      options.commandId
    )
    if (!updated) throw new DurableCommandStoreError('FENCED', 'result update was fenced or immutable')
    return updated
  }

  markRetryablePrePonrFailure(options: {
    commandId: string
    leaseOwner: string
    generation: number
    errorCode: string
    now: string
    stage: 'PRE_PONR_NO_PREPARE'
  }): DurableCommandRow {
    if (options.stage !== 'PRE_PONR_NO_PREPARE') {
      throw new DurableCommandStoreError('PRE_PONR_REQUIRED', 'FAILED is forbidden after PREPARE')
    }
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(options.errorCode)) {
      throw new DurableCommandStoreError('ROW_INVALID', 'errorCode is invalid')
    }
    const updated = this.immediate(() => this.updateOne(
      `UPDATE command_log
          SET status = 'FAILED',
              result_json = NULL,
              error_code = ?,
              error_message = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              completed_at = NULL,
              updated_at = ?
        WHERE command_id = ?
          AND status = 'PROCESSING'
          AND lease_owner = ?
          AND current_lease_generation = ?
          AND lease_expires_at > ?
      `,
      [
        options.errorCode,
        options.now,
        options.commandId,
        options.leaseOwner,
        options.generation,
        options.now
      ],
      options.commandId
    ))
    if (!updated) throw new DurableCommandStoreError('FENCED', 'pre-PONR failure update was fenced')
    return updated
  }
}
