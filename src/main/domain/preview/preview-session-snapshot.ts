import type {
  PreviewPublishBinding,
  PreviewSessionQuestionSnapshot,
  PreviewSessionSnapshot
} from '../../../shared/types/preview-contract'
import { PREVIEW_CONTRACT_SCHEMA_VERSION, PREVIEW_CONTRACT_VERSION } from '../../../shared/types/preview-contract'
import {
  assertCanonicalReferenceSet,
  assertHash,
  assertText,
  assertTimestamp,
  hashPreviewDocument
} from './preview-canonical'
import { canonicalJson, type CanonicalJsonValue } from '../event-batch/canonical-json'
import { PreviewContractError } from './preview-errors'

export interface BuildPreviewSessionSnapshotInput {
  session_id: string
  assessment_session_id: string
  student_id: string
  job_code: string
  task_code: string
  assignment_id: string
  grant_id: string
  device_id: string
  binding: PreviewPublishBinding & Readonly<{ canonical_references: Parameters<typeof assertCanonicalReferenceSet>[0] }>
  question_snapshots: readonly PreviewSessionQuestionSnapshot[]
  captured_at: string
}

function assertQuestionSnapshot(question: PreviewSessionQuestionSnapshot, index: number): void {
  const field = `question_snapshots[${index}]`
  if (!question.question_ref || typeof question.question_ref !== 'object') throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field}.question_ref is missing`)
  assertText(question.question_ref.question_id, `${field}.question_ref.question_id`)
  if (!Number.isSafeInteger(question.question_ref.question_version) || question.question_ref.question_version < 1) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field}.question_ref.question_version is invalid`)
  assertHash(question.question_ref.semantic_hash, `${field}.question_ref.semantic_hash`)
  if (!Number.isSafeInteger(question.question_order) || question.question_order < 1) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field}.question_order is invalid`)
  if (!['ONLINE', 'OFFLINE', 'OBSERVATION'].includes(question.question_phase)) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field}.question_phase is invalid`)
  assertHash(question.content_hash, `${field}.content_hash`)
  assertHash(question.scoring_hash, `${field}.scoring_hash`)
  assertText(question.safety_ref, `${field}.safety_ref`)
  if (!question.renderer_ref || !Array.isArray(question.asset_refs) || !Array.isArray(question.evidence_refs)) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field} renderer/assets/evidence are invalid`)
  assertText(question.renderer_ref.renderer_id, `${field}.renderer_ref.renderer_id`)
  assertText(question.renderer_ref.renderer_version, `${field}.renderer_ref.renderer_version`)
  assertHash(question.renderer_ref.renderer_hash, `${field}.renderer_ref.renderer_hash`)
  for (const [assetIndex, asset] of question.asset_refs.entries()) {
    assertText(asset.asset_id, `${field}.asset_refs[${assetIndex}].asset_id`)
    if (!Number.isSafeInteger(asset.asset_version) || asset.asset_version < 1) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', `${field}.asset_refs[${assetIndex}].asset_version is invalid`)
    assertHash(asset.file_hash, `${field}.asset_refs[${assetIndex}].file_hash`)
    assertHash(asset.rights_hash, `${field}.asset_refs[${assetIndex}].rights_hash`)
  }
  for (const [evidenceIndex, evidence] of question.evidence_refs.entries()) {
    assertText(evidence.evidence_id, `${field}.evidence_refs[${evidenceIndex}].evidence_id`)
    assertText(evidence.evidence_version, `${field}.evidence_refs[${evidenceIndex}].evidence_version`)
    assertHash(evidence.evidence_hash, `${field}.evidence_refs[${evidenceIndex}].evidence_hash`)
  }
}

function referenceKey(value: unknown): string {
  return canonicalJson(value as CanonicalJsonValue)
}

function assertSnapshotScope(snapshot: PreviewSessionSnapshot): void {
  if (snapshot.source_ref.scope.job_code !== snapshot.job_code || snapshot.source_ref.scope.task_code !== snapshot.task_code) {
    throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session scope does not match the frozen student/job/task facts')
  }
  assertTimestamp(snapshot.source_ref.validity.issued_at, 'source_ref.validity.issued_at')
  assertTimestamp(snapshot.source_ref.validity.effective_at, 'source_ref.validity.effective_at')
  assertTimestamp(snapshot.source_ref.validity.expires_at, 'source_ref.validity.expires_at')
  if (Date.parse(snapshot.captured_at) < Date.parse(snapshot.source_ref.validity.effective_at) || Date.parse(snapshot.captured_at) >= Date.parse(snapshot.source_ref.validity.expires_at)) {
    throw new PreviewContractError('PREVIEW_VALIDITY_INVALID', 'preview session captured_at is outside the source validity window')
  }
}

function assertQuestionsMatchReferences(
  questions: readonly PreviewSessionQuestionSnapshot[],
  references: Parameters<typeof assertCanonicalReferenceSet>[0]
): void {
  const expectedQuestions = new Map(references.question_refs.map((ref) => [referenceKey(ref), ref]))
  const actualQuestions = questions.map((question) => referenceKey(question.question_ref))
  if (actualQuestions.length !== expectedQuestions.size || new Set(actualQuestions).size !== actualQuestions.length || actualQuestions.some((key) => !expectedQuestions.has(key))) {
    throw new PreviewContractError('PREVIEW_APPROVAL_HASH_CONFLICT', 'preview session questions do not match the frozen release references')
  }

  const assets = new Set(references.asset_refs.map(referenceKey))
  const renderers = new Set(references.renderer_refs.map(referenceKey))
  const evidence = new Set(references.evidence_refs.map(referenceKey))
  for (const question of questions) {
    if (question.asset_refs.some((asset) => !assets.has(referenceKey(asset)))) {
      throw new PreviewContractError('PREVIEW_APPROVAL_HASH_CONFLICT', 'preview session asset references are outside the frozen release set')
    }
    if (!renderers.has(referenceKey(question.renderer_ref))) {
      throw new PreviewContractError('PREVIEW_APPROVAL_HASH_CONFLICT', 'preview session renderer reference is outside the frozen release set')
    }
    if (question.evidence_refs.some((item) => !evidence.has(referenceKey(item)))) {
      throw new PreviewContractError('PREVIEW_APPROVAL_HASH_CONFLICT', 'preview session evidence references are outside the frozen release set')
    }
  }
}

export function previewSessionContentRoot(questions: readonly PreviewSessionQuestionSnapshot[]): string {
  return hashPreviewDocument(questions.map((question) => ({
    question_ref: question.question_ref,
    content_hash: question.content_hash
  })))
}

export function previewSessionScoringRoot(questions: readonly PreviewSessionQuestionSnapshot[]): string {
  return hashPreviewDocument(questions.map((question) => ({
    question_ref: question.question_ref,
    scoring_hash: question.scoring_hash
  })))
}

export function previewSessionRendererRoot(questions: readonly PreviewSessionQuestionSnapshot[]): string {
  return hashPreviewDocument(questions.map((question) => ({
    question_ref: question.question_ref,
    renderer_ref: question.renderer_ref
  })))
}

export function previewSessionSnapshotRoot(snapshot: Omit<PreviewSessionSnapshot, 'snapshot_root_hash'>): string {
  return hashPreviewDocument(snapshot)
}

export function assertPreviewSessionSnapshot(snapshot: PreviewSessionSnapshot): PreviewSessionSnapshot {
  if (snapshot.snapshot_schema_version !== PREVIEW_CONTRACT_SCHEMA_VERSION || snapshot.contract_version !== PREVIEW_CONTRACT_VERSION || snapshot.delivery_mode !== 'PREVIEW_ONLY') throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview session snapshot contract discriminator is invalid')
  for (const field of ['session_id', 'assessment_session_id', 'student_id', 'job_code', 'task_code', 'assignment_id', 'grant_id', 'device_id']) assertText(snapshot[field as keyof PreviewSessionSnapshot], field)
  assertTimestamp(snapshot.captured_at, 'captured_at')
  if (!snapshot.source_ref || typeof snapshot.source_ref !== 'object' || snapshot.source_ref.namespace !== 'preview_publish_set' || snapshot.source_ref.delivery_mode !== 'PREVIEW_ONLY') throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview session source is not preview-only')
  assertSnapshotScope(snapshot)
  assertHash(snapshot.pack_ref.pack_hash, 'pack_ref.pack_hash')
  assertHash(snapshot.content_root_hash, 'content_root_hash')
  assertHash(snapshot.scoring_root_hash, 'scoring_root_hash')
  assertHash(snapshot.renderer_root_hash, 'renderer_root_hash')
  assertHash(snapshot.snapshot_root_hash, 'snapshot_root_hash')
  if (!Array.isArray(snapshot.question_snapshots) || snapshot.question_snapshots.length === 0) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'preview session must contain questions')
  const orders = new Set<number>()
  for (const [index, question] of snapshot.question_snapshots.entries()) {
    assertQuestionSnapshot(question, index)
    if (orders.has(question.question_order)) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'question orders must be unique')
    orders.add(question.question_order)
  }
  if (previewSessionContentRoot(snapshot.question_snapshots) !== snapshot.content_root_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'preview content root hash mismatch')
  if (previewSessionScoringRoot(snapshot.question_snapshots) !== snapshot.scoring_root_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'preview scoring root hash mismatch')
  if (previewSessionRendererRoot(snapshot.question_snapshots) !== snapshot.renderer_root_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'preview renderer root hash mismatch')
  const withoutRoot = { ...snapshot, snapshot_root_hash: undefined }
  delete (withoutRoot as Record<string, unknown>).snapshot_root_hash
  if (previewSessionSnapshotRoot(withoutRoot as Omit<PreviewSessionSnapshot, 'snapshot_root_hash'>) !== snapshot.snapshot_root_hash) throw new PreviewContractError('PREVIEW_HASH_INVALID', 'preview snapshot root hash mismatch')
  return Object.freeze({ ...snapshot, question_snapshots: Object.freeze([...snapshot.question_snapshots]) })
}

export function buildPreviewSessionSnapshot(input: BuildPreviewSessionSnapshotInput): PreviewSessionSnapshot {
  assertCanonicalReferenceSet(input.binding.canonical_references)
  if (input.binding.status !== 'ACTIVE' || input.binding.delivery_mode !== 'PREVIEW_ONLY') throw new PreviewContractError('PREVIEW_SOURCE_AUTHORITY_MISSING', 'preview release binding is not ACTIVE')
  assertTimestamp(input.captured_at, 'captured_at')
  if (input.binding.source_ref.scope.job_code !== input.job_code || input.binding.source_ref.scope.task_code !== input.task_code) throw new PreviewContractError('PREVIEW_SCOPE_INVALID', 'preview release scope does not match the session business facts')
  if (Date.parse(input.captured_at) < Date.parse(input.binding.validity.effective_at) || Date.parse(input.captured_at) >= Date.parse(input.binding.validity.expires_at)) throw new PreviewContractError('PREVIEW_VALIDITY_INVALID', 'captured_at is outside the preview release validity window')
  if (!Array.isArray(input.question_snapshots) || input.question_snapshots.length === 0) throw new PreviewContractError('PREVIEW_SESSION_CONTRACT_INVALID', 'question snapshots are required')
  for (const [index, question] of input.question_snapshots.entries()) assertQuestionSnapshot(question, index)
  assertQuestionsMatchReferences(input.question_snapshots, input.binding.canonical_references)
  const snapshotWithoutRoot: Omit<PreviewSessionSnapshot, 'snapshot_root_hash'> = {
    snapshot_schema_version: PREVIEW_CONTRACT_SCHEMA_VERSION,
    contract_version: PREVIEW_CONTRACT_VERSION,
    delivery_mode: 'PREVIEW_ONLY',
    session_id: input.session_id,
    assessment_session_id: input.assessment_session_id,
    student_id: input.student_id,
    job_code: input.job_code,
    task_code: input.task_code,
    pack_ref: input.binding.pack_ref,
    source_ref: input.binding.source_ref,
    manifest_ref: input.binding.manifest_ref,
    approval_ref: input.binding.approval_ref,
    strategy_ref: input.binding.strategy_ref,
    assignment_id: input.assignment_id,
    grant_id: input.grant_id,
    device_id: input.device_id,
    question_snapshots: Object.freeze([...input.question_snapshots]),
    content_root_hash: previewSessionContentRoot(input.question_snapshots),
    scoring_root_hash: previewSessionScoringRoot(input.question_snapshots),
    renderer_root_hash: previewSessionRendererRoot(input.question_snapshots),
    captured_at: input.captured_at
  }
  const snapshot = {
    ...snapshotWithoutRoot,
    snapshot_root_hash: previewSessionSnapshotRoot(snapshotWithoutRoot)
  }
  return assertPreviewSessionSnapshot(snapshot)
}
