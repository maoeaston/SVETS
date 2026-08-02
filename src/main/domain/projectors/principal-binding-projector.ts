import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import type { PreparedProjectorContext } from '../event-batch/result-registry'
import { PreparedFactRegistry } from '../event-batch/result-registry'
import type { EventRecord } from '../event-batch/record-types'
import {
  PREVIEW_CONTRACT_REGISTRY,
  type PreviewEventOwnershipDescriptor
} from '../preview/preview-contract-registry'
import {
  PREVIEW_CONTRACT_MIGRATION_ID,
  PREVIEW_CONTRACT_VERSION,
} from '../../../shared/types/preview-contract'
import type {
  PrincipalBindingEnrollmentPayload,
  PrincipalBindingRotationPayload
} from '../../../shared/types/event-payloads'
import { PreviewContractError } from '../preview/preview-errors'
import { projectPreviewEvent } from './preview-event-projection'
import {
  PrincipalBindingService,
  principalEnrollmentFactFromEvent,
  principalRotationFactFromEvent,
  validatePrincipalEnrollmentFact,
  validatePrincipalRotationFact
} from '../authority/principal-binding-service'

export const PRINCIPAL_BINDING_PROJECTOR_NAME = 'preview-principal-binding-projector-v1'
export const PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION = 1
export const PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS = Object.freeze({
  'preview:enrollPrincipal': 'preview.preview-principal-enrollment.result.v1',
  'preview:rotatePrincipal': 'preview.preview-principal-rotation.result.v1'
})

let principalContractRegistered = false

const PREVIEW_METADATA_KEYS = [
  'actor_role',
  'allowed_shell_kind',
  'app_version',
  'batch_context',
  'contract_version',
  'correlation_id',
  'event_payload_version'
] as const

const ENROLLMENT_KEYS = [
  ...PREVIEW_METADATA_KEYS,
  'effective_at',
  'enrollment_id',
  'expires_at',
  'mapping_hash',
  'mapping_id',
  'mapping_version',
  'organization_id',
  'principal_id',
  'signer_key_id',
  'signature',
  'source_manifest_hash',
  'source_manifest_id',
  'status_after',
  'target_installation_id',
  'user_id'
] as const

const ROTATION_KEYS = [
  ...PREVIEW_METADATA_KEYS,
  'effective_at',
  'expires_at',
  'new_mapping_hash',
  'new_mapping_id',
  'new_principal_id',
  'new_status_after',
  'new_user_id',
  'old_mapping_hash',
  'old_mapping_id',
  'old_principal_id',
  'old_status_after',
  'old_user_id',
  'organization_id',
  'reason',
  'signer_key_id',
  'signature',
  'target_installation_id'
] as const

type PrincipalPayload = Readonly<Record<string, CanonicalJsonValue>>

function exactKeys(payload: PrincipalPayload, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`principal payload field set mismatch: ${actual.join(',')}`)
  }
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) throw new Error(`${field} is invalid`)
  return value
}

function metadata(payload: PrincipalPayload): void {
  if (payload.event_payload_version !== PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION) throw new Error('event_payload_version is invalid')
  if (payload.contract_version !== PREVIEW_CONTRACT_VERSION) throw new Error('contract_version is invalid')
  if (payload.allowed_shell_kind !== 'PREVIEW_SHELL') throw new Error('allowed_shell_kind is invalid')
  if (payload.actor_role !== 'ADMIN' && payload.actor_role !== 'SYSTEM') throw new Error('actor_role is invalid')
  text(payload.app_version, 'app_version')
  text(payload.correlation_id, 'correlation_id')
  const context = payload.batch_context
  if (typeof context !== 'object' || context === null || Array.isArray(context)) throw new Error('batch_context is invalid')
  if ((context as Record<string, CanonicalJsonValue>).schema_version !== 'batch-context-v1') throw new Error('batch_context schema is invalid')
}

function enrollmentFact(payload: PrincipalPayload) {
  return principalEnrollmentFactFromEvent(payload as unknown as PrincipalBindingEnrollmentPayload)
}

