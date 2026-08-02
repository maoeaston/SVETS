import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '../event-batch/canonical-json'
import { PreviewContractError } from '../preview/preview-errors'
import { scanFeedbackForPrivateData } from './feedback-pii-scanner'

export interface FeedbackBodyV1 {
  feedback_id: string
  revision_no: number
  session_export_ref: string
  subject_export_ref: string
  body: Readonly<Record<string, CanonicalJsonValue>>
}

export function serializeFeedbackBody(body: FeedbackBodyV1): Readonly<{ canonical_json: string; body_hash: string }> {
  if (!Number.isSafeInteger(body.revision_no) || body.revision_no < 1) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'feedback revision_no is invalid')
  scanFeedbackForPrivateData({ session_export_ref: body.session_export_ref, subject_export_ref: body.subject_export_ref, body: body.body })
  let canonical: string
  try {
    canonical = canonicalJson(body as unknown as CanonicalJsonValue)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'feedback body is not canonical JSON', undefined, error)
  }
  return Object.freeze({ canonical_json: canonical, body_hash: sha256Hex(canonical) })
}

export function parseFeedbackBody(canonical: string): FeedbackBodyV1 {
  try {
    const value = JSON.parse(canonical) as FeedbackBodyV1
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body is not an object')
    scanFeedbackForPrivateData(value)
    return value
  } catch (error) {
    if (error instanceof PreviewContractError) throw error
    throw new PreviewContractError('FEEDBACK_PRIVACY_VIOLATION', 'stored feedback body is invalid', undefined, error)
  }
}
