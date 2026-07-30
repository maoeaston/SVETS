import { describe, expect, it } from 'vitest'
import { CanonicalJsonError } from '../../../domain/report-canonical'
import {
  assertNoTrustedEnvelopeOverrides,
  createCommandEnvelopeFactory
} from '../command-envelope'

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000'
const PARENT_ID = '223e4567-e89b-42d3-a456-426614174001'
const NOW = new Date('2026-07-29T01:02:03.456Z')

function factory(uuid = COMMAND_ID) {
  return createCommandEnvelopeFactory({ uuid: () => uuid, now: () => NOW })
}

describe('CommandEnvelope', () => {
  it('生成 Main-owned UUID/UTC/correlation，并命中 PRD 固定 request hash', () => {
    const envelope = factory()({
      commandType: 'student.read',
      source: 'IPC',
      actor: { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' },
      target: { aggregate_type: 'STUDENT', aggregate_id: 'student-1' },
      payload: { action: 'list' }
    })

    expect(envelope).toEqual({
      commandId: COMMAND_ID,
      commandType: 'student.read',
      source: 'IPC',
      actor: { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' },
      target: { aggregate_id: 'student-1', aggregate_type: 'STUDENT' },
      payload: { action: 'list' },
      requestHash: 'df1470b5705db8c57362264c5ad9626f83b95ce732ede593b17ac60b61cd933c',
      createdAt: '2026-07-29T01:02:03.456Z',
      correlationId: COMMAND_ID
    })
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(Object.isFrozen(envelope.actor)).toBe(true)
    expect(Object.isFrozen(envelope.target)).toBe(true)
    expect(Object.isFrozen(envelope.payload)).toBe(true)
  })

  it('对象 key 插入顺序不影响 hash，数组顺序仍有影响', () => {
    const build = factory()
    const left = build({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: { z: 1, a: { y: 2, x: 3 } },
      payload: { items: ['a', 'b'], enabled: true }
    })
    const reordered = build({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: { a: { x: 3, y: 2 }, z: 1 },
      payload: { enabled: true, items: ['a', 'b'] }
    })
    const reversedArray = build({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: { a: { x: 3, y: 2 }, z: 1 },
      payload: { enabled: true, items: ['b', 'a'] }
    })

    expect(reordered.requestHash).toBe(left.requestHash)
    expect(reversedArray.requestHash).not.toBe(left.requestHash)
  })

  it('只有 INTERNAL child 可以继承父 correlation，child command id 仍独立', () => {
    const envelope = factory()({
      commandType: 'internal.child',
      source: 'INTERNAL',
      actor: { kind: 'SYSTEM', phase: 'RUNTIME_ACCEPTED_CHILD' },
      target: { aggregate_id: 'student-1' },
      payload: {},
      parentCorrelationId: PARENT_ID
    })
    expect(envelope.commandId).toBe(COMMAND_ID)
    expect(envelope.correlationId).toBe(PARENT_ID)

    expect(() => factory()({
      commandType: 'ipc.child',
      source: 'IPC',
      actor: { kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' },
      target: { aggregate_id: 'student-1' },
      payload: {},
      parentCorrelationId: PARENT_ID
    })).toThrow('only INTERNAL child commands may inherit correlationId')
  })

  it('拒绝 renderer 覆盖可信 envelope 字段，但保留现有 caller 兼容输入给 adapter 比对', () => {
    for (const field of ['commandId', 'command_id', 'source', 'actor', 'target', 'createdAt', 'correlationId', 'requestHash']) {
      expect(() => assertNoTrustedEnvelopeOverrides({ [field]: 'forged' })).toThrow(`renderer input cannot override trusted envelope field ${field}`)
    }
    expect(() => assertNoTrustedEnvelopeOverrides({ callerUserId: 'legacy-caller', callerRole: 'TEACHER' })).not.toThrow()
  })

  it('拒绝 canonical payload 中的 caller/actor 权限声明', () => {
    for (const payload of [{ callerUserId: 'forged' }, { callerRole: 'ADMIN' }, { actor: { kind: 'SYSTEM' } }]) {
      expect(() => factory()({
        commandType: 'example.command',
        source: 'IPC',
        actor: { kind: 'UNAUTHENTICATED' },
        target: { aggregate_id: 'student-1' },
        payload
      })).toThrow('canonical payload cannot contain trusted actor field')
    }
  })

  it('复用 canonical 校验，拒绝非有限数字、非普通对象与循环引用', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    class CustomTarget {
      aggregate_id = 'student-1'
    }

    for (const payload of [{ score: Number.NaN }, { score: Number.POSITIVE_INFINITY }, cyclic]) {
      expect(() => factory()({
        commandType: 'example.command',
        source: 'IPC',
        actor: { kind: 'UNAUTHENTICATED' },
        target: { aggregate_id: 'student-1' },
        payload
      })).toThrow(CanonicalJsonError)
    }
    expect(() => factory()({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: new CustomTarget() as unknown as Record<string, unknown>,
      payload: {}
    })).toThrow(CanonicalJsonError)
  })

  it('拒绝非法 UUID、actor 和非毫秒 UTC 时间', () => {
    expect(() => factory('not-a-uuid')({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: { aggregate_id: 'student-1' },
      payload: {}
    })).toThrow('commandId must be a UUID v4')

    const invalidClock = createCommandEnvelopeFactory({
      uuid: () => COMMAND_ID,
      now: () => ({ toISOString: () => '2026-07-29T01:02:03Z' }) as Date
    })
    expect(() => invalidClock({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'UNAUTHENTICATED' },
      target: { aggregate_id: 'student-1' },
      payload: {}
    })).toThrow('createdAt must be UTC RFC3339 with milliseconds')

    expect(() => factory()({
      commandType: 'example.command',
      source: 'IPC',
      actor: { kind: 'SYSTEM', phase: ' ' },
      target: { aggregate_id: 'student-1' },
      payload: {}
    })).toThrow('actor.phase must be non-empty')
  })
})