function rotationFact(payload: PrincipalPayload) {
  return principalRotationFactFromEvent(payload as unknown as PrincipalBindingRotationPayload)
}

function previewEventDescriptor(
  eventType: 'PRINCIPAL_BINDING_ENROLLMENT' | 'PRINCIPAL_BINDING_ROTATION'
): PreviewEventOwnershipDescriptor {
  return {
    event_type: eventType,
    event_payload_version: PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
    aggregate_type: 'PRINCIPAL_BINDING',
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_shell_kind: 'PREVIEW_SHELL',
    projector_name: PRINCIPAL_BINDING_PROJECTOR_NAME,
    result_suppressed: true
  }
}

export function registerPrincipalBindingContract(): void {
  if (principalContractRegistered) return
  PREVIEW_CONTRACT_REGISTRY.registerEvent(previewEventDescriptor('PRINCIPAL_BINDING_ENROLLMENT'))
  PREVIEW_CONTRACT_REGISTRY.registerEvent(previewEventDescriptor('PRINCIPAL_BINDING_ROTATION'))
  PREVIEW_CONTRACT_REGISTRY.registerCommand({
    command_type: 'preview:enrollPrincipal',
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_roles: ['ADMIN'],
    event_types: ['PRINCIPAL_BINDING_ENROLLMENT'],
    result_recipe_version: PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS['preview:enrollPrincipal'],
    recovery_registered: true
  })
  PREVIEW_CONTRACT_REGISTRY.registerCommand({
    command_type: 'preview:rotatePrincipal',
    contract_version: PREVIEW_CONTRACT_VERSION,
    allowed_roles: ['ADMIN'],
    event_types: ['PRINCIPAL_BINDING_ROTATION'],
    result_recipe_version: PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS['preview:rotatePrincipal'],
    recovery_registered: true
  })
    PREVIEW_CONTRACT_REGISTRY.registerProjection({
      projection_name: 'principal_binding_projection',
      canonical_owner: PRINCIPAL_BINDING_PROJECTOR_NAME,
      contract_version: PREVIEW_CONTRACT_VERSION,
      migration_id: PREVIEW_CONTRACT_MIGRATION_ID
    })
  principalContractRegistered = true
}

function assertPrincipalEvent(event: EventRecord, expectedType: string): PrincipalPayload {
  registerPrincipalBindingContract()
  if (event.aggregate_type !== 'PRINCIPAL_BINDING' || event.event_type !== expectedType) {
    throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'principal event ownership does not match projector')
  }
  metadata(event.payload)
  PREVIEW_CONTRACT_REGISTRY.eventOwnership(
    event.event_type,
    PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
    'PRINCIPAL_BINDING',
    'PREVIEW_SHELL'
  )
  return event.payload
}

export function validatePrincipalEnrollmentPayload(payload: PrincipalPayload): void {
  exactKeys(payload, ENROLLMENT_KEYS)
  metadata(payload)
  text(payload.enrollment_id, 'enrollment_id')
  const fact = enrollmentFact(payload)
  validatePrincipalEnrollmentFact(fact, {
    target_installation_id: fact.target_installation_id,
    organization_id: fact.organization_id,
    existing: []
  })
}

export function validatePrincipalRotationPayload(payload: PrincipalPayload): void {
  exactKeys(payload, ROTATION_KEYS)
  metadata(payload)
  const fact = rotationFact(payload)
  validatePrincipalRotationFact(fact, {
    target_installation_id: fact.target_installation_id,
    organization_id: fact.organization_id,
    existing: []
  })
}

function projectEnrollment(context: PreparedProjectorContext): void {
  const payload = assertPrincipalEvent(context.event.record, 'PRINCIPAL_BINDING_ENROLLMENT')
  const fact = enrollmentFact(payload)
  const service = new PrincipalBindingService({})
  projectPreviewEvent(context)
  service.projectEnrollment(context.database, fact, context.event.record.event_id)
}

function projectRotation(context: PreparedProjectorContext): void {
  const payload = assertPrincipalEvent(context.event.record, 'PRINCIPAL_BINDING_ROTATION')
  const fact = rotationFact(payload)
  const service = new PrincipalBindingService({})
  projectPreviewEvent(context)
  service.projectRotation(context.database, fact, context.event.record.event_id)
}

