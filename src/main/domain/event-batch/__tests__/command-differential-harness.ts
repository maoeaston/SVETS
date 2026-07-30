import { createHash } from 'crypto'
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve, sep } from 'path'
import {
  canonicalJson,
  sha256Hex,
  type CanonicalJsonValue
} from '../canonical-json'

const IMPLEMENTATION_START_FIXTURE = resolve(
  process.cwd(),
  'scripts/fixtures/m5b-implementation-start-v1.json'
)

interface FrozenSourceEntry {
  readonly path: string
  readonly file_type: 'FILE'
  readonly sha256: string
}

interface ImplementationStartFixture {
  readonly schema_version: 'm5b-implementation-start-v1'
  readonly base_commit: string
  readonly entries: readonly FrozenSourceEntry[]
}

export interface DifferentialOracleEvidence {
  readonly fixtureSchemaVersion: 'm5b-implementation-start-v1'
  readonly baseCommit: string
  readonly paths: readonly string[]
  readonly digest: string
}

export interface DifferentialEventSemantics {
  readonly eventType: string
  readonly payload: CanonicalJsonValue
}

export interface DifferentialSnapshot {
  readonly publicResult: CanonicalJsonValue
  readonly businessTables: Readonly<Record<string, readonly Readonly<Record<string, CanonicalJsonValue>>[]>>
  readonly events: readonly DifferentialEventSemantics[]
  readonly files: Readonly<Record<string, Readonly<{ sha256: string; byteLength: number }>>>
}

export interface DifferentialFieldNormalizer {
  /** Explicit dot path; wildcards and parent-wide deletion are forbidden. */
  readonly path: string
  readonly rationale: string
  normalize(value: CanonicalJsonValue, side: 'LEGACY' | 'V2'): CanonicalJsonValue
}

export interface DifferentialCaseResult {
  readonly testId: string
  readonly oracle: DifferentialOracleEvidence
  readonly legacy: DifferentialSnapshot
  readonly v2: DifferentialSnapshot
  readonly normalizedCanonicalJson: string
}

export interface DifferentialRunContext {
  readonly dataRoot: string
  readonly now: () => Date
  readonly nextId: () => string
}

export class DifferentialHarnessError extends Error {
  constructor(message: string) {
    super(`[event-batch-differential] ${message}`)
    this.name = 'DifferentialHarnessError'
  }
}

function implementationStart(): ImplementationStartFixture {
  const value = JSON.parse(readFileSync(IMPLEMENTATION_START_FIXTURE, 'utf8')) as ImplementationStartFixture
  if (value.schema_version !== 'm5b-implementation-start-v1' || !Array.isArray(value.entries)) {
    throw new DifferentialHarnessError('M5B-1 implementation-start fixture is invalid')
  }
  return value
}

export function verifyFrozenLegacyOracle(pathsValue: readonly string[]): DifferentialOracleEvidence {
  const paths = [...pathsValue]
  if (
    paths.length === 0
    || new Set(paths).size !== paths.length
    || paths.some((path) => !path || isAbsolute(path) || resolve(process.cwd(), path) === process.cwd())
  ) throw new DifferentialHarnessError('oracle paths must be unique repository-relative files')
  paths.sort()
  const fixture = implementationStart()
  const entries = new Map(fixture.entries.map((entry) => [entry.path, entry]))
  const evidence: string[] = []
  for (const path of paths) {
    const entry = entries.get(path)
    if (!entry || entry.file_type !== 'FILE' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new DifferentialHarnessError(`oracle path ${path} is not frozen by M5B-1`)
    }
    const currentHash = sha256Hex(readFileSync(resolve(process.cwd(), path)))
    if (currentHash !== entry.sha256) {
      throw new DifferentialHarnessError(`legacy oracle ${path} drifted from its M5B-1 hash`)
    }
    evidence.push(`${path}\u0000${entry.sha256}`)
  }
  return Object.freeze({
    fixtureSchemaVersion: fixture.schema_version,
    baseCommit: fixture.base_commit,
    paths: Object.freeze(paths),
    digest: createHash('sha256').update(evidence.join('\n'), 'utf8').digest('hex')
  })
}

function cloneRoots(sourceRootValue: string): Readonly<{
  parent: string
  legacyRoot: string
  v2Root: string
  cleanup(): void
}> {
  const sourceRoot = resolve(sourceRootValue)
  const temporaryRoot = realpathSync(tmpdir())
  if (
    !isAbsolute(sourceRootValue)
    || sourceRoot !== sourceRootValue
    || realpathSync(sourceRoot) !== sourceRoot
    || !sourceRoot.startsWith(`${temporaryRoot}${sep}`)
  ) {
    throw new DifferentialHarnessError('pre-state root must be a real normalized child of the temporary directory')
  }
  const stats = lstatSync(sourceRoot)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new DifferentialHarnessError('pre-state root must be a real directory')
  }
  const parent = mkdtempSync(join(tmpdir(), 'svets-m5b-differential-'))
  const legacyRoot = join(parent, 'legacy')
  const v2Root = join(parent, 'v2')
  cpSync(sourceRoot, legacyRoot, { recursive: true, dereference: false, errorOnExist: true })
  cpSync(sourceRoot, v2Root, { recursive: true, dereference: false, errorOnExist: true })
  return Object.freeze({
    parent,
    legacyRoot,
    v2Root,
    cleanup: () => rmSync(parent, { recursive: true, force: true })
  })
}

