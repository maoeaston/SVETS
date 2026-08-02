import type { DBAdapter } from '../../db/interface'
import {
  assertCanonicalReferenceSet,
  parsePreviewCanonicalJson
} from '../../domain/preview/preview-canonical'
import { PreviewContractError } from '../../domain/preview/preview-errors'
import type {
  PreviewReleaseView,
  PreviewSessionQuestionView,
  PreviewSessionView,
  PreviewSourceView
} from '../../../shared/types/preview-ipc'
import type { PreviewCanonicalReferenceSet, PreviewScope } from '../../../shared/types/preview-contract'

interface ReleaseRow {
  release_id: string
  source_ref_id: string
  delivery_mode: string
  question_id: string
  question_version: number
  semantic_hash: string
  pack_id: string
  pack_version: string
  pack_hash: string
  strategy_id: string
  strategy_version: number
  policy_hash: string
  approval_id: string
  approval_hash: string
  manifest_id: string
  manifest_hash: string
  references_json: string
  status: string
  effective_at: string
  expires_at: string
  revoked_at: string | null
  audit_ref: string
}

interface SessionRow {
  preview_session_id: string
  assessment_session_id: string
  student_id: string
  job_code: string
  task_code: string
  source_ref_id: string
  pack_id: string
  pack_version: string
  pack_hash: string
  strategy_id: string
  strategy_version: number
  status: string
  assignment_id: string
  grant_id: string
  snapshot_root_hash: string
  result_suppressed: number
  preview_redline_ref: string | null
  snapshot_json: string
  created_at: string
  updated_at: string
}

interface QuestionRow {
  session_question_id: string
  preview_session_id: string
  question_id: string
  question_version: number
  semantic_hash: string
  question_order: number
  question_phase: 'ONLINE' | 'OFFLINE' | 'OBSERVATION'
  snapshot_json: string
  content_hash: string
  scoring_hash: string
  renderer_hash: string
  safety_ref: string
}

type PreviewCallerRole = 'STUDENT' | 'TEACHER' | 'ADMIN'

interface PreviewCallerScope {
  callerRole?: PreviewCallerRole
  callerUserId?: string
  now?: Date
}

function parseReferences(value: string, field: string): PreviewCanonicalReferenceSet {
  let parsed: unknown
  try {
    parsed = parsePreviewCanonicalJson(value)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_CONTRACT_REGISTRY_INVALID', `${field} is not canonical JSON`, field, error)
  }
  try {
    assertCanonicalReferenceSet(parsed as PreviewCanonicalReferenceSet)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_CONTRACT_REGISTRY_INVALID', `${field} failed canonical reference validation`, field, error)
  }
  return parsed as PreviewCanonicalReferenceSet
}

