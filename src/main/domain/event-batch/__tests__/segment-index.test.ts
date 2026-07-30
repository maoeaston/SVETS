import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBatchCommittedRecord,
  createBatchPreparedRecord,
  createEventRecord
} from '../batch-hash'
import { canonicalJsonBytes, sha256Hex } from '../canonical-json'
import { DurableFileCapability } from '../file-capability'
import type { LegacyAnchorV1 } from '../legacy-anchor'
import {
  buildSegmentIndex,
  loadSegmentSources,
  parseSegmentIndexBytes,
  readSegmentIndexFile,
  rebuildSegmentIndexFromDisk,
  reconcileSegmentIndex,
  SEGMENT_INDEX_PATH,
  segmentIndexBytes,
  segmentIndexSha256,
  validateSegmentIndex,
  writeSegmentIndexAtomic,
  type SegmentFileSource
} from '../segment-index'
import { SEGMENT_DIRECTORY, segmentRelativePath } from '../segment-store'

const golden = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-event-batch-golden-v1.json'),
  'utf8'
))
const roots: string[] = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'svets-m5b-segment-index-'))
  roots.push(path)
  return path
}

function goldenPreparedBytes(): Buffer {
  return Buffer.from(`${golden.batch.prepared_line}${golden.batch.event_lines.join('')}`, 'utf8')
}

function goldenCompleteBytes(): Buffer {
  return Buffer.from(
    `${golden.batch.prepared_line}${golden.batch.event_lines.join('')}${golden.batch.committed_line}`,
    'utf8'
  )
}

function nextBatch(options: {
  segmentId?: string
  batchId?: string
  previousBatchHash?: string
  eventId?: string
}) {
  const batchId = options.batchId ?? 'batch-0002'
  const event = createEventRecord({
    batch_id: batchId,
    event_id: options.eventId ?? 'event-0003',
    aggregate_type: 'TRAINING_SESSION',
    aggregate_id: 'training-0001',
    event_type: 'TRAINING_STARTED',
    event_sequence: 1,
    payload: { step_count: 3 },
    actor_id: 'teacher-0001',
    timestamp: '2026-07-29T08:01:00.100Z'
  })
  const prepared = createBatchPreparedRecord({
    batch_id: batchId,
    batch_sequence: 2,
    segment_id: options.segmentId ?? 'seg_000000000002',
    command_id: 'command-0002',
    request_hash: '2'.repeat(64),
    prepared_lease_generation: 2,
    worker_id: 'worker-0001',
    previous_batch_hash: options.previousBatchHash ?? golden.batch.batch_hash,
    timestamp: '2026-07-29T08:01:00.000Z'
  }, [event])
  const committed = createBatchCommittedRecord({
    batch_id: batchId,
    batch_sequence: 2,
    timestamp: '2026-07-29T08:01:00.200Z'
  })
  const preparedBytes = Buffer.concat([
    canonicalJsonBytes(prepared, true),
    canonicalJsonBytes(event, true)
  ])
  const completeBytes = Buffer.concat([preparedBytes, canonicalJsonBytes(committed, true)])
  return { event, prepared, committed, preparedBytes, completeBytes }
}

function source(segmentId: string, bytes: Uint8Array): SegmentFileSource {
  return { segmentId, bytes }
}

