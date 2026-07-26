import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import type { DBAdapter, DBStatement } from '../../db/interface'
import { writeEvent } from '../event-writer'
import { readActionLog } from '../recovery'
import {
  ReportCommandCoordinator,
  ReportCommandValidationError,
  ReportRecoveryRequiredError
} from '../report-command-coordinator'

const key = {
  studentId: 'student-1',
  jobCode: 'SUPERMARKET_SHELVER',
  taskCode: 'SHELVE_TASK',
  scope: 'BASE_ABILITY' as const
}

const dirs: string[] = []

function createLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-report-coordinator-test-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
}

class FailNextProjectionInsertAdapter implements DBAdapter {
  private failNextProjectionInsert = false

  constructor(private readonly delegate: DBAdapter) {}

  failNextDomainEventProjectionInsert(): void {
    this.failNextProjectionInsert = true
  }

  prepare(sql: string): DBStatement {
    const statement = this.delegate.prepare(sql)
    if (!this.failNextProjectionInsert || !sql.toUpperCase().includes('INSERT INTO DOMAIN_EVENT_PROJECTION')) {
      return statement
    }
    return {
      run: () => {
        this.failNextProjectionInsert = false
        throw new Error('injected domain_event_projection insert failure')
      },
      get: statement.get,
      all: statement.all
    }
  }

  transaction<T>(fn: () => T): () => T {
    return this.delegate.transaction(fn)
  }

  exec(sql: string): void {
    this.delegate.exec(sql)
  }
}

