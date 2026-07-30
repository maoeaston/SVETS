import { eventBatchRecordBytes, type BatchCommittedRecord, type BatchPreparedRecord, type EventRecord } from './record-types'
import {
  validateCommittedForBatch,
  validatePreparedBatch,
  GENESIS_BATCH_HASH
} from './batch-hash'
import {
  DurableFileCapability,
  type DurableFileHandle,
  type FileIdentity
} from './file-capability'

export const SEGMENT_MAX_BYTES = 10_485_760
export const SEGMENT_MAX_CONFIRMED_BATCHES = 10_000
export const SEGMENT_ID_PATTERN = /^seg_(\d{12})$/
export const SEGMENT_DIRECTORY = 'event-log/segments'

export class SegmentStoreError extends Error {
  constructor(
    public readonly code:
      | 'SEGMENT_ID_INVALID'
      | 'ROTATION_REQUIRED'
      | 'BATCH_PENDING'
      | 'NO_PENDING_BATCH'
      | 'SEQUENCE_MISMATCH'
      | 'HASH_CHAIN_MISMATCH'
      | 'SEGMENT_ID_MISMATCH'
      | 'SEGMENT_STATE_MISMATCH'
      | 'SEGMENT_FAILED',
    message: string
  ) {
    super(`[event-batch-segment] ${message}`)
    this.name = 'SegmentStoreError'
  }
}

export interface SegmentFilePort {
  ensureDirectory(relativePath: string): string
  createExclusive(relativePath: string, initialBytes?: Uint8Array): DurableFileHandle
  openAppend(relativePath: string): DurableFileHandle
  appendExact(handle: DurableFileHandle, bytes: Uint8Array): { offsetStart: number; offsetEnd: number }
  syncFile(handle: DurableFileHandle): void
  assertHandleIdentity(handle: DurableFileHandle): { size: number }
  hashHandle(handle: DurableFileHandle): string
  close(handle: DurableFileHandle): void
}

export interface SegmentOpenState {
  segmentOrdinal: number
  expectedByteSize: number
  expectedFileHash: string
  confirmedBatchCount: number
  nextBatchSequence: number
  previousBatchHash: string
}

export interface PreparedAppendResult {
  segmentId: string
  relativePath: string
  batchId: string
  batchSequence: number
  batchHash: string
  offsetStart: number
  offsetEnd: number
  preparedBytes: number
  fileIdentity: FileIdentity
}

export interface CommittedAppendResult extends PreparedAppendResult {
  committedOffsetStart: number
  committedOffsetEnd: number
  committedBytes: number
  finalByteSize: number
  confirmedBatchCount: number
}

export interface SealedSegmentResult {
  segmentId: string
  relativePath: string
  byteSize: number
  confirmedBatchCount: number
  segmentFileHash: string
  lastBatchHash: string
  sealedAt: string
}

function nonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', `${label} is invalid`)
}

function assertHash(value: string): void {
  if (value !== GENESIS_BATCH_HASH && !/^[0-9a-f]{64}$/.test(value)) {
    throw new SegmentStoreError('HASH_CHAIN_MISMATCH', 'previous batch hash is invalid')
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', `${label} is not a lowercase SHA-256 digest`)
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) {
    throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', `${label} is not an exact UTC timestamp`)
  }
}

function assertOpenState(state: SegmentOpenState): void {
  nonNegativeSafeInteger(state.expectedByteSize, 'expectedByteSize')
  assertSha256(state.expectedFileHash, 'expectedFileHash')
  nonNegativeSafeInteger(state.confirmedBatchCount, 'confirmedBatchCount')
  if (!Number.isSafeInteger(state.nextBatchSequence) || state.nextBatchSequence < 1) {
    throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'nextBatchSequence is invalid')
  }
  assertHash(state.previousBatchHash)
}

export function segmentIdForOrdinal(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 999_999_999_999) {
    throw new SegmentStoreError('SEGMENT_ID_INVALID', `segment ordinal ${ordinal} is out of range`)
  }
  return `seg_${String(ordinal).padStart(12, '0')}`
}

export function segmentOrdinalFromId(segmentId: string): number {
  const match = segmentId.match(SEGMENT_ID_PATTERN)
  if (!match) throw new SegmentStoreError('SEGMENT_ID_INVALID', `invalid segment ID ${segmentId}`)
  const ordinal = Number(match[1])
  if (ordinal < 1) throw new SegmentStoreError('SEGMENT_ID_INVALID', `invalid segment ordinal in ${segmentId}`)
  return ordinal
}

export function segmentRelativePath(segmentId: string): string {
  segmentOrdinalFromId(segmentId)
  return `${SEGMENT_DIRECTORY}/${segmentId}.jsonl`
}

