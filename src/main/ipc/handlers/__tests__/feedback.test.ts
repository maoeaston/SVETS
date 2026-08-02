import { describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import { canonicalJson } from '../../../domain/event-batch/canonical-json'
import type { PreviewCanonicalReferenceSet } from '../../../../shared/types/preview-contract'
import {
  assertFeedbackQueryDoesNotExposeBody,
  getFeedbackReference,
  listFeedbackReferences
} from '../../../application/query/feedback-query-service'

function sourceReferencesJson(
  sourceRefId = 'source-1',
  installationId = 'install-1',
  jobCode = 'SUPERMARKET_SHELVER',
  taskCode = 'UNBOX_AND_SHELF'
): string {
  const hash = 'c'.repeat(64)
  const references: PreviewCanonicalReferenceSet = {
    source_ref: {
      source_ref_id: sourceRefId,
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'authority-1',
      authority_hash: hash,
      scope: {
        organization_id: 'org-1',
        installation_id: installationId,
        job_code: jobCode,
        task_code: taskCode,
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
  return canonicalJson(references as never)
}

const feedbackRow = {
  feedback_id: 'feedback-1',
  revision_no: 1,
  feedback_commit_id: 'commit-1',
  proof_hash: 'a'.repeat(64),
  session_id: 'preview-session-1',
  organization_id: 'org-1',
  status: 'RECONCILED_SUBMITTED',
  body_hash: 'b'.repeat(64),
  session_export_ref: 'session-export-1',
  subject_export_ref: 'subject-export-1',
  tombstone_id: null,
  source_namespace: 'preview_publish_set',
  source_delivery_mode: 'PREVIEW_ONLY',
  source_organization_id: 'org-1',
  source_installation_id: 'install-1',
  session_job_code: 'SUPERMARKET_SHELVER',
  session_task_code: 'UNBOX_AND_SHELF',
  assignment_status: 'ACTIVE',
  grant_status: 'ACTIVE',
  responsibility_teacher_user_id: 'teacher-1',
  grant_expires_at: '2026-08-15T00:00:00.000Z',
  release_source_ref_id: 'source-1',
  source_references_json: sourceReferencesJson()
}

class FeedbackQueryFixture {
  readonly queries: string[] = []

  constructor(private readonly row = feedbackRow) {}

  prepare(sql: string) {
    this.queries.push(sql)
    return {
      get: (...params: unknown[]) => {
        const organizationId = params[params.length - 1]
        return organizationId === 'org-1' ? this.row : undefined
      },
      all: (...params: unknown[]) => params[0] === 'org-1' ? [this.row] : []
    }
  }
}

function fixtureDb(row = feedbackRow): FeedbackQueryFixture & DBAdapter {
  return new FeedbackQueryFixture(row) as unknown as FeedbackQueryFixture & DBAdapter
}

describe('feedback IPC read model', () => {
  it('returns reference/status facts without vault body or identity map', () => {
    const database = fixtureDb()
    const result = listFeedbackReferences(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1']
    })
    const latest = getFeedbackReference(database, {
      feedbackId: 'feedback-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1']
    })

    expect(result[0]).toMatchObject({
      feedback_id: 'feedback-1',
      status: 'RECONCILED_SUBMITTED'
    })
    expect(latest).not.toHaveProperty('body')
    expect(latest).not.toHaveProperty('identity_map')
    expect(database.queries.every((query) => !query.includes('feedback_vault'))).toBe(true)
    expect(database.queries.every((query) => query.includes("r.status IN ('RECONCILED_SUBMITTED', 'RECONCILED_DELETED')"))).toBe(true)
  })

  it('does not return a feedback reference across organization scope', () => {
    const database = fixtureDb()
    expect(listFeedbackReferences(database, {
      organizationId: 'org-2',
      authorizedInstallationIds: ['install-1']
    })).toEqual([])
    expect(getFeedbackReference(database, {
      feedbackId: 'feedback-1',
      organizationId: 'org-2',
      authorizedInstallationIds: ['install-1']
    })).toBeNull()
  })

  it('does not return a reference outside the trusted principal installation scope', () => {
    const database = fixtureDb()
    expect(listFeedbackReferences(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['other-installation']
    })).toEqual([])
    expect(getFeedbackReference(database, {
      feedbackId: 'feedback-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['other-installation']
    })).toBeNull()
  })

  it('fails closed when a private field is accidentally added to a query result', () => {
    expect(() => assertFeedbackQueryDoesNotExposeBody({ status: 'DRAFT', body: 'private' }))
      .toThrowError(expect.objectContaining({ code: 'FEEDBACK_PRIVACY_VIOLATION' }))
  })

  it('limits teacher feedback reads to the responsible active grant owner', () => {
    const database = fixtureDb()
    expect(listFeedbackReferences(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER',
      callerUserId: 'teacher-1',
      now: new Date('2026-08-02T00:00:00.000Z')
    })).toHaveLength(1)
    expect(listFeedbackReferences(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER',
      callerUserId: 'teacher-2'
    })).toEqual([])
    expect(getFeedbackReference(database, {
      feedbackId: 'feedback-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER',
      callerUserId: 'teacher-2'
    })).toBeNull()
  })

  it('fails closed for a teacher after the delegated grant expires', () => {
    const database = fixtureDb({
      ...feedbackRow,
      grant_expires_at: '2026-08-01T00:00:00.000Z'
    })
    expect(listFeedbackReferences(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER',
      callerUserId: 'teacher-1',
      now: new Date('2026-08-02T00:00:00.000Z')
    })).toEqual([])
    expect(getFeedbackReference(database, {
      feedbackId: 'feedback-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER',
      callerUserId: 'teacher-1',
      now: new Date('2026-08-02T00:00:00.000Z')
    })).toBeNull()
  })

  it('fails closed when the release reference is malformed or source-bound to another projection', () => {
    const malformed = fixtureDb({ ...feedbackRow, source_references_json: '{"source_ref":' })
    expect(listFeedbackReferences(malformed, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1']
    })).toEqual([])

    const drifted = fixtureDb({ ...feedbackRow, source_references_json: sourceReferencesJson('source-other') })
    expect(getFeedbackReference(drifted, {
      feedbackId: 'feedback-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1']
    })).toBeNull()

    const scopeDrifted = fixtureDb({
      ...feedbackRow,
      source_references_json: sourceReferencesJson('source-1', 'install-1', 'SUPERMARKET_SHELVER', 'OTHER_TASK')
    })
    expect(listFeedbackReferences(scopeDrifted, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1']
    })).toEqual([])
  })
})
