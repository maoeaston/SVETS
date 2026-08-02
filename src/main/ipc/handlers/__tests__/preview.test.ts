import { describe, expect, it } from 'vitest'
import type { DBAdapter } from '../../../db/interface'
import { canonicalJson } from '../../../domain/event-batch/canonical-json'
import {
  getPreviewRelease,
  getPreviewSession,
  listPreviewSessionQuestions,
  listPreviewSources
} from '../../../application/query/preview-query-service'
import type { PreviewCanonicalReferenceSet } from '../../../../shared/types/preview-contract'

const hash = 'a'.repeat(64)

function references(): PreviewCanonicalReferenceSet {
  return {
    source_ref: {
      source_ref_id: 'source-1',
      namespace: 'preview_publish_set',
      delivery_mode: 'PREVIEW_ONLY',
      authority_id: 'authority-1',
      authority_hash: hash,
      scope: {
        organization_id: 'org-1',
        installation_id: 'install-1',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        permissions: ['PREVIEW_PACK_PUBLISH']
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
    manifest_ref: {
      manifest_id: 'manifest-1',
      manifest_version: '1',
      manifest_hash: hash,
      signer_principal_id: 'principal-1',
      key_id: 'key-1'
    },
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

function releaseRow() {
  return {
    release_id: 'release-1',
    source_ref_id: 'source-1',
    delivery_mode: 'PREVIEW_ONLY',
    question_id: 'question-1',
    question_version: 1,
    semantic_hash: hash,
    pack_id: 'pack-1',
    pack_version: '1',
    pack_hash: hash,
    strategy_id: 'strategy-1',
    strategy_version: 1,
    policy_hash: hash,
    approval_id: 'approval-1',
    approval_hash: hash,
    manifest_id: 'manifest-1',
    manifest_hash: hash,
    references_json: canonicalJson(references()),
    status: 'ACTIVE',
    effective_at: '2026-08-01T00:00:00.000Z',
    expires_at: '2026-08-15T00:00:00.000Z',
    revoked_at: null,
    audit_ref: 'audit-1'
  }
}

function sessionRow() {
  return {
    preview_session_id: 'preview-session-1',
    assessment_session_id: 'assessment-session-1',
    student_id: 'student-1',
    job_code: 'SUPERMARKET_SHELVER',
    task_code: 'UNBOX_AND_SHELF',
    source_ref_id: 'source-1',
    pack_id: 'pack-1',
    pack_version: '1',
    pack_hash: hash,
    strategy_id: 'strategy-1',
    strategy_version: 1,
    status: 'ACTIVE',
    assignment_id: 'assignment-1',
    grant_id: 'grant-1',
    snapshot_root_hash: hash,
    result_suppressed: 1,
    preview_redline_ref: null,
    snapshot_json: canonicalJson({
      snapshot_schema_version: 'preview-contract-v1',
      session_id: 'preview-session-1',
      assessment_session_id: 'assessment-session-1',
      student_id: 'student-1',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'UNBOX_AND_SHELF',
      device_id: 'device-1',
      pack_ref: { pack_id: 'pack-1', pack_version: '1', pack_hash: hash }
    }),
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z'
  }
}

class PreviewQueryFixture {
  readonly queries: string[] = []
  private readonly release = releaseRow()
  private readonly session = sessionRow()
  private readonly question = {
    session_question_id: 'session-question-1',
    preview_session_id: 'preview-session-1',
    question_id: 'question-1',
    question_version: 1,
    semantic_hash: hash,
    question_order: 1,
    question_phase: 'ONLINE',
    snapshot_json: canonicalJson({ content: { safe: true } }),
    content_hash: hash,
    scoring_hash: hash,
    renderer_hash: hash,
    safety_ref: 'safety-1'
  }

  setReleaseReferences(value: PreviewCanonicalReferenceSet): void {
    this.release.references_json = canonicalJson(value)
  }

  prepare(sql: string) {
    this.queries.push(sql)
    return {
      get: (...params: unknown[]) => {
        if (sql.includes('FROM business_session_assignment')) {
          return params[2] === 'teacher-1' ? { authorized: 1 } : undefined
        }
        if (sql.includes('SELECT references_json FROM preview_release_projection')) {
          return { references_json: this.release.references_json }
        }
        if (sql.includes('FROM preview_session_projection')) return this.session
        if (sql.includes('FROM preview_release_projection')) return this.release
        return undefined
      },
      all: () => {
        if (sql.includes('FROM preview_session_question_projection')) return [this.question]
        if (sql.includes('FROM preview_release_projection')) return [this.release]
        return []
      }
    }
  }
}

function fixtureDb(): PreviewQueryFixture & DBAdapter {
  return new PreviewQueryFixture() as unknown as PreviewQueryFixture & DBAdapter
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action()
    throw new Error('expected ' + code)
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}

describe('preview IPC read model', () => {
  it('reads only preview projections and preserves canonical scope', () => {
    const database = fixtureDb()
    const sources = listPreviewSources(database, { organizationId: 'org-1', authorizedInstallationIds: ['install-1'] })
    const release = getPreviewRelease(database, { releaseId: 'release-1', organizationId: 'org-1', authorizedInstallationIds: ['install-1'] })
    const session = getPreviewSession(database, {
      sessionId: 'preview-session-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      studentId: 'student-1',
      deviceId: 'device-1'
    })
    const questions = listPreviewSessionQuestions(database, {
      sessionId: 'preview-session-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      studentId: 'student-1',
      deviceId: 'device-1'
    })

    expect(sources).toHaveLength(1)
    expect(release?.canonicalReferences).toMatchObject({ source_ref: { namespace: 'preview_publish_set' } })
    expect(session?.snapshot).toMatchObject({ device_id: 'device-1' })
    expect(questions).toHaveLength(1)
    expect(database.queries.some((query) => query.includes('question_bank'))).toBe(false)
    expect(database.queries.some((query) => query.includes('formal'))).toBe(false)
  })

  it('rejects organization scope mismatch instead of falling back to formal data', () => {
    const database = fixtureDb()
    expectCode(
      () => getPreviewRelease(database, { releaseId: 'release-1', organizationId: 'org-2', authorizedInstallationIds: ['install-1'] }),
      'PREVIEW_SCOPE_INVALID'
    )
  })

  it('binds student session reads to the trusted student scope', () => {
    const database = fixtureDb()
    expectCode(
      () => getPreviewSession(database, {
        sessionId: 'assessment-session-1',
        organizationId: 'org-1',
        authorizedInstallationIds: [],
        studentId: 'student-2',
        deviceId: 'device-1'
      }),
      'PREVIEW_SCOPE_INVALID'
    )
  })

  it('rejects a teacher/admin source outside the trusted principal installation scope', () => {
    const database = fixtureDb()
    expect(listPreviewSources(database, {
      organizationId: 'org-1',
      authorizedInstallationIds: ['other-installation']
    })).toEqual([])
    expectCode(
      () => getPreviewRelease(database, {
        releaseId: 'release-1',
        organizationId: 'org-1',
        authorizedInstallationIds: ['other-installation']
      }),
      'PREVIEW_SCOPE_INVALID'
    )
  })

  it('rejects a student device mismatch even when user and organization match', () => {
    const database = fixtureDb()
    expectCode(
      () => getPreviewSession(database, {
        sessionId: 'preview-session-1',
        organizationId: 'org-1',
        authorizedInstallationIds: [],
        studentId: 'student-1',
        deviceId: 'forged-device'
      }),
      'PREVIEW_SCOPE_INVALID'
    )
  })

  it('fails closed when the session release references a formal source namespace', () => {
    const database = fixtureDb()
    database.setReleaseReferences({
      ...references(),
      source_ref: {
        ...references().source_ref,
        namespace: 'official_publish_set',
        delivery_mode: 'FORMAL_DEMO'
      }
    })
    const input = {
      sessionId: 'preview-session-1',
      organizationId: 'org-1',
      authorizedInstallationIds: [],
      studentId: 'student-1',
      deviceId: 'device-1'
    }
    expectCode(() => getPreviewSession(database, input), 'PREVIEW_SOURCE_AUTHORITY_MISSING')
    expectCode(() => listPreviewSessionQuestions(database, input), 'PREVIEW_SOURCE_AUTHORITY_MISSING')
  })

  it('binds teacher session reads to the active assignment and delegated grant owner', () => {
    const database = fixtureDb()
    const input = {
      sessionId: 'preview-session-1',
      organizationId: 'org-1',
      authorizedInstallationIds: ['install-1'],
      callerRole: 'TEACHER' as const,
      callerUserId: 'teacher-1',
      now: new Date('2026-08-01T12:00:00.000Z')
    }
    expect(getPreviewSession(database, input)?.previewSessionId).toBe('preview-session-1')
    expect(listPreviewSessionQuestions(database, input)).toHaveLength(1)
    expectCode(
      () => getPreviewSession(database, { ...input, callerUserId: 'teacher-2' }),
      'PREVIEW_SCOPE_INVALID'
    )
  })
})
