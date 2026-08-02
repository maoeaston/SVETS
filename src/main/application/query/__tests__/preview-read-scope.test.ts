import { describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import { canonicalJson } from '../../../domain/event-batch/canonical-json'
import type { PreviewCanonicalReferenceSet } from '../../../../shared/types/preview-contract'
import { resolveAuthorizedPreviewInstallationIds } from '../preview-read-scope'

const baseRow = {
  mapping_id: 'mapping-1',
  target_installation_id: 'install-1',
  organization_id: 'org-1',
  user_id: 'teacher-1',
  principal_id: 'principal-1',
  mapping_version: 1,
  mapping_hash: 'a'.repeat(64),
  source_manifest_id: 'manifest-1',
  source_manifest_hash: 'b'.repeat(64),
  effective_at: '2026-08-01T00:00:00.000Z',
  expires_at: '2026-08-02T00:00:00.000Z',
  revoked_at: null,
  status: 'ACTIVE',
  signer_key_id: 'key-1',
  signature: 'signature-1',
  created_event_id: 'event-1'
}

function previewReferences(installationId: string, organizationId = 'org-1'): PreviewCanonicalReferenceSet {
  const hash = 'c'.repeat(64)
  return {
    source_ref: {
      source_ref_id: `source-${installationId}`,
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'authority-1',
      authority_hash: hash,
      scope: {
        organization_id: organizationId,
        installation_id: installationId,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_SESSION_START']
      },
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      }
    },
    pack_ref: { pack_id: 'pack-1', pack_version: '1', pack_hash: hash },
    strategy_ref: { strategy_id: 'strategy-1', strategy_version: 1, policy_hash: hash, scoring_policy_hash: hash },
    question_refs: [{ question_id: 'question-1', question_version: 1, semantic_hash: hash }],
    asset_refs: [],
    renderer_refs: [{ renderer_id: 'renderer-1', renderer_version: '1', renderer_hash: hash }],
    evidence_refs: [],
    manifest_ref: { manifest_id: 'manifest-1', manifest_version: '1', manifest_hash: hash, signer_principal_id: 'principal-1', key_id: 'key-1' },
    approval_ref: {
      approval_id: 'approval-1',
      approval_version: '1',
      approval_hash: hash,
      signer_principal_id: 'principal-1',
      scope: 'JOB_SKILL_PREVIEW_ONLY',
      allowed_actions: ['PREVIEW_PACK_PUBLISH'],
      validity: {
        issued_at: '2026-08-01T00:00:00.000Z',
        effective_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-15T00:00:00.000Z',
        revoked_at: null
      },
      key_id: 'key-1'
    }
  }
}

class ScopeFixture {
  prepare(sql: string) {
    if (sql.includes('preview_release_projection')) {
      return {
        all: () => [
          { references_json: canonicalJson(previewReferences('install-1') as never) },
          { references_json: canonicalJson(previewReferences('install-2') as never) },
          { references_json: canonicalJson(previewReferences('install-other-org', 'org-2') as never) }
        ]
      }
    }
    return { all: () => [
      baseRow,
      { ...baseRow, mapping_id: 'mapping-expired', target_installation_id: 'install-expired', expires_at: '2026-07-31T00:00:00.000Z' },
      { ...baseRow, mapping_id: 'mapping-other-user', target_installation_id: 'install-other-user', user_id: 'teacher-2' },
      { ...baseRow, mapping_id: 'mapping-other-org', target_installation_id: 'install-other-org', organization_id: 'org-2' },
      { ...baseRow, mapping_id: 'mapping-revoked', target_installation_id: 'install-revoked', status: 'REVOKED' }
    ] }
  }
}

describe('preview read authorization scope', () => {
  it('returns only current bindings for the trusted user and organization', () => {
    const database = new ScopeFixture() as unknown as DBAdapter
    expect(resolveAuthorizedPreviewInstallationIds(database, {
      userId: 'teacher-1',
      organizationId: 'org-1',
      now: new Date('2026-08-01T12:00:00.000Z')
    })).toEqual(['install-1'])
  })

  it('gives a teacher directory scope from canonical preview releases without a principal mapping', () => {
    const database = new ScopeFixture() as unknown as DBAdapter
    expect(resolveAuthorizedPreviewInstallationIds(database, {
      userId: 'teacher-without-principal-binding',
      organizationId: 'org-1',
      role: 'TEACHER'
    })).toEqual(['install-1', 'install-2'])
  })
})
