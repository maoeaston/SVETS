import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import { MemoryAdapter } from '../../db/memory-adapter'
import {
  preReconcileLegacyActionLog,
  StartupRecoveryRequiredError
} from '../legacy-upgrade-recovery'

const tempDirs: string[] = []

function checksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function event(params: Omit<ActionLogEntry, 'checksum' | 'created_at' | 'app_version'>): ActionLogEntry {
  return {
    ...params,
    checksum: checksum(params.payload),
    created_at: '2026-07-24T00:00:00.000Z',
    app_version: 'test'
  }
}

function writeLog(events: ActionLogEntry[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-legacy-recovery-'))
  tempDirs.push(dir)
  const logPath = join(dir, 'action_log.jsonl')
  writeFileSync(logPath, `${events.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
  return logPath
}

async function createDatabase(): Promise<MemoryAdapter> {
  const db = await MemoryAdapter.create()
  db.exec(readFileSync(resolve(process.cwd(), 'src/main/db/schema.sql'), 'utf8'))
  db.exec(`
    INSERT INTO user_account (user_id, username, password_hash, role, display_name, status)
    VALUES
      ('teacher-recovery', 'teacher-recovery', 'hash', 'TEACHER', '教师', 'ACTIVE'),
      ('admin-recovery', 'admin-recovery', 'hash', 'ADMIN', '管理员', 'ACTIVE');
    INSERT INTO student_profile (student_id, student_name, status)
    VALUES ('student-recovery', '学生', 'ACTIVE');
  `)
  return db
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('legacy upgrade recovery', () => {
  it('replays a JSONL-only schema-v1 report before the F7 migration begins', async () => {
    const db = await createDatabase()
    const report = event({
      event_id: 'event-report-v1',
      aggregate_type: 'TASK_REPORT',
      aggregate_id: 'report-v1',
      event_type: 'REPORT_GENERATED',
      event_sequence: 1,
      schema_version: 1,
      actor_id: 'teacher-recovery',
      actor_role: 'TEACHER',
      payload: {
        report_id: 'report-v1',
        student_id: 'student-recovery',
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF',
        report_type: 'FULL_REPORT',
        source_aggregate_type: 'SYSTEM',
        source_aggregate_id: 'legacy-system',
        result_ids: ['legacy-result'],
        report_title: '旧报告',
        report_content: {},
        generated_by: 'teacher-recovery',
        generated_at: '2026-07-24T00:00:00.000Z'
      }
    })

    const result = preReconcileLegacyActionLog(db, { logPath: writeLog([report]) })

    expect(result.replayedEventCount).toBe(1)
    expect(db.prepare("SELECT generated_event_id FROM task_report WHERE report_id = 'report-v1'").get())
      .toMatchObject({ generated_event_id: 'event-report-v1' })
    expect(preReconcileLegacyActionLog(db, { logPath: writeLog([report]) }).replayedEventCount).toBe(0)
    db.close()
  })

  it('rejects a schema-v2 event before F7 instead of interpreting it with a legacy reducer', async () => {
    const db = await createDatabase()
    const schemaV2 = event({
      event_id: 'event-v2', aggregate_type: 'TASK_REPORT', aggregate_id: 'report-v2',
      event_type: 'REPORT_GENERATED', event_sequence: 1, schema_version: 2,
      actor_id: 'teacher-recovery', actor_role: 'TEACHER', payload: {}
    })

    expect(() => preReconcileLegacyActionLog(db, { logPath: writeLog([schemaV2]) }))
      .toThrow(StartupRecoveryRequiredError)
    expect(() => preReconcileLegacyActionLog(db, { logPath: writeLog([schemaV2]) }))
      .toThrow('schema version 1')
    db.close()
  })

  it('rejects a truncated legacy factual-correction prefix without adding a replacement incident', async () => {
    const db = await createDatabase()
    const created = event({
      event_id: 'event-new-incident', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'incident-new',
      event_type: 'SAFETY_INCIDENT_CREATED', event_sequence: 1, schema_version: 1,
      actor_id: 'admin-recovery', actor_role: 'ADMIN',
      payload: {
        incident_id: 'incident-new', student_id: 'student-recovery', job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF', reason_code: 'OTHER', context_phase: 'OFFLINE_OPERATION',
        occurred_at: '2026-07-24T00:00:00.000Z', reported_by: 'admin-recovery', brief_description: '修正后事实'
      }
    })

    expect(() => preReconcileLegacyActionLog(db, { logPath: writeLog([created]) }))
      .toThrow('factual-correction event prefix')
    expect(db.prepare("SELECT COUNT(*) AS count FROM safety_incident WHERE incident_id = 'incident-new'").get())
      .toMatchObject({ count: 0 })
    expect(db.prepare("SELECT COUNT(*) AS count FROM domain_event_projection WHERE event_id = 'event-new-incident'").get())
      .toMatchObject({ count: 0 })
    db.close()
  })

  it('replays a complete legacy factual-correction triplet in one recoverable group', async () => {
    const db = await createDatabase()
    const original = event({
      event_id: 'event-old-incident', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'incident-old',
      event_type: 'SAFETY_INCIDENT_CREATED', event_sequence: 1, schema_version: 1,
      actor_id: 'teacher-recovery', actor_role: 'TEACHER',
      payload: {
        incident_id: 'incident-old', student_id: 'student-recovery', job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF', reason_code: 'OTHER_SAFETY_RISK', context_phase: 'OTHER',
        occurred_at: '2026-07-24T00:00:00.000Z', reported_by: 'teacher-recovery'
      }
    })
    const created = event({
      event_id: 'event-new-incident-complete', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'incident-new-complete',
      event_type: 'SAFETY_INCIDENT_CREATED', event_sequence: 1, schema_version: 1,
      actor_id: 'admin-recovery', actor_role: 'ADMIN',
      payload: {
        incident_id: 'incident-new-complete', student_id: 'student-recovery', job_code: 'SUPERMARKET_SHELVER',
        task_code: 'UNBOX_AND_SHELF', reason_code: 'OTHER_SAFETY_RISK', context_phase: 'OTHER',
        occurred_at: '2026-07-24T00:01:00.000Z', reported_by: 'admin-recovery', brief_description: '修正后事实'
      }
    })
    const replaced = event({
      event_id: 'event-replaced-complete', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'incident-old',
      event_type: 'SAFETY_INCIDENT_REPLACED_FOR_FACTUAL_CORRECTION', event_sequence: 2, schema_version: 1,
      actor_id: 'admin-recovery', actor_role: 'ADMIN',
      payload: {
        old_incident_id: 'incident-old', new_incident_id: 'incident-new-complete',
        replaced_at: '2026-07-24T00:01:00.000Z', replaced_by: 'admin-recovery', correction_reason: '修正事实'
      }
    })
    const voided = event({
      event_id: 'event-voided-complete', aggregate_type: 'SAFETY_INCIDENT', aggregate_id: 'incident-old',
      event_type: 'SAFETY_INCIDENT_VOIDED', event_sequence: 3, schema_version: 1,
      actor_id: 'admin-recovery', actor_role: 'ADMIN',
      payload: {
        incident_id: 'incident-old', voided_at: '2026-07-24T00:01:00.000Z', voided_by: 'admin-recovery',
        void_reason: 'FACTUAL_CORRECTION', void_notes: '修正事实', replacement_incident_id: 'incident-new-complete'
      }
    })

    const result = preReconcileLegacyActionLog(db, { logPath: writeLog([original, created, replaced, voided]) })

    expect(result.replayedEventCount).toBe(4)
    expect(db.prepare("SELECT status, replacement_incident_id FROM safety_incident WHERE incident_id = 'incident-old'").get())
      .toMatchObject({ status: 'VOIDED', replacement_incident_id: 'incident-new-complete' })
    expect(db.prepare("SELECT status FROM safety_incident WHERE incident_id = 'incident-new-complete'").get())
      .toMatchObject({ status: 'PENDING_DETAIL' })
    db.close()
  })
})
