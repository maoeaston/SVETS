import { sha256CanonicalJson } from '../event-batch/canonical-json'
import type { EventType, AggregateType, SessionStartedPayload, SessionStartedPayloadV2 } from '@shared/types/event-payloads'
import type {
  LegacySessionInterpretation,
  PreviewContractReadiness,
  PreviewContractVersion
} from '@shared/types/preview-contract'
import {
  PREVIEW_CONTRACT_MIGRATION_ID,
  PREVIEW_CONTRACT_VERSION
} from '../../../shared/types/preview-contract'

export type PreviewShellKind = 'PREVIEW_SHELL' | 'FORMAL_SHELL'

export interface PreviewEventOwnershipDescriptor {
  event_type: string
  event_payload_version: number
  aggregate_type: string
  contract_version: PreviewContractVersion
  allowed_shell_kind: PreviewShellKind
  projector_name: string
  result_suppressed: boolean
}

export interface PreviewCommandDescriptor {
  command_type: string
  contract_version: PreviewContractVersion
  allowed_roles: readonly ('ADMIN' | 'TEACHER' | 'STUDENT' | 'SYSTEM')[]
  event_types: readonly string[]
  result_recipe_version: string
  recovery_registered: boolean
}

export interface PreviewErrorDescriptor {
  code: string
  public: true
  retryable: boolean
  safe_context_keys: readonly string[]
}

export interface PreviewProjectionDescriptor {
  projection_name: string
  canonical_owner: string
  contract_version: PreviewContractVersion
  migration_id: string
}

export interface PreviewQueryDescriptor {
  query_name: string
  projection_name: string
  allowed_roles: readonly ('ADMIN' | 'TEACHER' | 'STUDENT' | 'SYSTEM')[]
  includes_private_identity_map: false
}

export class PreviewContractRegistryError extends Error {
  constructor(
    public readonly code:
      | 'REGISTRY_SEALED'
      | 'DUPLICATE_EVENT_OWNERSHIP'
      | 'DUPLICATE_COMMAND'
      | 'DUPLICATE_ERROR'
      | 'DUPLICATE_PROJECTION'
      | 'DUPLICATE_QUERY'
      | 'REGISTRY_INCOMPLETE'
      | 'LEGACY_PAYLOAD_UNKNOWN',
    message: string
  ) {
    super(`[preview-contract-registry] ${message}`)
    this.name = 'PreviewContractRegistryError'
  }
}

const TOKEN = /^[A-Z][A-Z0-9_]*$/

function assertToken(value: string, field: string): void {
  if (!TOKEN.test(value)) throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `${field} must be an uppercase protocol token`)
}