export function shouldRotateBeforePrepare(input: {
  currentBytes: number
  confirmedBatchCount: number
  preparedBatchBytes: number
}): boolean {
  nonNegativeSafeInteger(input.currentBytes, 'currentBytes')
  nonNegativeSafeInteger(input.confirmedBatchCount, 'confirmedBatchCount')
  if (!Number.isSafeInteger(input.preparedBatchBytes) || input.preparedBatchBytes < 1) {
    throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'preparedBatchBytes is invalid')
  }
  const empty = input.currentBytes === 0 && input.confirmedBatchCount === 0
  return !empty && (
    input.currentBytes + input.preparedBatchBytes > SEGMENT_MAX_BYTES
    || input.confirmedBatchCount >= SEGMENT_MAX_CONFIRMED_BATCHES
  )
}

type PendingBatch = PreparedAppendResult & { prepared: BatchPreparedRecord }

export class SegmentStore {
  readonly segmentId: string
  readonly relativePath: string
  private pending: PendingBatch | null = null
  private byteSize: number
  private confirmedBatchCount: number
  private nextBatchSequence: number
  private previousBatchHash: string
  private sealed = false
  private failed = false

  private constructor(
    private readonly files: SegmentFilePort,
    private readonly handle: DurableFileHandle,
    state: SegmentOpenState
  ) {
    this.segmentId = segmentIdForOrdinal(state.segmentOrdinal)
    this.relativePath = segmentRelativePath(this.segmentId)
    assertOpenState(state)
    const actual = files.assertHandleIdentity(handle)
    if (actual.size !== state.expectedByteSize) {
      throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', `segment size ${actual.size} does not match expected ${state.expectedByteSize}`)
    }
    this.byteSize = state.expectedByteSize
    this.confirmedBatchCount = state.confirmedBatchCount
    this.nextBatchSequence = state.nextBatchSequence
    this.previousBatchHash = state.previousBatchHash
  }

  static create(
    files: SegmentFilePort,
    state: Omit<SegmentOpenState, 'expectedByteSize' | 'expectedFileHash' | 'confirmedBatchCount'>
  ): SegmentStore {
    const segmentId = segmentIdForOrdinal(state.segmentOrdinal)
    const initialState = {
      ...state,
      expectedByteSize: 0,
      expectedFileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      confirmedBatchCount: 0
    }
    assertOpenState(initialState)
    files.ensureDirectory(SEGMENT_DIRECTORY)
    const handle = files.createExclusive(segmentRelativePath(segmentId))
    try {
      return new SegmentStore(files, handle, initialState)
    } catch (error) {
      files.close(handle)
      throw error
    }
  }

