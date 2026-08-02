import type { PreparedProjectorContext } from '../event-batch/result-registry'
import { PreparedFactRegistry } from '../event-batch/result-registry'
import { PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import { PREVIEW_CONTRACT_REGISTRY, type PreviewEventOwnershipDescriptor } from '../preview/preview-contract-registry'
import { PreviewContractError } from '../preview/preview-errors'
import { projectPreviewEvent, assertPreviewEventProjected } from './preview-event-projection'
import { PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION, validatePreviewSafetyPayload } from '../preview/preview-safety-event-contract'

export const PREVIEW_SAFETY_PROJECTOR_NAME = 'preview-safety-projector-v1'
export const PREVIEW_SAFETY_RESULT_RECIPE_VERSION = 'preview.preview-safety-incident.result.v1'

function descriptor(): PreviewEventOwnershipDescriptor {
  return { event_type: 'PREVIEW_SAFETY_INCIDENT_CREATED', event_payload_version: PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION, aggregate_type: 'PREVIEW_SESSION', contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL', projector_name: PREVIEW_SAFETY_PROJECTOR_NAME, result_suppressed: true }
}

export function projectPreviewSafetyIncident(context: PreparedProjectorContext): void {
  projectPreviewEvent(context)
  const fact = validatePreviewSafetyPayload(context.event.record.payload)
  const session = context.database.prepare(
    `SELECT preview_session_id, assessment_session_id, student_id, job_code, task_code,
            snapshot_root_hash, status
       FROM preview_session_projection WHERE preview_session_id = ?`
  ).get(fact.preview_session_id) as { preview_session_id: string; assessment_session_id: string; student_id: string; job_code: string; task_code: string; snapshot_root_hash: string; status: string } | undefined
  if (!session || session.student_id !== fact.student_id || session.job_code !== fact.job_code || session.task_code !== fact.task_code || session.snapshot_root_hash !== fact.snapshot_root_hash || session.status !== 'ACTIVE') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview safety incident does not match active preview session')
  const existing = context.database.prepare('SELECT incident_id FROM preview_safety_incident_projection WHERE incident_id = ?').get(fact.incident_id)
  if (existing) throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'preview safety incident already exists')
  context.database.prepare(
    `INSERT INTO preview_safety_incident_projection (
      incident_id, preview_session_id, student_id, job_code, task_code,
      reason_code, status, preview_redline_ref, occurred_at, created_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`
  ).run(fact.incident_id, fact.preview_session_id, fact.student_id, fact.job_code, fact.task_code, fact.reason_code, fact.preview_redline_ref, fact.occurred_at, context.event.record.event_id)
  context.database.prepare(
    `UPDATE preview_session_projection
        SET status = 'REDLINE_HALTED', preview_redline_ref = ?, last_event_id = ?, updated_at = ?
      WHERE preview_session_id = ? AND status = 'ACTIVE'`
  ).run(fact.preview_redline_ref, context.event.record.event_id, fact.occurred_at, fact.preview_session_id)
  context.database.prepare(
    `UPDATE assessment_session
        SET status = 'REDLINE_HALTED', preview_redline_ref = ?, updated_at = ?
      WHERE session_id = ? AND session_contract_kind = 'PREVIEW_SHELL'`
  ).run(fact.preview_redline_ref, fact.occurred_at, session.assessment_session_id)
}

export function assertPreviewSafetyProjected(context: PreparedProjectorContext): void {
  assertPreviewEventProjected(context)
  const fact = validatePreviewSafetyPayload(context.event.record.payload)
  const row = context.database.prepare('SELECT status, preview_redline_ref, created_event_id FROM preview_safety_incident_projection WHERE incident_id = ?').get(fact.incident_id) as { status: string; preview_redline_ref: string; created_event_id: string } | undefined
  const session = context.database.prepare('SELECT status, preview_redline_ref FROM preview_session_projection WHERE preview_session_id = ?').get(fact.preview_session_id) as { status: string; preview_redline_ref: string } | undefined
  if (!row || row.status !== 'OPEN' || row.preview_redline_ref !== fact.preview_redline_ref || row.created_event_id !== context.event.record.event_id || !session || session.status !== 'REDLINE_HALTED' || session.preview_redline_ref !== fact.preview_redline_ref) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview safety projection mismatch')
}

export function registerPreviewSafetyPreparedFacts(registry: PreparedFactRegistry): void {
  registry.registerEvent({ eventType: 'PREVIEW_SAFETY_INCIDENT_CREATED', eventPayloadVersion: PREVIEW_SAFETY_EVENT_PAYLOAD_VERSION, ownership: { aggregateType: 'PREVIEW_SESSION', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' }, projectorName: PREVIEW_SAFETY_PROJECTOR_NAME, validatePayload: validatePreviewSafetyPayload, project: projectPreviewSafetyIncident, assertProjected: assertPreviewSafetyProjected, operationalEffects: [] })
  registry.registerResult({ commandType: 'preview:triggerSafety', resultRecipeVersion: PREVIEW_SAFETY_RESULT_RECIPE_VERSION, fromPrepared: ({ batch }) => ({ success: true, eventId: batch.events[0]?.record.event_id ?? '' }) })
}

let registered = false
export function registerPreviewSafetyContract(): void {
  if (registered) return
  registered = true
  PREVIEW_CONTRACT_REGISTRY.registerEvent(descriptor())
  PREVIEW_CONTRACT_REGISTRY.registerCommand({ command_type: 'preview:triggerSafety', contract_version: PREVIEW_CONTRACT_VERSION, allowed_roles: ['STUDENT', 'TEACHER', 'ADMIN'], event_types: ['PREVIEW_SAFETY_INCIDENT_CREATED'], result_recipe_version: PREVIEW_SAFETY_RESULT_RECIPE_VERSION, recovery_registered: true })
  PREVIEW_CONTRACT_REGISTRY.registerProjection({ projection_name: 'preview_safety_incident_projection', canonical_owner: PREVIEW_SAFETY_PROJECTOR_NAME, contract_version: PREVIEW_CONTRACT_VERSION, migration_id: PREVIEW_CONTRACT_MIGRATION_ID })
}
