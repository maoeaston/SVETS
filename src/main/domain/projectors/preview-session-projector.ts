import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import type { DBAdapter } from '../../db/interface'
import type { PreparedProjectorContext } from '../event-batch/result-registry'
import { PreparedFactRegistry } from '../event-batch/result-registry'
import { PREVIEW_CONTRACT_MIGRATION_ID, PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import type { PreviewCanonicalReferenceSet } from '../../../shared/types/preview-contract'
import { PREVIEW_CONTRACT_REGISTRY, type PreviewEventOwnershipDescriptor } from '../preview/preview-contract-registry'
import { PreviewContractError } from '../preview/preview-errors'
import { assertCanonicalReferenceSet, parsePreviewCanonicalJson } from '../preview/preview-canonical'
import { assertPreviewEventProjected, projectPreviewEvent } from './preview-event-projection'
import { validatePreviewSessionStartedPayload, validatePreviewSessionStatusPayload, PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, type PreviewSessionEventType } from '../preview/preview-session-event-contract'
import type { PreviewSessionStatus } from '../../../shared/types/preview-contract'

export const PREVIEW_SESSION_PROJECTOR_NAME = 'preview-session-projector-v1'
export const PREVIEW_SESSION_RESULT_RECIPE_VERSIONS = Object.freeze({
  'preview:startSession': 'preview.preview-session-start.result.v1',
  'preview:completeSession': 'preview.preview-session-complete.result.v1',
  'preview:abortSession': 'preview.preview-session-abort.result.v1',
  'preview:technicalInterruption': 'preview.preview-session-technical-interruption.result.v1'
})

const STARTED: PreviewSessionEventType = 'PREVIEW_SESSION_STARTED'
const STATUS_TYPES: readonly PreviewSessionEventType[] = ['PREVIEW_SESSION_COMPLETED', 'PREVIEW_SESSION_ABORTED', 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION']

function descriptor(eventType: PreviewSessionEventType): PreviewEventOwnershipDescriptor {
  return { event_type: eventType, event_payload_version: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, aggregate_type: 'PREVIEW_SESSION', contract_version: PREVIEW_CONTRACT_VERSION, allowed_shell_kind: 'PREVIEW_SHELL', projector_name: PREVIEW_SESSION_PROJECTOR_NAME, result_suppressed: true }
}

function statusForEvent(eventType: PreviewSessionEventType): PreviewSessionStatus {
  return eventType === 'PREVIEW_SESSION_COMPLETED' ? 'COMPLETED' : eventType === 'PREVIEW_SESSION_ABORTED' ? 'ABORTED' : eventType === 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION' ? 'TECHNICAL_INTERRUPTED' : 'PREPARED'
}

function ensureBusinessSession(
  database: DBAdapter,
  snapshot: ReturnType<typeof validatePreviewSessionStartedPayload>,
  createdBy: string
): void {
  const existing = database.prepare(
    `SELECT session_type, student_id, job_code, task_code
       FROM business_session
      WHERE business_session_id = ?`
  ).get(snapshot.assessment_session_id) as { session_type: string; student_id: string; job_code: string; task_code: string } | undefined
  if (existing) {
    if (existing.session_type !== 'ASSESSMENT' || existing.student_id !== snapshot.student_id || existing.job_code !== snapshot.job_code || existing.task_code !== snapshot.task_code) {
      throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview business session facts conflict with the frozen snapshot')
    }
    return
  }
  database.prepare(
    `INSERT INTO business_session
       (business_session_id, session_type, student_id, job_code, task_code, created_by)
     VALUES (?, 'ASSESSMENT', ?, ?, ?, ?)`
  ).run(snapshot.assessment_session_id, snapshot.student_id, snapshot.job_code, snapshot.task_code, createdBy)
}

function shellCreatorId(snapshot: ReturnType<typeof validatePreviewSessionStartedPayload>, actorId: string): string {
  // Internal runtime commands have no user_account row; the shell creator is
  // the already-authorized student identity frozen into the snapshot.
  return actorId.startsWith('SYSTEM:') ? snapshot.student_id : actorId
}

function assertReleaseBinding(database: DBAdapter, snapshot: ReturnType<typeof validatePreviewSessionStartedPayload>): void {
  const release = database.prepare(
    `SELECT status, delivery_mode, question_id, question_version, semantic_hash,
            pack_id, pack_version, pack_hash, strategy_id, strategy_version,
            effective_at, expires_at, references_json
       FROM preview_release_projection
      WHERE source_ref_id = ?`
  ).get(snapshot.source_ref.source_ref_id) as {
    status: string
    delivery_mode: string
    question_id: string
    question_version: number
    semantic_hash: string
    pack_id: string
    pack_version: string
    pack_hash: string
    strategy_id: string
    strategy_version: number
    effective_at: string
    expires_at: string
    references_json: string
  } | undefined
  if (!release || release.status !== 'ACTIVE' || release.delivery_mode !== 'PREVIEW_ONLY') {
    throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview session source binding is not active for the frozen snapshot')
  }
  let references: PreviewCanonicalReferenceSet
  try {
    const parsed = parsePreviewCanonicalJson(release.references_json)
    assertCanonicalReferenceSet(parsed as unknown as PreviewCanonicalReferenceSet)
    references = parsed as unknown as PreviewCanonicalReferenceSet
  } catch (error) {
    throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview session source references are not canonical', undefined, error)
  }
  const question = snapshot.question_snapshots[0]
  const referenceKey = (value: unknown): string => canonicalJson(value as CanonicalJsonValue)
  const expectedQuestionKeys = references.question_refs.map(referenceKey).sort()
  const actualQuestionKeys = snapshot.question_snapshots.map((entry) => referenceKey(entry.question_ref)).sort()
  const releaseAssetKeys = new Set(references.asset_refs.map(referenceKey))
  const releaseRendererKeys = new Set(references.renderer_refs.map(referenceKey))
  const releaseEvidenceKeys = new Set(references.evidence_refs.map(referenceKey))
  const referencesMatchSnapshot = referenceKey(references.source_ref) === referenceKey(snapshot.source_ref)
    && referenceKey(references.pack_ref) === referenceKey(snapshot.pack_ref)
    && referenceKey(references.strategy_ref) === referenceKey(snapshot.strategy_ref)
    && referenceKey(references.manifest_ref) === referenceKey(snapshot.manifest_ref)
    && referenceKey(references.approval_ref) === referenceKey(snapshot.approval_ref)
    && expectedQuestionKeys.length === actualQuestionKeys.length
    && expectedQuestionKeys.every((key, index) => key === actualQuestionKeys[index])
    && snapshot.question_snapshots.every((entry) => releaseRendererKeys.has(referenceKey(entry.renderer_ref))
      && entry.asset_refs.every((asset) => releaseAssetKeys.has(referenceKey(asset)))
      && entry.evidence_refs.every((evidence) => releaseEvidenceKeys.has(referenceKey(evidence))))
  if (!referencesMatchSnapshot
    || release.question_id !== question.question_ref.question_id
    || release.question_version !== question.question_ref.question_version
    || release.semantic_hash !== question.question_ref.semantic_hash
    || release.pack_id !== snapshot.pack_ref.pack_id
    || release.pack_version !== snapshot.pack_ref.pack_version
    || release.pack_hash !== snapshot.pack_ref.pack_hash
    || release.strategy_id !== snapshot.strategy_ref.strategy_id
    || release.strategy_version !== snapshot.strategy_ref.strategy_version
    || Date.parse(snapshot.captured_at) < Date.parse(release.effective_at)
    || Date.parse(snapshot.captured_at) >= Date.parse(release.expires_at)) {
    throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview session source binding is not active for the frozen snapshot')
  }
}

function assertAssignmentGrantConsistency(database: DBAdapter, snapshot: ReturnType<typeof validatePreviewSessionStartedPayload>): void {
  const row = database.prepare(
    `SELECT bsa.business_session_id, bsa.student_id AS assignment_student_id,
            bsa.device_id AS assignment_device_id, bsa.grant_id,
            bsa.status AS assignment_status, g.student_id AS grant_student_id,
            g.device_id AS grant_device_id, g.status AS grant_status,
            g.expires_at, bs.student_id AS session_student_id,
            bs.job_code, bs.task_code
       FROM business_session_assignment bsa
       JOIN delegated_access_grant g ON g.grant_id = bsa.grant_id
       JOIN business_session bs ON bs.business_session_id = bsa.business_session_id
      WHERE bsa.assignment_id = ?`
  ).get(snapshot.assignment_id) as {
    business_session_id: string
    assignment_student_id: string
    assignment_device_id: string
    grant_id: string
    assignment_status: string
    grant_student_id: string
    grant_device_id: string
    grant_status: string
    expires_at: string
    session_student_id: string
    job_code: string
    task_code: string
  } | undefined
  if (!row
    || row.business_session_id !== snapshot.assessment_session_id
    || row.grant_id !== snapshot.grant_id
    || row.assignment_student_id !== snapshot.student_id
    || row.grant_student_id !== snapshot.student_id
    || row.session_student_id !== snapshot.student_id
    || row.assignment_device_id !== snapshot.device_id
    || row.grant_device_id !== snapshot.device_id
    || row.job_code !== snapshot.job_code
    || row.task_code !== snapshot.task_code
    || row.assignment_status !== 'ACTIVE'
    || row.grant_status !== 'ACTIVE'
    || Date.parse(row.expires_at) <= Date.parse(snapshot.captured_at)) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview assignment/grant facts are not active and mutually consistent')
  }
}

function startProjection(context: PreparedProjectorContext): void {
  const snapshot = validatePreviewSessionStartedPayload(context.event.record.payload)
  if (context.event.record.event_sequence !== 1) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session start must be event sequence 1')
  const existing = context.database.prepare('SELECT preview_session_id FROM preview_session_projection WHERE preview_session_id = ?').get(snapshot.session_id)
  const existingShell = context.database.prepare('SELECT session_id FROM assessment_session WHERE session_id = ?').get(snapshot.assessment_session_id)
  if (existing || existingShell) throw new PreviewContractError('PREVIEW_IDEMPOTENCY_CONFLICT', 'preview session or its identity shell already exists')
  assertReleaseBinding(context.database, snapshot)
  assertAssignmentGrantConsistency(context.database, snapshot)
  const creatorId = shellCreatorId(snapshot, context.command.actorId)
  ensureBusinessSession(context.database, snapshot, creatorId)
  const strategy = snapshot.strategy_ref
  const onlineCount = snapshot.question_snapshots.filter((question) => question.question_phase === 'ONLINE').length
  const offlineCount = snapshot.question_snapshots.filter((question) => question.question_phase === 'OFFLINE').length
  context.database.prepare(
    `INSERT INTO assessment_session (
      session_id, session_contract_kind, preview_contract_version, business_session_id,
      student_id, strategy_id, strategy_type, job_code, task_code, strategy_version,
      status, delivery_phase, online_question_count, offline_question_count,
      max_score, created_by, created_event_id, last_applied_event_id, last_status_event_id,
      event_sequence_version, updated_at
    ) VALUES (?, 'PREVIEW_SHELL', 'PREVIEW_CONTRACT_V1', ?, ?, ?, 'JOB_SKILL_ASSESSMENT', ?, ?, ?, 'INIT', 'PREPARED', ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?)`
  ).run(
    snapshot.assessment_session_id,
    snapshot.assessment_session_id,
    snapshot.student_id,
    strategy.strategy_id,
    snapshot.job_code,
    snapshot.task_code,
    strategy.strategy_version,
    onlineCount,
    offlineCount,
    creatorId,
    snapshot.captured_at
  )
  context.database.prepare(
    `INSERT INTO preview_session_projection (
      preview_session_id, assessment_session_id, contract_registry_id, contract_version,
      delivery_mode, student_id, job_code, task_code, pack_id, pack_version, pack_hash,
      source_ref_id, strategy_id, strategy_version, snapshot_json, content_root_hash,
      scoring_root_hash, renderer_root_hash, snapshot_root_hash, assignment_id, grant_id,
      status, result_suppressed, created_event_id, last_event_id, created_at, updated_at
    ) VALUES (?, ?, 'PREVIEW_CONTRACT_V1', 'PREVIEW_CONTRACT_V1', 'PREVIEW_ONLY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`
  ).run(
    snapshot.session_id,
    snapshot.assessment_session_id,
    snapshot.student_id,
    snapshot.job_code,
    snapshot.task_code,
    snapshot.pack_ref.pack_id,
    snapshot.pack_ref.pack_version,
    snapshot.pack_ref.pack_hash,
    snapshot.source_ref.source_ref_id,
    snapshot.strategy_ref.strategy_id,
    snapshot.strategy_ref.strategy_version,
    canonicalJson(snapshot as never),
    snapshot.content_root_hash,
    snapshot.scoring_root_hash,
    snapshot.renderer_root_hash,
    snapshot.snapshot_root_hash,
    snapshot.assignment_id,
    snapshot.grant_id,
    context.event.record.event_id,
    context.event.record.event_id,
    snapshot.captured_at,
    snapshot.captured_at
  )
  for (const question of snapshot.question_snapshots) {
    context.database.prepare(
      `INSERT INTO preview_session_question_projection (
        session_question_id, preview_session_id, question_id, question_version,
        semantic_hash, question_order, question_phase, snapshot_json, content_hash,
        scoring_hash, renderer_hash, safety_ref
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `${snapshot.session_id}:${question.question_order}`,
      snapshot.session_id,
      question.question_ref.question_id,
      question.question_ref.question_version,
      question.question_ref.semantic_hash,
      question.question_order,
      question.question_phase,
      canonicalJson(question as never),
      question.content_hash,
      question.scoring_hash,
      question.renderer_ref.renderer_hash,
      question.safety_ref
    )
  }
  context.database.prepare(
    `UPDATE assessment_session SET status = 'ACTIVE', updated_at = ?
      WHERE session_id = ? AND session_contract_kind = 'PREVIEW_SHELL' AND status = 'INIT'`
  ).run(context.event.record.timestamp, snapshot.assessment_session_id)
}

function statusProjection(context: PreparedProjectorContext): void {
  const eventType = context.event.record.event_type as PreviewSessionEventType
  const fact = validatePreviewSessionStatusPayload(context.event.record.payload, eventType)
  const row = context.database.prepare('SELECT assessment_session_id, snapshot_root_hash, status FROM preview_session_projection WHERE preview_session_id = ?').get(fact.session_id) as { assessment_session_id: string; snapshot_root_hash: string; status: PreviewSessionStatus } | undefined
  if (!row || row.snapshot_root_hash !== fact.snapshot_root_hash || row.status !== fact.status_before) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session status transition does not match frozen snapshot')
  const previousEvent = context.database.prepare(
    `SELECT MAX(event_sequence) AS event_sequence
       FROM preview_event_projection
      WHERE aggregate_type = 'PREVIEW_SESSION' AND aggregate_id = ? AND event_id <> ?`
  ).get(fact.session_id, context.event.record.event_id) as { event_sequence: number | null } | undefined
  if ((previousEvent?.event_sequence ?? 0) + 1 !== context.event.record.event_sequence) throw new PreviewContractError('PREVIEW_STATE_CONFLICT', 'preview session status event sequence is not contiguous')
  context.database.prepare('UPDATE preview_session_projection SET status = ?, last_event_id = ?, updated_at = ? WHERE preview_session_id = ? AND status = ?').run(fact.status_after, context.event.record.event_id, context.event.record.timestamp, fact.session_id, fact.status_before)
  if (fact.status_after === 'COMPLETED' || fact.status_after === 'ABORTED') {
    context.database.prepare(
      `UPDATE assessment_session SET status = ?, updated_at = ?
        WHERE session_id = ? AND session_contract_kind = 'PREVIEW_SHELL'`
    ).run(fact.status_after, context.event.record.timestamp, row.assessment_session_id)
  }
}

export function validatePreviewSessionPayload(payload: Readonly<Record<string, CanonicalJsonValue>>, eventType: PreviewSessionEventType): void {
  if (eventType === STARTED) validatePreviewSessionStartedPayload(payload)
  else validatePreviewSessionStatusPayload(payload, eventType)
}

export function projectPreviewSession(context: PreparedProjectorContext): void {
  projectPreviewEvent(context)
  if (context.event.record.event_type === STARTED) startProjection(context)
  else statusProjection(context)
}

export function assertPreviewSessionProjected(context: PreparedProjectorContext): void {
  assertPreviewEventProjected(context)
  const eventType = context.event.record.event_type as PreviewSessionEventType
  if (eventType === STARTED) {
    const snapshot = validatePreviewSessionStartedPayload(context.event.record.payload)
    const row = context.database.prepare('SELECT status, snapshot_root_hash, created_event_id FROM preview_session_projection WHERE preview_session_id = ?').get(snapshot.session_id) as { status: PreviewSessionStatus; snapshot_root_hash: string; created_event_id: string } | undefined
    const shell = context.database.prepare('SELECT status, session_contract_kind, created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?').get(snapshot.assessment_session_id) as { status: string; session_contract_kind: string; created_event_id: string | null; last_applied_event_id: string | null; last_status_event_id: string | null; event_sequence_version: number } | undefined
    const validLaterStatus = row?.status === 'ACTIVE'
      || row?.status === 'COMPLETED'
      || row?.status === 'ABORTED'
      || row?.status === 'TECHNICAL_INTERRUPTED'
      || row?.status === 'REDLINE_HALTED'
    const validShellStatus = shell?.status === 'ACTIVE'
      || shell?.status === 'COMPLETED'
      || shell?.status === 'ABORTED'
      || shell?.status === 'REDLINE_HALTED'
    if (!row || !validLaterStatus || row.snapshot_root_hash !== snapshot.snapshot_root_hash || row.created_event_id !== context.event.record.event_id || !shell || !validShellStatus || shell.session_contract_kind !== 'PREVIEW_SHELL' || shell.created_event_id !== null || shell.last_applied_event_id !== null || shell.last_status_event_id !== null || shell.event_sequence_version !== 0) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview session start projection mismatch')
    return
  }
  const fact = validatePreviewSessionStatusPayload(context.event.record.payload, eventType)
  const row = context.database.prepare('SELECT assessment_session_id, status, last_event_id FROM preview_session_projection WHERE preview_session_id = ?').get(fact.session_id) as { assessment_session_id: string; status: PreviewSessionStatus; last_event_id: string } | undefined
  const shellStatus = fact.status_after === 'TECHNICAL_INTERRUPTED' ? 'ACTIVE' : fact.status_after
  const shell = row ? context.database.prepare('SELECT status, created_event_id, last_applied_event_id, last_status_event_id, event_sequence_version FROM assessment_session WHERE session_id = ?').get(row.assessment_session_id) as { status: string; created_event_id: string | null; last_applied_event_id: string | null; last_status_event_id: string | null; event_sequence_version: number } | undefined : undefined
  if (!row || row.status !== statusForEvent(eventType) || row.last_event_id !== context.event.record.event_id || !shell || shell.status !== shellStatus || shell.created_event_id !== null || shell.last_applied_event_id !== null || shell.last_status_event_id !== null || shell.event_sequence_version !== 0) throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview session status projection mismatch')
}

export function registerPreviewSessionPreparedFacts(registry: PreparedFactRegistry): void {
  registry.registerEvent({ eventType: STARTED, eventPayloadVersion: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, ownership: { aggregateType: 'PREVIEW_SESSION', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' }, projectorName: PREVIEW_SESSION_PROJECTOR_NAME, validatePayload: (payload) => validatePreviewSessionPayload(payload, STARTED), project: projectPreviewSession, assertProjected: assertPreviewSessionProjected, operationalEffects: [] })
  for (const eventType of STATUS_TYPES) registry.registerEvent({ eventType, eventPayloadVersion: PREVIEW_SESSION_EVENT_PAYLOAD_VERSION, ownership: { aggregateType: 'PREVIEW_SESSION', contractVersion: PREVIEW_CONTRACT_VERSION, allowedShellKind: 'PREVIEW_SHELL' }, projectorName: PREVIEW_SESSION_PROJECTOR_NAME, validatePayload: (payload) => validatePreviewSessionPayload(payload, eventType), project: projectPreviewSession, assertProjected: assertPreviewSessionProjected, operationalEffects: [] })
  for (const [commandType, resultRecipeVersion] of Object.entries(PREVIEW_SESSION_RESULT_RECIPE_VERSIONS)) registry.registerResult({ commandType, resultRecipeVersion, fromPrepared: ({ batch }) => ({ success: true, commandType, eventId: batch.events[0]?.record.event_id ?? '' }) })
}

let registered = false
export function registerPreviewSessionContract(): void {
  if (registered) return
  registered = true
  for (const eventType of [STARTED, ...STATUS_TYPES]) PREVIEW_CONTRACT_REGISTRY.registerEvent(descriptor(eventType))
  for (const [commandType, resultRecipeVersion] of Object.entries(PREVIEW_SESSION_RESULT_RECIPE_VERSIONS)) PREVIEW_CONTRACT_REGISTRY.registerCommand({ command_type: commandType, contract_version: PREVIEW_CONTRACT_VERSION, allowed_roles: ['ADMIN', 'TEACHER', 'STUDENT'], event_types: [commandType === 'preview:startSession' ? STARTED : commandType === 'preview:completeSession' ? 'PREVIEW_SESSION_COMPLETED' : commandType === 'preview:abortSession' ? 'PREVIEW_SESSION_ABORTED' : 'PREVIEW_SESSION_TECHNICAL_INTERRUPTION'], result_recipe_version: resultRecipeVersion, recovery_registered: true })
  PREVIEW_CONTRACT_REGISTRY.registerProjection({ projection_name: 'preview_session_projection', canonical_owner: PREVIEW_SESSION_PROJECTOR_NAME, contract_version: PREVIEW_CONTRACT_VERSION, migration_id: PREVIEW_CONTRACT_MIGRATION_ID })
  PREVIEW_CONTRACT_REGISTRY.registerProjection({ projection_name: 'preview_session_question_projection', canonical_owner: PREVIEW_SESSION_PROJECTOR_NAME, contract_version: PREVIEW_CONTRACT_VERSION, migration_id: PREVIEW_CONTRACT_MIGRATION_ID })
}
