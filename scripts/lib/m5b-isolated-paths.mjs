import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

export const M5B_TEMP_PREFIX = 'svets-m5b-'
export const M5B_PATH_KEYS = Object.freeze([
  'runRoot',
  'dataRoot',
  'dbPath',
  'legacyLogPath',
  'userDataRoot',
  'exportRoot',
  'evidenceRoot'
])

export class M5bIsolatedPathError extends Error {
  constructor(message) {
    super(`[m5b-isolated-paths] ${message}`)
    this.name = 'M5bIsolatedPathError'
  }
}

function statIfPresent(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}

function isWithin(parent, child) {
  const offset = relative(parent, child)
  return offset !== '' && !offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset)
}

function assertPathShape(paths) {
  for (const key of M5B_PATH_KEYS) {
    const value = paths[key]
    if (typeof value !== 'string' || !value.trim()) throw new M5bIsolatedPathError(`${key} is required`)
    if (!isAbsolute(value)) throw new M5bIsolatedPathError(`${key} must be absolute`)
    if (resolve(value) !== value) throw new M5bIsolatedPathError(`${key} must be normalized`)
  }

  const expected = {
    dataRoot: join(paths.runRoot, 'data-root'),
    dbPath: join(paths.runRoot, 'data-root', 'xc-career-guide.db'),
    legacyLogPath: join(paths.runRoot, 'data-root', 'action_log.jsonl'),
    userDataRoot: join(paths.runRoot, 'user-data'),
    exportRoot: join(paths.runRoot, 'export'),
    evidenceRoot: join(paths.runRoot, 'evidence')
  }
  for (const [key, value] of Object.entries(expected)) {
    if (paths[key] !== value) throw new M5bIsolatedPathError(`${key} is not paired with runRoot`)
  }

  const resolvedTmp = realpathSync(tmpdir())
  const resolvedRunParent = realpathSync(dirname(paths.runRoot))
  if (resolvedRunParent !== resolvedTmp) throw new M5bIsolatedPathError('runRoot must be a direct child of the system temporary directory')
  if (!basename(paths.runRoot).startsWith(M5B_TEMP_PREFIX)) throw new M5bIsolatedPathError(`runRoot basename must start with ${M5B_TEMP_PREFIX}`)
  if (!isWithin(resolvedTmp, paths.runRoot)) throw new M5bIsolatedPathError('runRoot must be below the system temporary directory')
}

function assertNoSymlinkComponents(path, stopAt) {
  const components = []
  let cursor = path
  while (cursor !== stopAt) {
    if (!isWithin(stopAt, cursor)) throw new M5bIsolatedPathError(`path escaped runRoot: ${path}`)
    components.push(cursor)
    cursor = dirname(cursor)
  }
  components.push(stopAt)
  for (const component of components.reverse()) {
    const stat = statIfPresent(component)
    if (stat?.isSymbolicLink()) throw new M5bIsolatedPathError(`symlink component is forbidden: ${component}`)
  }
}

function identityKey(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`
}

function assertExistingIdentities(paths) {
  const runStat = statIfPresent(paths.runRoot)
  if (!runStat?.isDirectory()) throw new M5bIsolatedPathError('runRoot must already exist as a directory')
  if (realpathSync(paths.runRoot) !== paths.runRoot) throw new M5bIsolatedPathError('runRoot real path drifted')

  for (const key of ['dataRoot', 'userDataRoot', 'exportRoot', 'evidenceRoot']) {
    const stat = statIfPresent(paths[key])
    if (!stat?.isDirectory()) throw new M5bIsolatedPathError(`${key} must already exist as a directory`)
    if (realpathSync(paths[key]) !== paths[key]) throw new M5bIsolatedPathError(`${key} real path drifted`)
  }

  const fileIdentities = new Map()
  for (const key of ['dbPath', 'legacyLogPath']) {
    const stat = statIfPresent(paths[key])
    if (!stat) continue
    if (!stat.isFile()) throw new M5bIsolatedPathError(`${key} must be a regular file when present`)
    if (stat.nlink !== 1) throw new M5bIsolatedPathError(`${key} hard-link aliases are forbidden`)
    const identity = identityKey(statSync(paths[key]))
    const previous = fileIdentities.get(identity)
    if (previous) throw new M5bIsolatedPathError(`${key} aliases ${previous}`)
    fileIdentities.set(identity, key)
  }
}

export function validateM5bIsolatedPaths(input) {
  const paths = Object.fromEntries(M5B_PATH_KEYS.map((key) => [key, input?.[key]]))
  assertPathShape(paths)
  for (const value of Object.values(paths)) assertNoSymlinkComponents(value, paths.runRoot)
  assertExistingIdentities(paths)
  return Object.freeze({ ...paths })
}

export function validateThenOpenM5bPaths(input, open) {
  if (typeof open !== 'function') throw new TypeError('open must be a function')
  const paths = validateM5bIsolatedPaths(input)
  return open(paths)
}

export function createM5bTempPaths() {
  const resolvedTmp = realpathSync(tmpdir())
  const runRoot = mkdtempSync(join(resolvedTmp, M5B_TEMP_PREFIX))
  const paths = {
    runRoot,
    dataRoot: join(runRoot, 'data-root'),
    dbPath: join(runRoot, 'data-root', 'xc-career-guide.db'),
    legacyLogPath: join(runRoot, 'data-root', 'action_log.jsonl'),
    userDataRoot: join(runRoot, 'user-data'),
    exportRoot: join(runRoot, 'export'),
    evidenceRoot: join(runRoot, 'evidence')
  }
  for (const key of ['dataRoot', 'userDataRoot', 'exportRoot', 'evidenceRoot']) {
    mkdirSync(paths[key], { recursive: false })
  }
  return Object.freeze(paths)
}
