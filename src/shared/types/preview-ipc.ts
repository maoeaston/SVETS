import type { PreviewLifecycleStatus, PreviewScope } from './preview-contract'

export interface PreviewSourceQueryParams {
  jobCode?: string
  taskCode?: string
}

export interface PreviewReleaseQueryParams {
  releaseId: string
}

export interface PreviewSessionQueryParams {
  sessionId: string
}

export interface PreviewSourceView {
  releaseId: string
  sourceRefId: string
  deliveryMode: 'PREVIEW_ONLY'
  scope: PreviewScope
  status: PreviewLifecycleStatus
  questionId: string
  questionVersion: number
  semanticHash: string
  packId: string
  packVersion: string
  packHash: string
  strategyId: string
  strategyVersion: number
  effectiveAt: string
  expiresAt: string
}

export interface PreviewReleaseView extends PreviewSourceView {
  approvalId: string
  approvalHash: string
  manifestId: string
  manifestHash: string
  policyHash: string
  revokedAt: string | null
  auditRef: string
  canonicalReferences: unknown
}

export interface PreviewSessionView {
  previewSessionId: string
  assessmentSessionId: string
  studentId: string
  jobCode: string
  taskCode: string
  sourceRefId: string
  packId: string
  packVersion: string
  packHash: string
  strategyId: string
  strategyVersion: number
  status: string
  assignmentId: string
  grantId: string
  snapshotRootHash: string
  resultSuppressed: true
  previewRedlineRef: string | null
  snapshot: unknown
  createdAt: string
  updatedAt: string
}

export interface PreviewSessionQuestionView {
  sessionQuestionId: string
  previewSessionId: string
  questionId: string
  questionVersion: number
  semanticHash: string
  questionOrder: number
  questionPhase: 'ONLINE' | 'OFFLINE' | 'OBSERVATION'
  contentHash: string
  scoringHash: string
  rendererHash: string
  safetyRef: string
  snapshot: unknown
}
