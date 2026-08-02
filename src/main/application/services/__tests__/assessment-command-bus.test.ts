import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown) => Promise<unknown>>()
}))
const eventState = vi.hoisted(() => ({
  db: null as unknown as import('../../../db/interface').DBAdapter,
  calls: [] as Array<{
    aggregateId: string
    eventType: string
    correlationId?: string
  }>,
  failAfterProjectionFor: null as string | null
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, handler: (event: unknown, rawInput?: unknown) => Promise<unknown>) {
      if (electronState.handlers.has(channel)) throw new Error(`duplicate IPC handler: ${channel}`)
      electronState.handlers.set(channel, handler)
    },
    removeHandler(channel: string) {
      electronState.handlers.delete(channel)
    }
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showErrorBox: vi.fn()
  }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn(
    (params: import('../../../domain/event-writer').WriteEventParams): import('@shared/types/event-payloads').ActionLogEntry => {
      const db = eventState.db
      if (!db) throw new Error('assessment bus event DB is not initialized')
      const eventId = uuidv4()
      const sequence = ((db.prepare(
        `SELECT MAX(event_sequence) AS max_sequence
           FROM domain_event_projection
          WHERE aggregate_type = ? AND aggregate_id = ?`
      ).get(params.aggregateType, params.aggregateId) as { max_sequence: number | null }).max_sequence ?? 0) + 1
      const entry: import('@shared/types/event-payloads').ActionLogEntry = {
        event_id: eventId,
        aggregate_type: params.aggregateType,
        aggregate_id: params.aggregateId,
        event_type: params.eventType,
        event_sequence: sequence,
        payload: params.payload,
        checksum: `test-checksum-${eventId}`,
        schema_version: params.schemaVersion ?? 1,
        created_at: new Date().toISOString(),
        actor_id: params.actorId,
        actor_role: params.actorRole,
        app_version: 'test',
        ...(params.correlationId ? { correlation_id: params.correlationId } : {})
      }
      eventState.calls.push({
        aggregateId: params.aggregateId,
        eventType: params.eventType,
        correlationId: params.correlationId
      })
      db.prepare(
        `INSERT INTO domain_event_projection
           (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
            payload_json, checksum, source_log_path, schema_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entry.event_id,
        entry.aggregate_type,
        entry.aggregate_id,
        entry.event_type,
        entry.event_sequence,
        JSON.stringify(entry.payload),
        entry.checksum,
        'assessment-command-bus.test.jsonl',
        entry.schema_version,
        entry.created_at
      )
      if (eventState.failAfterProjectionFor === params.eventType) {
        throw new Error(`injected projection failure after ${params.eventType}`)
      }
      return entry
    }
  )
}))

import type { IpcMainInvokeEvent } from 'electron'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import {
  createApplicationRuntime,
  type ApplicationRuntime,
  type RuntimeScheduler
} from '../../runtime/application-runtime'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'
import {
  registerCentralIpcHandlers,
  type CentralIpcBoundary
} from '../../../ipc/handler-registry'
import { TEST_BUSINESS_ACCESS_GATE } from '../../../test-helpers/business-access-gate'

const ASSESSMENT_CORE_MUTATIONS = [
  'assessment:abortSession',
  'assessment:calculateResult',
  'assessment:createSession',
  'assessment:emotionInterrupt',
  'assessment:emotionResume',
  'assessment:pauseSitting',
  'assessment:recordEmotionCollapse',
  'assessment:startNextSitting',
  'assessment:startSession',
  'assessment:submitAnswer',
  'assessment:triggerRedline'
] as const

class InertScheduler implements RuntimeScheduler {
  setInterval(): object {
    return {}
  }

  clearInterval(): void {}
}

const databases: MemoryAdapter[] = []
const runtimes: ApplicationRuntime[] = []
const senderIds = new Set<number>()

async function createRuntime(): Promise<{
  db: MemoryAdapter
  runtime: ApplicationRuntime
  boundary: CentralIpcBoundary
}> {
  const db = await createTestDb()
  databases.push(db)
  eventState.db = db
  const runtime = createApplicationRuntime({
    db,
    dataRoot: `/tmp/svets-m5a7-assessment-${uuidv4()}`,
    dependencies: {
      prepareDirectory: () => undefined,
      scheduler: new InertScheduler()
    }
  })
  runtimes.push(runtime)
  const boundary = registerCentralIpcHandlers(runtime, TEST_BUSINESS_ACCESS_GATE)
  runtime.markBoundaryReady()
  return { db, runtime, boundary }
}

function event(senderId: number): IpcMainInvokeEvent {
  senderIds.add(senderId)
  return {
    sender: {
      id: senderId,
      once: vi.fn()
    }
  } as unknown as IpcMainInvokeEvent
}

function bindUser(
  db: MemoryAdapter,
  runtime: ApplicationRuntime,
  senderId: number,
  userId: string,
  role: 'STUDENT' | 'TEACHER'
): void {
  const issued = issuePasswordAuthSession(db, { userId, role, displayName: role })
  replaceSenderAuthSession(db, senderId, issued.rawToken, runtime.bindingOwnerId)
  senderIds.add(senderId)
}

function requireHandler(channel: string) {
  const handler = electronState.handlers.get(channel)
  if (!handler) throw new Error(`missing test IPC handler: ${channel}`)
  return (event: unknown, rawInput?: unknown) => (handler as unknown as (
    event: unknown,
    input?: unknown,
    transportMetadata?: unknown
  ) => Promise<unknown>)(event, rawInput, {
    schemaVersion: 1,
    clientInstanceId: uuidv4(),
    idempotencyKey: uuidv4(),
    deviceId: null
  })
}

function seedSession(
  db: MemoryAdapter,
  teacherId: string,
  studentId: string,
  taskCode: string
): string {
  return seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode,
    status: 'ACTIVE',
    createdBy: teacherId
  })
}

interface V2EventFact {
  event_type: string
  batch_id: string
  correlation_id: string | null
}

function v2EventFacts(db: MemoryAdapter): V2EventFact[] {
  return db.prepare(
    `SELECT pe.event_type, pe.batch_id,
            json_extract(dep.payload_json, '$.correlation_id') AS correlation_id
       FROM processed_event pe
       JOIN domain_event_projection dep ON dep.event_id = pe.event_id
      ORDER BY pe.rowid`
  ).all() as V2EventFact[]
}

function latestV2BatchFacts(db: MemoryAdapter): V2EventFact[] {
  const facts = v2EventFacts(db)
  const batchId = facts.at(-1)?.batch_id
  return batchId ? facts.filter((fact) => fact.batch_id === batchId) : []
}

beforeEach(() => {
  electronState.handlers.clear()
  eventState.calls = []
  eventState.failAfterProjectionFor = null
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
  eventState.calls = []
  eventState.failAfterProjectionFor = null
})

describe('M5A-7 assessment core commands through CommandBus', () => {
  it('registers eleven mutations and three reads with application ownership metadata', async () => {
    const { boundary } = await createRuntime()
    const definitions = ASSESSMENT_CORE_MUTATIONS.map((channel) =>
      boundary.registry.requireMutation(channel)
    )
    expect(definitions).toHaveLength(11)
    expect(definitions.every((definition) =>
      definition.metadata.transactionOwner.startsWith('assessment-service.')
      && definition.metadata.retryPolicy === 'NO_AUTO_RETRY'
      && definition.metadata.concurrencyPolicy.kind === 'FAIL_FAST_ACTIVE_KEY'
      && definition.metadata.sideEffects.includes('LEGACY_EVENT_PORT_WRITE')
      && !definition.metadata.sideEffects.includes('LEGACY_HANDLER_MUTATION')
      && definition.metadata.testReferences.includes(
        'src/main/application/services/__tests__/assessment-command-bus.test.ts'
      )
    )).toBe(true)
    for (const channel of [
      'assessment:getSession',
      'assessment:listMySessions',
      'assessment:listSessions'
    ]) {
      expect(boundary.registry.get(channel)?.metadata).toMatchObject({
        mode: 'READ',
        sideEffects: [],
        transactionOwner: 'NONE_READ_ONLY'
      })
    }
  })

  it('keeps core reads write-free and rejects forged target hints before execution', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const teacherSender = 6401
    const studentSender = 6402
    bindUser(db, runtime, teacherSender, teacherId, 'TEACHER')
    bindUser(db, runtime, studentSender, studentId, 'STUDENT')
    const sessionId = seedSession(db, teacherId, studentId, 'READ_TARGET_TASK')

    expect(await requireHandler('assessment:getSession')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId
    })).toMatchObject({ success: true, session: { sessionId } })
    expect(await requireHandler('assessment:listSessions')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER'
    })).toMatchObject({ success: true })
    expect(await requireHandler('assessment:listMySessions')(event(studentSender), {
      callerUserId: studentId,
      callerRole: 'STUDENT'
    })).toMatchObject({ success: true })
    expect(v2EventFacts(db)).toEqual([])

    const before = (db.prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }).status
    const forged = await requireHandler('assessment:abortSession')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      jobCode: 'FORGED_JOB'
    }) as { success: boolean }
    expect(forged.success).toBe(false)
    expect(v2EventFacts(db)).toEqual([])
    expect((db.prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }).status).toBe(before)
  })

  it('shares one correlation across the redline multi-event transaction and child halt', async () => {
    const { db, runtime, boundary } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6403
    bindUser(db, runtime, senderId, teacherId, 'TEACHER')
    const sessionId = seedSession(db, teacherId, studentId, 'REDLINE_CORRELATION_TASK')

    const redline = await requireHandler('assessment:triggerRedline')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      reasonCode: 'BLADE_TOWARD_SELF',
      contextPhase: 'ONLINE_ASSESSMENT'
    })
    expect(redline).toMatchObject({ success: true, sessionId })
    const facts = latestV2BatchFacts(db)
    expect(facts.map((fact) => fact.event_type)).toEqual(['SAFETY_INCIDENT_CREATED'])
    expect(new Set(facts.map((fact) => fact.batch_id)).size).toBe(1)
    expect(new Set(facts.map((fact) => fact.correlation_id)).size).toBe(1)
    expect(facts[0]?.correlation_id).toMatch(/^[0-9a-f-]{36}$/)
    expect((db.prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }).status).toBe('REDLINE_HALTED')
    expect(boundary.registry.requireMutation('assessment:triggerRedline').metadata.sideEffects)
      .toContain('TRAINING_HALT_ACCEPTED_CHILD')
  })

  it('confirms a redline event batch before exposing its safety result', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6404
    bindUser(db, runtime, senderId, teacherId, 'TEACHER')
    const sessionId = seedSession(db, teacherId, studentId, 'REDLINE_ROLLBACK_TASK')
    const result = await requireHandler('assessment:triggerRedline')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      reasonCode: 'BLADE_TOWARD_SELF',
      contextPhase: 'ONLINE_ASSESSMENT'
    })
    expect(result).toMatchObject({ success: true, sessionId })
    const facts = latestV2BatchFacts(db)
    expect(facts.map((fact) => fact.event_type)).toEqual(['SAFETY_INCIDENT_CREATED'])
    expect(db.prepare(
      `SELECT batch_status, event_count
         FROM applied_event_batch
        WHERE batch_id = ?`
    ).get(facts[0]?.batch_id)).toEqual({ batch_status: 'CONFIRMED', event_count: 1 })
    expect((db.prepare('SELECT COUNT(*) AS count FROM safety_incident WHERE task_code = ?')
      .get('REDLINE_ROLLBACK_TASK') as { count: number }).count).toBe(1)
    expect((db.prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }).status).toBe('REDLINE_HALTED')
  })
})