  static open(files: SegmentFilePort, state: SegmentOpenState): SegmentStore {
    const segmentId = segmentIdForOrdinal(state.segmentOrdinal)
    const handle = files.openAppend(segmentRelativePath(segmentId))
    try {
      if (files.hashHandle(handle) !== state.expectedFileHash) {
        throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'segment file hash does not match verified open state')
      }
      return new SegmentStore(files, handle, state)
    } catch (error) {
      files.close(handle)
      throw error
    }
  }

  appendPrepared(preparedValue: BatchPreparedRecord, eventValues: readonly EventRecord[]): PreparedAppendResult {
    if (this.failed) throw new SegmentStoreError('SEGMENT_FAILED', 'segment handle is poisoned after an I/O failure')
    if (this.sealed) throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'sealed segment cannot accept PREPARE')
    if (this.pending) throw new SegmentStoreError('BATCH_PENDING', `batch ${this.pending.batchId} is awaiting COMMITTED`)
    const verified = validatePreparedBatch(preparedValue, eventValues)
    if (verified.prepared.segment_id !== this.segmentId) {
      throw new SegmentStoreError('SEGMENT_ID_MISMATCH', `prepared segment ${verified.prepared.segment_id} does not match ${this.segmentId}`)
    }
    if (verified.prepared.batch_sequence !== this.nextBatchSequence) {
      throw new SegmentStoreError('SEQUENCE_MISMATCH', `expected batch sequence ${this.nextBatchSequence}, got ${verified.prepared.batch_sequence}`)
    }
    if (verified.prepared.previous_batch_hash !== this.previousBatchHash) {
      throw new SegmentStoreError('HASH_CHAIN_MISMATCH', 'prepared previous_batch_hash does not match the verified chain head')
    }
    if (shouldRotateBeforePrepare({
      currentBytes: this.byteSize,
      confirmedBatchCount: this.confirmedBatchCount,
      preparedBatchBytes: verified.preparedBytes.length
    })) {
      throw new SegmentStoreError('ROTATION_REQUIRED', `segment ${this.segmentId} must rotate before batch ${verified.prepared.batch_id}`)
    }

    let offsets: { offsetStart: number; offsetEnd: number }
    try {
      offsets = this.files.appendExact(this.handle, verified.preparedBytes)
      this.files.syncFile(this.handle)
    } catch (error) {
      this.failed = true
      throw error
    }
    const result: PreparedAppendResult = {
      segmentId: this.segmentId,
      relativePath: this.relativePath,
      batchId: verified.prepared.batch_id,
      batchSequence: verified.prepared.batch_sequence,
      batchHash: verified.prepared.batch_hash,
      offsetStart: offsets.offsetStart,
      offsetEnd: offsets.offsetEnd,
      preparedBytes: verified.preparedBytes.length,
      fileIdentity: this.handle.identity
    }
    this.byteSize = offsets.offsetEnd
    this.pending = { ...result, prepared: verified.prepared }
    return result
  }

  appendCommitted(committedValue: BatchCommittedRecord): CommittedAppendResult {
    if (this.failed) throw new SegmentStoreError('SEGMENT_FAILED', 'segment handle is poisoned after an I/O failure')
    if (this.sealed) throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'sealed segment cannot accept COMMITTED')
    if (!this.pending) throw new SegmentStoreError('NO_PENDING_BATCH', 'no prepared batch is awaiting COMMITTED')
    const committed = validateCommittedForBatch(this.pending.prepared, committedValue)
    const bytes = eventBatchRecordBytes(committed)
    let offsets: { offsetStart: number; offsetEnd: number }
    try {
      offsets = this.files.appendExact(this.handle, bytes)
      this.files.syncFile(this.handle)
    } catch (error) {
      this.failed = true
      throw error
    }
    const pending = this.pending
    const result: CommittedAppendResult = {
      segmentId: pending.segmentId,
      relativePath: pending.relativePath,
      batchId: pending.batchId,
      batchSequence: pending.batchSequence,
      batchHash: pending.batchHash,
      offsetStart: pending.offsetStart,
      offsetEnd: pending.offsetEnd,
      preparedBytes: pending.preparedBytes,
      fileIdentity: pending.fileIdentity,
      committedOffsetStart: offsets.offsetStart,
      committedOffsetEnd: offsets.offsetEnd,
      committedBytes: bytes.length,
      finalByteSize: offsets.offsetEnd,
      confirmedBatchCount: this.confirmedBatchCount + 1
    }
    this.byteSize = offsets.offsetEnd
    this.confirmedBatchCount += 1
    this.nextBatchSequence += 1
    this.previousBatchHash = this.pending.batchHash
    this.pending = null
    return result
  }

  seal(sealedAt: string): SealedSegmentResult {
    if (this.failed) throw new SegmentStoreError('SEGMENT_FAILED', 'segment handle is poisoned after an I/O failure')
    if (this.sealed) throw new SegmentStoreError('SEGMENT_STATE_MISMATCH', 'segment is already sealed')
    if (this.pending) throw new SegmentStoreError('BATCH_PENDING', `cannot seal while batch ${this.pending.batchId} is uncommitted`)
    assertTimestamp(sealedAt, 'sealedAt')
    let stats: { size: number }
    let segmentFileHash: string
    try {
      this.files.syncFile(this.handle)
      stats = this.files.assertHandleIdentity(this.handle)
      segmentFileHash = this.files.hashHandle(this.handle)
      this.files.close(this.handle)
    } catch (error) {
      this.failed = true
      throw error
    }
    this.sealed = true
    return {
      segmentId: this.segmentId,
      relativePath: this.relativePath,
      byteSize: stats.size,
      confirmedBatchCount: this.confirmedBatchCount,
      segmentFileHash,
      lastBatchHash: this.previousBatchHash,
      sealedAt
    }
  }

  close(): void {
    this.files.close(this.handle)
  }

  snapshot(): {
    byteSize: number
    confirmedBatchCount: number
    nextBatchSequence: number
    previousBatchHash: string
    pendingBatchId: string | null
    failed: boolean
  } {
    return {
      byteSize: this.byteSize,
      confirmedBatchCount: this.confirmedBatchCount,
      nextBatchSequence: this.nextBatchSequence,
      previousBatchHash: this.previousBatchHash,
      pendingBatchId: this.pending?.batchId ?? null,
      failed: this.failed
    }
  }
}

export function nativeSegmentFiles(dataRoot: string): SegmentFilePort {
  return new DurableFileCapability(dataRoot)
}
