import { assertPublicErrorDetailMap, assertPublicErrorMap } from './public-error-contract'
import type {
  AnyCommandDefinition,
  AnyMutationCommandDefinition,
  CommandActorPolicy,
  CommandDefinitionMetadata,
  DurableCommandContract,
  MutationCommandDefinition,
  ReadCommandDefinition
} from './command-types'

function requireNonEmptyString(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
}

function requireNonEmptyStrings(values: readonly string[], field: string): void {
  if (!Array.isArray(values) || !values.length) throw new Error(`${field} must not be empty`)
  const normalized = values.map((value) => {
    requireNonEmptyString(value, field)
    return value
  })
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} must not contain duplicates`)
}

function validateActorPolicy(policy: CommandActorPolicy): void {
  if (policy.kind === 'ACTIVE_USER') requireNonEmptyStrings(policy.roles, 'actorPolicy.roles')
  if (policy.kind === 'SYSTEM') requireNonEmptyStrings(policy.phases, 'actorPolicy.phases')
  if (!['ACTIVE_USER', 'SYSTEM', 'BOOTSTRAP'].includes(policy.kind)) throw new Error('actorPolicy.kind is invalid')
}

function validateDurableCommandContract(contract: DurableCommandContract): void {
  if (contract.requestHash.schemaVersion !== 'command-request-hash-v1') {
    throw new Error('durableCommand.requestHash.schemaVersion is invalid')
  }
  const secretFields = contract.requestHash.secretFields
  const identityFields = contract.requestHash.secretIdentityFields
  if (!Array.isArray(secretFields) || !Array.isArray(identityFields)) {
    throw new Error('durableCommand request hash fields must be arrays')
  }
  const validatePaths = (paths: readonly string[], field: string): void => {
    if (new Set(paths).size !== paths.length) throw new Error(`${field} must not contain duplicates`)
    for (const path of paths) {
      requireNonEmptyString(path, field)
      if (path.split('.').some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part))) {
        throw new Error(`${field} contains an invalid path`)
      }
    }
  }
  validatePaths(secretFields, 'durableCommand.requestHash.secretFields')
  validatePaths(identityFields, 'durableCommand.requestHash.secretIdentityFields')
  if ((secretFields.length === 0) !== (identityFields.length === 0)) {
    throw new Error('durableCommand secret and identity fields must both be empty or non-empty')
  }
  if (secretFields.some((path) => identityFields.includes(path))) {
    throw new Error('durableCommand secret and identity fields must not overlap')
  }
  if (contract.resultSchemaVersion !== 'command-result-v1') {
    throw new Error('durableCommand.resultSchemaVersion is invalid')
  }
  requireNonEmptyString(contract.resultRecipeVersion, 'durableCommand.resultRecipeVersion')
  if (contract.prePonrRetryPolicy !== 'RETRYABLE_SYSTEM_FAILURE' || contract.maxAttempts !== 3) {
    throw new Error('durableCommand retry contract is invalid')
  }
}

function validateMetadata<ErrorCode extends string>(metadata: CommandDefinitionMetadata<ErrorCode>): void {
  if (!['READ', 'MUTATION'].includes(metadata.mode)) throw new Error('metadata.mode is invalid')
  if (!['SYNC', 'ASYNC'].includes(metadata.executionMode)) throw new Error('metadata.executionMode is invalid')
  requireNonEmptyStrings(metadata.allowedSources, 'metadata.allowedSources')
  if (metadata.allowedSources.some((source) => source !== 'IPC' && source !== 'INTERNAL')) throw new Error('metadata.allowedSources contains unsupported source')
  validateActorPolicy(metadata.actorPolicy)

  const resolver = metadata.targetResolver
  requireNonEmptyString(resolver.owner, 'targetResolver.owner')
  if (!['EXISTING_AGGREGATE', 'CREATE_FROM_VALIDATED_REFERENCES', 'ACTOR_SCOPED', 'STATIC_CONTEXT'].includes(resolver.kind)) {
    throw new Error('targetResolver.kind is invalid')
  }
  requireNonEmptyStrings(resolver.canonicalTargetFields, 'targetResolver.canonicalTargetFields')
  requireNonEmptyString(resolver.notFoundMapping, 'targetResolver.notFoundMapping')
  requireNonEmptyString(resolver.mismatchMapping, 'targetResolver.mismatchMapping')
  requireNonEmptyStrings(resolver.testReferences, 'targetResolver.testReferences')

  requireNonEmptyString(metadata.payloadContract, 'metadata.payloadContract')
  requireNonEmptyString(metadata.phase, 'metadata.phase')
  requireNonEmptyString(metadata.transactionOwner, 'metadata.transactionOwner')
  requireNonEmptyStrings(metadata.publicErrorCodes, 'metadata.publicErrorCodes')
  requireNonEmptyStrings(metadata.testReferences, 'metadata.testReferences')
  assertPublicErrorMap(metadata.preflightErrorMap, metadata.publicErrorCodes)
  assertPublicErrorDetailMap(metadata.preflightErrorDetailMap, metadata.publicErrorCodes)

  if (metadata.mode === 'READ') {
    if (metadata.durableCommand) throw new Error('READ definition cannot declare a durable command contract')
    if (metadata.sideEffects.length) throw new Error('READ definition cannot declare side effects')
    if (metadata.concurrencyPolicy.kind !== 'NONE_READ_ONLY') throw new Error('READ definition must use NONE_READ_ONLY concurrency')
  } else {
    if (!metadata.durableCommand) throw new Error('MUTATION definition requires a durable command contract')
    validateDurableCommandContract(metadata.durableCommand)
    requireNonEmptyStrings(metadata.sideEffects, 'metadata.sideEffects')
    if (metadata.concurrencyPolicy.kind === 'NONE_READ_ONLY') throw new Error('MUTATION definition requires a mutation concurrency policy')
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export class CommandRegistry {
  private readonly definitions = new Map<string, AnyCommandDefinition>()
  private sealed = false

  registerMutation<RawInput, ValidatedInput, Result, ErrorCode extends string>(
    definition: MutationCommandDefinition<RawInput, ValidatedInput, Result, ErrorCode>
  ): this {
    this.registerDefinition(definition as unknown as AnyMutationCommandDefinition)
    return this
  }

  registerRead<ErrorCode extends string>(definition: ReadCommandDefinition<ErrorCode>): this {
    this.registerDefinition(definition as unknown as ReadCommandDefinition)
    return this
  }

  seal(expectedCommandTypes?: readonly string[]): this {
    if (expectedCommandTypes) {
      requireNonEmptyStrings(expectedCommandTypes, 'expectedCommandTypes')
      const registered = this.list().map((definition) => definition.commandType)
      const missing = expectedCommandTypes.filter((commandType) => !registered.includes(commandType))
      const extra = registered.filter((commandType) => !expectedCommandTypes.includes(commandType))
      if (missing.length || extra.length) {
        throw new Error(`registry command set mismatch; missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`)
      }
    }
    this.sealed = true
    return this
  }

  isSealed(): boolean {
    return this.sealed
  }

  get(commandType: string): AnyCommandDefinition | undefined {
    return this.definitions.get(commandType)
  }

  requireMutation(commandType: string): AnyMutationCommandDefinition {
    const definition = this.definitions.get(commandType)
    if (!definition) throw new Error(`unknown command type: ${commandType}`)
    if (definition.metadata.mode !== 'MUTATION') throw new Error(`command is not a mutation: ${commandType}`)
    return definition as AnyMutationCommandDefinition
  }

  list(): readonly AnyCommandDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.commandType.localeCompare(right.commandType))
  }

  private registerDefinition(definition: AnyCommandDefinition): void {
    if (this.sealed) throw new Error('registry is sealed')
    requireNonEmptyString(definition.commandType, 'commandType')
    if (/\s/.test(definition.commandType)) throw new Error('commandType cannot contain whitespace')
    if (this.definitions.has(definition.commandType)) throw new Error(`duplicate command type: ${definition.commandType}`)
    validateMetadata(definition.metadata)
    this.definitions.set(definition.commandType, deepFreeze(definition))
  }
}
