import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync
} from 'fs'
import { dirname } from 'path'
import {
  ARTIFACT_PLAN_SCHEMA_VERSION,
  assertArtifactPlanTargetIdentity,
  artifactTargetIdentity,
  artifactStagePath,
  type PreparedArtifactPlan
} from './artifact-probe'

export class ArtifactPublishError extends Error {
  constructor(
    public readonly code: 'PLAN_INVALID' | 'TARGET_CONFLICT' | 'STAGE_CONFLICT' | 'PUBLISH_FAILED',
    message: string
  ) {
    super(`[event-batch-artifact-publisher] ${message}`)
    this.name = 'ArtifactPublishError'
  }
}

export interface ArtifactPublishResult {
  readonly status: 'PUBLISHED' | 'ADOPTED'
  readonly targetPath: string
  readonly cleanupWarning: string | null
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function preparedArtifactBytes(plan: PreparedArtifactPlan): Buffer {
  if (plan.schema_version !== ARTIFACT_PLAN_SCHEMA_VERSION || plan.mime_type !== 'text/html') {
    throw new ArtifactPublishError('PLAN_INVALID', 'artifact plan schema or MIME type is invalid')
  }
  if (!/^[a-f0-9]{64}$/.test(plan.file_hash) || !Number.isSafeInteger(plan.file_size_bytes) || plan.file_size_bytes < 0) {
    throw new ArtifactPublishError('PLAN_INVALID', 'artifact hash or size is invalid')
  }
  try {
    artifactTargetIdentity(plan.target_identity)
  } catch (error) {
    throw new ArtifactPublishError('PLAN_INVALID', error instanceof Error ? error.message : String(error))
  }
  const bytes = Buffer.from(plan.artifact_bytes_base64, 'base64')
  if (
    bytes.toString('base64') !== plan.artifact_bytes_base64
    || bytes.byteLength !== plan.file_size_bytes
    || hash(bytes) !== plan.file_hash
  ) throw new ArtifactPublishError('PLAN_INVALID', 'artifact bytes do not match prepared facts')
  return bytes
}

function syncDirectory(path: string): void {
  const handle = openSync(path, 'r')
  try {
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
}

function existing(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertMatchingTarget(targetPath: string, plan: PreparedArtifactPlan): 'MISSING' | 'MATCHING' {
  const stat = existing(targetPath)
  if (!stat) return 'MISSING'
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ArtifactPublishError('TARGET_CONFLICT', 'artifact target is not a regular file')
  }
  const bytes = readFileSync(targetPath)
  if (bytes.byteLength !== plan.file_size_bytes || hash(bytes) !== plan.file_hash) {
    throw new ArtifactPublishError('TARGET_CONFLICT', 'artifact target conflicts with frozen bytes')
  }
  return 'MATCHING'
}

function writeStage(stagePath: string, bytes: Buffer): void {
  let handle: number | null = null
  try {
    handle = openSync(stagePath, 'wx', 0o600)
    let offset = 0
    while (offset < bytes.byteLength) offset += writeSync(handle, bytes, offset, bytes.byteLength - offset)
    fsyncSync(handle)
  } finally {
    if (handle !== null) closeSync(handle)
  }
  const written = readFileSync(stagePath)
  if (!written.equals(bytes)) throw new ArtifactPublishError('PUBLISH_FAILED', 'stage bytes failed verification')
}

function cleanupOwnedStage(stagePath: string, targetPath: string, bytes: Buffer): void {
  const stage = existing(stagePath)
  if (!stage) return
  const target = existing(targetPath)
  if (
    !stage.isFile()
    || stage.isSymbolicLink()
    || !readFileSync(stagePath).equals(bytes)
    || stage.nlink > 2
    || (stage.nlink === 2 && (!target || target.dev !== stage.dev || target.ino !== stage.ino))
  ) {
    throw new ArtifactPublishError('STAGE_CONFLICT', 'refusing to remove an unowned stage path')
  }
  unlinkSync(stagePath)
  syncDirectory(dirname(stagePath))
}

function cleanupWarning(stagePath: string, targetPath: string, bytes: Buffer): string | null {
  try {
    cleanupOwnedStage(stagePath, targetPath, bytes)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function publishPreparedArtifact(plan: PreparedArtifactPlan): ArtifactPublishResult {
  const bytes = preparedArtifactBytes(plan)
  try {
    assertArtifactPlanTargetIdentity(plan)
    if (assertMatchingTarget(plan.target_path, plan) === 'MATCHING') {
      return Object.freeze({
        status: 'ADOPTED',
        targetPath: plan.target_path,
        cleanupWarning: null
      })
    }
    const stagePath = artifactStagePath(plan.target_path, `${plan.artifact_id}-${randomUUID()}`)
    writeStage(stagePath, bytes)
    try {
      try {
        linkSync(stagePath, plan.target_path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (assertMatchingTarget(plan.target_path, plan) !== 'MATCHING') {
          throw new ArtifactPublishError('TARGET_CONFLICT', 'artifact target appeared with conflicting bytes')
        }
        return Object.freeze({
          status: 'ADOPTED',
          targetPath: plan.target_path,
          cleanupWarning: cleanupWarning(stagePath, plan.target_path, bytes)
        })
      }
      syncDirectory(dirname(plan.target_path))
      return Object.freeze({
        status: 'PUBLISHED',
        targetPath: plan.target_path,
        cleanupWarning: cleanupWarning(stagePath, plan.target_path, bytes)
      })
    } catch (error) {
      cleanupWarning(stagePath, plan.target_path, bytes)
      throw error
    }
  } catch (error) {
    if (error instanceof ArtifactPublishError) throw error
    throw new ArtifactPublishError('PUBLISH_FAILED', error instanceof Error ? error.message : String(error))
  }
}
