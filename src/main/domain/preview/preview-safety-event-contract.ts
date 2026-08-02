import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PreviewContractError } from './preview-errors'

export const PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION = 1

export interface PreviewSafetyIncidentFact {
  incident_id: string
  preview_session_id: string
  session_id: string
  student_id: string
  job_code: string
  task_code: string
  reason_code: string
  status_after: 'OPEN'
  preview_redline_ref: string
  snapshot_root_hash: string
  occurred_at: string
}

function text(value: CanonicalJsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} is invalid`, field)
  return value
}

export function validatePreviewSafetyPayload(payload: Readonly<Record<string, CanonicalJsonValue>>): PreviewSafetyIncidentFact {
  const expected = ['actor_role', 'allowed_shell_kind', 'app_version', 'batch_context', 'contract_version', 'correlation_id', 'event_payload_version', 'incident_id', 'job_code', 'occurred_at', 'preview_redline_ref', 'preview_session_id', 'reason_code', 'session_id', 'snapshot_root_hash', 'status_after', 'student_id', 'task_code']
  const actual = Object.keys(payload).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'preview safety payload field set mismatch')
  if (payload.event_payload_version !== PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION || payload.contract_version !== PREVIEW_CONTRACT_VERSION || payload.allowed_shell_kind !== 'PREVIEW_SHELL') throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview safety ownership metadata is invalid')
  if (payload.actor_role !== 'STUDENT' && payload.actor_role !== 'TEACHER' && payload.actor_role !== 'ADMIN' && payload.actor_role !== 'SYSTEM') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview safety actor role is invalid')
  const occurredAt = text(payload.occurred_at, 'occurred_at')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt) || new Date(occurredAt).toISOString() !== occurredAt) throw new PreviewContractError('PREVIEW_VALIDITY_INVALID', 'occurred_at is invalid')
  const incidentId = text(payload.incident_id, 'incident_id')
  const previewSessionId = text(payload.preview_session_id, 'preview_session_id')
  const sessionId = text(payload.session_id, 'session_id')
  const studentId = text(payload.student_id, 'student_id')
  const jobCode = text(payload.job_code, 'job_code')
  const taskCode = text(payload.task_code, 'task_code')
  const reasonCode = text(payload.reason_code, 'reason_code')
  const previewRedlineRef = text(payload.preview_redline_ref, 'preview_redline_ref')
  const snapshotRootHash = text(payload.snapshot_root_hash, 'snapshot_root_hash')
  if (payload.status_after !== 'OPEN') throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview safety status must be OPEN')
  return { incident_id: incidentId, preview_session_id: previewSessionId, session_id: sessionId, student_id: studentId, job_code: jobCode, task_code: taskCode, reason_code: reasonCode, status_after: 'OPEN', preview_redline_ref: previewRedlineRef, snapshot_root_hash: snapshotRootHash, occurred_at: occurredAt }
}