function seedPendingIncident(db: DBAdapter, incidentId: string, createdEventId: string, teacherId: string, studentId: string): void {
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code,
        description, triggered_by, context_phase, occurred_at, status)
     VALUES (?, ?, 'SUPERMARKET_SHELVER', 'SHELVE_TASK', ?, 'BLADE_TOWARD_SELF', ?, ?, 'OFFLINE_SCORING', ?, 'PENDING_DETAIL')`
  ).run(incidentId, studentId, createdEventId, '待作废的安全事件', teacherId, '2026-07-25T10:00:00.000Z')
}

function voidIntent(incidentId: string, adminId: string) {
  return {
    aggregateType: 'SAFETY_INCIDENT' as const,
    aggregateId: incidentId,
    eventType: 'SAFETY_INCIDENT_VOIDED' as const,
    payload: {
      incident_id: incidentId, voided_at: '2026-07-25T10:10:00.000Z', voided_by: adminId,
      void_reason: 'FALSE_TRIGGER', void_notes: null, replacement_incident_id: null,
      archived_report_ids: [], superseded_report_ids: [], primary_incident_id: null
    },
    actorId: adminId,
    actorRole: 'ADMIN' as const
  }
}

function writeSafetyCreatedEvent(db: DBAdapter, actionLogPath: string, incidentId: string, teacherId: string, studentId: string) {
  return writeEvent({
    aggregateType: 'SAFETY_INCIDENT', aggregateId: incidentId, eventType: 'SAFETY_INCIDENT_CREATED',
    payload: {
      incident_id: incidentId, student_id: studentId, job_code: 'SUPERMARKET_SHELVER', task_code: 'SHELVE_TASK',
      reason_code: 'BLADE_TOWARD_SELF', context_phase: 'OFFLINE_SCORING',
      occurred_at: '2026-07-25T10:00:00.000Z', reported_by: teacherId, brief_description: '待确认安全事件'
    },
    actorId: teacherId, actorRole: 'TEACHER', database: db, actionLogPath
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  return { promise: new Promise<void>((done) => { resolve = done }), resolve }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('ReportCommandCoordinator', () => {
  it('serializes commands with the same business key while independent keys can proceed', async () => {
    const db = await createTestDb()
    try {
      const coordinator = new ReportCommandCoordinator({
        db,
        actionLogPath: '/tmp/report-coordinator-unused.jsonl',
        recoverPending: () => undefined
      })
      const firstGate = deferred()
      const secondGate = deferred()
      const started: string[] = []

      const first = coordinator.runSingleEventCommand({
        key,
        areas: ['TASK_CLOSURE'],
        buildIntent: async () => {
          started.push('first')
          await firstGate.promise
          return null
        },
        mapResult: () => 'first'
      })
      await flushMicrotasks()
      const second = coordinator.runSingleEventCommand({
        key,
        areas: ['TASK_CLOSURE'],
        buildIntent: () => {
          started.push('second')
          return null
        },
        mapResult: () => 'second'
      })
      await flushMicrotasks()
      expect(started).toEqual(['first'])

      const differentKey = coordinator.runSingleEventCommand({
        key: { ...key, studentId: 'student-2', scope: 'SAFETY' },
        areas: ['SAFETY_INCIDENT'],
        buildIntent: async () => {
          started.push('different')
          await secondGate.promise
          return null
        },
        mapResult: () => 'different'
      })
      await flushMicrotasks()
      expect(started).toEqual(['first', 'different'])

      firstGate.resolve()
      secondGate.resolve()
      await expect(Promise.all([first, second, differentKey])).resolves.toEqual(['first', 'second', 'different'])
      expect(started).toEqual(['first', 'different', 'second'])
    } finally {
      db.close()
    }
  })

  it('recovers a real JSONL append when domain_event_projection insertion fails', async () => {
    const db = await createTestDb()
    try {
      const actionLogPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const adminId = seedCaller(db, 'ADMIN')
      const studentId = seedStudent(db)
      const incidentId = 'incident-projection-failure'
      const created = writeSafetyCreatedEvent(db, actionLogPath, incidentId, teacherId, studentId)
      seedPendingIncident(db, incidentId, created.event_id, teacherId, studentId)
      const faultingDb = new FailNextProjectionInsertAdapter(db)
      faultingDb.failNextDomainEventProjectionInsert()
      const coordinator = new ReportCommandCoordinator({
        db: faultingDb,
        actionLogPath
      })

      await expect(coordinator.runSingleEventCommand({
        key: { ...key, studentId, scope: 'SAFETY' },
        areas: ['SAFETY_INCIDENT'],
        buildIntent: () => voidIntent(incidentId, adminId),
        mapResult: () => undefined
      })).rejects.toBeInstanceOf(ReportRecoveryRequiredError)

      expect(() => coordinator.assertWriteAllowed('TASK_CLOSURE')).toThrow(ReportRecoveryRequiredError)
      expect(() => coordinator.assertWriteAllowed('RESULT')).toThrow(ReportRecoveryRequiredError)
      expect(() => coordinator.assertWriteAllowed('SAFETY_INCIDENT')).toThrow(ReportRecoveryRequiredError)
      expect(readActionLog({ logPath: actionLogPath }).events).toHaveLength(2)
      expect(db.prepare('SELECT 1 FROM domain_event_projection WHERE aggregate_id = ? AND event_sequence = 2').get(incidentId)).toBeUndefined()
      expect(db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId)).toEqual({ status: 'PENDING_DETAIL' })

      await expect(coordinator.recoverPendingF7EventsOrThrow()).resolves.toBeUndefined()
      expect(db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId)).toEqual({ status: 'VOIDED' })
      expect(db.prepare('SELECT applied_to_snapshot FROM domain_event_projection WHERE aggregate_id = ? AND event_sequence = 2').get(incidentId))
        .toEqual({ applied_to_snapshot: 1 })
      expect(() => coordinator.assertWriteAllowed('TASK_REPORT')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('rejects an invalid F7 payload before JSONL append without closing the write gate', async () => {
    const db = await createTestDb()
    try {
      const actionLogPath = createLogPath()
      const coordinator = new ReportCommandCoordinator({ db, actionLogPath })
      await expect(coordinator.runSingleEventCommand({
        key: { ...key, scope: 'SAFETY' },
        areas: ['TASK_REPORT'],
        buildIntent: () => ({
          aggregateType: 'TASK_REPORT', aggregateId: 'report-invalid-export', eventType: 'REPORT_EXPORTED',
          payload: {
            report_id: 'report-invalid-export', export_format: 'HTML', export_path: '/tmp/report.html',
            exported_at: '2026-07-25T10:10:00.000Z', exported_by: 'teacher-1', file_asset_id: 'asset-1',
            file_hash: 'a'.repeat(64), file_size_bytes: 1, mime_type: 'text/html', content_hash: 'b'.repeat(64),
            status_before: 'LOCKED', status_after: 'EXPORTED'
          },
          actorId: 'teacher-1', actorRole: 'TEACHER'
        }),
        mapResult: () => undefined
      })).rejects.toBeInstanceOf(ReportCommandValidationError)

      expect(readActionLog({ logPath: actionLogPath }).events).toHaveLength(0)
      expect(db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual({ count: 0 })
      expect(() => coordinator.assertWriteAllowed('TASK_REPORT')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('keeps a projection-pending event blocked until its reducer precondition is restored', async () => {
    const db = await createTestDb()
    try {
      const actionLogPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const adminId = seedCaller(db, 'ADMIN')
      const studentId = seedStudent(db)
      const incidentId = 'incident-reducer-failure'
      const created = writeSafetyCreatedEvent(db, actionLogPath, incidentId, teacherId, studentId)
      const pending = writeEvent({
        ...voidIntent(incidentId, adminId), schemaVersion: 2, database: db, actionLogPath
      })
      const coordinator = new ReportCommandCoordinator({ db, actionLogPath })

      await expect(coordinator.recoverPendingF7EventsOrThrow()).rejects.toBeInstanceOf(ReportRecoveryRequiredError)
      expect(db.prepare('SELECT applied_to_snapshot FROM domain_event_projection WHERE event_id = ?').get(pending.event_id))
        .toEqual({ applied_to_snapshot: 0 })
      expect(() => coordinator.assertWriteAllowed('SAFETY_INCIDENT')).toThrow(ReportRecoveryRequiredError)

      seedPendingIncident(db, incidentId, created.event_id, teacherId, studentId)
      await expect(coordinator.recoverPendingF7EventsOrThrow()).resolves.toBeUndefined()
      expect(db.prepare('SELECT status FROM safety_incident WHERE incident_id = ?').get(incidentId)).toEqual({ status: 'VOIDED' })
      expect(db.prepare('SELECT applied_to_snapshot FROM domain_event_projection WHERE event_id = ?').get(pending.event_id))
        .toEqual({ applied_to_snapshot: 1 })
      expect(() => coordinator.assertWriteAllowed('SAFETY_INCIDENT')).not.toThrow()
    } finally {
      db.close()
    }
  })
})
