import type { DBAdapter } from '../../db/interface'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import {
  assertCanonicalReferenceSet,
  parsePreviewCanonicalJson
} from '../../domain/preview/preview-canonical'
import type { PreviewCanonicalReferenceSet } from '../../../shared/types/preview-contract'
import type { FeedbackReferenceView } from '../../../shared/types/feedback-ipc'

export type { FeedbackReferenceView } from '../../../shared/types/feedback-ipc'

type FeedbackCallerRole = 'TEACHER' | 'ADMIN'

interface FeedbackCallerScope {
  callerRole?: FeedbackCallerRole
  callerUserId?: string
  now?: Date
}

function parseSourceReferences(row: Record<string, unknown>): PreviewCanonicalReferenceSet | null {
  if (typeof row.source_references_json !== 'string') return null
  try {
    const references = parsePreviewCanonicalJson(row.source_references_json) as unknown as PreviewCanonicalReferenceSet
    assertCanonicalReferenceSet(references)
    return references
  } catch {
    return null
  }
}

function view(row: Record<string, unknown>): FeedbackReferenceView {
  return {
    feedback_id: String(row.feedback_id), revision_no: Number(row.revision_no), feedback_commit_id: String(row.feedback_commit_id), proof_hash: String(row.proof_hash), session_id: String(row.session_id), organization_id: String(row.organization_id), status: String(row.status), body_hash: String(row.body_hash), session_export_ref: String(row.session_export_ref), subject_export_ref: String(row.subject_export_ref), tombstone_id: row.tombstone_id === null || row.tombstone_id === undefined ? null : String(row.tombstone_id)
  }
}

function isAuthorizedPreviewSource(
  row: Record<string, unknown>,
  organizationId: string,
  authorizedInstallationIds: readonly string[],
  caller: FeedbackCallerScope
): boolean {
  const references = parseSourceReferences(row)
  if (!references) return false
  const source = references.source_ref
  const sourceAuthorized = row.organization_id === organizationId
    && row.release_source_ref_id === source.source_ref_id
    && source.namespace === 'preview_publish_set'
    && source.delivery_mode === 'PREVIEW_ONLY'
    && source.scope.organization_id === organizationId
    && source.scope.job_code === row.session_job_code
    && source.scope.task_code === row.session_task_code
    && authorizedInstallationIds.includes(source.scope.installation_id)
  if (!sourceAuthorized) return false
  if (caller.callerRole !== 'TEACHER') return true
  const now = caller.now ?? new Date()
  const grantExpiresAt = typeof row.grant_expires_at === 'string'
    ? Date.parse(row.grant_expires_at)
    : Number.NaN
  return typeof caller.callerUserId === 'string'
    && row.responsibility_teacher_user_id === caller.callerUserId
    && row.assignment_status === 'ACTIVE'
    && row.grant_status === 'ACTIVE'
    && Number.isFinite(grantExpiresAt)
    && Number.isFinite(now.getTime())
    && grantExpiresAt > now.getTime()
}

const REFERENCE_SELECT = `
       SELECT r.feedback_id, r.revision_no, r.feedback_commit_id, r.proof_hash,
              r.session_id, r.organization_id, r.status, r.body_hash,
              r.session_export_ref, r.subject_export_ref, t.tombstone_id,
              s.job_code AS session_job_code,
              s.task_code AS session_task_code,
              p.source_ref_id AS release_source_ref_id,
              p.references_json AS source_references_json,
              a.status AS assignment_status,
              g.status AS grant_status,
              g.teacher_user_id AS responsibility_teacher_user_id,
              g.expires_at AS grant_expires_at
         FROM preview_feedback_reference_projection r
         LEFT JOIN preview_feedback_tombstone_projection t
           ON t.feedback_id = r.feedback_id AND t.revision_no = r.revision_no
         JOIN preview_session_projection s
           ON s.preview_session_id = r.session_id OR s.assessment_session_id = r.session_id
         JOIN preview_release_projection p ON p.source_ref_id = s.source_ref_id
         JOIN business_session_assignment a
           ON a.assignment_id = s.assignment_id
          AND a.grant_id = s.grant_id
          AND a.business_session_id = s.assessment_session_id
          AND a.student_id = s.student_id
         JOIN delegated_access_grant g
           ON g.grant_id = s.grant_id
          AND g.business_session_id = s.assessment_session_id
          AND g.student_id = s.student_id`

const EXTERNAL_STATUS_FILTER = "r.status IN ('RECONCILED_SUBMITTED', 'RECONCILED_DELETED')"

export function listFeedbackReferences(database: DBAdapter, input: { organizationId: string; authorizedInstallationIds: readonly string[] } & FeedbackCallerScope): readonly FeedbackReferenceView[] {
  const rows = database.prepare(
    `${REFERENCE_SELECT}
        WHERE ${EXTERNAL_STATUS_FILTER}
          AND r.organization_id = ?
        ORDER BY r.feedback_id, r.revision_no`
  ).all(input.organizationId) as Record<string, unknown>[]
  return Object.freeze(rows.filter((row) => isAuthorizedPreviewSource(row, input.organizationId, input.authorizedInstallationIds, input)).map(view))
}

export function getFeedbackReference(database: DBAdapter, input: { feedbackId: string; revisionNo?: number; organizationId: string; authorizedInstallationIds: readonly string[] } & FeedbackCallerScope): FeedbackReferenceView | null {
  const row = input.revisionNo === undefined
    ? database.prepare(`${REFERENCE_SELECT}
        WHERE ${EXTERNAL_STATUS_FILTER}
          AND r.feedback_id = ? AND r.organization_id = ?
        ORDER BY r.revision_no DESC LIMIT 1`).get(input.feedbackId, input.organizationId)
    : database.prepare(`${REFERENCE_SELECT}
        WHERE ${EXTERNAL_STATUS_FILTER}
          AND r.feedback_id = ? AND r.revision_no = ? AND r.organization_id = ?`).get(input.feedbackId, input.revisionNo, input.organizationId)
  const record = row as Record<string, unknown> | undefined
  return record && isAuthorizedPreviewSource(record, input.organizationId, input.authorizedInstallationIds, input) ? view(record) : null
}

export function assertFeedbackQueryDoesNotExposeBody(value: unknown): void {
  if (value && typeof value === 'object' && ('body' in value || 'identity_map' in value || 'password' in value)) throw new PreviewContractError('FEEDBACK_PRIVACY_VIOLATION', 'feedback query exposed private vault data')
}
