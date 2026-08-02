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
      if (!db) throw new Error('assignment/safety bus event DB is not initialized')
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
      eventState.calls.push({ eventType: params.eventType, correlationId: params.correlationId })
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
        'assignment-safety-command-bus.test.jsonl',
        entry.schema_version,
        entry.created_at
      )
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

const ASSIGNMENT_MUTATIONS = [
  'assignment:create',
  'assignment:confirmStudent',
  'assignment:startAssessment',
  'assignment:rebind',
  'assignment:release'
] as const
const SAFETY_MUTATIONS = [
  'safety:confirm',
  'safety:resolve',
  'safety:void',
  'safety:replaceForFactualCorrection'
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
    dataRoot: `/tmp/svets-m5a9-assignment-safety-${uuidv4()}`,
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
    sender: { id: senderId, once: vi.fn() }
  } as unknown as IpcMainInvokeEvent
}

function bindUser(
  db: MemoryAdapter,
  runtime: ApplicationRuntime,
  senderId: number,
  userId: string,
  role: 'STUDENT' | 'TEACHER' | 'ADMIN'
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

function seedPreparedAssignmentSession(
  db: MemoryAdapter,
  teacherId: string,
  studentId: string
): string {
  return seedAssessmentSessionFixture(db, {
    studentId,
    strategyId: 'strategy_baseline_shelver_v1',
    strategyType: 'BASELINE_ASSESSMENT',
    jobCode: 'SUPERMARKET_SHELVER',
    taskCode: 'SHELVE_TASK',
    status: 'INIT',
    deliveryPhase: 'PREPARED',
    createdBy: teacherId,
    onlineQuestionCount: 1,
    offlineQuestionCount: 0
  })
}

function seedSafetyIncident(
  db: MemoryAdapter,
  teacherId: string,
  studentId: string,
  status: 'PENDING_DETAIL' | 'CONFIRMED' = 'PENDING_DETAIL'
): string {
  const incidentId = uuidv4()
  const triggerEventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence,
        payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1,
             '{}', 'seed', 'seed', 1, '2026-07-29T00:00:00.000Z')`
  ).run(triggerEventId, incidentId)
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK', ?, 'THROWING_OBJECT',
             '待确认安全事实', ?, 'TRAINING_PRACTICE', '2026-07-29T00:00:00.000Z', 'PENDING_DETAIL')`
  ).run(incidentId, studentId, triggerEventId, teacherId)
  if (status === 'CONFIRMED') {
    db.prepare(
      "UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?"
    ).run(teacherId, incidentId)
  }
  return incidentId
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