function assertProjected(context: PreparedProjectorContext): void {
  const event = context.event.record
  const previewEvent = context.database.prepare(
    'SELECT checksum FROM preview_event_projection WHERE event_id = ?'
  ).get(event.event_id) as { checksum: string } | undefined
  if (!previewEvent || previewEvent.checksum !== event.checksum) throw new Error('principal preview event projection is missing')
  if (event.event_type === 'PRINCIPAL_BINDING_ENROLLMENT') {
    const mappingId = text(event.payload.mapping_id, 'mapping_id')
    const row = context.database.prepare(
      'SELECT status, created_event_id FROM principal_binding_projection WHERE mapping_id = ?'
    ).get(mappingId) as { status: string; created_event_id: string } | undefined
    if (!row || row.status !== 'ACTIVE' || row.created_event_id !== event.event_id) throw new Error('principal enrollment projection conflicts')
  } else {
    const oldMappingId = text(event.payload.old_mapping_id, 'old_mapping_id')
    const newMappingId = text(event.payload.new_mapping_id, 'new_mapping_id')
    const old = context.database.prepare(
      'SELECT status FROM principal_binding_projection WHERE mapping_id = ?'
    ).get(oldMappingId) as { status: string } | undefined
    const next = context.database.prepare(
      'SELECT status, created_event_id FROM principal_binding_projection WHERE mapping_id = ?'
    ).get(newMappingId) as { status: string; created_event_id: string } | undefined
    if (!old || old.status !== event.payload.old_status_after || !next || next.status !== 'ACTIVE' || next.created_event_id !== event.event_id) {
      throw new Error('principal rotation projection conflicts')
    }
  }
}

function resultFor(context: PreparedProjectorContext): Readonly<Record<string, CanonicalJsonValue>> {
  const event = context.batch.events.find((candidate) => candidate.record.event_type === context.event.record.event_type)
  if (!event) throw new Error('principal result event is missing')
  const payload = event.record.payload
  return Object.freeze({
    success: true,
    mappingId: payload.mapping_id ?? payload.new_mapping_id,
    status: 'ACTIVE',
    eventId: event.record.event_id
  })
}

export function registerPrincipalBindingPreparedFacts(
  registry = new PreparedFactRegistry()
): PreparedFactRegistry {
  registerPrincipalBindingContract()
  registry.registerEvent({
    eventType: 'PRINCIPAL_BINDING_ENROLLMENT',
    eventPayloadVersion: PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
    ownership: {
      aggregateType: 'PRINCIPAL_BINDING',
      contractVersion: PREVIEW_CONTRACT_VERSION,
      allowedShellKind: 'PREVIEW_SHELL'
    },
    projectorName: PRINCIPAL_BINDING_PROJECTOR_NAME,
    validatePayload: validatePrincipalEnrollmentPayload,
    project: projectEnrollment,
    assertProjected,
    operationalEffects: []
  })
  registry.registerEvent({
    eventType: 'PRINCIPAL_BINDING_ROTATION',
    eventPayloadVersion: PRINCIPAL_BINDING_EVENT_PAYLOAD_VERSION,
    ownership: {
      aggregateType: 'PRINCIPAL_BINDING',
      contractVersion: PREVIEW_CONTRACT_VERSION,
      allowedShellKind: 'PREVIEW_SHELL'
    },
    projectorName: PRINCIPAL_BINDING_PROJECTOR_NAME,
    validatePayload: validatePrincipalRotationPayload,
    project: projectRotation,
    assertProjected,
    operationalEffects: []
  })
  registry.registerResult({
    commandType: 'preview:enrollPrincipal',
    resultRecipeVersion: PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS['preview:enrollPrincipal'],
    fromPrepared: resultFor
  })
  registry.registerResult({
    commandType: 'preview:rotatePrincipal',
    resultRecipeVersion: PRINCIPAL_BINDING_RESULT_RECIPE_VERSIONS['preview:rotatePrincipal'],
    fromPrepared: resultFor
  })
  return registry
}
