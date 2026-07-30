import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import { canonicalJson, sha256Hex } from '../canonical-json'
import { createLegacyAnchor, validateLegacyAnchor } from '../legacy-anchor'
import {
  archiveAndTruncateLegacyTail,
  inspectLegacyLogBytes,
  isProvablyIncompleteJsonTail,
  LegacyLogError
} from '../legacy-reader'

const roots: string[] = []
const golden = JSON.parse(readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/m5b-event-batch-golden-v1.json'),
  'utf8'
))

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'svets-m5b-legacy-reader-'))
  roots.push(path)
  return path
}

function event(overrides: Partial<ActionLogEntry> = {}): ActionLogEntry {
  const payload = overrides.payload ?? { answer_id: 'answer-1', score: 2 }
  return {
    event_id: 'legacy-event-1',
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: 'legacy-session-1',
    event_type: 'ANSWER_SUBMITTED',
    event_sequence: 1,
    payload,
    checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
    schema_version: 1,
    created_at: '2026-07-29T07:00:00.000Z',
    actor_id: 'teacher-1',
    actor_role: 'TEACHER',
    app_version: '1.0.0-alpha.1',
    ...overrides
  }
}

function line(value: ActionLogEntry, lf = true): Buffer {
  return Buffer.from(`${JSON.stringify(value)}${lf ? '\n' : ''}`, 'utf8')
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('M5B byte-exact legacy reader and anchor', () => {
  it('matches the frozen LF, byte hash, and canonical legacy anchor vector', () => {
    const bytes = Buffer.from(golden.legacy.line, 'utf8')
    const inspection = inspectLegacyLogBytes(bytes)
    const anchored = createLegacyAnchor({ inspection, sealedAt: golden.legacy.anchor.sealed_at })
    expect(inspection.events).toEqual([golden.legacy.event])
    expect(inspection.originalByteLength).toBe(golden.legacy.byte_length)
    expect(inspection.originalSha256).toBe(golden.legacy.sha256)
    expect(anchored).toEqual(golden.legacy.anchor)
    expect(canonicalJson(anchored)).toBe(golden.legacy.anchor_canonical_json)
    expect(sha256Hex(canonicalJson(anchored))).toBe(golden.legacy.anchor_sha256)
  })

  it('recognizes v1 and F7-v2 records without changing LF-terminated bytes', () => {
    const first = event()
    const secondPayload = { report_id: 'report-1', report_schema_version: 'task-report-v1.1' }
    const second = event({
      event_id: 'legacy-event-2',
      aggregate_type: 'TASK_REPORT',
      aggregate_id: 'report-1',
      event_type: 'REPORT_GENERATED',
      payload: secondPayload,
      checksum: createHash('sha256').update(JSON.stringify(secondPayload), 'utf8').digest('hex'),
      schema_version: 2,
      correlation_id: 'command-1'
    })
    const bytes = Buffer.concat([line(first), line(second)])
    const before = Buffer.from(bytes)
    const inspection = inspectLegacyLogBytes(bytes)

    expect(inspection).toMatchObject({
      state: 'VALID_LF_TERMINATED',
      originalByteLength: bytes.length,
      verifiedByteLength: bytes.length,
      tailOffset: null,
      tailBytes: null,
      lastEventId: 'legacy-event-2',
      lastEventTimestamp: second.created_at
    })
    expect(inspection.events).toEqual([first, second])
    expect(inspection.lines.map((entry) => [entry.offsetStart, entry.offsetEnd, entry.terminatedByLf]))
      .toEqual([[0, line(first).length, true], [line(first).length, bytes.length, true]])
    expect(inspection.groups.map((group) => group.kind)).toEqual(['SINGLE', 'SINGLE'])
    expect(bytes.equals(before)).toBe(true)
  })

  it('accepts a complete EOF without adding LF and freezes that fact in the anchor', () => {
    const bytes = line(event(), false)
    const before = Buffer.from(bytes)
    const inspection = inspectLegacyLogBytes(bytes)
    expect(inspection.state).toBe('VALID_COMPLETE_EOF')
    const anchor = createLegacyAnchor({ inspection, sealedAt: '2026-07-29T08:00:00.000Z' })
    expect(anchor).toMatchObject({
      schema_version: 'legacy-anchor-v1',
      relative_path: 'action_log.jsonl',
      byte_length: bytes.length,
      record_count: 1,
      last_event_id: 'legacy-event-1',
      line_termination: 'COMPLETE_EOF'
    })
    expect(bytes.equals(before)).toBe(true)
    expect(() => validateLegacyAnchor({ ...anchor, unknown: true })).toThrow(/field set mismatch/)
  })

  it('recognizes a complete legacy factual-correction triplet as one replay group', () => {
    const replacementId = 'incident-new'
    const oldId = 'incident-old'
    const createdPayload = {
      incident_id: replacementId,
      brief_description: 'corrected facts',
      reported_by: 'admin-1'
    }
    const replacedPayload = {
      old_incident_id: oldId,
      new_incident_id: replacementId,
      correction_reason: 'wrong person'
    }
    const voidedPayload = {
      incident_id: oldId,
      replacement_incident_id: replacementId,
      void_reason: 'FACTUAL_CORRECTION'
    }
    const entries = [
      event({
        event_id: 'correction-created', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: replacementId,
        event_type: 'SAFETY_INCIDENT_CREATED', payload: createdPayload,
        checksum: createHash('sha256').update(JSON.stringify(createdPayload)).digest('hex'), actor_id: 'admin-1', actor_role: 'ADMIN'
      }),
      event({
        event_id: 'correction-replaced', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: oldId,
        event_type: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', payload: replacedPayload,
        checksum: createHash('sha256').update(JSON.stringify(replacedPayload)).digest('hex'), actor_id: 'admin-1', actor_role: 'ADMIN'
      }),
      event({
        event_id: 'correction-voided', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: oldId,
        event_type: 'SAFETY_INCIDENT_VOIDED', event_sequence: 2, payload: voidedPayload,
        checksum: createHash('sha256').update(JSON.stringify(voidedPayload)).digest('hex'), actor_id: 'admin-1', actor_role: 'ADMIN'
      })
    ]
    const inspection = inspectLegacyLogBytes(Buffer.concat(entries.map((entry) => line(entry))))
    expect(inspection.groups).toEqual([{
      kind: 'F7_FACTUAL_CORRECTION',
      eventIds: ['correction-created', 'correction-replaced', 'correction-voided'],
      offsetStart: 0,
      offsetEnd: inspection.originalByteLength
    }])
  })

  it('archives an exact provably incomplete tail durably before truncating only to the verified byte offset', () => {
    const dataRoot = root()
    const prefix = line(event())
    const tail = Buffer.from('{"event_id":"partial-event","payload":{"note":"unfinished', 'utf8')
    const original = Buffer.concat([prefix, tail])
    const logPath = join(dataRoot, 'action_log.jsonl')
    writeFileSync(logPath, original, { flag: 'wx' })
    const inspection = inspectLegacyLogBytes(original)
    expect(inspection).toMatchObject({
      state: 'RECOVERABLE_INCOMPLETE_TAIL',
      verifiedByteLength: prefix.length,
      tailOffset: prefix.length
    })
    expect(inspection.tailBytes?.equals(tail)).toBe(true)

    const repaired = archiveAndTruncateLegacyTail({
      dataRoot,
      archiveRelativeDirectory: 'legacy-tail-archive',
      repairId: 'repair-1',
      inspection
    })
    expect(repaired).toEqual({
      archiveRelativePath: 'legacy-tail-archive/action-log.incomplete-tail.repair-1.bin',
      truncatedTo: prefix.length
    })
    expect(readFileSync(logPath).equals(prefix)).toBe(true)
    expect(readFileSync(join(dataRoot, repaired.archiveRelativePath)).equals(tail)).toBe(true)
    expect(inspectLegacyLogBytes(readFileSync(logPath)).state).toBe('VALID_LF_TERMINATED')
  })

  it('recognizes only syntactically completable JSON/UTF-8 tails and rejects complete corruption', () => {
    expect(isProvablyIncompleteJsonTail(Buffer.from('{"a":[1,{"b":"x', 'utf8'))).toBe(true)
    expect(isProvablyIncompleteJsonTail(Buffer.from('{"a":1,}', 'utf8'))).toBe(false)
    expect(isProvablyIncompleteJsonTail(Buffer.from('{}', 'utf8'))).toBe(false)
    const utf8Tail = Buffer.concat([
      Buffer.from('{"event_id":"partial雪', 'utf8').subarray(0, Buffer.byteLength('{"event_id":"partial雪') - 1)
    ])
    expect(isProvablyIncompleteJsonTail(utf8Tail)).toBe(true)
    expect(isProvablyIncompleteJsonTail(Buffer.from([0xe9]))).toBe(false)
    expect(isProvablyIncompleteJsonTail(Buffer.concat([
      Buffer.from('{"payload":', 'utf8'),
      Buffer.from([0xe9])
    ]))).toBe(false)

    expect(() => inspectLegacyLogBytes(Buffer.concat([line(event()), Buffer.from('{"a":1,}', 'utf8')])))
      .toThrow(/not complete supported JSON/)
    expect(() => inspectLegacyLogBytes(Buffer.concat([Buffer.from('{bad}\n'), line(event())])))
      .toThrow(/line 1/)
  })

  it('fails closed on checksum, sequence, unsupported complete event, blank line, and ambiguous correction groups', () => {
    expect(() => inspectLegacyLogBytes(line(event({ checksum: '0'.repeat(64) })))).toThrowError(LegacyLogError)
    expect(() => inspectLegacyLogBytes(Buffer.concat([
      line(event()),
      line(event({ event_id: 'legacy-event-2', event_sequence: 3 }))
    ]))).toThrow(/expected event_sequence 2/)
    expect(() => inspectLegacyLogBytes(line(event({ event_type: 'UNKNOWN_EVENT' as never })))).toThrow(/unsupported event_type/)
    expect(() => inspectLegacyLogBytes(Buffer.concat([line(event()), Buffer.from('\n')]))).toThrow(/empty/)

    const createdPayload = { incident_id: 'new', brief_description: 'x', reported_by: 'admin-1' }
    const created = event({
      event_id: 'created', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'new',
      event_type: 'SAFETY_INCIDENT_CREATED', actor_id: 'admin-1', actor_role: 'ADMIN',
      payload: createdPayload, checksum: createHash('sha256').update(JSON.stringify(createdPayload)).digest('hex')
    })
    expect(() => inspectLegacyLogBytes(line(created))).toThrow(/incomplete factual-correction group/)
  })

  it('never truncates when archive fsync fails or when the source changed after inspection', () => {
    const dataRoot = root()
    const prefix = line(event())
    const tail = Buffer.from('{"event_id":"partial', 'utf8')
    const original = Buffer.concat([prefix, tail])
    const logPath = join(dataRoot, 'action_log.jsonl')
    writeFileSync(logPath, original, { flag: 'wx' })
    const inspection = inspectLegacyLogBytes(original)

    expect(() => archiveAndTruncateLegacyTail({
      dataRoot,
      archiveRelativeDirectory: 'archive-fail',
      repairId: 'repair-fail',
      inspection,
      hooks: {
        syncFile: () => { throw new Error('archive sync failure') },
        syncDirectory: () => undefined
      }
    })).toThrow(/file sync failed/)
    expect(readFileSync(logPath).equals(original)).toBe(true)

    writeFileSync(logPath, Buffer.concat([original, Buffer.from('changed')]))
    expect(() => archiveAndTruncateLegacyTail({
      dataRoot,
      archiveRelativeDirectory: 'archive-changed',
      repairId: 'repair-changed',
      inspection
    })).toThrow(/source changed/)
    expect(existsSync(join(dataRoot, 'archive-changed'))).toBe(false)
  })

  it('rejects a same-byte path identity swap after archiving and before truncate', () => {
    const dataRoot = root()
    const prefix = line(event())
    const tail = Buffer.from('{"event_id":"partial', 'utf8')
    const original = Buffer.concat([prefix, tail])
    const logPath = join(dataRoot, 'action_log.jsonl')
    const parkedPath = join(dataRoot, 'action_log.parked.jsonl')
    writeFileSync(logPath, original, { flag: 'wx' })
    const inspection = inspectLegacyLogBytes(original)
    let directorySyncs = 0

    expect(() => archiveAndTruncateLegacyTail({
      dataRoot,
      archiveRelativeDirectory: 'archive-race',
      repairId: 'repair-race',
      inspection,
      hooks: {
        syncFile: () => undefined,
        syncDirectory: () => {
          directorySyncs += 1
          if (directorySyncs === 2) {
            renameSync(logPath, parkedPath)
            writeFileSync(logPath, original, { flag: 'wx' })
          }
        }
      }
    })).toThrow(/changed before truncate/)
    expect(readFileSync(logPath).equals(original)).toBe(true)
    expect(readFileSync(parkedPath).equals(original)).toBe(true)
    expect(readFileSync(join(
      dataRoot,
      'archive-race/action-log.incomplete-tail.repair-race.bin'
    )).equals(tail)).toBe(true)
  })
})
