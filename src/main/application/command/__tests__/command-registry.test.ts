import { describe, expect, it } from 'vitest'
import { CommandRegistry } from '../command-registry'
import {
  PUBLIC_ERROR_FAMILY_DEFAULT,
  createPreflightErrorMap
} from '../public-error-contract'
import type {
  CommandDefinitionMetadata,
  MutationCommandDefinition,
  ReadCommandDefinition
} from '../command-types'

type TestErrorCode = 'SYSTEM_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
type TestResult = { success: true } | { success: false; errorCode: TestErrorCode }

function metadata(mode: 'READ' | 'MUTATION'): CommandDefinitionMetadata<TestErrorCode> {
  return {
    mode,
    executionMode: 'SYNC',
    allowedSources: ['IPC'],
    actorPolicy: { kind: 'ACTIVE_USER', roles: ['TEACHER'] },
    targetResolver: {
      owner: 'tests.resolveTarget',
      kind: 'EXISTING_AGGREGATE',
      locatorFields: ['studentId'],
      authoritativeFields: ['student_profile.student_id'],
      canonicalTargetFields: ['student_id'],
      clientHintFields: [],
      notFoundMapping: 'NOT_FOUND',
      mismatchMapping: 'VALIDATION_ERROR',
      testReferences: ['command-registry.test.ts']
    },
    payloadContract: 'test-payload-v1',
    sideEffects: mode === 'MUTATION' ? ['TEST_SPY'] : [],
    phase: mode === 'MUTATION' ? 'RUNTIME_ACCEPTED' : 'RUNTIME_READ',
    transactionOwner: mode === 'MUTATION' ? 'tests.execute' : 'NONE',
    retryPolicy: 'NO_AUTO_RETRY',
    durableCommand: mode === 'MUTATION' ? {
      requestHash: {
        schemaVersion: 'command-request-hash-v1',
        secretFields: [],
        secretIdentityFields: []
      },
      resultSchemaVersion: 'command-result-v1',
      resultRecipeVersion: 'test.result.v1',
      prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
      maxAttempts: 3
    } : undefined,
    concurrencyPolicy: mode === 'MUTATION'
      ? { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'tests.key' }
      : { kind: 'NONE_READ_ONLY' },
    publicErrorCodes: ['SYSTEM_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR'],
    preflightErrorMap: createPreflightErrorMap<TestErrorCode>('SYSTEM_ERROR', {
      INVALID_ACTOR: 'FORBIDDEN',
      TARGET_NOT_FOUND: 'NOT_FOUND',
      TARGET_MISMATCH: 'VALIDATION_ERROR'
    }),
    preflightErrorDetailMap: {
      TARGET_MISMATCH: { studentId: 'VALIDATION_ERROR' }
    },
    testReferences: ['command-registry.test.ts']
  }
}

function mutation(commandType = 'test:mutate'): MutationCommandDefinition<{ studentId: string }, { studentId: string }, TestResult, TestErrorCode> {
  return {
    commandType,
    metadata: { ...metadata('MUTATION'), mode: 'MUTATION' },
    validateStructure: (rawInput) => rawInput,
    resolveActor: () => ({ kind: 'USER', userId: 'teacher-1', role: 'TEACHER', authSessionId: 'auth-1' }),
    normalizeBusinessInput: (_context, _actor, input) => input,
    resolveTarget: (_context, _actor, input) => ({ student_id: input.studentId }),
    canonicalPayload: () => ({}),
    concurrencyKey: (envelope) => String(envelope.target.student_id),
    execute: () => ({ success: true }),
    mapUnexpectedExecutionError: () => ({ success: false, errorCode: 'SYSTEM_ERROR' })
  }
}

function read(commandType = 'test:read'): ReadCommandDefinition<TestErrorCode> {
  return {
    commandType,
    metadata: { ...metadata('READ'), mode: 'READ' }
  }
}

