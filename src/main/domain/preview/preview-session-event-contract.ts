import type { CanonicalJsonValue } from '../event-batch/canonical-json'
import { PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import type { PreviewSessionSnapshot, PreviewSessionStatus } from '../../../shared/types/preview-contract'
import { assertPreviewSessionSnapshot } from './preview-session-snapshot'
import { PreviewContractError } from './preview-errors'

export const PREVIEW_SESSION_EVENT_PAYLOAD_VERSION = 1

export type PreviewSessionEventType =
  | 'PREVIEW_SESSION_STARTED'
  | 'PREVIEW_SESSION_COMPLETED'
  | 'PREVIEW_SESSION_ABORTED'
  | 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION'

export interface PreviewSessionStatusFact {
  session_id: string
  snapshot_root_hash: string
  status_before: PreviewSessionStatus
  status_after: PreviewSessionStatus
  reason_code: string
  event_payload_version: number
  batch_context: CanonicalJsonValue
  actor_role: CanonicalJsonValue
  app_version: CanonicalJsonValue
  correlation_id: CanonicalJsonValue
  contract_version: CanonicalJsonValue
  allowed_shell_kind: CanonicalJsonValue
}

function record(value: CanonicalJsonValue, field: string): Record<string, CanonicalJsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', `${field} must be an object`)
  return value as Record<string, CanonicalJsonValue>
}

function exactKeys(payload: Record<string, CanonicalJsonValue>, expected: readonly string[]): void {
  const actual = Object.keys(payload).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new PreviewContractError('PREVIEW_UNKNOWN_FIELD', 'preview session event payload field set mismatch')
}

function metadata(payload: Record<string, CanonicalJsonValue>): void {
  if (payload.event_payload_version !== PREVIEW_SESSION_EVENT_PAYLOAD_VERSION || payload.contract_version !== PREVIEW_CONTRACT_VERSION || payload.allowed_shell_kind !== 'PREVIEW_SHELL') throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview session event metadata is invalid')
  if (typeof payload.batch_context !== 'object' || payload.batch_context === null || Array.isArray(payload.batch_context)) throw new PreviewContractError('PREVIEW_CANONICAL_INVALID', 'batch_context is invalid')
}

export function validatePreviewSessionStartedPayload(payload: Record<string, CanonicalJsonValue>): PreviewSessionSnapshot {
  metadata(payload)
  exactKeys(payload, ['actor_role', 'allowed_shell_kind', 'app_version', 'batch_context', 'contract_version', 'correlation_id', 'event_payload_version', 'snapshot'])
  return assertPreviewSessionSnapshot(record(payload.snapshot, 'snapshot') as unknown as PreviewSessionSnapshot)
}

export function validatePreviewSessionStatusPayload(payload: Record<string, CanonicalJsonValue>, eventType: PreviewSessionEventType): PreviewSessionStatusFact {
  metadata(payload)
  const expected = ['actor_role', 'allowed_shell_kind', 'app_version', 'batch_context', 'contract_version', 'correlation_id', 'event_payload_version', 'reason_code', 'session_id', 'snapshot_root_hash', 'status_after', 'status_before']
  exactKeys(payload, expected)
  const statusAfter = payload.status_after
  const allowed: Record<PreviewSessionEventType, PreviewSessionStatus> = {
    PREVIEW_SESSION_COMPLETED: 'COMPLETED',
    PREVIEW_SESSION_ABORTED: 'ABORTED',
    PREVIEW_SESSION_TECHNICAL_INTERRUPTION: 'TECHNICAL_INTERRUPTED',
    PREVIEW_SESSION_STARTED: 'PREPARED'
  }
  if (statusAfter !== allowed[eventType] || payload.status_before !== 'ACTIVE' || typeof payload.session_id !== 'string' || typeof payload.snapshot_root_hash !== 'string' || typeof payload.reason_code !== 'string') throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session status event must transition from ACTIVE')
  return payload as unknown as PreviewSessionStatusFact
}