function parseSnapshot(value: string, field: string): unknown {
  try {
    return parsePreviewCanonicalJson(value)
  } catch (error) {
    throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field} is not canonical JSON`, field, error)
  }
}

function assertScopeMatches(
  scope: PreviewScope,
  organizationId: string,
  authorizedInstallationIds: readonly string[],
  jobCode?: string,
  taskCode?: string
): void {
  if (scope.organization_id !== organizationId) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview query organization scope mismatch')
  if (!authorizedInstallationIds.includes(scope.installation_id)) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview query installation scope mismatch')
  if (jobCode !== undefined && scope.job_code !== jobCode) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview query job scope mismatch')
  if (taskCode !== undefined && scope.task_code !== taskCode) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview query task scope mismatch')
}

function sourceView(row: ReleaseRow, references: PreviewCanonicalReferenceSet): PreviewSourceView {
  if (row.delivery_mode !== 'PREVIEW_ONLY' || references.source_ref.source_ref_id !== row.source_ref_id || references.source_ref.delivery_mode !== 'PREVIEW_ONLY') {
    throw new PreviewContractError('PREVIEW_EVENT_OWNERSHIP_CONFLICT', 'preview release projection source binding drifted')
  }
  return {
    releaseId: row.release_id,
    sourceRefId: row.source_ref_id,
    deliveryMode: 'PREVIEW_ONLY',
    scope: references.source_ref.scope,
    status: row.status as PreviewSourceView['status'],
    questionId: row.question_id,
    questionVersion: row.question_version,
    semanticHash: row.semantic_hash,
    packId: row.pack_id,
    packVersion: row.pack_version,
    packHash: row.pack_hash,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at
  }
}

function releaseView(row: ReleaseRow, references: PreviewCanonicalReferenceSet): PreviewReleaseView {
  return {
    ...sourceView(row, references),
    approvalId: row.approval_id,
    approvalHash: row.approval_hash,
    manifestId: row.manifest_id,
    manifestHash: row.manifest_hash,
    policyHash: row.policy_hash,
    revokedAt: row.revoked_at,
    auditRef: row.audit_ref,
    canonicalReferences: references
  }
}

function readRelease(database: DBAdapter, releaseId: string): ReleaseRow | null {
  const row = database.prepare(
    `SELECT release_id, source_ref_id, delivery_mode, question_id, question_version,
            semantic_hash, pack_id, pack_version, pack_hash, strategy_id,
            strategy_version, policy_hash, approval_id, approval_hash, manifest_id,
            manifest_hash, references_json, status, effective_at, expires_at,
            revoked_at, audit_ref
       FROM preview_release_projection
      WHERE release_id = ?`
  ).get(releaseId) as ReleaseRow | undefined
  return row ?? null
}

export function listPreviewSources(database: DBAdapter, input: { organizationId: string; authorizedInstallationIds: readonly string[]; jobCode?: string; taskCode?: string }): readonly PreviewSourceView[] {
  const rows = database.prepare(
    `SELECT release_id, source_ref_id, delivery_mode, question_id, question_version,
            semantic_hash, pack_id, pack_version, pack_hash, strategy_id,
            strategy_version, policy_hash, approval_id, approval_hash, manifest_id,
            manifest_hash, references_json, status, effective_at, expires_at,
            revoked_at, audit_ref
       FROM preview_release_projection
      ORDER BY release_id`
  ).all() as ReleaseRow[]
  const result: PreviewSourceView[] = []
  for (const row of rows) {
    const references = parseReferences(row.references_json, `release:${row.release_id}.references_json`)
    if (references.source_ref.namespace !== 'preview_publish_set') throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'release query encountered a non-preview source')
    if (references.source_ref.scope.organization_id !== input.organizationId) continue
    if (!input.authorizedInstallationIds.includes(references.source_ref.scope.installation_id)) continue
    if (input.jobCode !== undefined && references.source_ref.scope.job_code !== input.jobCode) continue
    if (input.taskCode !== undefined && references.source_ref.scope.task_code !== input.taskCode) continue
    result.push(sourceView(row, references))
  }
  return Object.freeze(result)
}

export function getPreviewRelease(database: DBAdapter, input: { releaseId: string; organizationId: string; authorizedInstallationIds: readonly string[] }): PreviewReleaseView | null {
  const row = readRelease(database, input.releaseId)
  if (!row) return null
  const references = parseReferences(row.references_json, `release:${row.release_id}.references_json`)
  assertScopeMatches(references.source_ref.scope, input.organizationId, input.authorizedInstallationIds)
  if (references.source_ref.namespace !== 'preview_publish_set') throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'release is not owned by preview_publish_set')
  return releaseView(row, references)
}

function readSession(database: DBAdapter, sessionId: string): SessionRow | null {
  const row = database.prepare(
    `SELECT preview_session_id, assessment_session_id, student_id, job_code, task_code,
            source_ref_id, pack_id, pack_version, pack_hash, strategy_id,
            strategy_version, status, assignment_id, grant_id, snapshot_root_hash,
            result_suppressed, preview_redline_ref, snapshot_json, created_at, updated_at
       FROM preview_session_projection
      WHERE preview_session_id = ? OR assessment_session_id = ?
      ORDER BY preview_session_id
      LIMIT 1`
  ).get(sessionId, sessionId) as SessionRow | undefined
  return row ?? null
}

function sessionScope(database: DBAdapter, row: SessionRow, organizationId: string, authorizedInstallationIds: readonly string[], studentId?: string): PreviewCanonicalReferenceSet {
  const release = database.prepare('SELECT references_json FROM preview_release_projection WHERE source_ref_id = ?').get(row.source_ref_id) as { references_json: string } | undefined
  if (!release) throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview session source release is missing')
  const references = parseReferences(release.references_json, `session:${row.preview_session_id}.source_ref`)
  if (
    references.source_ref.namespace !== 'preview_publish_set'
    || references.source_ref.delivery_mode !== 'PREVIEW_ONLY'
  ) {
    throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview session source is not owned by preview_publish_set')
  }
  if (references.source_ref.source_ref_id !== row.source_ref_id || references.source_ref.scope.organization_id !== organizationId || references.source_ref.scope.job_code !== row.job_code || references.source_ref.scope.task_code !== row.task_code) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session source scope mismatch')
  }
  if (studentId === undefined && !authorizedInstallationIds.includes(references.source_ref.scope.installation_id)) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session installation scope mismatch')
  }
  return references
}

function requiredNestedText(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `preview session snapshot ${path} is invalid`, path)
  }
  return value
}

function assertSessionSnapshotAccess(row: SessionRow, snapshot: unknown, studentId: string | undefined, deviceId: string | null | undefined): void {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview session snapshot is not an object')
  }
  const record = snapshot as Record<string, unknown>
  const requiredText = (field: string): string => {
    const value = record[field]
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
      throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `preview session snapshot ${field} is invalid`, field)
    }
    return value
  }
  const sessionId = requiredText('session_id')
  const assessmentSessionId = requiredText('assessment_session_id')
  const snapshotStudentId = requiredText('student_id')
  const jobCode = requiredText('job_code')
  const taskCode = requiredText('task_code')
  const deviceSnapshotId = requiredText('device_id')
  const packRef = record.pack_ref
  if (typeof packRef !== 'object' || packRef === null || Array.isArray(packRef)) {
    throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview session snapshot pack_ref is invalid', 'pack_ref')
  }
  const pack = packRef as Record<string, unknown>
  const packId = requiredNestedText(pack, 'pack_id', 'pack_ref.pack_id')
  const packVersion = requiredNestedText(pack, 'pack_version', 'pack_ref.pack_version')
  const packHash = requiredNestedText(pack, 'pack_hash', 'pack_ref.pack_hash')
  if (sessionId !== row.preview_session_id || assessmentSessionId !== row.assessment_session_id || snapshotStudentId !== row.student_id || jobCode !== row.job_code || taskCode !== row.task_code || packId !== row.pack_id || packVersion !== row.pack_version || packHash !== row.pack_hash || deviceSnapshotId.length === 0) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session snapshot identity does not match projection')
  }
  if (studentId !== undefined && (!deviceId || deviceSnapshotId !== deviceId)) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session device scope does not match the sender')
  }
}

function sessionView(row: SessionRow, snapshot: unknown): PreviewSessionView {
  if (row.result_suppressed !== 1) throw new PreviewContractError('PREVIEW_RESULT_SUPPRESSED', 'preview session result suppression is not active')
  return {
    previewSessionId: row.preview_session_id,
    assessmentSessionId: row.assessment_session_id,
    studentId: row.student_id,
    jobCode: row.job_code,
    taskCode: row.task_code,
    sourceRefId: row.source_ref_id,
    packId: row.pack_id,
    packVersion: row.pack_version,
    packHash: row.pack_hash,
    strategyId: row.strategy_id,
    strategyVersion: row.strategy_version,
    status: row.status,
    assignmentId: row.assignment_id,
    grantId: row.grant_id,
    snapshotRootHash: row.snapshot_root_hash,
    resultSuppressed: true,
    previewRedlineRef: row.preview_redline_ref,
    snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function assertStudentScope(row: SessionRow, studentId: string | undefined): void {
  if (studentId !== undefined && row.student_id !== studentId) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session does not belong to the sender')
}

function assertTeacherResponsibility(
  database: DBAdapter,
  row: SessionRow,
  input: PreviewCallerScope
): void {
  if (input.callerRole !== 'TEACHER') return
  if (!input.callerUserId) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'teacher identity is required for preview session access')
  const now = input.now ?? new Date()
  const responsibility = database.prepare(
    `SELECT 1 AS authorized
       FROM business_session_assignment a
       JOIN delegated_access_grant g ON g.grant_id = a.grant_id
       JOIN business_session b ON b.business_session_id = a.business_session_id
      WHERE a.assignment_id = ?
        AND a.grant_id = ?
        AND a.status = 'ACTIVE'
        AND g.status = 'ACTIVE'
        AND g.teacher_user_id = ?
        AND a.student_id = ?
        AND g.student_id = ?
        AND b.student_id = ?
        AND b.job_code = ?
        AND b.task_code = ?
        AND strftime('%s', g.expires_at) > strftime('%s', ?)`
  ).get(
    row.assignment_id,
    row.grant_id,
    input.callerUserId,
    row.student_id,
    row.student_id,
    row.student_id,
    row.job_code,
    row.task_code,
    now.toISOString()
  ) as { authorized?: number } | undefined
  if (!responsibility?.authorized) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'teacher is not responsible for this preview session')
}

type PreviewSessionReadInput = {
  sessionId: string
  organizationId: string
  authorizedInstallationIds: readonly string[]
  studentId?: string
  deviceId?: string | null
} & PreviewCallerScope

export function getPreviewSession(database: DBAdapter, input: PreviewSessionReadInput): PreviewSessionView | null {
  const row = readSession(database, input.sessionId)
  if (!row) return null
  sessionScope(database, row, input.organizationId, input.authorizedInstallationIds, input.studentId)
  assertStudentScope(row, input.studentId)
  assertTeacherResponsibility(database, row, input)
  const snapshot = parseSnapshot(row.snapshot_json, `session:${row.preview_session_id}.snapshot_json`)
  assertSessionSnapshotAccess(row, snapshot, input.studentId, input.deviceId)
  return sessionView(row, snapshot)
}

export function listPreviewSessionQuestions(database: DBAdapter, input: PreviewSessionReadInput): readonly PreviewSessionQuestionView[] {
  const session = readSession(database, input.sessionId)
  if (!session) return Object.freeze([])
  sessionScope(database, session, input.organizationId, input.authorizedInstallationIds, input.studentId)
  assertStudentScope(session, input.studentId)
  assertTeacherResponsibility(database, session, input)
  const sessionSnapshot = parseSnapshot(session.snapshot_json, `session:${session.preview_session_id}.snapshot_json`)
  assertSessionSnapshotAccess(session, sessionSnapshot, input.studentId, input.deviceId)
  const rows = database.prepare(
    `SELECT session_question_id, preview_session_id, question_id, question_version,
            semantic_hash, question_order, question_phase, snapshot_json,
            content_hash, scoring_hash, renderer_hash, safety_ref
       FROM preview_session_question_projection
      WHERE preview_session_id = ?
      ORDER BY question_order`
  ).all(session.preview_session_id) as QuestionRow[]
  return Object.freeze(rows.map((row) => ({
    sessionQuestionId: row.session_question_id,
    previewSessionId: row.preview_session_id,
    questionId: row.question_id,
    questionVersion: row.question_version,
    semanticHash: row.semantic_hash,
    questionOrder: row.question_order,
    questionPhase: row.question_phase,
    contentHash: row.content_hash,
    scoringHash: row.scoring_hash,
    rendererHash: row.renderer_hash,
    safetyRef: row.safety_ref,
    snapshot: parseSnapshot(row.snapshot_json, `question:${row.session_question_id}.snapshot_json`)
  })))
}