describe('CommandRegistry', () => {
  it('登记 mutation/read、冻结 metadata，并按 command type 排序', () => {
    const mutationDefinition = mutation('z:mutate')
    const readDefinition = read('a:read')
    const registry = new CommandRegistry()
      .registerMutation(mutationDefinition)
      .registerRead(readDefinition)
      .seal(['a:read', 'z:mutate'])

    expect(registry.isSealed()).toBe(true)
    expect(registry.list().map((item) => item.commandType)).toEqual(['a:read', 'z:mutate'])
    expect(registry.requireMutation('z:mutate')).toBe(mutationDefinition)
    expect(Object.isFrozen(mutationDefinition)).toBe(true)
    expect(Object.isFrozen(mutationDefinition.metadata)).toBe(true)
    expect(Object.isFrozen(mutationDefinition.metadata.targetResolver)).toBe(true)
    expect(Object.isFrozen(mutationDefinition.metadata.preflightErrorDetailMap?.TARGET_MISMATCH)).toBe(true)
  })

  it('拒绝重复、空 command type、seal 后新增和 expected set 漂移', () => {
    const duplicate = new CommandRegistry().registerMutation(mutation())
    expect(() => duplicate.registerMutation(mutation())).toThrow('duplicate command type')
    expect(() => new CommandRegistry().registerMutation(mutation(' '))).toThrow('commandType is required')

    const sealed = new CommandRegistry().registerMutation(mutation()).seal()
    expect(() => sealed.registerRead(read())).toThrow('registry is sealed')

    expect(() => new CommandRegistry().registerMutation(mutation()).seal(['test:mutate', 'missing:command']))
      .toThrow('registry command set mismatch')
  })

  it('拒绝 mutation 缺 resolver/test/error/concurrency/side-effect metadata', () => {
    const cases: Array<[string, (definition: ReturnType<typeof mutation>) => void, string]> = [
      ['resolver', (definition) => {
        (definition.metadata.targetResolver as unknown as { canonicalTargetFields: string[] }).canonicalTargetFields = []
      }, 'canonicalTargetFields'],
      ['tests', (definition) => {
        (definition.metadata as unknown as { testReferences: string[] }).testReferences = []
      }, 'testReferences'],
      ['side effects', (definition) => {
        (definition.metadata as unknown as { sideEffects: string[] }).sideEffects = []
      }, 'sideEffects'],
      ['concurrency', (definition) => {
        (definition.metadata as unknown as { concurrencyPolicy: { kind: 'NONE_READ_ONLY' } }).concurrencyPolicy = { kind: 'NONE_READ_ONLY' }
      }, 'mutation concurrency policy'],
      ['public errors', (definition) => {
        (definition.metadata as unknown as { publicErrorCodes: string[] }).publicErrorCodes = ['FORBIDDEN']
      }, 'preflight_error_map.UNKNOWN_COMMAND'],
      ['detail errors', (definition) => {
        (definition.metadata.preflightErrorDetailMap!.TARGET_MISMATCH as Record<string, string>).studentId = 'UNDECLARED'
      }, 'preflight_error_detail_map.TARGET_MISMATCH.studentId']
    ]

    for (const [, mutateDefinition, expected] of cases) {
      const definition = mutation()
      mutateDefinition(definition)
      expect(() => new CommandRegistry().registerMutation(definition)).toThrow(expected)
    }
  })

  it('拒绝 READ side effect 或 mutation concurrency capability', () => {
    const sideEffectRead = read()
    ;(sideEffectRead.metadata as unknown as { sideEffects: string[] }).sideEffects = ['DB_WRITE']
    expect(() => new CommandRegistry().registerRead(sideEffectRead)).toThrow('READ definition cannot declare side effects')

    const guardedRead = read()
    ;(guardedRead.metadata as unknown as { concurrencyPolicy: { kind: 'FAIL_FAST_ACTIVE_KEY'; keyOwner: string } }).concurrencyPolicy = { kind: 'FAIL_FAST_ACTIVE_KEY', keyOwner: 'bad' }
    expect(() => new CommandRegistry().registerRead(guardedRead)).toThrow('READ definition must use NONE_READ_ONLY concurrency')
  })

  it('public error family defaults 全部来自当前 shared unions，map 覆盖全部 preflight 原因', () => {
    expect(PUBLIC_ERROR_FAMILY_DEFAULT).toEqual({
      AUTH_STUDENT_STRATEGY: 'SYSTEM_ERROR',
      ASSESSMENT_SCORING: 'ASSESSMENT_SYSTEM_ERROR',
      TRAINING: 'TRAINING_SYSTEM_ERROR',
      ASSIGNMENT: 'ASSIGNMENT_SYSTEM_ERROR',
      SAFETY: 'SAFETY_SYSTEM_ERROR',
      REPORT: 'REPORT_SYSTEM_ERROR',
      PREVIEW_FEEDBACK: 'PREVIEW_CONTRACT_MIGRATION_REQUIRED'
    })
    expect(Object.keys(createPreflightErrorMap('SYSTEM_ERROR'))).toEqual([
      'UNKNOWN_COMMAND',
      'BOUNDARY_NOT_READY',
      'SOURCE_NOT_ALLOWED',
      'INVALID_PAYLOAD',
      'INVALID_ACTOR',
      'TARGET_NOT_FOUND',
      'TARGET_MISMATCH',
      'ACTIVE_KEY_CONFLICT',
      'INTERNAL_PREFLIGHT_FAILURE'
    ])
  })

  it('requireMutation 对未知或 READ command 失败关闭', () => {
    const registry = new CommandRegistry().registerRead(read()).seal()
    expect(() => registry.requireMutation('missing')).toThrow('unknown command type')
    expect(() => registry.requireMutation('test:read')).toThrow('command is not a mutation')
  })
})
