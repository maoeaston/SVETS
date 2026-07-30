import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import {
  COMMAND_REQUEST_HASH_SCHEMA_VERSION,
  createCommandRequestHash
} from '../command-request-hash'
import { createM5AMutationDefinitions } from '../m5a-command-definitions'

const PUBLIC_INPUT = {
  username: 'alice',
  password: 'correct horse battery staple'
}

const PASSWORD_CONTRACT = {
  schemaVersion: COMMAND_REQUEST_HASH_SCHEMA_VERSION,
  secretFields: ['password'],
  secretIdentityFields: ['username']
} as const

describe('M5B secret-safe command request hash', () => {
  it('matches the frozen PBKDF2-SHA512 100,000/64-byte request KAT', () => {
    expect(createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: PUBLIC_INPUT,
      contract: PASSWORD_CONTRACT
    })).toBe('9e00e8da5f43d8c101c737da869afc1867d5608429c781ddabaf8b15ec991488')
  })

  it('is canonical across key order and independent of transport metadata or idempotency key', () => {
    const left = createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: { username: 'alice', password: 'correct horse battery staple' },
      contract: PASSWORD_CONTRACT
    })
    const reordered = createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: { password: 'correct horse battery staple', username: 'alice' },
      contract: PASSWORD_CONTRACT
    })
    expect(reordered).toBe(left)
    expect(left).not.toBe(createHash('sha256').update(PUBLIC_INPUT.password).digest('hex'))
    expect(left).not.toContain(PUBLIC_INPUT.password)
  })

  it('domain-separates command, non-secret identity, and secret changes', () => {
    const hash = (commandType: string, username: string, password: string) => createCommandRequestHash({
      commandType,
      normalizedBusinessInput: { username, password },
      contract: PASSWORD_CONTRACT
    })
    const baseline = hash('auth:login', 'alice', 'password-1')
    expect(hash('student:create', 'alice', 'password-1')).not.toBe(baseline)
    expect(hash('auth:login', 'bob', 'password-1')).not.toBe(baseline)
    expect(hash('auth:login', 'alice', 'password-2')).not.toBe(baseline)
  })

  it('rejects missing/non-string secrets and incomplete registry salt declarations', () => {
    expect(() => createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: { username: 'alice' },
      contract: PASSWORD_CONTRACT
    })).toThrow(/declared field is missing/)
    expect(() => createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: { username: 'alice', password: 123 },
      contract: PASSWORD_CONTRACT
    })).toThrow(/secret field/)
    expect(() => createCommandRequestHash({
      commandType: 'auth:login',
      normalizedBusinessInput: PUBLIC_INPUT,
      contract: { ...PASSWORD_CONTRACT, secretIdentityFields: [] }
    })).toThrow(/stable non-secret identity/)
  })

  it('gives all 46 mutation rows explicit result/retry contracts and only three password declarations', () => {
    const definitions = createM5AMutationDefinitions({
      db: {} as DBAdapter,
      eventForTransport: () => ({}) as never,
      handlerForChannel: () => (() => ({ success: true })) as never
    })
    expect(definitions).toHaveLength(46)
    const passwordCommands = definitions
      .filter((definition) => definition.metadata.durableCommand!.requestHash.secretFields.length > 0)
      .map((definition) => definition.commandType)
      .sort()
    expect(passwordCommands).toEqual([
      'auth:createTeacherAccount',
      'auth:login',
      'student:create'
    ])
    for (const definition of definitions) {
      expect(definition.normalizeBusinessInput).toBeTypeOf('function')
      expect(definition.metadata.durableCommand).toMatchObject({
        resultSchemaVersion: 'command-result-v1',
        prePonrRetryPolicy: 'RETRYABLE_SYSTEM_FAILURE',
        maxAttempts: 3
      })
      expect(definition.metadata.durableCommand!.resultRecipeVersion)
        .toBe(`m5b.${definition.commandType}.result.v1`)
    }
  })
})
