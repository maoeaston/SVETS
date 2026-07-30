import { afterEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
import {
  hasAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'
import { createJobSkillReportAutomation } from '../../../ipc/handlers/job-skill-report'
import { createReportsApplicationService } from '../../services/reports-service'
import { createSafetyReportAutomation } from '../../services/safety-service'
import {
  createApplicationRuntime,
  startApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../application-runtime'
import { INTERNAL_MUTATION_INVENTORY } from '../internal-mutation-capability'

class FakeScheduler implements RuntimeScheduler {
  readonly tasks = new Map<object, () => void>()
  readonly cleared: object[] = []

  setInterval(task: () => void): object {
    const handle = {}
    this.tasks.set(handle, task)
    return handle
  }

  clearInterval(handle: unknown): void {
    this.cleared.push(handle as object)
    this.tasks.delete(handle as object)
  }
}

const inertReportPort = (): ReportMutationPort => Object.freeze({
  writeEvent() {
    throw new Error('test report port is inert')
  },
  recoverPending() {}
})

const runtimes: ApplicationRuntime[] = []
const databases: MemoryAdapter[] = []

async function testDb(): Promise<MemoryAdapter> {
  const db = await createTestDb()
  databases.push(db)
  return db
}

function runtimeOptions(db: MemoryAdapter, dataRoot = `/tmp/svets-runtime-${uuidv4()}`) {
  return {
    db,
    dataRoot,
    dependencies: {
      prepareDirectory: () => undefined,
      createLegacyMutationPort: inertReportPort,
      scheduler: new FakeScheduler()
    }
  }
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const db of databases.splice(0)) db.close()
})

describe('application runtime startup boundary', () => {
  it('seeds all four error-code groups before registration and stays idempotent', async () => {
    const db = await testDb()
    const dataRoot = `/tmp/svets-runtime-seed-${uuidv4()}`
    const order: string[] = []
    const first = startApplicationRuntime({
      runtime: runtimeOptions(db, dataRoot),
      registerBoundary(runtime) {
        order.push('register')
        expect(runtime.state()).toBe('PRE_BOUNDARY_READY')
        const row = db.prepare(
          `SELECT COUNT(*) AS count FROM error_code_registry
            WHERE error_code IN (
              'AUTH_LOGIN_SUCCESS',
              'STUDENT_PROFILE_CREATED',
              'STRATEGY_CONFIG_CREATED',
              'ASSESSMENT_SYSTEM_ERROR'
            )`
        ).get() as { count: number }
        expect(row.count).toBe(4)
      }
    })
    runtimes.push(first)
    expect(order).toEqual(['register'])
    expect(first.state()).toBe('BOUNDARY_READY')
    const countAfterFirst = (db.prepare('SELECT COUNT(*) AS count FROM error_code_registry').get() as { count: number }).count

    first.dispose()
    const second = startApplicationRuntime({
      runtime: runtimeOptions(db, dataRoot),
      registerBoundary: () => undefined
    })
    runtimes.push(second)
    const countAfterSecond = (db.prepare('SELECT COUNT(*) AS count FROM error_code_registry').get() as { count: number }).count
    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('seed failure leaves registration at zero and releases the data-root reservation', async () => {
    const db = await testDb()
    const dataRoot = `/tmp/svets-runtime-seed-failure-${uuidv4()}`
    const registerBoundary = vi.fn()
    expect(() => startApplicationRuntime({
      runtime: {
        ...runtimeOptions(db, dataRoot),
        dependencies: {
          ...runtimeOptions(db, dataRoot).dependencies,
          bootstrapErrorCodes: () => {
            throw new Error('injected seed failure')
          }
        }
      },
      registerBoundary
    })).toThrow('injected seed failure')
    expect(registerBoundary).not.toHaveBeenCalled()

    const recovered = createApplicationRuntime({
      ...runtimeOptions(db, dataRoot),
      dependencies: {
        ...runtimeOptions(db, dataRoot).dependencies,
        bootstrapErrorCodes: () => undefined
      }
    })
    runtimes.push(recovered)
    expect(recovered.state()).toBe('PRE_BOUNDARY_READY')
  })

  it('runs bootstrap once before a synthetic first IPC and never seeds on that call', async () => {
    const db = await testDb()
    const seed = vi.fn()
    const callbackState: { firstIpc?: () => string } = {}
    const runtime = startApplicationRuntime({
      runtime: {
        ...runtimeOptions(db),
        dependencies: {
          ...runtimeOptions(db).dependencies,
          bootstrapErrorCodes: seed
        }
      },
      registerBoundary() {
        callbackState.firstIpc = () => 'ok'
      }
    })
    runtimes.push(runtime)
    expect(seed).toHaveBeenCalledTimes(1)
    expect(callbackState.firstIpc?.()).toBe('ok')
    expect(callbackState.firstIpc?.()).toBe('ok')
    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('allows one runtime per normalized data root and allows reconstruction after dispose', async () => {
    const db = await testDb()
    const dataRoot = `/tmp/svets-runtime-singleton-${uuidv4()}`
    const first = createApplicationRuntime({
      ...runtimeOptions(db, dataRoot),
      dependencies: {
        ...runtimeOptions(db, dataRoot).dependencies,
        bootstrapErrorCodes: () => undefined
      }
    })
    runtimes.push(first)
    expect(() => createApplicationRuntime({
      ...runtimeOptions(db, `${dataRoot}/..${dataRoot.slice(dataRoot.lastIndexOf('/'))}`),
      dependencies: {
        ...runtimeOptions(db, dataRoot).dependencies,
        bootstrapErrorCodes: () => undefined
      }
    })).toThrow('already owns data root')

    first.dispose()
    const second = createApplicationRuntime({
      ...runtimeOptions(db, dataRoot),
      dependencies: {
        ...runtimeOptions(db, dataRoot).dependencies,
        bootstrapErrorCodes: () => undefined
      }
    })
    runtimes.push(second)
    expect(second.state()).toBe('PRE_BOUNDARY_READY')
  })
})

describe('application runtime ownership and disposal', () => {
  it('shares one report coordinator with reports, safety, and job-skill automation', async () => {
    const db = await testDb()
    const runtime = createApplicationRuntime({
      ...runtimeOptions(db),
      dependencies: {
        ...runtimeOptions(db).dependencies,
        bootstrapErrorCodes: () => undefined
      }
    })
    runtimes.push(runtime)

    expect(createSafetyReportAutomation(db, runtime.reportCoordinator).coordinator)
      .toBe(runtime.reportCoordinator)
    expect(createJobSkillReportAutomation(db, runtime.reportCoordinator).coordinator)
      .toBe(runtime.reportCoordinator)
    expect(createReportsApplicationService(db, runtime.reportCoordinator).coordinator)
      .toBe(runtime.reportCoordinator)
  })

  it('renderer destruction and dispose clear only runtime-owned bindings and stop the timer', async () => {
    const db = await testDb()
    const scheduler = new FakeScheduler()
    const runtime = createApplicationRuntime({
      ...runtimeOptions(db),
      dependencies: {
        ...runtimeOptions(db).dependencies,
        bootstrapErrorCodes: () => undefined,
        scheduler
      }
    })
    runtimes.push(runtime)
    const teacherId = seedCaller(db, 'TEACHER')
    const first = issuePasswordAuthSession(db, {
      userId: teacherId,
      role: 'TEACHER',
      displayName: '教师'
    })
    const callbackState: { destroyed?: () => void } = {}
    replaceSenderAuthSession(db, 701, first.rawToken, runtime.bindingOwnerId)
    runtime.trackSender(701, (release) => { callbackState.destroyed = release })
    expect(hasAuthSessionBinding(701)).toBe(true)
    callbackState.destroyed?.()
    expect(hasAuthSessionBinding(701)).toBe(false)

    const second = issuePasswordAuthSession(db, {
      userId: teacherId,
      role: 'TEACHER',
      displayName: '教师'
    })
    replaceSenderAuthSession(db, 702, second.rawToken, runtime.bindingOwnerId)
    runtime.trackSender(702, () => undefined)
    runtime.dispose()
    expect(hasAuthSessionBinding(702)).toBe(false)
    expect(scheduler.cleared).toHaveLength(1)
    expect(runtime.state()).toBe('CLOSED')
  })

  it('internal mutation inventory has unique IDs and explicit lifecycle owners', () => {
    expect(new Set(INTERNAL_MUTATION_INVENTORY.map((entry) => entry.id)).size)
      .toBe(INTERNAL_MUTATION_INVENTORY.length)
    expect(INTERNAL_MUTATION_INVENTORY.every((entry) => entry.owner.length > 0)).toBe(true)
    expect(INTERNAL_MUTATION_INVENTORY.map((entry) => entry.phase)).toEqual(expect.arrayContaining([
      'PRE_DB_INIT',
      'DB_INIT_RECOVERY',
      'POST_DB_INIT_PRE_BOUNDARY_READY',
      'ACCEPTED_MUTATION',
      'RUNTIME_MAINTENANCE',
      'SHUTDOWN'
    ]))
  })
})
