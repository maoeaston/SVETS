#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadInventoryDocuments as loadM5aInventoryDocuments } from './lib/m5a-command-boundary-inventory.mjs'
import {
  M5B_SOURCE_DIGEST,
  scanM5bCheckout
} from './lib/m5b-runtime-inventory.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const goldenPath = resolve(projectRoot, 'scripts/fixtures/m5b-event-batch-golden-v1.json')
const step2Path = resolve(projectRoot, 'scripts/fixtures/m5b-step2-source-delta-v1.json')
const deltaPath = resolve(projectRoot, 'scripts/fixtures/m5b-step3-source-delta-v1.json')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildGoldenSections(golden) {
  const eventLines = golden.batch.events.map((event) => `${canonicalJson(event)}\n`)
  const eventBytes = Buffer.from(eventLines.join(''), 'utf8')
  const eventsHash = sha256(eventBytes)
  const batchHash = sha256(Buffer.from(`GENESIS${eventsHash}`, 'utf8'))
  const preparedLine = `${canonicalJson(golden.batch.prepared)}\n`
  const committedLine = `${canonicalJson(golden.batch.committed)}\n`
  const preparedBytes = Buffer.from(`${preparedLine}${eventLines.join('')}`, 'utf8')
  const completeBytes = Buffer.concat([preparedBytes, Buffer.from(committedLine, 'utf8')])
  if (
    !exactJson(eventLines, golden.batch.event_lines)
    || eventsHash !== golden.batch.events_hash
    || batchHash !== golden.batch.batch_hash
    || preparedLine !== golden.batch.prepared_line
    || committedLine !== golden.batch.committed_line
    || sha256(preparedBytes) !== golden.batch.prepared_batch_bytes_sha256
    || sha256(completeBytes) !== golden.batch.complete_batch_bytes_sha256
  ) throw new Error('[m5b-step3-fixture] existing batch vector is inconsistent')

  const segmentEntry = {
    segment_id: 'seg_000000000001',
    file_path: 'event-log/segments/seg_000000000001.jsonl',
    state: 'ACTIVE',
    first_batch_sequence: 1,
    last_batch_sequence: 1,
    first_batch_hash: batchHash,
    last_batch_hash: batchHash,
    first_events_hash: eventsHash,
    last_events_hash: eventsHash,
    previous_segment_hash: 'GENESIS',
    segment_file_hash: sha256(completeBytes),
    byte_size: completeBytes.length,
    batch_count: 1,
    confirmed_batch_count: 1,
    has_uncommitted_tail: false
  }
  const index = {
    schema_version: 'segment-index-v1',
    legacy_anchor: null,
    active_segment_id: 'seg_000000000001',
    last_global_batch_sequence: 1,
    last_confirmed_batch_sequence: 1,
    last_batch_hash: batchHash,
    segments: [segmentEntry]
  }
  const indexLine = `${canonicalJson(index)}\n`
  const segment = {
    segment_id: segmentEntry.segment_id,
    relative_path: segmentEntry.file_path,
    byte_size: completeBytes.length,
    complete_bytes_sha256: sha256(completeBytes),
    index,
    index_line: indexLine,
    index_sha256: sha256(Buffer.from(indexLine, 'utf8'))
  }

  const payload = { answer_id: 'answer-1', score: 2 }
  const legacyEvent = {
    event_id: 'legacy-event-1',
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: 'legacy-session-1',
    event_type: 'ANSWER_SUBMITTED',
    event_sequence: 1,
    payload,
    checksum: sha256(Buffer.from(JSON.stringify(payload), 'utf8')),
    schema_version: 1,
    created_at: '2026-07-29T07:00:00.000Z',
    actor_id: 'teacher-1',
    actor_role: 'TEACHER',
    app_version: '1.0.0-alpha.1'
  }
  const legacyLine = `${JSON.stringify(legacyEvent)}\n`
  const legacyBytes = Buffer.from(legacyLine, 'utf8')
  const legacyAnchor = {
    schema_version: 'legacy-anchor-v1',
    relative_path: 'action_log.jsonl',
    byte_length: legacyBytes.length,
    sha256: sha256(legacyBytes),
    record_count: 1,
    last_event_id: legacyEvent.event_id,
    last_event_timestamp: legacyEvent.created_at,
    line_termination: 'LF',
    sealed_at: '2026-07-29T08:00:00.000Z'
  }
  const legacy = {
    event: legacyEvent,
    line: legacyLine,
    byte_length: legacyBytes.length,
    sha256: sha256(legacyBytes),
    anchor: legacyAnchor,
    anchor_canonical_json: canonicalJson(legacyAnchor),
    anchor_sha256: sha256(Buffer.from(canonicalJson(legacyAnchor), 'utf8'))
  }
  return { segment, legacy }
}