function eventKey(value: PreviewEventOwnershipDescriptor): string {
  return [value.event_type, value.event_payload_version, value.aggregate_type, value.contract_version, value.allowed_shell_kind].join('\u0000')
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

export class PreviewContractRegistry {
  private readonly events = new Map<string, PreviewEventOwnershipDescriptor>()
  private readonly commands = new Map<string, PreviewCommandDescriptor>()
  private readonly errors = new Map<string, PreviewErrorDescriptor>()
  private readonly projections = new Map<string, PreviewProjectionDescriptor>()
  private readonly queries = new Map<string, PreviewQueryDescriptor>()
  private sealed = false

  registerEvent(descriptor: PreviewEventOwnershipDescriptor): this {
    this.assertOpen()
    assertToken(descriptor.event_type, 'event_type')
    assertToken(descriptor.aggregate_type, 'aggregate_type')
    if (!Number.isSafeInteger(descriptor.event_payload_version) || descriptor.event_payload_version < 1) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', 'event_payload_version must be positive')
    }
    if (!descriptor.projector_name || descriptor.contract_version !== PREVIEW_CONTRACT_VERSION) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', 'preview event descriptor is incomplete')
    }
    const key = eventKey(descriptor)
    if ([...this.events.values()].some((entry) =>
      entry.event_type === descriptor.event_type
      && entry.event_payload_version === descriptor.event_payload_version
      && entry.contract_version === descriptor.contract_version
    )) {
      throw new PreviewContractRegistryError('DUPLICATE_EVENT_OWNERSHIP', `duplicate event ownership ${key}`)
    }
    this.events.set(key, freeze({
      event_type: descriptor.event_type,
      event_payload_version: descriptor.event_payload_version,
      aggregate_type: descriptor.aggregate_type,
      contract_version: descriptor.contract_version,
      allowed_shell_kind: descriptor.allowed_shell_kind,
      projector_name: descriptor.projector_name,
      result_suppressed: descriptor.result_suppressed
    }))
    return this
  }

  registerCommand(descriptor: PreviewCommandDescriptor): this {
    this.assertOpen()
    if (!descriptor.command_type || descriptor.contract_version !== PREVIEW_CONTRACT_VERSION || !descriptor.result_recipe_version) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', 'preview command descriptor is incomplete')
    }
    if (this.commands.has(descriptor.command_type)) throw new PreviewContractRegistryError('DUPLICATE_COMMAND', descriptor.command_type)
    this.commands.set(descriptor.command_type, freeze({
      command_type: descriptor.command_type,
      contract_version: descriptor.contract_version,
      allowed_roles: Object.freeze([...descriptor.allowed_roles]),
      event_types: Object.freeze([...descriptor.event_types]),
      result_recipe_version: descriptor.result_recipe_version,
      recovery_registered: descriptor.recovery_registered
    }))
    return this
  }

  registerError(descriptor: PreviewErrorDescriptor): this {
    this.assertOpen()
    if (!descriptor.code || descriptor.public !== true || !Array.isArray(descriptor.safe_context_keys)) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', 'preview error descriptor is incomplete')
    }
    if (this.errors.has(descriptor.code)) throw new PreviewContractRegistryError('DUPLICATE_ERROR', descriptor.code)
    this.errors.set(descriptor.code, freeze({
      code: descriptor.code,
      public: true,
      retryable: descriptor.retryable,
      safe_context_keys: Object.freeze([...descriptor.safe_context_keys].sort())
    }))
    return this
  }

  registerProjection(descriptor: PreviewProjectionDescriptor): this {
    this.assertOpen()
    if (this.projections.has(descriptor.projection_name)) throw new PreviewContractRegistryError('DUPLICATE_PROJECTION', descriptor.projection_name)
    if (descriptor.contract_version !== PREVIEW_CONTRACT_VERSION || descriptor.migration_id !== PREVIEW_CONTRACT_MIGRATION_ID) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `projection ${descriptor.projection_name} has incompatible contract/migration`)
    }
    this.projections.set(descriptor.projection_name, freeze({ ...descriptor }))
    return this
  }

  registerQuery(descriptor: PreviewQueryDescriptor): this {
    this.assertOpen()
    if (descriptor.includes_private_identity_map !== false) {
      throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `${descriptor.query_name} may not expose identity map`)
    }
    if (this.queries.has(descriptor.query_name)) throw new PreviewContractRegistryError('DUPLICATE_QUERY', descriptor.query_name)
    this.queries.set(descriptor.query_name, freeze({
      ...descriptor,
      allowed_roles: Object.freeze([...descriptor.allowed_roles])
    }))
    return this
  }

  seal(): this {
    this.sealed = true
    return this
  }

  isSealed(): boolean {
    return this.sealed
  }

  eventOwnership(eventType: string, payloadVersion: number, aggregateType: string, shellKind: PreviewShellKind): PreviewEventOwnershipDescriptor {
    const found = this.events.get(eventKey({
      event_type: eventType,
      event_payload_version: payloadVersion,
      aggregate_type: aggregateType,
      contract_version: PREVIEW_CONTRACT_VERSION,
      allowed_shell_kind: shellKind,
      projector_name: '',
      result_suppressed: true
    }))
    if (!found) throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `unknown preview event ownership ${eventType}@${payloadVersion}/${aggregateType}/${shellKind}`)
    return found
  }

  command(commandType: string): PreviewCommandDescriptor {
    const found = this.commands.get(commandType)
    if (!found) throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `unknown preview command ${commandType}`)
    return found
  }

  eventDescriptors(): readonly PreviewEventOwnershipDescriptor[] {
    return Object.freeze([...this.events.values()].sort((a, b) => eventKey(a).localeCompare(eventKey(b))))
  }

  commandDescriptors(): readonly PreviewCommandDescriptor[] {
    return Object.freeze([...this.commands.values()].sort((a, b) => a.command_type.localeCompare(b.command_type)))
  }

  errorDescriptors(): readonly PreviewErrorDescriptor[] {
    return Object.freeze([...this.errors.values()].sort((a, b) => a.code.localeCompare(b.code)))
  }

  projectionDescriptors(): readonly PreviewProjectionDescriptor[] {
    return Object.freeze([...this.projections.values()].sort((a, b) => a.projection_name.localeCompare(b.projection_name)))
  }

  queryDescriptors(): readonly PreviewQueryDescriptor[] {
    return Object.freeze([...this.queries.values()].sort((a, b) => a.query_name.localeCompare(b.query_name)))
  }

  assertComplete(expected: {
    event_types?: readonly string[]
    command_types?: readonly string[]
    projection_names?: readonly string[]
    query_names?: readonly string[]
    error_codes?: readonly string[]
  } = {}): void {
    const check = (actual: readonly string[], wanted: readonly string[] | undefined, label: string): void => {
      if (!wanted) return
      const left = [...actual].sort()
      const right = [...wanted].sort()
      if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
        throw new PreviewContractRegistryError('REGISTRY_INCOMPLETE', `${label} registry mismatch`)
      }
    }
    check(this.eventDescriptors().map((entry) => entry.event_type), expected.event_types, 'event')
    check(this.commandDescriptors().map((entry) => entry.command_type), expected.command_types, 'command')
    check(this.projectionDescriptors().map((entry) => entry.projection_name), expected.projection_names, 'projection')
    check(this.queryDescriptors().map((entry) => entry.query_name), expected.query_names, 'query')
    check(this.errorDescriptors().map((entry) => entry.code), expected.error_codes, 'error')
  }

  readiness(status: PreviewContractReadiness['status'] = 'INSTALLING'): PreviewContractReadiness {
    const digest = (value: unknown): string => sha256CanonicalJson(value as never)
    return Object.freeze({
      registry_id: 'PREVIEW_CONTRACT_V1',
      contract_version: PREVIEW_CONTRACT_VERSION,
      status,
      schema_version: '0.1.19-job-skill-preview-contract-v1',
      migration_id: PREVIEW_CONTRACT_MIGRATION_ID,
      event_registry_digest: digest(this.eventDescriptors()),
      projection_digest: digest(this.projectionDescriptors()),
      query_digest: digest(this.queryDescriptors()),
      recovery_digest: digest(this.commandDescriptors().map((entry) => ({ command_type: entry.command_type, recovery_registered: entry.recovery_registered }))),
      error_map_digest: digest(this.errorDescriptors()),
      installed_at: null
    })
  }

  private assertOpen(): void {
    if (this.sealed) throw new PreviewContractRegistryError('REGISTRY_SEALED', 'registry is sealed')
  }
}

