import type { PreviewSessionSnapshot, PreviewSessionStatus } from '../../../shared/types/preview-contract'
import { validatePreviewSessionStartedPayload, validatePreviewSessionStatusPayload, type PreviewSessionEventType } from './preview-session-event-contract'
import { PreviewContractError } from './preview-errors'

export interface PreviewSessionReplayEvent {
  event_id: string
  event_type: PreviewSessionEventType
  event_sequence: number
  payload: Readonly<Record<string, unknown>>
}

export interface PreviewSessionReplayState {
  snapshot: PreviewSessionSnapshot
  status: PreviewSessionStatus
  last_event_id: string
  event_sequence: number
}

export function replayPreviewSession(events: readonly PreviewSessionReplayEvent[]): PreviewSessionReplayState {
  const ordered = [...events].sort((left, right) => left.event_sequence - right.event_sequence)
  let state: PreviewSessionReplayState | null = null
  const ids = new Set<string>()
  let expectedSequence = 1
  for (const event of ordered) {
    if (ids.has(event.event_id) || event.event_sequence !== expectedSequence) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview session replay sequence is not contiguous')
    ids.add(event.event_id)
    if (event.event_type === 'PREVIEW_SESSION_STARTED') {
      if (state) throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'preview session replay contains duplicate start')
      const snapshot = validatePreviewSessionStartedPayload(event.payload as never)
      state = { snapshot, status: 'ACTIVE', last_event_id: event.event_id, event_sequence: event.event_sequence }
    } else {
      if (!state) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session replay has no start')
      const fact = validatePreviewSessionStatusPayload(event.payload as never, event.event_type)
      const current = state
      if (fact.session_id !== current.snapshot.session_id || fact.snapshot_root_hash !== current.snapshot.snapshot_root_hash || fact.status_before !== current.status) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session replay status drift')
      state = { ...current, status: fact.status_after, last_event_id: event.event_id, event_sequence: event.event_sequence }
    }
    expectedSequence += 1
    const currentState = state
    if (currentState && (currentState.status === 'COMPLETED' || currentState.status === 'ABORTED' || currentState.status === 'TECHNICAL_INTERRUPTED')) {
      if (event !== ordered.at(-1)) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session replay contains events after terminal state')
    }
  }
  if (!state) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview session replay is empty')
  return Object.freeze(state)
}
