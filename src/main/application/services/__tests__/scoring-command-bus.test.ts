import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, rawInput?: unknown) => Promise<unknown>>()
}))
const eventState = vi.hoisted(() => ({
  db: null as unknown as import('../../../db/interface').DBAdapter,
  calls: [] as Array<{ eventType: string; correlationId?: string }>
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
      if (!db) throw new Error('scoring bus event DB is not initialized')
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
        'scoring-command-bus.test.jsonl',
        entry.schema_version,
        entry.created_at
      )
      return entry
    }
  )
}))

import type { IpcMainInvokeEvent } from 'electron'
import { writeEvent } from '../../../domain/event-writer'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
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
import { TASK_OPERATION_CODES } from '../../../../shared/types/operation-scoring'
import { finalizeJobSkillResultCore } from '../job-skill-result-service'
import { acceptedScoringTestContext } from './scoring-test-support'

const SCORING_MUTATIONS = [
  'assessment:recordTeacherObservation',
  'assessment:submitJobSkillOfflineScores',
  'assessment:submitOfflineAbilityScores',
  'assessment:submitOperationScores'
] as const

const SCORING_READS = [
  'assessment:getJobSkillOfflineScores',
  'assessment:getOfflineAbilityScores',
  'assessment:getOperationScores',
  'assessment:getSessionScoringQuestions',
  'assessment:getTeacherObservations'
] as const

class InertScheduler implements RuntimeScheduler {
  setInterval(): object {
    return {}
  }

  clearInterval(): void {}
}

function recordingMutationPort(): ReportMutationPort {
  return Object.freeze({
    writeEvent,
    recoverPending() {}
  })
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
    dataRoot: `/tmp/svets-m5a8-scoring-${uuidv4()}`,
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

function bindTeacher(
  db: MemoryAdapter,
  runtime: ApplicationRuntime,
  senderId: number,
  teacherId: string
): void {
  const issued = issuePasswordAuthSession(db, {
    userId: teacherId,
    role: 'TEACHER',
    displayName: 'TEACHER'
  })
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

function seedOfflinePendingSession(
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
    strategyVersion: 1,
    status: 'OFFLINE_PENDING',
    createdBy: teacherId
  })
}

function operationInput(teacherId: string, sessionId: string) {
  return {
    callerUserId: teacherId,
    callerRole: 'TEACHER' as const,
    sessionId,
    toolChecklistConfirmed: true,
    scores: TASK_OPERATION_CODES.map((taskOperationCode) => ({
      taskOperationCode,
      score: 2 as const
    }))
  }
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
})

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose()
  for (const senderId of senderIds) clearAuthSessionBinding(senderId)
  senderIds.clear()
  for (const db of databases.splice(0)) db.close()
  electronState.handlers.clear()
  eventState.calls = []
})

describe('M5A-8 scoring and observation commands through CommandBus', () => {
  it('registers four mutations and five query-only reads with application ownership', async () => {
    const { boundary } = await createRuntime()
    const definitions = SCORING_MUTATIONS.map((channel) => boundary.registry.requireMutation(channel))
    expect(definitions).toHaveLength(4)
    expect(definitions.every((definition) =>
      definition.metadata.transactionOwner.includes('-service.')
      && definition.metadata.sideEffects.includes('LEGACY_EVENT_PORT_WRITE')
      && !definition.metadata.sideEffects.includes('LEGACY_HANDLER_MUTATION')
      && definition.metadata.testReferences.includes(
        'src/main/application/services/__tests__/scoring-command-bus.test.ts'
      )
    )).toBe(true)
    for (const channel of SCORING_READS) {
      expect(boundary.registry.get(channel)?.metadata).toMatchObject({
        mode: 'READ',
        sideEffects: [],
        transactionOwner: 'NONE_READ_ONLY'
      })
    }
  })

  it('rejects result automation from an accepted but unregistered parent command', async () => {
    const { db } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    expect(() => finalizeJobSkillResultCore(db, 'missing-session', teacherId, {
      eventPort: recordingMutationPort(),
      context: acceptedScoringTestContext({
        commandType: 'assessment:submitOfflineAbilityScores',
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        sessionId: 'missing-session'
      })
    })).toThrow('job-skill result rejected parent assessment:submitOfflineAbilityScores')
  })

  it('rejects a forged triple before execution and shares one correlation across 9+1 events', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6501
    bindTeacher(db, runtime, senderId, teacherId)
    const sessionId = seedOfflinePendingSession(db, teacherId, studentId, 'SCORING_BUS_TASK')
    const input = operationInput(teacherId, sessionId)

    expect(await requireHandler('assessment:submitOperationScores')(event(senderId), {
      ...input,
      jobCode: 'FORGED_JOB'
    })).toMatchObject({ success: false })
    expect(v2EventFacts(db)).toEqual([])
    expect((db.prepare('SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?')
      .get(sessionId) as { count: number }).count).toBe(0)

    expect(await requireHandler('assessment:submitOperationScores')(event(senderId), input))
      .toMatchObject({ success: true, normalizedScore: 100 })
    const facts = latestV2BatchFacts(db)
    expect(facts.map((fact) => fact.event_type)).toEqual([
      ...Array.from({ length: 9 }, () => 'OFFLINE_SCORE_SUBMITTED'),
      'RESULT_CALCULATED'
    ])
    expect(new Set(facts.map((fact) => fact.batch_id)).size).toBe(1)
    expect(new Set(facts.map((fact) => fact.correlation_id)).size).toBe(1)
    expect(facts[0]?.correlation_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps all five scoring and observation reads free of event writes', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6502
    bindTeacher(db, runtime, senderId, teacherId)
    const sessionId = seedOfflinePendingSession(db, teacherId, studentId, 'SCORING_READ_TASK')

    for (const channel of SCORING_READS) {
      expect(await requireHandler(channel)(event(senderId), {
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        sessionId
      })).toMatchObject({ success: true })
    }
    expect(v2EventFacts(db)).toEqual([])
  })
})
