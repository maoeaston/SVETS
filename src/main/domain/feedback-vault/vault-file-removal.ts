import type { DurableFileCapability, FileIdentity } from '../event-batch/file-capability'
import { PreviewContractError } from '../preview/preview-errors'

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

export function removeVaultFile(capability: DurableFileCapability, relativePath: string, expectedIdentity?: FileIdentity): boolean {
  const snapshot = capability.readStable(relativePath)
  if (!snapshot) return false
  if (expectedIdentity && !sameIdentity(expectedIdentity, snapshot.identity)) throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `vault file identity changed before removal: ${relativePath}`)
  try {
    capability.removeFile(relativePath, snapshot.identity)
  } catch (error) {
    throw new PreviewContractError('FEEDBACK_RECONCILE_REQUIRED', `vault file removal failed: ${relativePath}`, undefined, error)
  }
  return true
}
