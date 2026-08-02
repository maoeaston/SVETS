import type { DurableFileCapability } from '../event-batch/file-capability'

export const FEEDBACK_VAULT_ROOT = 'preview-feedback'
export const FEEDBACK_VAULT_FORMAT_VERSION = 'preview-feedback-vault-v1'

export const FEEDBACK_VAULT_PATHS = Object.freeze({
  identityMap: `${FEEDBACK_VAULT_ROOT}/private/identity-map`,
  drafts: `${FEEDBACK_VAULT_ROOT}/private/drafts`,
  revisions: `${FEEDBACK_VAULT_ROOT}/private/revisions`,
  export: `${FEEDBACK_VAULT_ROOT}/export`,
  journal: `${FEEDBACK_VAULT_ROOT}/journal`,
  manifest: `${FEEDBACK_VAULT_ROOT}/vault-manifest.json`
})

export function ensureFeedbackVaultLayout(capability: DurableFileCapability): void {
  capability.ensureDirectory(`${FEEDBACK_VAULT_ROOT}/private`)
  capability.ensureDirectory(FEEDBACK_VAULT_PATHS.identityMap)
  capability.ensureDirectory(FEEDBACK_VAULT_PATHS.drafts)
  capability.ensureDirectory(FEEDBACK_VAULT_PATHS.revisions)
  capability.ensureDirectory(FEEDBACK_VAULT_PATHS.export)
  capability.ensureDirectory(FEEDBACK_VAULT_PATHS.journal)
}

export function commitJournalPath(commitId: string): string {
  return `${FEEDBACK_VAULT_PATHS.journal}/commit-${commitId}.json`
}

export function purgeMarkerPath(commitId: string): string {
  return `${FEEDBACK_VAULT_PATHS.journal}/purged-${commitId}.json`
}

export function stagedBodyPath(commitId: string): string {
  return `${FEEDBACK_VAULT_PATHS.drafts}/${commitId}.stage.json`
}

export function revisionBodyPath(feedbackId: string, revisionNo: number, commitId: string): string {
  return `${FEEDBACK_VAULT_PATHS.revisions}/${feedbackId}-${revisionNo}-${commitId}.json`
}

export function exportArtifactPath(exportRef: string): string {
  return `${FEEDBACK_VAULT_PATHS.export}/${exportRef}.json`
}
