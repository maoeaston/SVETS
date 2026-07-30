import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBatchCommittedRecord,
  createBatchPreparedRecord,
  createEventRecord
} from '../batch-hash'
import { DurableFileCapability } from '../file-capability'
import {
  nativeSegmentFiles,
  SEGMENT_MAX_BYTES,
  SEGMENT_MAX_CONFIRMED_BATCHES,
  SegmentStore,
  segmentIdForOrdinal,
  segmentOrdinalFromId,
  segmentRelativePath,
  shouldRotateBeforePrepare,
  type SegmentFilePort
} from '../segment-store'
import type { EventRecord } from '../record-types'

const roots: string[] = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'svets-m5b-segment-store-'))
  roots.push(path)
  return path
}

function batch(params: {
  batchId?: string
  batchSequence?: number
  segmentId?: string
  previousBatchHash?: string
  eventSequence?: number
}) {
  const batchId = params.batchId ?? 'batch-1'
  const event = createEventRecord({
    batch_id: batchId,
    event_id: `event-${batchId}`,
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: 'session-1',
    event_type: 'ANSWER_SUBMITTED',
    event_sequence: params.eventSequence ?? 1,
    payload: { answer_id: `answer-${batchId}`, score: 2 },
    actor_id: 'teacher-1',
    timestamp: '2026-07-29T08:00:00.100Z'
  })
  const prepared = createBatchPreparedRecord({
    batch_id: batchId,
    batch_sequence: params.batchSequence ?? 1,
    segment_id: params.segmentId ?? 'seg_000000000001',
    command_id: `command-${batchId}`,
    request_hash: '1'.repeat(64),
    prepared_lease_generation: 1,
    worker_id: 'worker-1',
    previous_batch_hash: params.previousBatchHash ?? 'GENESIS',
    timestamp: '2026-07-29T08:00:00.000Z'
  }, [event])
  const committed = createBatchCommittedRecord({
    batch_id: batchId,
    batch_sequence: params.batchSequence ?? 1,
    timestamp: '2026-07-29T08:00:00.200Z'
  })
  return { events: [event] as EventRecord[], prepared, committed }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('M5B segment store', () => {
  it('freezes segment naming and rejects invalid ordinals/IDs', () => {
    expect(segmentIdForOrdinal(1)).toBe('seg_000000000001')
    expect(segmentIdForOrdinal(999_999_999_999)).toBe('seg_999999999999')
    expect(segmentOrdinalFromId('seg_000000000042')).toBe(42)
    expect(segmentRelativePath('seg_000000000042')).toBe('event-log/segments/seg_000000000042.jsonl')
    for (const invalid of [0, -1, 1.5, 1_000_000_000_000]) expect(() => segmentIdForOrdinal(invalid)).toThrow()
    for (const invalid of ['seg_1', 'seg_000000000000', 'segment_000000000001']) {
      expect(() => segmentOrdinalFromId(invalid)).toThrow()
    }
  })

  it('rejects invalid initial chain state before creating directories or segment bytes', () => {
    const dataRoot = root()
    expect(() => SegmentStore.create(nativeSegmentFiles(dataRoot), {
      segmentOrdinal: 1,
      nextBatchSequence: 0,
      previousBatchHash: 'GENESIS'
    })).toThrow(/nextBatchSequence/)
    expect(existsSync(join(dataRoot, 'event-log'))).toBe(false)
  })

  it('uses the exact prospective byte and confirmed-count rotation boundaries', () => {
    expect(shouldRotateBeforePrepare({
      currentBytes: SEGMENT_MAX_BYTES - 101,
      preparedBatchBytes: 100,
      confirmedBatchCount: 9999
    })).toBe(false)
    expect(shouldRotateBeforePrepare({
      currentBytes: SEGMENT_MAX_BYTES - 100,
      preparedBatchBytes: 100,
      confirmedBatchCount: 9999
    })).toBe(false)
    expect(shouldRotateBeforePrepare({
      currentBytes: SEGMENT_MAX_BYTES - 99,
      preparedBatchBytes: 100,
      confirmedBatchCount: 9999
    })).toBe(true)
    expect(shouldRotateBeforePrepare({ currentBytes: 1, preparedBatchBytes: 1, confirmedBatchCount: 9999 })).toBe(false)
    expect(shouldRotateBeforePrepare({
      currentBytes: 1,
      preparedBatchBytes: 1,
      confirmedBatchCount: SEGMENT_MAX_CONFIRMED_BATCHES
    })).toBe(true)
    expect(shouldRotateBeforePrepare({
      currentBytes: 0,
      preparedBatchBytes: SEGMENT_MAX_BYTES + 1,
      confirmedBatchCount: 0
    })).toBe(false)
  })

  it('writes PREPARED+EVENT as one fsynced range and counts COMMITTED only in final size', () => {
    const dataRoot = root()
    const store = SegmentStore.create(nativeSegmentFiles(dataRoot), {
      segmentOrdinal: 1,
      nextBatchSequence: 1,
      previousBatchHash: 'GENESIS'
    })
    const first = batch({})
    const preparedResult = store.appendPrepared(first.prepared, first.events)
    expect(preparedResult.offsetStart).toBe(0)
    expect(preparedResult.offsetEnd).toBe(preparedResult.preparedBytes)
    expect(store.snapshot()).toMatchObject({
      byteSize: preparedResult.preparedBytes,
      confirmedBatchCount: 0,
      nextBatchSequence: 1,
      pendingBatchId: 'batch-1'
    })
    expect(readFileSync(join(dataRoot, preparedResult.relativePath), 'utf8')).not.toContain('BATCH_COMMITTED')

    const committedResult = store.appendCommitted(first.committed)
    expect(committedResult.committedOffsetStart).toBe(preparedResult.offsetEnd)
    expect(committedResult.finalByteSize).toBe(preparedResult.preparedBytes + committedResult.committedBytes)
    expect(store.snapshot()).toMatchObject({
      byteSize: committedResult.finalByteSize,
      confirmedBatchCount: 1,
      nextBatchSequence: 2,
      previousBatchHash: first.prepared.batch_hash,
      pendingBatchId: null
    })

    const sealed = store.seal('2026-07-29T08:01:00.000Z')
    expect(sealed).toMatchObject({
      segmentId: 'seg_000000000001',
      byteSize: committedResult.finalByteSize,
      confirmedBatchCount: 1,
      lastBatchHash: first.prepared.batch_hash
    })
    expect(sealed.segmentFileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(() => store.appendPrepared(first.prepared, first.events)).toThrow(/sealed/)
  })

  it('keeps a batch in one segment and enforces global sequence/hash chain before append', () => {
    const dataRoot = root()
    const store = SegmentStore.create(nativeSegmentFiles(dataRoot), {
      segmentOrdinal: 2,
      nextBatchSequence: 7,
      previousBatchHash: 'a'.repeat(64)
    })
    const wrongSegment = batch({
      batchId: 'wrong-segment', batchSequence: 7, segmentId: 'seg_000000000001', previousBatchHash: 'a'.repeat(64)
    })
    expect(() => store.appendPrepared(wrongSegment.prepared, wrongSegment.events)).toThrow(/does not match/)
    const wrongSequence = batch({
      batchId: 'wrong-sequence', batchSequence: 8, segmentId: 'seg_000000000002', previousBatchHash: 'a'.repeat(64)
    })
    expect(() => store.appendPrepared(wrongSequence.prepared, wrongSequence.events)).toThrow(/expected batch sequence 7/)
    const wrongHash = batch({
      batchId: 'wrong-hash', batchSequence: 7, segmentId: 'seg_000000000002', previousBatchHash: 'b'.repeat(64)
    })
    expect(() => store.appendPrepared(wrongHash.prepared, wrongHash.events)).toThrow(/chain head/)
    expect(store.snapshot().byteSize).toBe(0)
    store.close()
  })

  it('opens an active segment only against its exact verified byte size and file hash', () => {
    const dataRoot = root()
    const files = nativeSegmentFiles(dataRoot)
    const store = SegmentStore.create(files, {
      segmentOrdinal: 1, nextBatchSequence: 1, previousBatchHash: 'GENESIS'
    })
    const first = batch({})
    store.appendPrepared(first.prepared, first.events)
    store.appendCommitted(first.committed)
    const state = store.snapshot()
    const path = segmentRelativePath('seg_000000000001')
    const fileHash = new DurableFileCapability(dataRoot).readStable(path)!.sha256
    store.close()

    expect(() => SegmentStore.open(files, {
      segmentOrdinal: 1,
      expectedByteSize: state.byteSize,
      expectedFileHash: '0'.repeat(64),
      confirmedBatchCount: state.confirmedBatchCount,
      nextBatchSequence: state.nextBatchSequence,
      previousBatchHash: state.previousBatchHash
    })).toThrow(/file hash/)
    const reopened = SegmentStore.open(files, {
      segmentOrdinal: 1,
      expectedByteSize: state.byteSize,
      expectedFileHash: fileHash,
      confirmedBatchCount: state.confirmedBatchCount,
      nextBatchSequence: state.nextBatchSequence,
      previousBatchHash: state.previousBatchHash
    })
    expect(reopened.snapshot()).toMatchObject(state)
    reopened.close()
  })

  it('does not mark PONR when append is partial or fsync fails', () => {
    const partialRoot = root()
    const realFiles = nativeSegmentFiles(partialRoot)
    let failAppend = true
    const partialFiles: SegmentFilePort = {
      ...realFiles,
      ensureDirectory: realFiles.ensureDirectory.bind(realFiles),
      createExclusive: realFiles.createExclusive.bind(realFiles),
      openAppend: realFiles.openAppend.bind(realFiles),
      appendExact: (handle, bytes) => {
        if (failAppend) {
          failAppend = false
          realFiles.appendExact(handle, bytes.subarray(0, 17))
          throw new Error('injected partial write')
        }
        return realFiles.appendExact(handle, bytes)
      },
      syncFile: realFiles.syncFile.bind(realFiles),
      assertHandleIdentity: realFiles.assertHandleIdentity.bind(realFiles),
      hashHandle: realFiles.hashHandle.bind(realFiles),
      close: realFiles.close.bind(realFiles)
    }
    const partialStore = SegmentStore.create(partialFiles, {
      segmentOrdinal: 1, nextBatchSequence: 1, previousBatchHash: 'GENESIS'
    })
    const first = batch({})
    expect(() => partialStore.appendPrepared(first.prepared, first.events)).toThrow('injected partial write')
    expect(partialStore.snapshot()).toMatchObject({ pendingBatchId: null, confirmedBatchCount: 0 })
    expect(readFileSync(join(partialRoot, segmentRelativePath('seg_000000000001'))).length).toBe(17)
    expect(() => partialStore.appendPrepared(first.prepared, first.events)).toThrow(/poisoned/)
    expect(readFileSync(join(partialRoot, segmentRelativePath('seg_000000000001'))).length).toBe(17)
    partialStore.close()

    const syncRoot = root()
    let syncCalls = 0
    const capability = new DurableFileCapability(syncRoot, {
      syncFile: () => {
        syncCalls += 1
        if (syncCalls === 2) throw new Error('injected sync failure')
      },
      syncDirectory: () => undefined
    })
    const syncStore = SegmentStore.create(capability, {
      segmentOrdinal: 1, nextBatchSequence: 1, previousBatchHash: 'GENESIS'
    })
    expect(() => syncStore.appendPrepared(first.prepared, first.events)).toThrow(/file sync failed/)
    expect(syncStore.snapshot()).toMatchObject({ pendingBatchId: null, confirmedBatchCount: 0, failed: true })
    expect(() => syncStore.appendPrepared(first.prepared, first.events)).toThrow(/poisoned/)
    syncStore.close()
  })

  it('fails before bytes when the active path identity changes and refuses seal with a pending batch', () => {
    const dataRoot = root()
    const store = SegmentStore.create(nativeSegmentFiles(dataRoot), {
      segmentOrdinal: 1, nextBatchSequence: 1, previousBatchHash: 'GENESIS'
    })
    const first = batch({})
    const activePath = join(dataRoot, segmentRelativePath('seg_000000000001'))
    renameSync(activePath, `${activePath}.parked`)
    writeFileSync(activePath, 'foreign', { flag: 'wx' })
    expect(() => store.appendPrepared(first.prepared, first.events)).toThrow(/identity changed/)
    expect(readFileSync(activePath, 'utf8')).toBe('foreign')
    store.close()

    const secondRoot = root()
    const pendingStore = SegmentStore.create(nativeSegmentFiles(secondRoot), {
      segmentOrdinal: 1, nextBatchSequence: 1, previousBatchHash: 'GENESIS'
    })
    pendingStore.appendPrepared(first.prepared, first.events)
    expect(() => pendingStore.seal('2026-07-29T08:01:00.000Z')).toThrow(/cannot seal/)
    expect(() => pendingStore.appendPrepared(first.prepared, first.events)).toThrow(/awaiting COMMITTED/)
    pendingStore.close()
  })
})
