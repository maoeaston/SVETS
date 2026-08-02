import type {
  PrincipalBindingEnrollmentPayload,
  PrincipalBindingRotationPayload
} from '../../../shared/types/event-payloads'
import type { PrincipalBindingRow } from '../authority/principal-binding-service'
import {
  assertNoPrincipalBindingOverlap,
  principalEnrollmentFactFromEvent,
  principalRotationFactFromEvent,
  validatePrincipalEnrollmentFact,
  validatePrincipalRotationFact
} from '../authority/principal-binding-service'
import { PreviewContractError } from './preview-errors'
import {
  validatePrincipalEnrollmentPayload,
  validatePrincipalRotationPayload
} from '../projectors/principal-binding-projector'

export interface PreviewPrincipalEvent {
  readonly event_id: string
  readonly event_type: 'PRINCIPAL_BINDING_ENROLLMENT' | 'PRINCIPAL_BINDING_ROTATION'
  readonly event_sequence: number
  readonly payload: Readonly<Record<string, unknown>>
  readonly created_at: string
}

function asPayload(value: Readonly<Record<string, unknown>>): Readonly<Record<string, never>> {
  return value as Readonly<Record<string, never>>
}

function rowFromEnrollment(
  event: PreviewPrincipalEvent,
  payload: PrincipalBindingEnrollmentPayload
): PrincipalBindingRow {
  const fact = principalEnrollmentFactFromEvent(payload)
  return {
    ...fact,
    revoked_at: null,
    status: 'ACTIVE',
    created_event_id: event.event_id
  }
}

export function replayPrincipalBindings(
  events: readonly PreviewPrincipalEvent[]
): readonly PrincipalBindingRow[] {
  const ordered = [...events].sort((left, right) => left.event_sequence - right.event_sequence)
  const bindings: PrincipalBindingRow[] = []
  const eventIds = new Set<string>()
  let previousSequence = 0
  for (const event of ordered) {
    if (eventIds.has(event.event_id)) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'principal replay contains a duplicate event')
    if (!Number.isSafeInteger(event.event_sequence) || event.event_sequence < 1 || event.event_sequence <= previousSequence) {
      throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'principal replay event sequence is not strictly increasing')
    }
    eventIds.add(event.event_id)
    previousSequence = event.event_sequence
    const payload = event.payload
    if (event.event_type === 'PRINCIPAL_BINDING_ENROLLMENT') {
      validatePrincipalEnrollmentPayload(asPayload(payload))
      const fact = principalEnrollmentFactFromEvent(payload as unknown as PrincipalBindingEnrollmentPayload)
      validatePrincipalEnrollmentFact(fact, {
        target_installation_id: fact.target_installation_id,
        organization_id: fact.organization_id,
        existing: bindings
      })
      if (bindings.some((binding) => binding.mapping_id === fact.mapping_id)) {
        throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'principal replay contains a duplicate mapping')
      }
      assertNoPrincipalBindingOverlap(fact, bindings)
      bindings.push(rowFromEnrollment(event, payload as unknown as PrincipalBindingEnrollmentPayload))
      continue
    }

    validatePrincipalRotationPayload(asPayload(payload))
    const fact = principalRotationFactFromEvent(payload as unknown as PrincipalBindingRotationPayload)
    const old = bindings.find((binding) => binding.mapping_id === fact.old_mapping_id)
    if (!old || old.status !== 'ACTIVE') throw new PreviewContractError('PRINCIPAL_MAPPING_REVOKED', 'principal replay rotation old mapping is unavailable')
    validatePrincipalRotationFact(fact, {
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      existing: bindings
    })
    if (old.mapping_hash !== fact.old_mapping_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'principal replay old mapping hash mismatch')
    const oldIndex = bindings.indexOf(old)
    bindings[oldIndex] = Object.freeze({
      ...old,
      status: fact.old_status_after,
      revoked_at: fact.old_status_after === 'REVOKED' ? fact.effective_at : old.revoked_at
    })
    const newBinding: PrincipalBindingRow = {
      mapping_id: fact.new_mapping_id,
      target_installation_id: fact.target_installation_id,
      organization_id: fact.organization_id,
      user_id: fact.new_user_id,
      principal_id: fact.new_principal_id,
      mapping_version: old.mapping_version + 1,
      mapping_hash: fact.new_mapping_hash,
      source_manifest_id: old.source_manifest_id,
      source_manifest_hash: old.source_manifest_hash,
      effective_at: fact.effective_at,
      expires_at: fact.expires_at,
      signer_key_id: fact.signer_key_id,
      signature: fact.signature,
      status_after: 'ACTIVE',
      revoked_at: null,
      status: 'ACTIVE',
      created_event_id: event.event_id
    }
    if (bindings.some((binding) => binding.mapping_id === newBinding.mapping_id)) {
      throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'principal replay contains a duplicate rotation mapping')
    }
    assertNoPrincipalBindingOverlap(newBinding, bindings)
    bindings.push(Object.freeze(newBinding))
  }
  return Object.freeze(bindings.map((binding) => Object.freeze({ ...binding })))
}

export function replayPrincipalBindingProjection(
  events: readonly PreviewPrincipalEvent[]
): readonly PrincipalBindingRow[] {
  return replayPrincipalBindings(events)
}
