import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import { canonicalJson, sha256Hex } from '../event-batch/canonical-json'
import { PreviewContractError } from '../preview/preview-errors'
import { scanFeedbackForPrivateData } from './feedback-pii-scanner'

export interface AnonymousFeedbackExportV1 {
  export_format: 'preview-feedback-export-v1'
  export_ref: string
  feedback_ref: string
  revision_no: number
  session_export_ref: string
  subject_export_ref: string
  body_hash: string
  submitted_at: string
  status: 'SUBMITTED' | 'DELETED'
}

export function buildAnonymousFeedbackExport(value: AnonymousFeedbackExportV1): Readonly<{ json: string; export_hash: string }> {
  if (value.export_format !== 'preview-feedback-export-v1' || !value.export_ref || !value.feedback_ref || !value.session_export_ref || !value.subject_export_ref || !value.body_hash) throw new PreviewContractError('FEEDBACK_PRIVACY_VIOLATION', 'anonymous feedback export allowlist is incomplete')
  scanFeedbackForPrivateData(value)
  const json = canonicalJson(value as unknown as CanonicalJsonValue)
  return Object.freeze({ json, export_hash: sha256Hex(json) })
}
