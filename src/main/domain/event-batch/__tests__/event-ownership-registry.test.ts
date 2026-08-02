import { describe, expect, it } from 'vitest'
import type { CanonicalJsonValue } from '../canonical-json'
import type { VerifiedEventSource } from '../projection-source'
import { PreparedFactRegistry } from '../result-registry'
import { registerSafetyPreparedFacts } from '../../projectors/safety-projector'
import { registerPreviewSafetyPreparedFacts } from '../../projectors/preview-safety-projector'
import { validatePreviewSafetyPayload } from '../../preview/preview-safety-event-contract'

function event(
  eventType: string,
  aggregateType: string,
  payload: Record<string, CanonicalJsonValue>
): VerifiedEventSource {
  return {
    record: {
      type: 'EVENT',
      batch_id: '96000000-0000-4000-8000-000000000001',
      event_id: '95000000-0000-4000-8000-000000000001',
      aggregate_type: aggregateType,
      aggregate_id: 'ownership-aggregate-1',
      event_type: eventType,
      event_sequence: 1,
      payload,
      checksum: 'ownership-checksum',
      timestamp: '2026-08-01T07:00:00.000Z',
      actor_id: 'ownership-actor-1'
    },
    relativePath: 'segments/seg_000000000001.jsonl',
    segmentId: 'seg_000000000001',
    lineNumber: 2,
    byteOffset: 0,
    byteEnd: 1
  }
}

function metadata(extra: Record<string, CanonicalJsonValue> = {}): Record<string, CanonicalJsonValue> {
  return {
    event_payload_version: 1,
    batch_context: {
      schema_version: 'batch-context-v1',
      plan_version: 'preview.ownership.plan.v1',
      result_recipe_version: 'preview.ownership.result.v1',
      root_command_type: 'preview:ownership',
      root_command_id: '96000000-0000-4000-8000-000000000001',
      child_ordinal: 0
    },
    ...extra
  }
}

describe('prepared event ownership registry', () => {
  it('rejects formal events carrying preview ownership and preview events carrying formal ownership', () => {
    const registry = registerSafetyPreparedFacts()
    registerPreviewSafetyPreparedFacts(registry)
    registry.seal()
    expect(registry.projectorNames()).toEqual([
      'm5b-safety-prepared-projector-v1',
      'preview-safety-projector-v1'
    ])

    expect(() => registry.eventRegistration(event(
      'SAFETY_INCIDENT_CREATED',
      'SAFETY_INCIDENT',
      metadata({ contract_version: 'PREVIEW_CONTRACT_V1', allowed_shell_kind: 'PREVIEW_SHELL' })
    ))).toThrowError(expect.objectContaining({ code: 'UNKNOWN_EVENT_VERSION' }))
    expect(() => registry.eventRegistration(event(
      'PREVIEW_SAFETY_INCIDENT_CREATED',
      'PREVIEW_SESSION',
      metadata({ contract_version: 'PREVIEW_CONTRACT_V1', allowed_shell_kind: 'FORMAL_SHELL' })
    ))).toThrowError(expect.objectContaining({ code: 'UNKNOWN_EVENT_VERSION' }))
    expect(() => registry.eventRegistration(event(
      'PREVIEW_SAFETY_INCIDENT_CREATED',
      'SAFETY_INCIDENT',
      metadata({ contract_version: 'PREVIEW_CONTRACT_V1', allowed_shell_kind: 'PREVIEW_SHELL' })
    ))).toThrowError(expect.objectContaining({ code: 'UNKNOWN_EVENT_VERSION' }))
  })

  it('rejects same event/version registration under a second ownership descriptor', () => {
    const registry = new PreparedFactRegistry()
    const registration = {
      eventType: 'OWNED_EVENT',
      eventPayloadVersion: 1,
      ownership: { aggregateType: 'OWNED', contractVersion: 'CONTRACT_V1', allowedShellKind: 'PREVIEW_SHELL' as const },
      projectorName: 'owned-projector-v1',
      validatePayload: () => undefined,
      project: () => undefined,
      assertProjected: () => undefined,
      operationalEffects: []
    }
    registry.registerEvent(registration)
    expect(() => registry.registerEvent({
      ...registration,
      ownership: { aggregateType: 'OTHER', contractVersion: 'CONTRACT_V1', allowedShellKind: 'PREVIEW_SHELL' }
    })).toThrowError(expect.objectContaining({ code: 'DUPLICATE_REGISTRATION' }))
  })

  it('does not coerce invalid preview safety field types into valid facts', () => {
    const payload = metadata({
      actor_role: 'SYSTEM',
      allowed_shell_kind: 'PREVIEW_SHELL',
      contract_version: 'PREVIEW_CONTRACT_V1',
      app_version: 'preview-test',
      correlation_id: 'ownership-correlation',
      incident_id: 1,
      preview_session_id: 'preview-session-1',
      session_id: 'assessment-shell-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'UNBOX_AND_SHELF',
      reason_code: 'UNSAFE_PLACEMENT',
      status_after: 'OPEN',
      preview_redline_ref: 'preview-redline-1',
      snapshot_root_hash: 'a'.repeat(64),
      occurred_at: '2026-08-01T07:00:00.000Z'
    })
    expect(() => validatePreviewSafetyPayload(payload)).toThrowError(expect.objectContaining({ code: 'PREVIEW_CANONICAL_INVALID' }))
  })
})
