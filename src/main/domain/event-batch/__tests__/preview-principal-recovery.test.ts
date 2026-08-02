import { describe, expect, it } from 'vitest'
import {
  principalMappingHash,
  type PrincipalBindingFact
} from '../../authority/principal-binding-service'
import { replayPrincipalBindings } from '../../preview/preview-replay'
import { PreviewContractError } from '../../preview/preview-errors'

const INSTALLATION_ID = 'replay-installation'
const ORGANIZATION_ID = 'replay-organization'

function enrollmentPayload(): PrincipalBindingFact {
  const base: Omit<PrincipalBindingFact, 'mapping_hash'> = {
    mapping_id: 'replay-mapping-1',
    target_installation_id: INSTALLATION_ID,
    organization_id: ORGANIZATION_ID,
    user_id: 'replay-user-1',
    principal_id: 'replay-principal-1',
    mapping_version: 1,
    source_manifest_id: 'replay-manifest-1',
    source_manifest_hash: 'a'.repeat(64),
    effective_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
    signer_key_id: 'replay-signer',
    signature: 'replay-signature',
    status_after: 'ACTIVE'
  }
  return { ...base, mapping_hash: principalMappingHash(base) }
}

function eventPayload(fact: object): Record<string, unknown> {
  return {
    event_payload_version: 1,
    batch_context: {
      schema_version: 'batch-context-v1',
      plan_version: 'preview.principal.test.plan.v1',
      result_recipe_version: 'preview.principal.test.result.v1',
      root_command_type: 'preview:enrollPrincipal',
      root_command_id: 'root-command-1',
      child_ordinal: 0
    },
    actor_role: 'ADMIN',
    app_version: 'test',
    correlation_id: 'correlation-1',
    contract_version: 'PREVIEW_CONTRACT_V1',
    allowed_shell_kind: 'PREVIEW_SHELL',
    ...fact
  }
}

describe('preview principal recovery/replay', () => {
  it('从 frozen enrollment + rotation EVENT 重建相同 mapping projection，不调用 planner', () => {
    const enrollment = enrollmentPayload()
    const rotation = {
      old_mapping_id: enrollment.mapping_id,
      old_mapping_hash: enrollment.mapping_hash,
      new_mapping_id: 'replay-mapping-2',
      new_mapping_hash: 'c'.repeat(64),
      target_installation_id: INSTALLATION_ID,
      organization_id: ORGANIZATION_ID,
      old_user_id: enrollment.user_id,
      old_principal_id: enrollment.principal_id,
      new_user_id: 'replay-user-2',
      new_principal_id: 'replay-principal-2',
      effective_at: enrollment.effective_at,
      expires_at: enrollment.expires_at,
      reason: 'recovery rotation',
      signer_key_id: 'replay-signer',
      signature: 'rotation-signature',
      old_status_after: 'SUPERSEDED',
      new_status_after: 'ACTIVE'
    }
    const events = [
      {
        event_id: 'replay-event-1',
        event_type: 'PRINCIPAL_BINDING_ENROLLMENT' as const,
        event_sequence: 1,
        payload: eventPayload({ enrollment_id: 'replay-enrollment-1', ...enrollment }),
        created_at: '2026-08-01T00:00:00.000Z'
      },
      {
        event_id: 'replay-event-2',
        event_type: 'PRINCIPAL_BINDING_ROTATION' as const,
        event_sequence: 2,
        payload: eventPayload(rotation),
        created_at: '2026-08-01T00:00:01.000Z'
      }
    ]
    const first = replayPrincipalBindings(events)
    const second = replayPrincipalBindings([...events].reverse())
    expect(first).toEqual(second)
    expect(first).toMatchObject([
      { mapping_id: 'replay-mapping-1', status: 'SUPERSEDED' },
      { mapping_id: 'replay-mapping-2', status: 'ACTIVE', mapping_version: 2 }
    ])
  })

  it('回放遇到 old mapping hash 或 sequence 冲突时只读失败', () => {
    const enrollment = enrollmentPayload()
    const payload = eventPayload({ enrollment_id: 'replay-enrollment-1', ...enrollment })
    expect(() => replayPrincipalBindings([
      {
        event_id: 'replay-event-1',
        event_type: 'PRINCIPAL_BINDING_ENROLLMENT',
        event_sequence: 1,
        payload,
        created_at: '2026-08-01T00:00:00.000Z'
      },
      {
        event_id: 'replay-event-2',
        event_type: 'PRINCIPAL_BINDING_ROTATION',
        event_sequence: 1,
        payload: eventPayload({
          old_mapping_id: enrollment.mapping_id,
          old_mapping_hash: 'd'.repeat(64),
          new_mapping_id: 'replay-mapping-2',
          new_mapping_hash: 'e'.repeat(64),
          target_installation_id: INSTALLATION_ID,
          organization_id: ORGANIZATION_ID,
          old_user_id: enrollment.user_id,
          old_principal_id: enrollment.principal_id,
          new_user_id: 'replay-user-2',
          new_principal_id: 'replay-principal-2',
          effective_at: enrollment.effective_at,
          expires_at: enrollment.expires_at,
          reason: 'tampered',
          signer_key_id: 'replay-signer',
          signature: 'rotation-signature',
          old_status_after: 'SUPERSEDED',
          new_status_after: 'ACTIVE'
        }),
        created_at: '2026-08-01T00:00:01.000Z'
      }
    ])).toThrowError(PreviewContractError)
  })
})