function updateGolden() {
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
  if (golden.schema_version !== 'm5b-event-batch-golden-v1') {
    throw new Error('[m5b-step3-fixture] golden schema version mismatch')
  }
  const sections = buildGoldenSections(golden)
  if (golden.segment === null && golden.legacy === null) {
    golden.segment = sections.segment
    golden.legacy = sections.legacy
    writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
    return 'populated'
  }
  if (!exactJson(golden.segment, sections.segment) || !exactJson(golden.legacy, sections.legacy)) {
    if (process.argv.includes('--refresh-golden')) {
      golden.segment = sections.segment
      golden.legacy = sections.legacy
      writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')
      return 'refreshed'
    }
    throw new Error('[m5b-step3-fixture] frozen golden vector differs from derived bytes')
  }
  return 'verified'
}

function step2DirectFingerprints(active, step2) {
  const removed = new Set(step2.removed_source.map((entry) => entry.fingerprint))
  return new Set([
    ...active.direct_callsites.filter((entry) => !removed.has(entry.fingerprint)).map((entry) => entry.fingerprint),
    ...step2.added_target.map((entry) => entry.fingerprint)
  ])
}

function updateSourceDelta() {
  const { active } = loadM5aInventoryDocuments(projectRoot)
  const step2 = JSON.parse(readFileSync(step2Path, 'utf8'))
  if (step2.step !== 'M5B-2' || step2.source_digest !== M5B_SOURCE_DIGEST) {
    throw new Error('[m5b-step3-fixture] source is not the accepted M5B-2 delta')
  }
  const scan = scanM5bCheckout(projectRoot)
  const sourceFingerprints = step2DirectFingerprints(active, step2)
  const targetFingerprints = new Set(scan.direct_callsites.map((entry) => entry.fingerprint))
  const removed = [...sourceFingerprints].filter((fingerprint) => !targetFingerprints.has(fingerprint))
  const added = scan.direct_callsites.filter((entry) => !sourceFingerprints.has(entry.fingerprint))
  const fileCounts = Object.fromEntries(added.map((entry) => entry.file).map((file) => [
    file,
    added.filter((entry) => entry.file === file).length
  ]))
  const exact = removed.length === 0
    && added.length === 18
    && fileCounts['src/main/domain/event-batch/file-capability.ts'] === 17
    && fileCounts['src/main/domain/event-batch/legacy-reader.ts'] === 1
    && Object.keys(fileCounts).length === 2
    && scan.channels.length === 74
    && scan.direct_callsites.length === 236
    && scan.direct_files.length === 31
    && scan.capability_callsites.length === 72
    && scan.delegating_roots.length === 13
  if (!exact) throw new Error('[m5b-step3-fixture] checkout does not match the reviewed M5B-3 source delta')

  const fixture = {
    schema_version: 'm5b-step-source-delta-v1',
    step: 'M5B-3',
    source_digest: step2.target_digest,
    target_digest: scan.digest,
    expected_counts: {
      channels: scan.channels.length,
      direct_callsites: scan.direct_callsites.length,
      direct_files: scan.direct_files.length,
      capability_callsites: scan.capability_callsites.length,
      delegating_roots: scan.delegating_roots.length
    },
    removed_source: [],
    added_target: added.map((entry) => ({
      fingerprint: entry.fingerprint,
      file: entry.file,
      symbol: entry.symbol,
      line: entry.line,
      kind: entry.kind,
      callee: entry.callee,
      occurrence: entry.occurrence,
      target_class: entry.file.endsWith('/legacy-reader.ts')
        ? 'LEGACY_REPAIR_INTERNAL'
        : 'EVENT_BATCH_FILE_CAPABILITY_INTERNAL',
      planned_step: 'M5B-3'
    }))
  }
  if (existsSync(deltaPath)) {
    const frozen = JSON.parse(readFileSync(deltaPath, 'utf8'))
    if (!exactJson(frozen, fixture)) {
      if (process.argv.includes('--refresh-source-delta')) {
        writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        return { status: 'refreshed', fixture }
      }
      throw new Error('[m5b-step3-fixture] frozen source delta differs from checkout')
    }
    return { status: 'verified', fixture }
  }
  writeFileSync(deltaPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  return { status: 'populated', fixture }
}

const goldenStatus = updateGolden()
const delta = updateSourceDelta()
console.log(`[m5b-step3-fixture] golden=${goldenStatus}, source_delta=${delta.status}`)
console.log(`[m5b-step3-fixture] digest=${delta.fixture.target_digest}, added=${delta.fixture.added_target.length}`)
