import type { DBAdapter } from '../../db/interface'
import type { FeedbackVault, PreparedFeedbackCommit } from './feedback-vault'
import { PreviewContractError } from '../preview/preview-errors'

export class FeedbackDeleteService {
  constructor(private readonly database: DBAdapter, private readonly vault: FeedbackVault) {}

  reserveDelete(input: {
    feedback_id: string
    revision_no: number
    session_export_ref: string
    subject_export_ref: string
    organization_id: string
    installation_id: string
    request_hash: string
    actor_auth_ref: string
    issued_at: string
    expires_at: string
    reason_code: string
  }): PreparedFeedbackCommit {
    const row = this.database.prepare('SELECT feedback_id, revision_no, status FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ? ORDER BY created_at DESC LIMIT 1').get(input.feedback_id, input.revision_no) as { feedback_id: string; revision_no: number; status: string } | undefined
    if (!row || !['RECONCILED_SUBMITTED', 'RECONCILE_REQUIRED'].includes(row.status)) throw new PreviewContractError('FEEDBACK_STATE_CONFLICT', 'feedback is not deletable')
    return this.vault.reserveIntent({ ...input, operation: 'DELETE', feedback_id: input.feedback_id })
  }

  assertTombstoneDoesNotReuseSubmitCommit(input: { feedback_id: string; revision_no: number; feedback_commit_id: string }): void {
    const submit = this.database.prepare('SELECT feedback_commit_id FROM preview_feedback_reference_projection WHERE feedback_id = ? AND revision_no = ?').get(input.feedback_id, input.revision_no) as { feedback_commit_id: string } | undefined
    if (submit?.feedback_commit_id === input.feedback_commit_id) throw new PreviewContractError('FEEDBACK_COMMIT_CONFLICT', 'delete must use a new commit id')
  }
}
