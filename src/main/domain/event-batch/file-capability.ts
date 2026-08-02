import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats
} from 'fs'
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'path'
import { sha256Hex } from './canonical-json'

export interface FileIdentity {
  device: number
  inode: number
}

export interface StableFileSnapshot {
  identity: FileIdentity
  byteSize: number
  sha256: string
  bytes: Buffer
}

export interface DurableFileHandle {
  readonly fd: number
  readonly absolutePath: string
  readonly relativePath: string
  readonly identity: FileIdentity
  closed: boolean
}

export interface FileDurabilityHooks {
  syncFile: (fd: number) => void
  syncDirectory: (fd: number) => void
  removeFile?: (absolutePath: string) => void
}

export interface FileCapabilityProbeResult {
  supported: true
  exclusiveCreate: true
  sameFileIdentity: true
  fileSync: true
  directoryBarrier: true
  hardLinkNoClobber: true
  atomicReplace: true
}

export class FileCapabilityError extends Error {
  constructor(
    public readonly code:
      | 'PATH_INVALID'
      | 'PATH_ALIAS'
      | 'IDENTITY_DRIFT'
      | 'EXCLUSIVE_CREATE_FAILED'
      | 'SYNC_UNSUPPORTED'
      | 'NO_CLOBBER_FAILED'
      | 'REMOVE_FAILED'
      | 'ATOMIC_REPLACE_FAILED',
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[event-batch-file] ${message}`)
    this.name = 'FileCapabilityError'
  }
}

const DEFAULT_HOOKS: FileDurabilityHooks = {
  syncFile: (fd) => fsyncSync(fd),
  syncDirectory: (fd) => fsyncSync(fd),
  removeFile: unlinkSync
}

function identity(stats: Stats): FileIdentity {
  return { device: stats.dev, inode: stats.ino }
}

function identityEquals(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

function assertRegularSingleLink(stats: Stats, path: string): void {
  if (!stats.isFile()) throw new FileCapabilityError('PATH_INVALID', `${path} is not a regular file`)
  if (stats.nlink !== 1) throw new FileCapabilityError('PATH_ALIAS', `${path} must have exactly one hard link`)
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function protocolRelative(root: string, absolutePath: string): string {
  const value = relative(root, absolutePath)
  return value ? value.split(sep).join('/') : '.'
}

export class DurableFileCapability {
  readonly dataRoot: string

  constructor(dataRoot: string, private readonly hooks: FileDurabilityHooks = DEFAULT_HOOKS) {
    if (!isAbsolute(dataRoot) || resolve(dataRoot) !== dataRoot) {
      throw new FileCapabilityError('PATH_INVALID', 'data root must be an absolute normalized path')
    }
    const rootStats = lstatSync(dataRoot)
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || realpathSync(dataRoot) !== dataRoot) {
      throw new FileCapabilityError('PATH_ALIAS', 'data root must be an existing non-symlink real directory')
    }
    this.dataRoot = dataRoot
  }

  resolveRelative(relativePath: string): string {
    if (
      !relativePath
      || isAbsolute(relativePath)
      || /^[a-z]:/i.test(relativePath)
      || relativePath.includes('\\')
      || relativePath.includes('\u0000')
      || posix.normalize(relativePath) !== relativePath
      || relativePath === '.'
    ) {
      throw new FileCapabilityError('PATH_INVALID', `invalid relative path ${relativePath}`)
    }
    const absolutePath = resolve(this.dataRoot, relativePath)
    const offset = relative(this.dataRoot, absolutePath)
    if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
      throw new FileCapabilityError('PATH_INVALID', `path escapes data root: ${relativePath}`)
    }
    this.assertNoSymlinkComponents(absolutePath)
    return absolutePath
  }

  private assertNoSymlinkComponents(absolutePath: string): void {
    let cursor = absolutePath
    while (cursor !== this.dataRoot) {
      if (pathExists(cursor) && lstatSync(cursor).isSymbolicLink()) {
        throw new FileCapabilityError('PATH_ALIAS', `symlink path component is forbidden: ${cursor}`)
      }
      const parent = dirname(cursor)
      if (parent === cursor || (!parent.startsWith(`${this.dataRoot}${sep}`) && parent !== this.dataRoot)) {
        throw new FileCapabilityError('PATH_INVALID', `path escaped data root: ${absolutePath}`)
      }
      cursor = parent
    }
  }

  ensureDirectory(relativePath: string): string {
    const parts = relativePath.split('/').filter(Boolean)
    if (parts.join('/') !== relativePath || parts.some((part) => part === '.' || part === '..')) {
      throw new FileCapabilityError('PATH_INVALID', `invalid directory path ${relativePath}`)
    }
    let currentRelative = ''
    for (const part of parts) {
      currentRelative = currentRelative ? `${currentRelative}/${part}` : part
      const absolutePath = this.resolveRelative(currentRelative)
      if (existsSync(absolutePath)) {
        const stats = lstatSync(absolutePath)
        if (!stats.isDirectory() || stats.isSymbolicLink()) {
          throw new FileCapabilityError('PATH_ALIAS', `${currentRelative} is not a real directory`)
        }
        continue
      }
      mkdirSync(absolutePath, { recursive: false, mode: 0o700 })
      this.syncDirectory(protocolRelative(this.dataRoot, dirname(absolutePath)))
    }
    return this.resolveRelative(relativePath)
  }

  createExclusive(relativePath: string, initialBytes: Uint8Array = new Uint8Array()): DurableFileHandle {
    const absolutePath = this.resolveRelative(relativePath)
    const parent = dirname(absolutePath)
    if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
      throw new FileCapabilityError('PATH_INVALID', `parent directory does not exist for ${relativePath}`)
    }
    let fd: number
    try {
      fd = openSync(
        absolutePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW,
        0o600
      )
    } catch (error) {
      throw new FileCapabilityError('EXCLUSIVE_CREATE_FAILED', `exclusive create failed for ${relativePath}`, error)
    }
    try {
      const handle = this.handleFromFd(fd, absolutePath, relativePath)
      if (initialBytes.length > 0) this.appendExact(handle, initialBytes)
      this.syncFile(handle)
      this.syncDirectory(protocolRelative(this.dataRoot, parent))
      return handle
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }

  openAppend(relativePath: string): DurableFileHandle {
    const absolutePath = this.resolveRelative(relativePath)
    const before = lstatSync(absolutePath)
    assertRegularSingleLink(before, absolutePath)
    const fd = openSync(absolutePath, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW)
    try {
      const handle = this.handleFromFd(fd, absolutePath, relativePath)
      if (!identityEquals(handle.identity, identity(before))) {
        throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} changed while opening`)
      }
      return handle
    } catch (error) {
      closeSync(fd)
      throw error
    }
  }

  private handleFromFd(fd: number, absolutePath: string, relativePath: string): DurableFileHandle {
    const descriptorStats = fstatSync(fd)
    const pathStats = lstatSync(absolutePath)
    assertRegularSingleLink(descriptorStats, absolutePath)
    assertRegularSingleLink(pathStats, absolutePath)
    const descriptorIdentity = identity(descriptorStats)
    if (!identityEquals(descriptorIdentity, identity(pathStats))) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} descriptor/path identity mismatch`)
    }
    return { fd, absolutePath, relativePath, identity: descriptorIdentity, closed: false }
  }

  assertHandleIdentity(handle: DurableFileHandle): Stats {
    if (handle.closed) throw new FileCapabilityError('IDENTITY_DRIFT', `${handle.relativePath} handle is closed`)
    const descriptorStats = fstatSync(handle.fd)
    const pathStats = lstatSync(handle.absolutePath)
    assertRegularSingleLink(descriptorStats, handle.absolutePath)
    assertRegularSingleLink(pathStats, handle.absolutePath)
    if (
      !identityEquals(handle.identity, identity(descriptorStats))
      || !identityEquals(handle.identity, identity(pathStats))
    ) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `${handle.relativePath} identity changed`)
    }
    return descriptorStats
  }

  appendExact(handle: DurableFileHandle, bytes: Uint8Array): { offsetStart: number; offsetEnd: number } {
    const before = this.assertHandleIdentity(handle)
    let written = 0
    while (written < bytes.length) {
      const count = writeSync(handle.fd, bytes, written, bytes.length - written, null)
      if (count <= 0) throw new FileCapabilityError('IDENTITY_DRIFT', `short append to ${handle.relativePath}`)
      written += count
    }
    const after = this.assertHandleIdentity(handle)
    if (after.size !== before.size + bytes.length) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `append size mismatch for ${handle.relativePath}`)
    }
    return { offsetStart: before.size, offsetEnd: after.size }
  }

  truncate(handle: DurableFileHandle, size: number): void {
    const before = this.assertHandleIdentity(handle)
    if (!Number.isSafeInteger(size) || size < 0 || size > before.size) {
      throw new FileCapabilityError('PATH_INVALID', `invalid truncate size ${size}`)
    }
    ftruncateSync(handle.fd, size)
    const after = this.assertHandleIdentity(handle)
    if (after.size !== size) throw new FileCapabilityError('IDENTITY_DRIFT', `truncate size mismatch for ${handle.relativePath}`)
  }

  syncFile(handle: DurableFileHandle): void {
    this.assertHandleIdentity(handle)
    try {
      this.hooks.syncFile(handle.fd)
    } catch (error) {
      throw new FileCapabilityError('SYNC_UNSUPPORTED', `file sync failed for ${handle.relativePath}`, error)
    }
    this.assertHandleIdentity(handle)
  }

  syncDirectory(relativeDirectory: string): void {
    const absolutePath = relativeDirectory === '.' ? this.dataRoot : this.resolveRelative(relativeDirectory)
    const stats = lstatSync(absolutePath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new FileCapabilityError('PATH_ALIAS', `${relativeDirectory} is not a real directory`)
    }
    const directoryFlag = constants.O_DIRECTORY ?? 0
    if (!directoryFlag) throw new FileCapabilityError('SYNC_UNSUPPORTED', 'O_DIRECTORY is unavailable')
    const fd = openSync(absolutePath, constants.O_RDONLY | directoryFlag | constants.O_NOFOLLOW)
    try {
      this.hooks.syncDirectory(fd)
    } catch (error) {
      throw new FileCapabilityError('SYNC_UNSUPPORTED', `directory barrier failed for ${relativeDirectory}`, error)
    } finally {
      closeSync(fd)
    }
  }

  close(handle: DurableFileHandle): void {
    if (handle.closed) return
    closeSync(handle.fd)
    handle.closed = true
  }

  hashHandle(handle: DurableFileHandle): string {
    const before = this.assertHandleIdentity(handle)
    const bytes = Buffer.allocUnsafe(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(handle.fd, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) {
        throw new FileCapabilityError('IDENTITY_DRIFT', `short read from ${handle.relativePath}`)
      }
      offset += count
    }
    const after = this.assertHandleIdentity(handle)
    if (after.size !== before.size) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `${handle.relativePath} changed while hashing`)
    }
    return sha256Hex(bytes)
  }

  readStable(relativePath: string): StableFileSnapshot | null {
    const absolutePath = this.resolveRelative(relativePath)
    if (!pathExists(absolutePath)) return null
    const before = lstatSync(absolutePath)
    assertRegularSingleLink(before, absolutePath)
    const fd = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const descriptorBefore = fstatSync(fd)
      assertRegularSingleLink(descriptorBefore, absolutePath)
      if (!identityEquals(identity(before), identity(descriptorBefore))) {
        throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} changed while opening for read`)
      }
      const bytes = readFileSync(fd)
      const descriptorAfter = fstatSync(fd)
      const pathAfter = lstatSync(absolutePath)
      assertRegularSingleLink(descriptorAfter, absolutePath)
      assertRegularSingleLink(pathAfter, absolutePath)
      if (
        !identityEquals(identity(before), identity(descriptorAfter))
        || !identityEquals(identity(before), identity(pathAfter))
        || descriptorAfter.size !== bytes.length
      ) {
        throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} changed while reading`)
      }
      return {
        identity: identity(descriptorAfter),
        byteSize: descriptorAfter.size,
        sha256: sha256Hex(bytes),
        bytes
      }
    } finally {
      closeSync(fd)
    }
  }

  removeFile(relativePath: string, expectedIdentity?: FileIdentity): void {
    const absolutePath = this.resolveRelative(relativePath)
    const before = lstatSync(absolutePath)
    assertRegularSingleLink(before, absolutePath)
    const beforeIdentity = identity(before)
    if (expectedIdentity && !identityEquals(expectedIdentity, beforeIdentity)) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} changed before removal`)
    }
    try {
      (this.hooks.removeFile ?? unlinkSync)(absolutePath)
    } catch (error) {
      throw new FileCapabilityError('REMOVE_FAILED', `failed to remove ${relativePath}`, error)
    }
    if (pathExists(absolutePath)) throw new FileCapabilityError('IDENTITY_DRIFT', `${relativePath} remained after removal`)
    this.syncDirectory(protocolRelative(this.dataRoot, dirname(absolutePath)))
  }

  listRegularFiles(relativeDirectory: string): string[] {
    const absoluteDirectory = this.resolveRelative(relativeDirectory)
    if (!pathExists(absoluteDirectory)) return []
    const stats = lstatSync(absoluteDirectory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new FileCapabilityError('PATH_ALIAS', `${relativeDirectory} is not a real directory`)
    }
    return readdirSync(absoluteDirectory, { withFileTypes: true })
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new FileCapabilityError('PATH_ALIAS', `${relativeDirectory}/${entry.name} is not a regular file`)
        }
        return `${relativeDirectory}/${entry.name}`
      })
      .sort()
  }

  linkNoClobber(sourceRelative: string, targetRelative: string): FileIdentity {
    const sourcePath = this.resolveRelative(sourceRelative)
    const targetPath = this.resolveRelative(targetRelative)
    const sourceStats = lstatSync(sourcePath)
    assertRegularSingleLink(sourceStats, sourcePath)
    if (pathExists(targetPath)) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', `${targetRelative} already exists`)
    }
    try {
      linkSync(sourcePath, targetPath)
    } catch (error) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', `hard-link publication failed for ${targetRelative}`, error)
    }
    const sourceAfter = statSync(sourcePath)
    const targetAfter = lstatSync(targetPath)
    if (
      !sourceAfter.isFile()
      || !targetAfter.isFile()
      || sourceAfter.nlink !== 2
      || targetAfter.nlink !== 2
      || !identityEquals(identity(sourceAfter), identity(targetAfter))
    ) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', `hard-link identity mismatch for ${targetRelative}`)
    }
    this.syncDirectory(protocolRelative(this.dataRoot, dirname(targetPath)))
    return identity(targetAfter)
  }

  publishNoClobber(sourceRelative: string, targetRelative: string): FileIdentity {
    const publishedIdentity = this.linkNoClobber(sourceRelative, targetRelative)
    const sourcePath = this.resolveRelative(sourceRelative)
    const targetPath = this.resolveRelative(targetRelative)
    try {
      unlinkSync(sourcePath)
    } catch (error) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', `failed to unlink publication source ${sourceRelative}`, error)
    }
    this.syncDirectory(protocolRelative(this.dataRoot, dirname(sourcePath)))
    const targetStats = lstatSync(targetPath)
    assertRegularSingleLink(targetStats, targetPath)
    if (!identityEquals(publishedIdentity, identity(targetStats))) {
      throw new FileCapabilityError('IDENTITY_DRIFT', `${targetRelative} changed after no-clobber publication`)
    }
    return publishedIdentity
  }

  moveNoClobber(sourceRelative: string, targetRelative: string): FileIdentity {
    const sourcePath = this.resolveRelative(sourceRelative)
    const targetPath = this.resolveRelative(targetRelative)
    const sourceStats = lstatSync(sourcePath)
    assertRegularSingleLink(sourceStats, sourcePath)
    if (pathExists(targetPath)) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', String(targetRelative) + ' already exists')
    }
    try {
      renameSync(sourcePath, targetPath)
    } catch (error) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', 'atomic move failed for ' + targetRelative, error)
    }
    this.syncDirectory(protocolRelative(this.dataRoot, dirname(sourcePath)))
    this.syncDirectory(protocolRelative(this.dataRoot, dirname(targetPath)))
    const targetStats = lstatSync(targetPath)
    assertRegularSingleLink(targetStats, targetPath)
    return identity(targetStats)
  }

  atomicReplace(tempRelative: string, targetRelative: string, expectedTargetIdentity?: FileIdentity): void {
    const tempPath = this.resolveRelative(tempRelative)
    const targetPath = this.resolveRelative(targetRelative)
    const tempStats = lstatSync(tempPath)
    assertRegularSingleLink(tempStats, tempPath)
    if (expectedTargetIdentity) {
      const targetBefore = lstatSync(targetPath)
      assertRegularSingleLink(targetBefore, targetPath)
      if (!identityEquals(expectedTargetIdentity, identity(targetBefore))) {
        throw new FileCapabilityError('IDENTITY_DRIFT', `${targetRelative} changed before atomic replace`)
      }
    }
    try {
      renameSync(tempPath, targetPath)
    } catch (error) {
      throw new FileCapabilityError('ATOMIC_REPLACE_FAILED', `atomic replace failed for ${targetRelative}`, error)
    }
    const targetStats = lstatSync(targetPath)
    assertRegularSingleLink(targetStats, targetPath)
    if (!identityEquals(identity(tempStats), identity(targetStats))) {
      throw new FileCapabilityError('ATOMIC_REPLACE_FAILED', `replace identity mismatch for ${targetRelative}`)
    }
    const tempParent = protocolRelative(this.dataRoot, dirname(tempPath))
    const targetParent = protocolRelative(this.dataRoot, dirname(targetPath))
    if (tempParent !== targetParent) this.syncDirectory(tempParent)
    this.syncDirectory(targetParent)
  }
}

