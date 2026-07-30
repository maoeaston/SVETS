import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  validateTransportMetadataV1
} from '../../../../shared/types/command-transport'
import {
  assertNoTrustedEnvelopeOverrides,
  buildCommandEnvelopeV2
} from '../command-envelope'
import {
  createCommandResultJson,
  parseCommandResultJson
} from '../command-result'

const COMMAND_ID = '10000000-0000-4000-8000-000000000001'
const BATCH_ID = '20000000-0000-4000-8000-000000000001'
const CLIENT_ID = '30000000-0000-4000-8000-000000000001'
const KEY = '40000000-0000-4000-8000-000000000001'

function params() {
  return {
    commandId: COMMAND_ID,
    commandType: 'test:mutate',
    source: 'IPC' as const,
    actor: {
      kind: 'USER' as const,
      userId: 'teacher-1',
      role: 'TEACHER' as const,
      authSessionId: 'auth-1'
    },
    target: { z: 2, a: 1 },
    payload: { value: 'safe' },
    requestHash: 'a'.repeat(64),
    createdAt: '2026-07-29T12:00:00.000Z',
    clientInstanceId: CLIENT_ID,
    idempotencyKey: KEY,
    eventBatchId: BATCH_ID,
    actorId: 'teacher-1',
    deviceId: 'device-1',
    authSessionId: 'auth-1',
    leaseOwner: 'worker-1',
    leaseGeneration: 2
  }
}

describe('M5B transport metadata and CommandEnvelopeV2', () => {
  it('accepts only the exact trusted second-argument metadata shape', () => {
    expect(validateTransportMetadataV1({
      schemaVersion: 1,
      clientInstanceId: CLIENT_ID,
      idempotencyKey: KEY,
      deviceId: 'device-1'
    })).toEqual({
      schemaVersion: 1,
      clientInstanceId: CLIENT_ID,
      idempotencyKey: KEY,
      deviceId: 'device-1'
    })
    for (const invalid of [
      { schemaVersion: 1, clientInstanceId: CLIENT_ID, idempotencyKey: KEY },
      { schemaVersion: 2, clientInstanceId: CLIENT_ID, idempotencyKey: KEY, deviceId: 'device-1' },
      { schemaVersion: 1, clientInstanceId: 'renderer-choice', idempotencyKey: KEY, deviceId: 'device-1' },
      { schemaVersion: 1, clientInstanceId: CLIENT_ID, idempotencyKey: KEY, deviceId: 'device-1', workerId: 'forged' }
    ]) expect(() => validateTransportMetadataV1(invalid)).toThrow()
  })

  it('rejects transport/durable fields in business payload and keeps the type outside renderer IpcApi', () => {
    for (const field of [
      'clientInstanceId', 'idempotencyKey', 'deviceId', 'authSessionId',
      'eventBatchId', 'leaseGeneration', 'workerId', 'transportMetadata'
    ]) {
      expect(() => assertNoTrustedEnvelopeOverrides({ [field]: 'forged' }))
        .toThrow(`renderer input cannot override trusted envelope field ${field}`)
    }
    const ipcApi = readFileSync('src/shared/types/ipc-api.ts', 'utf8')
    expect(ipcApi).not.toContain('command-transport')
    expect(ipcApi).not.toContain('TransportMetadataV1')
  })

  it('builds v2 only from durable identity and fixes root correlation to command ID', () => {
    const envelope = buildCommandEnvelopeV2(params())
    expect(envelope).toEqual({
      envelopeVersion: 'v2',
      commandId: COMMAND_ID,
      commandType: 'test:mutate',
      source: 'IPC',
      actor: { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' },
      target: { a: 1, z: 2 },
      payload: { value: 'safe' },
      requestHash: 'a'.repeat(64),
      createdAt: '2026-07-29T12:00:00.000Z',
      correlationId: COMMAND_ID,
      clientInstanceId: CLIENT_ID,
      idempotencyKey: KEY,
      eventBatchId: BATCH_ID,
      actorId: 'teacher-1',
      deviceId: 'device-1',
      authSessionId: 'auth-1',
      leaseOwner: 'worker-1',
      leaseGeneration: 2
    })
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.target)).toBe(true)
  })

  it('rejects actor/session drift, non-durable IDs, invalid generation, and parent correlation', () => {
    expect(() => buildCommandEnvelopeV2({ ...params(), actorId: 'teacher-2' })).toThrow(/actor identity/)
    expect(() => buildCommandEnvelopeV2({ ...params(), authSessionId: 'auth-2' })).toThrow(/actor identity/)
    expect(() => buildCommandEnvelopeV2({ ...params(), commandId: 'temporary-id' })).toThrow(/UUID v4/)
    expect(() => buildCommandEnvelopeV2({ ...params(), leaseGeneration: 0 })).toThrow(/positive safe integer/)
    expect(() => buildCommandEnvelopeV2({ ...params(), parentCorrelationId: COMMAND_ID })).toThrow(/root durable/)
  })

  it('stores deterministic success:false in an exact canonical result envelope', () => {
    const json = createCommandResultJson({ errorCode: 'NOT_ALLOWED', success: false })
    expect(json).toBe('{"public_result":{"errorCode":"NOT_ALLOWED","success":false},"schema_version":"command-result-v1"}')
    expect(parseCommandResultJson(json)).toEqual({
      schema_version: 'command-result-v1',
      public_result: { errorCode: 'NOT_ALLOWED', success: false }
    })
    expect(() => parseCommandResultJson(`${json}\n`)).toThrow(/without LF/)
    expect(() => parseCommandResultJson('{"schema_version":"command-result-v1","public_result":{"success":true}}'))
      .toThrow(/canonical/)
    expect(() => createCommandResultJson({ success: true, password: 'secret' })).toThrow(/sensitive field/)
    expect(() => createCommandResultJson({ success: true, nested: { accessToken: 'secret' } })).toThrow(/sensitive field/)
    expect(() => createCommandResultJson({ success: true, passwordHash: 'cheap-hash' })).toThrow(/sensitive field/)
    expect(() => createCommandResultJson({ errorCode: 'MISSING_SUCCESS' })).toThrow(/success/)
  })

  it('returns a canonical deep-frozen result without freezing caller-owned input', () => {
    const callerOwned = { success: true, nested: { values: ['safe'] } }
    const parsed = parseCommandResultJson(createCommandResultJson(callerOwned))
    expect(Object.isFrozen(callerOwned)).toBe(false)
    expect(Object.isFrozen(callerOwned.nested)).toBe(false)
    expect(Object.isFrozen(parsed.public_result)).toBe(true)
    expect(Object.isFrozen(parsed.public_result.nested)).toBe(true)
    expect(Object.isFrozen((parsed.public_result.nested as { values: string[] }).values)).toBe(true)
  })
})