export const PREVIEW_CONTRACT_REGISTRY = new PreviewContractRegistry()

/**
 * Old SESSION_STARTED events have no preview discriminator. They remain
 * formal by explicit compatibility rule; unknown payload versions never get
 * guessed as preview.
 */
export function interpretLegacySessionStarted(payload: SessionStartedPayload | SessionStartedPayloadV2): LegacySessionInterpretation {
  if ('payload_version' in payload && payload.payload_version !== 2) {
    throw new PreviewContractRegistryError('LEGACY_PAYLOAD_UNKNOWN', `unknown SESSION_STARTED payload_version ${String(payload.payload_version)}`)
  }
  if (!('payload_version' in payload) && !('strategy_type' in payload)) {
    throw new PreviewContractRegistryError('LEGACY_PAYLOAD_UNKNOWN', 'legacy SESSION_STARTED payload is not recognized')
  }
  return Object.freeze({
    payload_version: 'payload_version' in payload ? 2 : 1,
    delivery_mode: 'FORMAL_DEMO',
    contract_version: null,
    reason: 'LEGACY_FORMAL_SESSION'
  })
}

export function previewEventTypes(): readonly EventType[] {
  return Object.freeze(PREVIEW_CONTRACT_REGISTRY.eventDescriptors().map((entry) => entry.event_type as EventType))
}

export function previewAggregateTypes(): readonly AggregateType[] {
  return Object.freeze([...new Set(PREVIEW_CONTRACT_REGISTRY.eventDescriptors().map((entry) => entry.aggregate_type as AggregateType))])
}
