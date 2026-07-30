import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { DurableCommandStore } from '../../../application/command/durable-command-store'
import {
  createLegacyAnchor
} from '../legacy-anchor'
import { inspectLegacyLogBytes } from '../legacy-reader'
import {
  MixedDomainReplay,
  MixedDomainReplayError,
  type MixedReplayInfrastructureFixture
} from '../mixed-domain-replay'
import { RuntimeCorruptionState } from '../runtime-corruption'
import { FairWriterMutex } from '../writer-mutex'
import {
  acceptSyntheticCommand,
  coordinator,
  createSyntheticDatabase,
  createSyntheticHarness,
  createSyntheticRegistry,
  rowCount,
  syntheticPlanner,
  syntheticSnapshot
} from './coordinator-test-support'

function legacyLine(): Buffer {
  const payload = { snapshot_id: 'legacy-snapshot-1' }
  const event = {
    event_id: 'legacy-event-1',
    aggregate_type: 'SYSTEM',
    aggregate_id: 'legacy-system-1',
    event_type: 'SNAPSHOT_COMMITTED',
    event_sequence: 1,
    payload,
    checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
    schema_version: 1,
    created_at: '2026-07-29T09:00:00.000Z',
    actor_id: 'SYSTEM:LEGACY',
    actor_role: 'SYSTEM',
    app_version: '1.0.0-alpha.1'
  }
  return Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')
}

describe('M5B legacy plus v2 mixed domain replay', () => {
  it('applies explicit infrastructure, byte-exact legacy groups, then v2 batches in global sequence', async () => {
    const source = await createSyntheticHarness()
    const rebuild = await createSyntheticDatabase()
    try {
      const legacyBytes = legacyLine()
      const legacyFile = source.capability.createExclusive('action_log.jsonl', legacyBytes)
      source.capability.close(legacyFile)
      const anchor = createLegacyAnchor({
        inspection: inspectLegacyLogBytes(legacyBytes),
        sealedAt: '2026-07-29T09:30:00.000Z'
      })

      const command = acceptSyntheticCommand({ harness: source })
      await coordinator({ harness: source }).execute({
        envelope: command.envelope,
        readSnapshot: () => syntheticSnapshot(),
        planner: syntheticPlanner({ command, values: ['v2-one', 'v2-two'] })
      })
      const sourceCommand = source.store.findByCommandId(command.row.commandId)!
      const rebuildStore = new DurableCommandStore(rebuild)
      const fixture: MixedReplayInfrastructureFixture = {
        fixtureId: 'synthetic-infrastructure-v1',
        apply: (database) => {
          expect(rowCount(database, 'domain_event_projection')).toBe(0)
          database.prepare(
            'INSERT INTO synthetic_infrastructure (fixture_id, applied_order) VALUES (?, 1)'
          ).run('synthetic-infrastructure-v1')
          rebuildStore.registerOrLoad({
            commandId: sourceCommand.commandId,
            idempotencyKey: sourceCommand.idempotencyKey,
            clientInstanceId: sourceCommand.clientInstanceId,
            commandType: sourceCommand.commandType,
            actorId: sourceCommand.actorId,
            deviceId: sourceCommand.deviceId,
            authSessionId: sourceCommand.authSessionId,
            requestHash: sourceCommand.requestHash,
            eventBatchId: sourceCommand.eventBatchId,
            createdAt: sourceCommand.createdAt,
            maxAttempts: 3
          })
          database.prepare(
            'UPDATE command_log SET current_lease_generation = ? WHERE command_id = ?'
          ).run(sourceCommand.currentLeaseGeneration, sourceCommand.commandId)
        },
        assertApplied: (database) => {
          expect(database.prepare('SELECT * FROM synthetic_infrastructure').get())
            .toEqual({ fixture_id: 'synthetic-infrastructure-v1', applied_order: 1 })
        }
      }
      const corruption = new RuntimeCorruptionState()
      const result = await new MixedDomainReplay({
        database: rebuild,
        commandStore: rebuildStore,
        registry: createSyntheticRegistry(),
        fileCapability: source.capability,
        legacyAnchor: anchor,
        infrastructureFixture: fixture,
        corruptionState: corruption,
        writerMutex: new FairWriterMutex(),
        now: source.clock.now
      }).run()

      expect(result).toEqual({
        fixtureId: 'synthetic-infrastructure-v1',
        legacyEventCount: 1,
        legacyGroupCount: 1,
        v2BatchCount: 1,
        v2EventCount: 2,
        applicationOrder: ['INFRASTRUCTURE_FIXTURE', 'LEGACY', 'V2'],
        commandHistoryRecovered: false
      })
      expect(corruption.snapshot().state).toBe('OPEN')
      expect(rowCount(rebuild, 'domain_event_projection')).toBe(3)
      expect(rowCount(rebuild, 'processed_event')).toBe(2)
      expect(rowCount(rebuild, 'synthetic_projection')).toBe(2)
      expect(rowCount(rebuild, 'synthetic_effect')).toBe(2)
      expect(rebuild.prepare(
        'SELECT source_log_path, source_log_line_no, source_log_byte_offset FROM domain_event_projection WHERE event_id = ?'
      ).get('legacy-event-1')).toEqual({
        source_log_path: 'action_log.jsonl',
        source_log_line_no: null,
        source_log_byte_offset: null
      })
      expect(rebuildStore.findByCommandId(sourceCommand.commandId)).toMatchObject({
        status: 'PENDING',
        resultJson: null,
        attemptCount: 0
      })
      expect(source.capability.readStable('action_log.jsonl')).toMatchObject({
        byteSize: anchor.byte_length,
        sha256: anchor.sha256
      })
    } finally {
      rebuild.close()
      source.close()
    }
  })

  it('refuses a rebuild without the non-event-sourced infrastructure fixture before any write', async () => {
    const source = await createSyntheticHarness()
    const rebuild = await createSyntheticDatabase()
    try {
      const legacyBytes = legacyLine()
      const legacyFile = source.capability.createExclusive('action_log.jsonl', legacyBytes)
      source.capability.close(legacyFile)
      const anchor = createLegacyAnchor({
        inspection: inspectLegacyLogBytes(legacyBytes),
        sealedAt: '2026-07-29T09:30:00.000Z'
      })
      const corruption = new RuntimeCorruptionState()
      await expect(new MixedDomainReplay({
        database: rebuild,
        commandStore: new DurableCommandStore(rebuild),
        registry: createSyntheticRegistry(),
        fileCapability: source.capability,
        legacyAnchor: anchor,
        infrastructureFixture: null,
        corruptionState: corruption,
        writerMutex: new FairWriterMutex(),
        now: source.clock.now
      }).run()).rejects.toBeInstanceOf(MixedDomainReplayError)
      expect(rowCount(rebuild, 'domain_event_projection')).toBe(0)
      expect(rowCount(rebuild, 'synthetic_infrastructure')).toBe(0)
      expect(corruption.snapshot().state).toBe('OPEN')
    } finally {
      rebuild.close()
      source.close()
    }
  })
})
