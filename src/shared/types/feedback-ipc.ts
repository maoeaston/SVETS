export type FeedbackListQueryParams = Record<never, never>

export interface FeedbackGetQueryParams {
  feedbackId: string
  revisionNo?: number
}

export interface FeedbackReferenceView {
  feedback_id: string
  revision_no: number
  feedback_commit_id: string
  proof_hash: string
  session_id: string
  organization_id: string
  status: string
  body_hash: string
  session_export_ref: string
  subject_export_ref: string
  tombstone_id: string | null
}

export type FeedbackQueryErrorCode = 'FEEDBACK_RECONCILE_REQUIRED' | 'FEEDBACK_PRIVACY_VIOLATION' | 'FORBIDDEN'
