import { describe, expect, it, vi } from 'vitest'
import { createCommandEnvelopeFactory } from '../command-envelope'
import { CommandBus } from '../command-bus'
import { CommandObservability } from '../command-observability'
import { CommandRegistry } from '../command-registry'
import { createPreflightErrorMap } from '../public-error-contract'
import {
  CommandPreflightError,
  type CommandActor,
  type CommandActorPolicy,
  type CommandEnvelope,
  type CommandExecutionMode,
  type PreflightErrorDetailMap,
  type CommandSource,
  type CommandTraceRecord,
  type MutationCommandDefinition
} from '../command-types'

type TestErrorCode = 'SYSTEM_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
type TestResult =
  | { success: true; value: string }
  | { success: false; errorCode: TestErrorCode }
type TestInput = {
  studentId: string
  value?: string
  password?: string
  note?: string
  callerUserId?: string
  callerRole?: string
}

const USER_ACTOR: CommandActor = {
  kind: 'USER',
  userId: 'teacher-1',
  role: 'TEACHER',
  authSessionId: 'auth-session-1'
}

function uuidFactory() {
  let counter = 0
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

type DefinitionOptions = {
  commandType?: string
  executionMode?: CommandExecutionMode
  allowedSources?: readonly CommandSource[]
  actorPolicy?: CommandActorPolicy
  validateStructure?: (rawInput: TestInput) => TestInput
  resolveActor?: () => CommandActor | Promise<CommandActor>
  resolveTarget?: (input: TestInput) => Record<string, unknown> | Promise<Record<string, unknown>>
  canonicalPayload?: (input: TestInput) => Record<string, unknown>
  concurrencyKey?: (envelope: CommandEnvelope) => string
  preflightErrorDetailMap?: PreflightErrorDetailMap<TestErrorCode>
  execute?: MutationCommandDefinition<TestInput, TestInput, TestResult, TestErrorCode>['execute']
  mapUnexpectedExecutionError?: MutationCommandDefinition<TestInput, TestInput, TestResult, TestErrorCode>['mapUnexpectedExecutionError']
}

function definition(options: DefinitionOptions = {}): MutationCommandDefinition<TestInput, TestInput, TestResult, TestErrorCode> {
  return {
    commandType: options.commandType ?? 'test:mutate',
    metadata: {
      mode: 'MUTATION',
      executionMode: options.executionMode ?? 'SYNC',
      allowedSources: options.allowedSources ?? ['IPC'],
      actorPolicy: options.actorPolicy ?? { kind: 'ACTIVE_USER', roles: ['TEACHER'] },
      targetResolver: {
        owner: 'command-bus.test.resolveTarget',
        kind: 'EXISTING_AGGREGATE',
        locatorFields: ['studentId'],
        authoritativeFields: ['student_profile.student_id'],
        canonicalTargetFields: ['student_id'],
        clientHintFields: [],
        notFoundMapping: 'NOT_FOUND',
        mismatchMapping: 'VALIDATION_ERROR',
        testReferences: ['command-bus.test.ts']
      },
      payloadContract: 'test-command-v1',
      sideEffects: ['TEST_WRITE_SPY'],
      phase: 'RUNTIME_ACCEPTED',
      transactionOwner: 'command-bus.test.execute',
      retryPolicy: 'NO_AUTO_RETRY',
      durableCommand: {
        requestHash: {
          schemaVersion: 'command-request-hash-v1',
          secretFields: [],
          secretIdentityFields: []
        },
        resultSchemaVersion: 'command-result-v1',
        resultRecipeVersion: 'test.result.v1',
        prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
        maxAttempts: 3
      },
      concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'student_id' },
      publicErrorCodes: ['SYSTEM_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR'],
      preflightErrorMap: createPreflightErrorMap<TestErrorCode>('SYSTEM_ERROR', {
        INVALID_ACTOR: 'FORBIDDEN',
        TARGET_NOT_FOUND: 'NOT_FOUND',
        TARGET_MISMATCH: 'VALIDATION_ERROR'
      }),
      preflightErrorDetailMap: options.preflightErrorDetailMap,
      testReferences: ['command-bus.test.ts']
    },
    validateStructure: options.validateStructure ?? ((rawInput) => rawInput),
    resolveActor: options.resolveActor ?? (() => USER_ACTOR),
    normalizeBusinessInput: (_context, _actor, input) => input,
    resolveTarget: (_context, _actor, input) => options.resolveTarget?.(input) ?? { student_id: input.studentId },
    canonicalPayload: (_context, _actor, _target, input) => options.canonicalPayload?.(input) ?? { value: input.value ?? null },
    concurrencyKey: options.concurrencyKey ?? ((envelope) => String(envelope.target.student_id)),
    execute: options.execute ?? (() => ({ success: true, value: 'done' })),
    mapUnexpectedExecutionError: options.mapUnexpectedExecutionError ?? (() => ({ success: false, errorCode: 'SYSTEM_ERROR' }))
  }
}

