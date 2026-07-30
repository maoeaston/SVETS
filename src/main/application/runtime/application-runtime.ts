import { dirname, resolve } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { DBAdapter } from '../../db/interface'
import { resolveActionLogPath } from '../../domain/action-log-path'
import {
  ReportCommandCoordinator,
  type ReportMutationPort
} from '../../domain/report-command-coordinator'
import {
  clearAuthSessionBindingForOwner,
  clearAuthSessionBindingsByOwner,
  sweepInvalidAuthSessions,
  type AuthSessionSweepResult
} from '../../utils/auth-session'
import { bootstrapErrorCodes } from './error-code-bootstrap'
import {
  createInternalMutationCapability,
  prepareInternalDirectory,
  type InternalMutationCapability
} from './internal-mutation-capability'
import {
  createLegacyMutationPort,
  type LegacyMutationPort
} from './legacy-mutation-port'

export type ApplicationRuntimeState = 'PRE_BOUNDARY_READY' | 'BOUNDARY_READY' | 'CLOSED'

export interface RuntimeScheduler {
  setInterval(task: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface ApplicationRuntimeDependencies {
  bootstrapErrorCodes?: (db: DBAdapter, capability: InternalMutationCapability) => void
  prepareDirectory?: (capability: InternalMutationCapability, directoryPath: string) => void
  createLegacyMutationPort?: (options: {
    db: DBAdapter
    actionLogPath: string
    capability: InternalMutationCapability
  }) => ReportMutationPort
  sweepAuthSessions?: (
    db: DBAdapter,
    capability: InternalMutationCapability,
    options: { bindingOwnerId?: string }
  ) => AuthSessionSweepResult
  scheduler?: RuntimeScheduler
  logRuntimeError?: (record: Readonly<{ owner: string; errorName: string }>) => void
}

export interface CreateApplicationRuntimeOptions {
  db: DBAdapter
  dataRoot: string
  actionLogPath?: string
  authSweepIntervalMs?: number
  dependencies?: ApplicationRuntimeDependencies
}

export interface ApplicationRuntime {
  readonly runtimeId: string
  readonly bindingOwnerId: string
  readonly dataRoot: string
  readonly actionLogPath: string
  readonly db: DBAdapter
  readonly legacyMutationPort: LegacyMutationPort
  readonly reportCoordinator: ReportCommandCoordinator
  readonly getDb: () => DBAdapter
  state(): ApplicationRuntimeState
  isBoundaryReady(): boolean
  markBoundaryReady(): void
  runAuthMaintenanceNow(): AuthSessionSweepResult
  trackSender(senderId: number, subscribeDestroyed: (release: () => void) => void): void
  releaseSender(senderId: number): void
  registerBoundaryDisposer(disposer: () => void): void
  dispose(): void
}

const DEFAULT_AUTH_SWEEP_INTERVAL_MS = 60_000
const activeDataRoots = new Map<string, symbol | ApplicationRuntimeImpl>()

interface RuntimeReportResources {
  readonly legacyMutationPort: LegacyMutationPort
  readonly reportCoordinator: ReportCommandCoordinator
}

const defaultScheduler: RuntimeScheduler = {
  setInterval(task, intervalMs) {
    const handle = globalThis.setInterval(task, intervalMs)
    handle.unref?.()
    return handle
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof setInterval>)
  }
}

class ApplicationRuntimeImpl implements ApplicationRuntime {
  readonly runtimeId = uuidv4()
  readonly bindingOwnerId = `application-runtime:${this.runtimeId}`
  readonly getDb = (): DBAdapter => this.db
  private runtimeState: ApplicationRuntimeState = 'PRE_BOUNDARY_READY'
  private maintenanceHandle: unknown = null
  private readonly trackedSenderIds = new Set<number>()
  private readonly boundaryDisposers: Array<() => void> = []
  private readonly maintenanceCapability: InternalMutationCapability

  constructor(
    readonly db: DBAdapter,
    readonly dataRoot: string,
    readonly actionLogPath: string,
    private readonly reportResources: RuntimeReportResources,
    private readonly sweepIntervalMs: number,
    private readonly scheduler: RuntimeScheduler,
    private readonly sweepAuthSessions: NonNullable<ApplicationRuntimeDependencies['sweepAuthSessions']>,
    private readonly logRuntimeError: NonNullable<ApplicationRuntimeDependencies['logRuntimeError']>
  ) {
    this.maintenanceCapability = createInternalMutationCapability({
      owner: 'application-runtime:auth-session-sweep',
      phase: 'RUNTIME_MAINTENANCE',
      dataRoot
    })
  }

  get reportCoordinator(): ReportCommandCoordinator {
    return this.reportResources.reportCoordinator
  }

  get legacyMutationPort(): LegacyMutationPort {
    return this.reportResources.legacyMutationPort
  }

  startMaintenance(): void {
    this.maintenanceHandle = this.scheduler.setInterval(() => {
      if (this.runtimeState === 'CLOSED') return
      try {
        this.runAuthMaintenanceNow()
      } catch (error) {
        this.logRuntimeError({
          owner: 'application-runtime:auth-session-sweep',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        })
      }
    }, this.sweepIntervalMs)
  }

  state(): ApplicationRuntimeState {
    return this.runtimeState
  }

