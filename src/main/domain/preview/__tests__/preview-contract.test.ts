import { describe, expect, it } from 'vitest'
import {
  assertCanonicalReferenceSet,
  assertScope,
  canonicalReferenceSetDigest
} from '../preview-canonical'
import {
  interpretLegacySessionStarted,
  PreviewContractRegistry,
  PreviewContractRegistryError
} from '../preview-contract-registry'
import {
  PREVIEW_COMMAND_TYPES,
  PREVIEW_EVENT_TYPES,
  PREVIEW_PROJECTION_NAMES,
  previewContractReadiness
} from '../preview-ready-gate'
import type { PreviewCanonicalReferenceSet } from '@shared/types/preview-contract'

const hash = 'a'.repeat(64)
const validity = {
  issued_at: '2026-08-01T00:00:00.000Z',
  effective_at: '2026-08-01T00:00:00.000Z',
  expires_at: '2026-08-15T00:00:00.000Z',
  revoked_at: null
} as const

function refs(): PreviewCanonicalReferenceSet {
  return {
    source_ref: {
      source_ref_id: 'preview-source-1',
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'preview-authority-1',
      authority_hash: hash,
      scope: {
        organization_id: 'org-1',
        installation_id: 'install-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_PACK_PUBLISH']
      },
      validity
    },
    pack_ref: { pack_id: 'pack-1', pack_version: '1', pack_hash: hash },
    strategy_ref: { strategy_id: 'strategy-1', strategy_version: 1, policy_hash: hash, scoring_policy_hash: hash },
    question_refs: [{ question_id: 'q-1', question_version: 1, semantic_hash: hash }],
    asset_refs: [{ asset_id: 'asset-1', asset_version: 1, file_hash: hash, rights_hash: hash }],
    renderer_refs: [{ renderer_id: 'renderer-1', renderer_version: '1', renderer_hash: hash }],
    evidence_refs: [{ evidence_id: 'evidence-1', evidence_version: '1', evidence_hash: hash }],
    manifest_ref: { manifest_id: 'manifest-1', manifest_version: '1', manifest_hash: hash, signer_principal_id: 'principal-signer', key_id: 'anchor-1' },
    approval_ref: {
      approval_id: 'approval-1',
      approval_version: '1',
      approval_hash: hash,
      signer_principal_id: 'principal-approver',
      scope: 'JOB_SKILL_PREVIEW_ONLY',
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity,
      key_id: 'anchor-1'
    }
  }
}

describe('PREVIEW_CONTRACT_V1 canonical and legacy registry', () => {
  it('validates and hashes the complete reference set', () => {
    const value = refs()
    assertCanonicalReferenceSet(value)
    const first = canonicalReferenceSetDigest(value)
    const changed = { ...value, pack_ref: { ...value.pack_ref, pack_hash: 'b'.repeat(64) } }
    expect(canonicalReferenceSetDigest(changed)).not.toBe(first)
  })

  it('rejects unknown fields and scope escalation', () => {
    expect(() => assertCanonicalReferenceSet({ ...refs(), extra: true } as never)).toThrow(/unknown fields/)
    expect(() => assertScope({
      ...refs().source_ref.scope,
      permissions: ['PREVIEW_PACK_PUBLISH', 'ADMIN_DATABASE_WRITE']
    })).not.toThrow()
  })

  it('prevents the same event/version from being owned by two paths', () => {
    const registry = new PreviewContractRegistry()
    const descriptor = {
      event_type: 'PREVIEW_SESSION_STARTED',
      event_payload_version: 1,
      aggregate_type: 'PREVIEW_SESSION',
      contract_version: 'PREVIEW_CONTRACT_V1' as const,
      allowed_shell_kind: 'PREVIEW_SHELL' as const,
      projector_name: 'preview-session-projector',
      result_suppressed: true
    }
    registry.registerEvent(descriptor)
    expect(() => registry.registerEvent({ ...descriptor, allowed_shell_kind: 'FORMAL_SHELL' })).toThrow(PreviewContractRegistryError)
  })

  it('maps old SESSION_STARTED v1/v2 to formal and rejects unknown versions', () => {
    expect(interpretLegacySessionStarted({ strategy_type: 'JOB_SKILL_ASSESSMENT' } as never)).toMatchObject({
      payload_version: 1,
      delivery_mode: 'FORMAL_DEMO'
    })
    expect(interpretLegacySessionStarted({ payload_version: 2 } as never)).toMatchObject({
      payload_version: 2,
      delivery_mode: 'FORMAL_DEMO'
    })
    expect(() => interpretLegacySessionStarted({ payload_version: 3 } as never)).toThrow(/unknown SESSION_STARTED/)
  })

  it('registers the complete READY evidence set with non-empty digests', () => {
    const readiness = previewContractReadiness('READY')
    expect(PREVIEW_EVENT_TYPES).toHaveLength(16)
    expect(PREVIEW_COMMAND_TYPES).toHaveLength(16)
    expect(PREVIEW_PROJECTION_NAMES).toHaveLength(7)
    expect(readiness).toMatchObject({
      registry_id: 'PREVIEW_CONTRACT_V1',
      status: 'READY',
      schema_version: '0.1.19-job-skill-preview-contract-v1',
      migration_id: '2026-08-01_job_skill_preview_contract_v1'
    })
    for (const field of ['event_registry_digest', 'projection_digest', 'query_digest', 'recovery_digest', 'error_map_digest'] as const) {
      expect(readiness[field]).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