function deterministicContext(
  dataRoot: string,
  timestamp: string,
  ids: readonly string[]
): DifferentialRunContext {
  if (new Date(timestamp).toISOString() !== timestamp) {
    throw new DifferentialHarnessError('differential clock must be an exact ISO timestamp')
  }
  let cursor = 0
  return Object.freeze({
    dataRoot,
    now: () => new Date(timestamp),
    nextId: () => {
      const value = ids[cursor]
      if (!value) throw new DifferentialHarnessError(`deterministic ID source exhausted at ${cursor}`)
      cursor += 1
      return value
    }
  })
}

type MutableCanonicalContainer = Record<string, CanonicalJsonValue> | CanonicalJsonValue[]

function childContainer(
  parent: MutableCanonicalContainer,
  part: string,
  path: string
): MutableCanonicalContainer {
  const child = Array.isArray(parent)
    ? (/^(0|[1-9]\d*)$/.test(part) ? parent[Number(part)] : undefined)
    : parent[part]
  if (typeof child !== 'object' || child === null) {
    throw new DifferentialHarnessError(`normalizer path ${path} does not identify a container`)
  }
  return child as MutableCanonicalContainer
}

function normalizeField(
  parent: MutableCanonicalContainer,
  field: string,
  normalizer: DifferentialFieldNormalizer,
  side: 'LEGACY' | 'V2'
): void {
  let current: CanonicalJsonValue
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(field) || Number(field) >= parent.length) {
      throw new DifferentialHarnessError(`normalizer path ${normalizer.path} does not exist on ${side}`)
    }
    current = parent[Number(field)]
  } else {
    if (!Object.hasOwn(parent, field)) {
      throw new DifferentialHarnessError(`normalizer path ${normalizer.path} does not exist on ${side}`)
    }
    current = parent[field]
  }
  if (current !== null && typeof current === 'object') {
    throw new DifferentialHarnessError(`normalizer path ${normalizer.path} must identify one scalar field`)
  }
  const normalized = normalizer.normalize(current, side)
  if (
    (normalized !== null && typeof normalized === 'object')
    || (current === null ? normalized !== null : typeof normalized !== typeof current)
  ) {
    throw new DifferentialHarnessError(`normalizer path ${normalizer.path} changed the field type on ${side}`)
  }
  if (Array.isArray(parent)) parent[Number(field)] = normalized
  else parent[field] = normalized
}

function normalizeSnapshot(
  snapshot: DifferentialSnapshot,
  side: 'LEGACY' | 'V2',
  normalizers: readonly DifferentialFieldNormalizer[]
): DifferentialSnapshot {
  const clone = JSON.parse(canonicalJson(snapshot as unknown as CanonicalJsonValue)) as unknown as DifferentialSnapshot
  const seenPaths = new Set<string>()
  for (const normalizer of normalizers) {
    if (
      !/^(publicResult|businessTables|events|files)(\.[A-Za-z0-9_-]+)+$/.test(normalizer.path)
      || normalizer.path.includes('*')
      || !normalizer.rationale.trim()
      || typeof normalizer.normalize !== 'function'
    ) throw new DifferentialHarnessError(`normalizer path ${normalizer.path} is not an explicit audited field`)
    if (seenPaths.has(normalizer.path)) {
      throw new DifferentialHarnessError(`normalizer path ${normalizer.path} is duplicated`)
    }
    seenPaths.add(normalizer.path)
    const parts = normalizer.path.split('.')
    let parent = clone as unknown as MutableCanonicalContainer
    for (const part of parts.slice(0, -1)) parent = childContainer(parent, part, normalizer.path)
    normalizeField(parent, parts.at(-1)!, normalizer, side)
  }
  return clone
}

export async function runCommandDifferential(options: {
  testId: string
  preStateRoot: string
  timestamp: string
  ids: readonly string[]
  oraclePaths: readonly string[]
  normalizers?: readonly DifferentialFieldNormalizer[]
  runLegacy(context: DifferentialRunContext): DifferentialSnapshot | Promise<DifferentialSnapshot>
  runV2(context: DifferentialRunContext): DifferentialSnapshot | Promise<DifferentialSnapshot>
}): Promise<DifferentialCaseResult> {
  if (!/^M5B-DIFF-[A-Z0-9-]+$/.test(options.testId)) {
    throw new DifferentialHarnessError('testId is not a registered M5B differential ID')
  }
  const oracle = verifyFrozenLegacyOracle(options.oraclePaths)
  const roots = cloneRoots(options.preStateRoot)
  try {
    const legacy = await options.runLegacy(
      deterministicContext(roots.legacyRoot, options.timestamp, options.ids)
    )
    const v2 = await options.runV2(
      deterministicContext(roots.v2Root, options.timestamp, options.ids)
    )
    const normalizers = options.normalizers ?? []
    const normalizedLegacy = normalizeSnapshot(legacy, 'LEGACY', normalizers)
    const normalizedV2 = normalizeSnapshot(v2, 'V2', normalizers)
    const legacyJson = canonicalJson(normalizedLegacy as unknown as CanonicalJsonValue)
    const v2Json = canonicalJson(normalizedV2 as unknown as CanonicalJsonValue)
    if (legacyJson !== v2Json) {
      throw new DifferentialHarnessError(`${options.testId} legacy/v2 business semantics differ`)
    }
    return Object.freeze({
      testId: options.testId,
      oracle,
      legacy,
      v2,
      normalizedCanonicalJson: legacyJson
    })
  } finally {
    roots.cleanup()
  }
}