export function probeRequiredFileCapabilities(
  dataRoot: string,
  probeId: string,
  hooks: FileDurabilityHooks = DEFAULT_HOOKS
): FileCapabilityProbeResult {
  if (!/^[a-z0-9-]{1,64}$/.test(probeId)) {
    throw new FileCapabilityError('PATH_INVALID', 'probeId must be a lowercase owned token')
  }
  const capability = new DurableFileCapability(dataRoot, hooks)
  const probeDirectory = `.m5b-capability-${probeId}`
  const probeRoot = capability.resolveRelative(probeDirectory)
  if (pathExists(probeRoot)) throw new FileCapabilityError('EXCLUSIVE_CREATE_FAILED', 'probe directory already exists')
  mkdirSync(probeRoot, { recursive: false, mode: 0o700 })
  capability.syncDirectory('.')
  const sourceRelative = `${probeDirectory}/source.bin`
  const occupiedRelative = `${probeDirectory}/occupied.bin`
  const publishedRelative = `${probeDirectory}/published.bin`
  const replacementRelative = `${probeDirectory}/replacement.bin`
  let source: DurableFileHandle | null = null
  let occupied: DurableFileHandle | null = null
  let replacement: DurableFileHandle | null = null
  try {
    source = capability.createExclusive(sourceRelative, Buffer.from('source', 'utf8'))
    const sourceIdentity = source.identity
    capability.assertHandleIdentity(source)
    capability.syncFile(source)
    capability.close(source)
    source = null

    try {
      capability.createExclusive(sourceRelative)
      throw new FileCapabilityError('EXCLUSIVE_CREATE_FAILED', 'exclusive create unexpectedly overwrote source')
    } catch (error) {
      if (!(error instanceof FileCapabilityError) || error.code !== 'EXCLUSIVE_CREATE_FAILED') throw error
    }

    occupied = capability.createExclusive(occupiedRelative, Buffer.from('occupied', 'utf8'))
    capability.close(occupied)
    occupied = null
    try {
      capability.linkNoClobber(sourceRelative, occupiedRelative)
      throw new FileCapabilityError('NO_CLOBBER_FAILED', 'hard link unexpectedly overwrote occupied target')
    } catch (error) {
      if (!(error instanceof FileCapabilityError) || error.code !== 'NO_CLOBBER_FAILED') throw error
    }
    if (readFileSync(capability.resolveRelative(occupiedRelative), 'utf8') !== 'occupied') {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', 'occupied target bytes changed')
    }

    const publishedIdentity = capability.linkNoClobber(sourceRelative, publishedRelative)
    if (!identityEquals(sourceIdentity, publishedIdentity)) {
      throw new FileCapabilityError('NO_CLOBBER_FAILED', 'published hard link has a different identity')
    }
    unlinkSync(capability.resolveRelative(publishedRelative))
    capability.syncDirectory(probeDirectory)

    replacement = capability.createExclusive(replacementRelative, Buffer.from('replacement', 'utf8'))
    capability.close(replacement)
    replacement = null
    capability.atomicReplace(replacementRelative, occupiedRelative)
    if (readFileSync(capability.resolveRelative(occupiedRelative), 'utf8') !== 'replacement') {
      throw new FileCapabilityError('ATOMIC_REPLACE_FAILED', 'atomic replacement bytes mismatch')
    }

    unlinkSync(capability.resolveRelative(sourceRelative))
    unlinkSync(capability.resolveRelative(occupiedRelative))
    capability.syncDirectory(probeDirectory)
    rmdirSync(probeRoot)
    capability.syncDirectory('.')
    return {
      supported: true,
      exclusiveCreate: true,
      sameFileIdentity: true,
      fileSync: true,
      directoryBarrier: true,
      hardLinkNoClobber: true,
      atomicReplace: true
    }
  } catch (error) {
    if (source) capability.close(source)
    if (occupied) capability.close(occupied)
    if (replacement) capability.close(replacement)
    throw error instanceof FileCapabilityError
      ? error
      : new FileCapabilityError('SYNC_UNSUPPORTED', 'required file capability probe failed closed', error)
  }
}
