import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  type Stats
} from 'fs'
import { basename, dirname, relative, resolve } from 'path'

export const ARTIFACT_PLAN_SCHEMA_VERSION = 'report-export-artifact-v1'

export interface PreparedArtifactPlan {
  readonly schema_version: typeof ARTIFACT_PLAN_SCHEMA_VERSION
  readonly artifact_id: string
  readonly target_path: string
  readonly target_identity: ArtifactTargetIdentity
  readonly artifact_bytes_base64: string
  readonly file_hash: string
  readonly file_size_bytes: number
  readonly mime_type: 'text/html'
}

export interface ArtifactDirectoryIdentity {
  readonly path: string
  readonly device: string
  readonly inode: string
}

export interface ArtifactTargetIdentity {
  readonly artifact_root: ArtifactDirectoryIdentity
  readonly target_parent: ArtifactDirectoryIdentity
}

export interface ArtifactInteractionTarget {
  readonly artifactRoot: string
  readonly targetPath: string
  readonly artifactId: string
}

export class ArtifactProbeError extends Error {
  constructor(
    public readonly code: 'TARGET_INVALID' | 'TARGET_EXISTS' | 'PROBE_FAILED',
    message: string
  ) {
    super(`[event-batch-artifact-probe] ${message}`)
    this.name = 'ArtifactProbeError'
  }
}

function assertToken(value: string, field: string): string {
  if (!/^[a-z0-9-]{16,128}$/i.test(value)) {
    throw new ArtifactProbeError('TARGET_INVALID', `${field} is invalid`)
  }
  return value
}

function syncDirectory(path: string): void {
  const handle = openSync(path, 'r')
  try {
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
}

function pathIsAbsent(path: string): boolean {
  try {
    lstatSync(path)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

function directoryIdentity(path: string, stat: Stats): ArtifactDirectoryIdentity {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ArtifactProbeError('TARGET_INVALID', `${path} is not a real directory`)
  }
  const device = String(stat.dev)
  const inode = String(stat.ino)
  if (!/^\d+$/.test(device) || !/^\d+$/.test(inode)) {
    throw new ArtifactProbeError('TARGET_INVALID', `${path} identity is invalid`)
  }
  return Object.freeze({ path, device, inode })
}

function parsedDirectoryIdentity(value: unknown, field: string): ArtifactDirectoryIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactProbeError('TARGET_INVALID', `${field} identity is invalid`)
  }
  const identity = value as Record<string, unknown>
  const path = typeof identity.path === 'string' ? identity.path : ''
  const device = typeof identity.device === 'string' ? identity.device : ''
  const inode = typeof identity.inode === 'string' ? identity.inode : ''
  if (!path || path !== resolve(path) || !/^\d+$/.test(device) || !/^\d+$/.test(inode)) {
    throw new ArtifactProbeError('TARGET_INVALID', `${field} identity is invalid`)
  }
  return Object.freeze({ path, device, inode })
}

export function artifactTargetIdentity(value: unknown): ArtifactTargetIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArtifactProbeError('TARGET_INVALID', 'target identity is invalid')
  }
  const identity = value as Record<string, unknown>
  return Object.freeze({
    artifact_root: parsedDirectoryIdentity(identity.artifact_root, 'artifact_root'),
    target_parent: parsedDirectoryIdentity(identity.target_parent, 'target_parent')
  })
}

function sameDirectoryIdentity(left: ArtifactDirectoryIdentity, right: ArtifactDirectoryIdentity): boolean {
  return left.path === right.path && left.device === right.device && left.inode === right.inode
}

export function artifactStagePath(targetPath: string, artifactId: string): string {
  return resolve(dirname(targetPath), `.${basename(targetPath)}.svets-${assertToken(artifactId, 'artifactId')}.stage`)
}