  isBoundaryReady(): boolean {
    return this.runtimeState === 'BOUNDARY_READY'
  }

  markBoundaryReady(): void {
    if (this.runtimeState !== 'PRE_BOUNDARY_READY') {
      throw new Error(`cannot mark boundary ready from ${this.runtimeState}`)
    }
    this.runtimeState = 'BOUNDARY_READY'
  }

  runAuthMaintenanceNow(): AuthSessionSweepResult {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    return this.sweepAuthSessions(this.db, this.maintenanceCapability, {
      bindingOwnerId: this.bindingOwnerId
    })
  }

  trackSender(senderId: number, subscribeDestroyed: (release: () => void) => void): void {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    if (this.trackedSenderIds.has(senderId)) return
    this.trackedSenderIds.add(senderId)
    subscribeDestroyed(() => this.releaseSender(senderId))
  }

  releaseSender(senderId: number): void {
    clearAuthSessionBindingForOwner(senderId, this.bindingOwnerId)
    this.trackedSenderIds.delete(senderId)
  }

  registerBoundaryDisposer(disposer: () => void): void {
    if (this.runtimeState === 'CLOSED') throw new Error('application runtime is closed')
    this.boundaryDisposers.push(disposer)
  }

  dispose(): void {
    if (this.runtimeState === 'CLOSED') return
    this.runtimeState = 'CLOSED'
    for (const disposer of this.boundaryDisposers.splice(0).reverse()) {
      try {
        disposer()
      } catch (error) {
        this.logRuntimeError({
          owner: 'application-runtime:boundary-dispose',
          errorName: error instanceof Error ? error.name : 'UnknownError'
        })
      }
    }
    if (this.maintenanceHandle !== null) {
      this.scheduler.clearInterval(this.maintenanceHandle)
      this.maintenanceHandle = null
    }
    clearAuthSessionBindingsByOwner(this.bindingOwnerId)
    this.trackedSenderIds.clear()
    if (activeDataRoots.get(this.dataRoot) === this) activeDataRoots.delete(this.dataRoot)
  }
}

export function createApplicationRuntime(options: CreateApplicationRuntimeOptions): ApplicationRuntime {
  const dataRoot = resolve(options.dataRoot)
  if (activeDataRoots.has(dataRoot)) {
    throw new Error(`application runtime already owns data root: ${dataRoot}`)
  }
  const sweepIntervalMs = options.authSweepIntervalMs ?? DEFAULT_AUTH_SWEEP_INTERVAL_MS
  if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs <= 0) {
    throw new Error('auth sweep interval must be a positive finite number')
  }

  const reservation = Symbol(dataRoot)
  activeDataRoots.set(dataRoot, reservation)
  try {
    const dependencies = options.dependencies ?? {}
    const prepareDirectory = dependencies.prepareDirectory ?? prepareInternalDirectory
    const seed = dependencies.bootstrapErrorCodes ?? bootstrapErrorCodes
    const createPort = dependencies.createLegacyMutationPort ?? createLegacyMutationPort
    const sweep = dependencies.sweepAuthSessions ?? sweepInvalidAuthSessions
    const scheduler = dependencies.scheduler ?? defaultScheduler
    const logRuntimeError = dependencies.logRuntimeError ?? ((record) => {
      console.error(`[runtime] ${record.owner} failed: ${record.errorName}`)
    })
    const actionLogPath = resolve(options.actionLogPath ?? resolveActionLogPath(dataRoot))

    const directoryCapability = createInternalMutationCapability({
      owner: 'application-runtime:action-log-directory',
      phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
      dataRoot
    })
    prepareDirectory(directoryCapability, dirname(actionLogPath))

    const seedCapability = createInternalMutationCapability({
      owner: 'application-runtime:error-code-bootstrap',
      phase: 'POST_DB_INIT_PRE_BOUNDARY_READY',
      dataRoot
    })
    seed(options.db, seedCapability)

    const eventPortCapability = createInternalMutationCapability({
      owner: 'application-runtime:legacy-event-port',
      phase: 'ACCEPTED_MUTATION',
      dataRoot
    })
    const eventPort = createPort({
      db: options.db,
      actionLogPath,
      capability: eventPortCapability
    })
    const reportCoordinator = new ReportCommandCoordinator({ db: options.db, eventPort })
    const runtime = new ApplicationRuntimeImpl(
      options.db,
      dataRoot,
      actionLogPath,
      { legacyMutationPort: eventPort, reportCoordinator },
      sweepIntervalMs,
      scheduler,
      sweep,
      logRuntimeError
    )
    activeDataRoots.set(dataRoot, runtime)
    runtime.startMaintenance()
    return runtime
  } catch (error) {
    if (activeDataRoots.get(dataRoot) === reservation) activeDataRoots.delete(dataRoot)
    throw error
  }
}

export function startApplicationRuntime(options: {
  runtime: CreateApplicationRuntimeOptions
  registerBoundary(runtime: ApplicationRuntime): void
}): ApplicationRuntime {
  const runtime = createApplicationRuntime(options.runtime)
  try {
    options.registerBoundary(runtime)
    runtime.markBoundaryReady()
    return runtime
  } catch (error) {
    runtime.dispose()
    throw error
  }
}
