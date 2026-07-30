import { mkdirSync } from 'fs'
import { resolve, sep } from 'path'

export const INTERNAL_MUTATION_PHASES = [
  'PRE_DB_INIT',
  'DB_INIT_RECOVERY',
  'POST_DB_INIT_PRE_BOUNDARY_READY',
  'ACCEPTED_MUTATION',
  'RUNTIME_MAINTENANCE',
  'SHUTDOWN'
] as const

export type InternalMutationPhase = (typeof INTERNAL_MUTATION_PHASES)[number]

const internalMutationCapabilityBrand = Symbol('svets.internal-mutation-capability')

export interface InternalMutationCapability {
  readonly owner: string
  readonly phase: InternalMutationPhase
  readonly dataRoot: string
  readonly [internalMutationCapabilityBrand]: true
}

export interface InternalMutationInventoryEntry {
  readonly id: string
  readonly owner: string
  readonly phase: InternalMutationPhase
  readonly sideEffects: readonly string[]
  readonly trigger: 'STARTUP' | 'ACCEPTED_COMMAND' | 'SYSTEM_TIMER' | 'SHUTDOWN'
}

/**
 * M5A keeps internal writes outside renderer-controlled command input, but still
 * gives each one an explicit owner and lifecycle phase.
 */
export const INTERNAL_MUTATION_INVENTORY: readonly InternalMutationInventoryEntry[] = Object.freeze([
  {
    id: 'INTERNAL-E2E-ROOT',
    owner: 'electron-main:e2e-user-data-root',
    phase: 'PRE_DB_INIT',
    sideEffects: ['FILE_MKDIR'],
    trigger: 'STARTUP'
  },
  {
    id: 'INTERNAL-DB-STARTUP',
    owner: 'database-connection:startup-upgrade-recovery',
    phase: 'DB_INIT_RECOVERY',
    sideEffects: ['DB_PRAGMA', 'DB_SCHEMA', 'DB_MIGRATION', 'DB_RECOVERY', 'EVENT_WRITE'],
    trigger: 'STARTUP'
  },
  {
    id: 'INTERNAL-ACTION-LOG-DIRECTORY',
    owner: 'application-runtime:action-log-directory',
    phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
    sideEffects: ['FILE_MKDIR'],
    trigger: 'STARTUP'
  },
  {
    id: 'INTERNAL-ERROR-CODE-BOOTSTRAP',
    owner: 'application-runtime:error-code-bootstrap',
    phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
    sideEffects: ['DB_RUN'],
    trigger: 'STARTUP'
  },
  {
    id: 'INTERNAL-LEGACY-EVENT-PORT',
    owner: 'application-runtime:legacy-event-port',
    phase: 'ACCEPTED_MUTATION',
    sideEffects: ['EVENT_WRITE', 'DB_PROJECTION', 'ACTION_LOG_RECOVERY'],
    trigger: 'ACCEPTED_COMMAND'
  },
  {
    id: 'INTERNAL-AUTH-SWEEP',
    owner: 'application-runtime:auth-session-sweep',
    phase: 'RUNTIME_MAINTENANCE',
    sideEffects: ['DB_RUN', 'MEMORY_BINDING_CLEAR'],
    trigger: 'SYSTEM_TIMER'
  },
  {
    id: 'INTERNAL-RUNTIME-DISPOSE',
    owner: 'application-runtime:dispose',
    phase: 'SHUTDOWN',
    sideEffects: ['TIMER_CLEAR', 'MEMORY_BINDING_CLEAR'],
    trigger: 'SHUTDOWN'
  }
])

export function createInternalMutationCapability(params: {
  owner: string
  phase: InternalMutationPhase
  dataRoot: string
}): InternalMutationCapability {
  const owner = params.owner.trim()
  if (!owner) throw new Error('internal mutation owner must be non-empty')
  if (!INTERNAL_MUTATION_PHASES.includes(params.phase)) {
    throw new Error(`unsupported internal mutation phase: ${params.phase}`)
  }
  return Object.freeze({
    owner,
    phase: params.phase,
    dataRoot: resolve(params.dataRoot),
    [internalMutationCapabilityBrand]: true as const
  })
}

export function assertInternalMutationCapability(
  capability: InternalMutationCapability,
  expectedPhase: InternalMutationPhase
): void {
  if (
    !capability
    || capability[internalMutationCapabilityBrand] !== true
    || capability.phase !== expectedPhase
  ) {
    throw new Error(`internal mutation requires ${expectedPhase} capability`)
  }
}

export function prepareInternalDirectory(
  capability: InternalMutationCapability,
  directoryPath: string
): void {
  const directory = resolve(directoryPath)
  const ownedRoot = capability.dataRoot
  if (directory !== ownedRoot && !directory.startsWith(`${ownedRoot}${sep}`)) {
    throw new Error(`internal directory is outside owned data root: ${directory}`)
  }
  mkdirSync(directory, { recursive: true })
}