function createBus(commandDefinition: ReturnType<typeof definition>, options: {
  trace?: CommandTraceRecord[]
  throwFromTrace?: boolean
  open?: boolean
} = {}) {
  const registry = new CommandRegistry().registerMutation(commandDefinition).seal([commandDefinition.commandType])
  const envelopeFactory = createCommandEnvelopeFactory({
    uuid: uuidFactory(),
    now: () => new Date('2026-07-29T01:02:03.456Z')
  })
  const observability = new CommandObservability({
    emit: (record) => {
      if (options.throwFromTrace) throw new Error('trace sink unavailable')
      options.trace?.push(record)
    }
  }, () => 100)
  const bus = new CommandBus({ registry, envelopeFactory, observability })
  if (options.open !== false) bus.open()
  return bus
}

function request(input: TestInput, source: CommandSource = 'IPC') {
  return {
    commandType: 'test:mutate',
    rawInput: input,
    transport: { source, transportId: 'renderer-1' }
  } as const
}

describe('CommandBus', () => {
  it('按固定 preflight 顺序同步 dispatch，只有 execute 收到 accepted context', () => {
    const order: string[] = []
    const writeSpy = vi.fn(() => undefined)
    const command = definition({
      validateStructure: (input) => { order.push('validate'); return input },
      resolveActor: () => { order.push('actor'); return USER_ACTOR },
      resolveTarget: (input) => { order.push('target'); return { student_id: input.studentId } },
      canonicalPayload: (input) => { order.push('payload'); return { value: input.value ?? null } },
      concurrencyKey: (envelope) => { order.push('key'); return String(envelope.target.student_id) },
      execute: (context) => {
        order.push('execute')
        writeSpy()
        expect(Object.isFrozen(context)).toBe(true)
        expect(Object.isFrozen(context.envelope)).toBe(true)
        return { success: true, value: 'written' }
      }
    })
    const outcome = createBus(command).dispatchSync<TestInput, TestResult, TestErrorCode>(
      request({ studentId: 'student-1', value: 'ok' })
    )

    expect(outcome.status).toBe('COMPLETED')
    expect(outcome.status === 'COMPLETED' && outcome.result).toEqual({ success: true, value: 'written' })
    expect(order).toEqual(['validate', 'actor', 'target', 'payload', 'key', 'execute'])
    expect(writeSpy).toHaveBeenCalledTimes(1)
  })

  it('unknown、not-ready、invalid payload/actor/target 均返回 typed failure 且零 execute side effect', async () => {
    const execute = vi.fn((): TestResult => ({ success: true, value: 'unexpected' }))
    const closedBus = createBus(definition({ execute }), { open: false })
    expect(closedBus.dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))).toEqual({
      status: 'REJECTED',
      reason: 'BOUNDARY_NOT_READY',
      publicError: { success: false, errorCode: 'SYSTEM_ERROR' }
    })

    const unknown = await closedBus.dispatch<TestInput, TestResult, TestErrorCode>({
      ...request({ studentId: 'student-1' }),
      commandType: 'unknown:command'
    })
    expect(unknown).toEqual({
      status: 'REJECTED',
      reason: 'UNKNOWN_COMMAND',
      publicError: { success: false, errorCode: 'SYSTEM_ERROR' }
    })

    const invalidPayload = createBus(definition({
      validateStructure: () => { throw new Error('contains-sensitive-input') },
      execute
    })).dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(invalidPayload).toMatchObject({ status: 'REJECTED', reason: 'INVALID_PAYLOAD', publicError: { errorCode: 'SYSTEM_ERROR' } })

    const invalidActor = createBus(definition({
      resolveActor: () => ({ kind: 'USER', userId: 'student-1', role: 'STUDENT', authSessionId: 'auth-2' }),
      execute
    })).dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(invalidActor).toMatchObject({ status: 'REJECTED', reason: 'INVALID_ACTOR', publicError: { errorCode: 'FORBIDDEN' } })

    const missingTarget = createBus(definition({
      resolveTarget: () => { throw new CommandPreflightError('TARGET_NOT_FOUND') },
      execute
    })).dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'missing' }))
    expect(missingTarget).toMatchObject({ status: 'REJECTED', reason: 'TARGET_NOT_FOUND', publicError: { errorCode: 'NOT_FOUND' } })
    expect(execute).not.toHaveBeenCalled()
  })

  it('拒绝 forged trusted fields，target mismatch 发生在 envelope/hash/guard 之前', () => {
    const uuid = vi.fn(uuidFactory())
    const registry = new CommandRegistry().registerMutation(definition({
      resolveTarget: () => { throw new CommandPreflightError('TARGET_MISMATCH') }
    })).seal()
    const bus = new CommandBus({
      registry,
      envelopeFactory: createCommandEnvelopeFactory({ uuid, now: () => new Date('2026-07-29T01:02:03.456Z') })
    })
    bus.open()

    const forged = bus.dispatchSync<TestInput & { commandId: string }, TestResult, TestErrorCode>({
      commandType: 'test:mutate',
      rawInput: { studentId: 'student-1', commandId: 'renderer-forged' },
      transport: { source: 'IPC', transportId: 'renderer-1' }
    })
    expect(forged).toMatchObject({ status: 'REJECTED', reason: 'INVALID_PAYLOAD' })
    expect(uuid).not.toHaveBeenCalled()

    const mismatch = bus.dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(mismatch).toMatchObject({ status: 'REJECTED', reason: 'TARGET_MISMATCH', publicError: { errorCode: 'VALIDATION_ERROR' } })
    expect(uuid).not.toHaveBeenCalled()
    expect(bus.activeKeyGuard.size()).toBe(0)
  })

  it('用 registry 冻结的安全细节映射保持既有 public error code', () => {
    const execute = vi.fn((): TestResult => ({ success: true, value: 'unexpected' }))
    const command = definition({
      preflightErrorDetailMap: {
        TARGET_MISMATCH: { studentId: 'NOT_FOUND' }
      },
      resolveTarget: () => {
        throw new CommandPreflightError('TARGET_MISMATCH', 'studentId')
      },
      execute
    })

    const outcome = createBus(command).dispatchSync<TestInput, TestResult, TestErrorCode>(
      request({ studentId: 'mismatched' })
    )

    expect(outcome).toEqual({
      status: 'REJECTED',
      reason: 'TARGET_MISMATCH',
      publicError: { success: false, errorCode: 'NOT_FOUND' }
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('同 key async mutation 在写前 fail-fast，不同 key 可并行，guard 最终释放', async () => {
    const releases = new Map<string, ReturnType<typeof deferred<TestResult>>>()
    const started: string[] = []
    const command = definition({
      executionMode: 'ASYNC',
      execute: (context) => {
        const key = String(context.envelope.target.student_id)
        started.push(key)
        const gate = deferred<TestResult>()
        releases.set(key, gate)
        return gate.promise
      }
    })
    const bus = createBus(command)

    const first = bus.dispatch<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    while (!releases.has('student-1')) await Promise.resolve()
    const conflict = await bus.dispatch<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(conflict).toEqual({
      status: 'REJECTED',
      reason: 'ACTIVE_KEY_CONFLICT',
      publicError: { success: false, errorCode: 'SYSTEM_ERROR' }
    })

    const other = bus.dispatch<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-2' }))
    while (!releases.has('student-2')) await Promise.resolve()
    expect(started).toEqual(['student-1', 'student-2'])
    expect(bus.activeKeyGuard.size()).toBe(2)

    releases.get('student-1')?.resolve({ success: true, value: 'first' })
    releases.get('student-2')?.resolve({ success: true, value: 'other' })
    expect((await first).status).toBe('COMPLETED')
    expect((await other).status).toBe('COMPLETED')
    expect(bus.activeKeyGuard.size()).toBe(0)
  })

  it('execution throw 映射为既有结果并在 finally 释放 key', () => {
    const bus = createBus(definition({
      execute: () => { throw new Error('database contained private detail') }
    }))
    const outcome = bus.dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(outcome.status).toBe('EXECUTION_FAILED')
    expect(outcome.status === 'EXECUTION_FAILED' && outcome.result).toEqual({ success: false, errorCode: 'SYSTEM_ERROR' })
    expect(bus.activeKeyGuard.size()).toBe(0)

    const brokenMapperBus = createBus(definition({
      execute: () => { throw new Error('execution failed') },
      mapUnexpectedExecutionError: () => { throw new Error('mapper failed') }
    }))
    expect(() => brokenMapperBus.dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-2' })))
      .toThrow('mapper failed')
    expect(brokenMapperBus.activeKeyGuard.size()).toBe(0)
  })

  it('actor policy 分离 ACTIVE USER、BOOTSTRAP 与 SYSTEM phase', () => {
    const bootstrap = createBus(definition({
      actorPolicy: { kind: 'BOOTSTRAP' },
      resolveActor: () => ({ kind: 'UNAUTHENTICATED' })
    })).dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'AUTH_LOGIN' }))
    expect(bootstrap.status).toBe('COMPLETED')

    const systemCommand = definition({
      allowedSources: ['INTERNAL'],
      actorPolicy: { kind: 'SYSTEM', phases: ['AUTH_SESSION_SWEEP'] },
      resolveActor: () => ({ kind: 'SYSTEM', phase: 'AUTH_SESSION_SWEEP' })
    })
    const system = createBus(systemCommand).dispatchSync<TestInput, TestResult, TestErrorCode>(
      request({ studentId: 'SYSTEM' }, 'INTERNAL')
    )
    expect(system.status).toBe('COMPLETED')

    const wrongPhase = createBus(definition({
      allowedSources: ['INTERNAL'],
      actorPolicy: { kind: 'SYSTEM', phases: ['AUTH_SESSION_SWEEP'] },
      resolveActor: () => ({ kind: 'SYSTEM', phase: 'RENDERER_PAYLOAD' })
    })).dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'SYSTEM' }, 'INTERNAL'))
    expect(wrongPhase).toMatchObject({ status: 'REJECTED', reason: 'INVALID_ACTOR' })
  })

  it('INTERNAL child 继承 correlation；IPC source mismatch 与 sync/async mismatch 失败关闭', () => {
    const parent = '123e4567-e89b-42d3-a456-426614174000'
    const internalDefinition = definition({
      allowedSources: ['INTERNAL'],
      actorPolicy: { kind: 'SYSTEM', phases: ['CHILD'] },
      resolveActor: () => ({ kind: 'SYSTEM', phase: 'CHILD' })
    })
    const internalBus = createBus(internalDefinition)
    const child = internalBus.dispatchSync<TestInput, TestResult, TestErrorCode>({
      commandType: 'test:mutate',
      rawInput: { studentId: 'student-1' },
      transport: { source: 'INTERNAL', transportId: 'runtime', parentCorrelationId: parent }
    })
    expect(child.status === 'COMPLETED' && child.envelope.correlationId).toBe(parent)
    expect(child.status === 'COMPLETED' && child.envelope.commandId).not.toBe(parent)

    const sourceMismatch = internalBus.dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(sourceMismatch).toMatchObject({ status: 'REJECTED', reason: 'SOURCE_NOT_ALLOWED' })

    const asyncViaSync = createBus(definition({ executionMode: 'ASYNC' }))
      .dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(asyncViaSync).toMatchObject({ status: 'REJECTED', reason: 'INTERNAL_PREFLIGHT_FAILURE' })
  })

  it('trace 只含稳定摘要，不泄露 password/note/full payload；sink 失败不改变命令结果', () => {
    const trace: CommandTraceRecord[] = []
    const command = definition({
      canonicalPayload: (input) => ({ password: input.password, note: input.note })
    })
    const outcome = createBus(command, { trace }).dispatchSync<TestInput, TestResult, TestErrorCode>(request({
      studentId: 'student-sensitive',
      password: 'Secret@123',
      note: '学生敏感观察全文'
    }))
    expect(outcome.status).toBe('COMPLETED')
    const serialized = JSON.stringify(trace)
    expect(serialized).not.toContain('Secret@123')
    expect(serialized).not.toContain('学生敏感观察全文')
    expect(serialized).not.toContain('student-sensitive')
    expect(trace.map((record) => record.phase)).toEqual(['ACCEPTED', 'COMPLETED'])

    const withBrokenSink = createBus(definition(), { throwFromTrace: true })
      .dispatchSync<TestInput, TestResult, TestErrorCode>(request({ studentId: 'student-1' }))
    expect(withBrokenSink.status).toBe('COMPLETED')
  })
})