describe('M5A-9 assignment and safety commands through CommandBus', () => {
  it('registers nine mutation owners, two query-only reads and one runtime coordinator', async () => {
    const { boundary } = await createRuntime()
    const assignment = ASSIGNMENT_MUTATIONS.map((channel) => boundary.registry.requireMutation(channel))
    const safety = SAFETY_MUTATIONS.map((channel) => boundary.registry.requireMutation(channel))
    expect(assignment).toHaveLength(5)
    expect(safety).toHaveLength(4)
    expect(assignment.every((definition) =>
      definition.metadata.transactionOwner.startsWith('assignment-service.')
      && definition.metadata.sideEffects.includes('LEGACY_EVENT_PORT_WRITE')
      && !definition.metadata.sideEffects.includes('LEGACY_HANDLER_MUTATION')
    )).toBe(true)
    expect(safety.every((definition) =>
      definition.metadata.transactionOwner.startsWith('safety-service.')
      && definition.metadata.sideEffects.includes('RUNTIME_REPORT_COORDINATOR')
      && definition.metadata.testReferences.includes(
        'src/main/application/services/__tests__/assignment-safety-command-bus.test.ts'
      )
    )).toBe(true)
    for (const channel of ['safety:get', 'safety:list']) {
      expect(boundary.registry.get(channel)?.metadata).toMatchObject({
        mode: 'READ',
        sideEffects: [],
        transactionOwner: 'NONE_READ_ONLY'
      })
    }
  })

  it('rejects a forged assignment target before writes, then creates runtime only after acceptance', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const senderId = 6901
    bindUser(db, runtime, senderId, teacherId, 'TEACHER')
    const businessSessionId = seedPreparedAssignmentSession(db, teacherId, studentId)

    expect(await requireHandler('assignment:create')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      businessSessionId,
      jobCode: 'FORGED_JOB'
    })).toMatchObject({ success: false })
    expect(v2EventFacts(db)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS count FROM organization').get()).toEqual({ count: 0 })

    const created = await requireHandler('assignment:create')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      businessSessionId
    }) as { success: boolean; assignmentId?: string }
    expect(created).toMatchObject({ success: true })
    expect(created.assignmentId).toBeTruthy()
    expect(db.prepare('SELECT COUNT(*) AS count FROM organization').get()).toEqual({ count: 1 })
    const createdFacts = latestV2BatchFacts(db)
    expect(createdFacts.map((fact) => fact.event_type)).toEqual(['ASSIGNMENT_CREATED'])
    expect(createdFacts[0]?.correlation_id).toMatch(/^[0-9a-f-]{36}$/)

    const afterCreated = v2EventFacts(db)
    expect(await requireHandler('assignment:confirmStudent')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      confirmationMethod: 'TEACHER_ATTESTATION',
      jobCode: 'FORGED_JOB'
    })).toMatchObject({ success: false })
    expect(v2EventFacts(db)).toEqual(afterCreated)
    expect(await requireHandler('assignment:confirmStudent')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      confirmationMethod: 'TEACHER_ATTESTATION'
    })).toMatchObject({ success: true, assignmentId: created.assignmentId })

    const otherStudentId = seedStudent(db)
    const studentSender = 6904
    bindUser(db, runtime, studentSender, otherStudentId, 'STUDENT')
    const beforeForbiddenStart = v2EventFacts(db)
    expect(await requireHandler('assignment:startAssessment')(event(studentSender), {
      callerUserId: otherStudentId,
      callerRole: 'STUDENT',
      assignmentId: created.assignmentId
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(v2EventFacts(db)).toEqual(beforeForbiddenStart)

    expect(await requireHandler('assignment:rebind')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      requireReconfirmation: false,
      confirmationMethod: 'TEACHER_ATTESTATION'
    })).toMatchObject({ success: true, assignmentId: created.assignmentId, version: 2 })
    expect(await requireHandler('assignment:release')(event(senderId), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      assignmentId: created.assignmentId,
      releaseReason: 'TEACHER_RELEASED'
    })).toMatchObject({ success: true, assignmentId: created.assignmentId })
  })

  it('enforces safety roles and authoritative triple, then records the confirmed safety batch', async () => {
    const { db, runtime } = await createRuntime()
    const teacherId = seedCaller(db, 'TEACHER')
    const adminId = seedCaller(db, 'ADMIN')
    const studentId = seedStudent(db)
    const teacherSender = 6902
    const adminSender = 6903
    bindUser(db, runtime, teacherSender, teacherId, 'TEACHER')
    bindUser(db, runtime, adminSender, adminId, 'ADMIN')
    const incidentId = seedSafetyIncident(db, teacherId, studentId)
    const confirmation = {
      incidentId,
      reasonCode: 'THROWING_OBJECT',
      contextPhase: 'TRAINING_PRACTICE',
      description: '学生抛掷纸箱'
    }

    expect(await requireHandler('safety:confirm')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      ...confirmation,
      jobCode: 'FORGED_JOB'
    })).toMatchObject({ success: false })
    expect(await requireHandler('safety:confirm')(event(adminSender), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      ...confirmation
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(v2EventFacts(db)).toEqual([])

    expect(await requireHandler('safety:confirm')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      ...confirmation
    })).toEqual({ success: true, incidentId })
    const confirmationFacts = latestV2BatchFacts(db)
    expect(confirmationFacts.map((fact) => fact.event_type)).toEqual(['SAFETY_INCIDENT_DETAIL_CONFIRMED'])
    expect(new Set(confirmationFacts.map((fact) => fact.batch_id)).size).toBe(1)
    expect(confirmationFacts[0]?.correlation_id).toMatch(/^[0-9a-f-]{36}$/)

    const afterConfirmation = v2EventFacts(db)
    expect(await requireHandler('safety:resolve')(event(teacherSender), {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      incidentId,
      resolutionNotes: '无权限',
      followUpRequired: false
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
    expect(v2EventFacts(db)).toEqual(afterConfirmation)

    expect(await requireHandler('safety:resolve')(event(adminSender), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId,
      resolutionNotes: '完成复盘',
      followUpRequired: false
    })).toEqual({ success: true, incidentId })

    const voidIncidentId = seedSafetyIncident(db, teacherId, studentId, 'CONFIRMED')
    expect(await requireHandler('safety:void')(event(adminSender), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId: voidIncidentId,
      voidReason: 'FALSE_TRIGGER'
    })).toEqual({ success: true, incidentId: voidIncidentId })

    const replaceIncidentId = seedSafetyIncident(db, teacherId, studentId, 'CONFIRMED')
    expect(await requireHandler('safety:replaceForFactualCorrection')(event(adminSender), {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId: replaceIncidentId,
      reasonCode: 'DANGEROUS_CLIMBING',
      contextPhase: 'TRAINING_DO',
      description: '修正后的事实',
      correctionReason: '原场景记录错误'
    })).toMatchObject({ success: true })
  })
})