function anchor(suffix = '1'): LegacyAnchorV1 {
  return {
    schema_version: 'legacy-anchor-v1',
    relative_path: 'action_log.jsonl',
    byte_length: 10,
    sha256: suffix.repeat(64),
    record_count: 1,
    last_event_id: `legacy-event-${suffix}`,
    last_event_timestamp: '2026-07-29T07:59:00.000Z',
    line_termination: 'LF',
    sealed_at: '2026-07-29T08:00:00.000Z'
  }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('M5B segment index', () => {
  it('builds deterministic segment boundaries and canonical index bytes from the frozen batch vector', () => {
    const bytes = goldenCompleteBytes()
    const index = buildSegmentIndex({
      sources: [source('seg_000000000001', bytes)],
      legacyAnchor: null
    })
    expect(index).toEqual({
      schema_version: 'segment-index-v1',
      legacy_anchor: null,
      active_segment_id: 'seg_000000000001',
      last_global_batch_sequence: 1,
      last_confirmed_batch_sequence: 1,
      last_batch_hash: golden.batch.batch_hash,
      segments: [{
        segment_id: 'seg_000000000001',
        file_path: 'event-log/segments/seg_000000000001.jsonl',
        state: 'ACTIVE',
        first_batch_sequence: 1,
        last_batch_sequence: 1,
        first_batch_hash: golden.batch.batch_hash,
        last_batch_hash: golden.batch.batch_hash,
        first_events_hash: golden.batch.events_hash,
        last_events_hash: golden.batch.events_hash,
        previous_segment_hash: 'GENESIS',
        segment_file_hash: golden.batch.complete_batch_bytes_sha256,
        byte_size: bytes.length,
        batch_count: 1,
        confirmed_batch_count: 1,
        has_uncommitted_tail: false
      }]
    })
    expect(index).toEqual(golden.segment.index)
    expect(segmentIndexBytes(index).toString('utf8')).toBe(golden.segment.index_line)
    expect(segmentIndexSha256(index)).toBe(golden.segment.index_sha256)
    expect(bytes.length).toBe(golden.segment.byte_size)
    expect(segmentIndexBytes(index).at(-1)).toBe(0x0a)
    expect(parseSegmentIndexBytes(segmentIndexBytes(index))).toEqual(index)
    expect(segmentIndexSha256(index)).toBe(sha256Hex(segmentIndexBytes(index)))
  })

  it('accepts exactly one complete prepared tail only in the final active segment', () => {
    const preparedOnly = buildSegmentIndex({
      sources: [source('seg_000000000001', goldenPreparedBytes())],
      legacyAnchor: null
    })
    expect(preparedOnly).toMatchObject({
      last_global_batch_sequence: 1,
      last_confirmed_batch_sequence: 0,
      last_batch_hash: golden.batch.batch_hash
    })
    expect(preparedOnly.segments[0]).toMatchObject({
      batch_count: 1,
      confirmed_batch_count: 0,
      has_uncommitted_tail: true
    })
    expect(() => buildSegmentIndex({
      sources: [
        source('seg_000000000001', goldenPreparedBytes()),
        source('seg_000000000002', new Uint8Array())
      ],
      legacyAnchor: null
    })).toThrow(/sealed segment has an uncommitted batch/)
  })

  it('fails closed on incomplete, noncanonical, reordered, hash, and record grammar corruption', () => {
    const complete = goldenCompleteBytes()
    expect(() => buildSegmentIndex({
      sources: [source('seg_000000000001', complete.subarray(0, complete.length - 1))],
      legacyAnchor: null
    })).toThrow(/does not end with LF/)

    const noncanonical = Buffer.concat([Buffer.from(' ', 'utf8'), complete])
    expect(() => buildSegmentIndex({
      sources: [source('seg_000000000001', noncanonical)], legacyAnchor: null
    })).toThrow(/not canonical/)

    const hashTamper = Buffer.from(complete)
    const eventMarker = Buffer.from('answer-1')
    const markerOffset = hashTamper.indexOf(eventMarker)
    hashTamper[markerOffset] = 0x62
    expect(() => buildSegmentIndex({
      sources: [source('seg_000000000001', hashTamper)], legacyAnchor: null
    })).toThrow()

    expect(() => buildSegmentIndex({
      sources: [source('seg_000000000001', Buffer.from(golden.batch.event_lines[0], 'utf8'))],
      legacyAnchor: null
    })).toThrow(/not BATCH_PREPARED/)
    expect(() => buildSegmentIndex({
      sources: [source('seg_000000000002', complete)], legacyAnchor: null
    })).toThrow(/expected seg_000000000001/)
  })

  it('verifies cross-segment global sequence, batch hash, event identity, and aggregate sequence', () => {
    const second = nextBatch({})
    const index = buildSegmentIndex({
      sources: [
        source('seg_000000000001', goldenCompleteBytes()),
        source('seg_000000000002', second.completeBytes)
      ],
      legacyAnchor: anchor()
    })
    expect(index).toMatchObject({
      active_segment_id: 'seg_000000000002',
      last_global_batch_sequence: 2,
      last_confirmed_batch_sequence: 2,
      last_batch_hash: second.prepared.batch_hash
    })
    expect(index.segments.map((entry) => entry.state)).toEqual(['SEALED', 'ACTIVE'])
    expect(index.segments[1].previous_segment_hash).toBe(golden.batch.batch_hash)
    expect(index.segments[1].first_batch_sequence).toBe(2)

    const wrongPrevious = nextBatch({ previousBatchHash: 'a'.repeat(64) })
    expect(() => buildSegmentIndex({
      sources: [
        source('seg_000000000001', goldenCompleteBytes()),
        source('seg_000000000002', wrongPrevious.completeBytes)
      ],
      legacyAnchor: null
    })).toThrow(/hash chain is discontinuous/)

    const duplicateEvent = nextBatch({ eventId: 'event-0001' })
    expect(() => buildSegmentIndex({
      sources: [
        source('seg_000000000001', goldenCompleteBytes()),
        source('seg_000000000002', duplicateEvent.completeBytes)
      ],
      legacyAnchor: null
    })).toThrow(/duplicate event ID/)
  })

  it('rebuilds from owned disk files and rejects unknown objects in the segment directory', () => {
    const dataRoot = root()
    const capability = new DurableFileCapability(dataRoot)
    capability.ensureDirectory(SEGMENT_DIRECTORY)
    const firstPath = segmentRelativePath('seg_000000000001')
    writeFileSync(join(dataRoot, firstPath), goldenCompleteBytes(), { flag: 'wx' })
    expect(loadSegmentSources(capability)).toEqual([
      { segmentId: 'seg_000000000001', bytes: goldenCompleteBytes() }
    ])
    expect(rebuildSegmentIndexFromDisk(capability, null).last_batch_hash).toBe(golden.batch.batch_hash)

    writeFileSync(join(dataRoot, SEGMENT_DIRECTORY, 'foreign.txt'), 'foreign', { flag: 'wx' })
    expect(() => loadSegmentSources(capability)).toThrow(/unexpected object/)
  })

  it('distinguishes a missing or byte-prefix-lagging index from conflicting history', () => {
    const prepared = goldenPreparedBytes()
    const complete = goldenCompleteBytes()
    const oldIndex = buildSegmentIndex({
      sources: [source('seg_000000000001', prepared)],
      legacyAnchor: anchor()
    })
    expect(reconcileSegmentIndex({
      existing: null,
      sources: [source('seg_000000000001', complete)],
      legacyAnchor: anchor()
    }).status).toBe('REBUILT_MISSING')
    expect(reconcileSegmentIndex({
      existing: oldIndex,
      sources: [source('seg_000000000001', complete)],
      legacyAnchor: anchor()
    }).status).toBe('REBUILT_LAGGING')
    const current = buildSegmentIndex({
      sources: [source('seg_000000000001', complete)], legacyAnchor: anchor()
    })
    expect(reconcileSegmentIndex({
      existing: current,
      sources: [source('seg_000000000001', complete)],
      legacyAnchor: anchor()
    }).status).toBe('CURRENT')

    const changedPrefix = Buffer.from(complete)
    changedPrefix[0] ^= 1
    expect(() => reconcileSegmentIndex({
      existing: oldIndex,
      sources: [source('seg_000000000001', changedPrefix)],
      legacyAnchor: anchor()
    })).toThrow()
    expect(() => reconcileSegmentIndex({
      existing: oldIndex,
      sources: [source('seg_000000000001', complete)],
      legacyAnchor: anchor('2')
    })).toThrow(/legacy anchor conflicts/)
  })

  it('rejects growth of an indexed sealed segment even when the new bytes form a valid chain', () => {
    const existing = buildSegmentIndex({
      sources: [
        source('seg_000000000001', goldenCompleteBytes()),
        source('seg_000000000002', new Uint8Array())
      ],
      legacyAnchor: null
    })
    const secondInFirst = nextBatch({ segmentId: 'seg_000000000001' })
    expect(() => reconcileSegmentIndex({
      existing,
      sources: [
        source('seg_000000000001', Buffer.concat([goldenCompleteBytes(), secondInFirst.completeBytes])),
        source('seg_000000000002', new Uint8Array())
      ],
      legacyAnchor: null
    })).toThrow(/changed after it was sealed/)
  })

  it('publishes canonical index bytes without clobber and updates only the expected identity/hash', () => {
    const dataRoot = root()
    const capability = new DurableFileCapability(dataRoot)
    const empty = buildSegmentIndex({ sources: [], legacyAnchor: null })
    const first = writeSegmentIndexAtomic({
      capability,
      index: empty,
      expectedSha256: null,
      operationId: 'initial'
    })
    expect(first.sha256).toBe(segmentIndexSha256(empty))
    expect(existsSync(join(dataRoot, '.segment-index-initial.tmp'))).toBe(false)
    expect(readSegmentIndexFile(capability)?.index).toEqual(empty)

    const withEmptyActive = buildSegmentIndex({
      sources: [source('seg_000000000001', new Uint8Array())], legacyAnchor: null
    })
    expect(() => writeSegmentIndexAtomic({
      capability,
      index: withEmptyActive,
      expectedSha256: 'f'.repeat(64),
      operationId: 'stale'
    })).toThrow(/changed before update/)
    expect(readFileSync(join(dataRoot, SEGMENT_INDEX_PATH)).equals(segmentIndexBytes(empty))).toBe(true)

    const second = writeSegmentIndexAtomic({
      capability,
      index: withEmptyActive,
      expectedSha256: first.sha256,
      operationId: 'update'
    })
    expect(second.sha256).toBe(segmentIndexSha256(withEmptyActive))
    expect(readSegmentIndexFile(capability)?.index).toEqual(withEmptyActive)
  })

  it('rejects unknown index fields and inconsistent global or per-segment metadata', () => {
    const index = buildSegmentIndex({
      sources: [source('seg_000000000001', goldenCompleteBytes())], legacyAnchor: null
    })
    expect(() => validateSegmentIndex({ ...index, extra: true })).toThrow(/field set mismatch/)
    expect(() => validateSegmentIndex({ ...index, last_global_batch_sequence: 2 })).toThrow(/global sequence/)
    expect(() => validateSegmentIndex({
      ...index,
      segments: [{ ...index.segments[0], confirmed_batch_count: 0 }]
    })).toThrow(/confirmed count/)
  })
})