export function assertArtifactInteractionTarget(input: ArtifactInteractionTarget): Readonly<{
  artifactRoot: string
  targetPath: string
  stagePath: string
  targetIdentity: ArtifactTargetIdentity
}> {
  const artifactRoot = resolve(input.artifactRoot)
  const targetPath = resolve(input.targetPath)
  const targetParent = dirname(targetPath)
  const targetRelative = relative(artifactRoot, targetPath)
  if (!artifactRoot || targetRelative === '' || targetRelative === '..' || targetRelative.startsWith('../') || targetRelative.startsWith('..\\')) {
    throw new ArtifactProbeError('TARGET_INVALID', 'target must be a child of the explicit artifact root')
  }
  let rootStat: Stats
  let parentStat: Stats
  try {
    rootStat = lstatSync(artifactRoot)
    parentStat = lstatSync(targetParent)
  } catch (error) {
    throw new ArtifactProbeError('TARGET_INVALID', `artifact root or target directory is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const rootIdentity = directoryIdentity(artifactRoot, rootStat)
  const parentIdentity = directoryIdentity(targetParent, parentStat)
  const realRoot = realpathSync(artifactRoot)
  const realParent = realpathSync(targetParent)
  const realParentRelative = relative(realRoot, realParent)
  if (
    realParentRelative === '..'
    || realParentRelative.startsWith('../')
    || realParentRelative.startsWith('..\\')
  ) {
    throw new ArtifactProbeError('TARGET_INVALID', 'target parent resolves outside the explicit artifact root')
  }
  if (!pathIsAbsent(targetPath)) throw new ArtifactProbeError('TARGET_EXISTS', 'export target already exists')
  return Object.freeze({
    artifactRoot,
    targetPath,
    stagePath: artifactStagePath(targetPath, input.artifactId),
    targetIdentity: Object.freeze({ artifact_root: rootIdentity, target_parent: parentIdentity })
  })
}

/** Verifies that a frozen artifact still targets the exact directories selected before PONR. */
export function assertArtifactPlanTargetIdentity(plan: PreparedArtifactPlan): Readonly<{
  stagePath: string
}> {
  const identity = artifactTargetIdentity(plan.target_identity)
  const targetPath = resolve(plan.target_path)
  if (targetPath !== plan.target_path) throw new ArtifactProbeError('TARGET_INVALID', 'artifact target path is not canonical')
  const targetParent = dirname(targetPath)
  const relativeTarget = relative(identity.artifact_root.path, targetPath)
  if (
    !relativeTarget
    || relativeTarget === '..'
    || relativeTarget.startsWith('../')
    || relativeTarget.startsWith('..\\')
  ) throw new ArtifactProbeError('TARGET_INVALID', 'artifact target is outside its frozen root')
  let rootStat: Stats
  let parentStat: Stats
  try {
    rootStat = lstatSync(identity.artifact_root.path)
    parentStat = lstatSync(targetParent)
  } catch (error) {
    throw new ArtifactProbeError('TARGET_INVALID', `frozen artifact directories are unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const root = directoryIdentity(identity.artifact_root.path, rootStat)
  const parent = directoryIdentity(targetParent, parentStat)
  if (!sameDirectoryIdentity(root, identity.artifact_root) || !sameDirectoryIdentity(parent, identity.target_parent)) {
    throw new ArtifactProbeError('TARGET_INVALID', 'frozen artifact directory identity changed')
  }
  const realRoot = realpathSync(identity.artifact_root.path)
  const realParent = realpathSync(targetParent)
  const realParentRelative = relative(realRoot, realParent)
  if (realParentRelative === '..' || realParentRelative.startsWith('../') || realParentRelative.startsWith('..\\')) {
    throw new ArtifactProbeError('TARGET_INVALID', 'frozen artifact target parent resolves outside its root')
  }
  return Object.freeze({ stagePath: artifactStagePath(targetPath, plan.artifact_id) })
}

/** Performs a no-content ownership/barrier check before the durable PONR. */
export function probeArtifactTarget(input: ArtifactInteractionTarget): Readonly<{
  artifactRoot: string
  targetPath: string
  stagePath: string
  targetIdentity: ArtifactTargetIdentity
}> {
  const verified = assertArtifactInteractionTarget(input)
  if (!pathIsAbsent(verified.stagePath)) {
    throw new ArtifactProbeError('PROBE_FAILED', 'owned stage path is unexpectedly occupied')
  }
  let handle: number | null = null
  let created = false
  try {
    handle = openSync(verified.stagePath, 'wx', 0o600)
    created = true
    fsyncSync(handle)
    closeSync(handle)
    handle = null
    const stage = lstatSync(verified.stagePath)
    if (!stage.isFile() || stage.isSymbolicLink() || stage.nlink !== 1 || stage.size !== 0) {
      throw new ArtifactProbeError('PROBE_FAILED', 'probe file identity is invalid')
    }
    unlinkSync(verified.stagePath)
    syncDirectory(dirname(verified.targetPath))
    return verified
  } catch (error) {
    if (handle !== null) closeSync(handle)
    try {
      if (created) {
        const stage = lstatSync(verified.stagePath)
        if (stage.isFile() && !stage.isSymbolicLink() && stage.nlink === 1 && stage.size === 0) {
          unlinkSync(verified.stagePath)
        }
      }
    } catch {
      // The original probe failure remains authoritative; no wildcard cleanup is allowed.
    }
    if (error instanceof ArtifactProbeError) throw error
    throw new ArtifactProbeError('PROBE_FAILED', error instanceof Error ? error.message : String(error))
  }
}
