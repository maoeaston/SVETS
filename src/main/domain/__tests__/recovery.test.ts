import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDb, seedCaller, seedStudent } from '../../db/test-helpers'
import type { ActionLogEntry } from '@shared/types/event-payloads'
import {
  RecoveryLogError,
  RecoveryReplayError,
  readActionLog,
  reconcileActionLog,
  writeRecoverySnapshot
} from '../recovery'

const dirs: string[] = []

function createLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'svets-recovery-test-'))
  dirs.push(dir)
  return join(dir, 'action_log.jsonl')
}

function event(eventId: string, sequence = 1): ActionLogEntry {
  const payload = { session_id: 'session-1', event_id: eventId }
  return {
    event_id: eventId,
    aggregate_type: 'ASSESSMENT_SESSION',
    aggregate_id: 'session-1',
    event_type: 'SESSION_STARTED',
    event_sequence: sequence,
    payload,
    checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
    schema_version: 1,
    created_at: '2026-07-23T00:00:00.000Z',
    actor_id: 'teacher-1',
    actor_role: 'TEACHER',
    app_version: '1.0.0'
  } as ActionLogEntry
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readActionLog', () => {
  it('返回校验通过的事件', () => {
    const logPath = createLogPath()
    writeFileSync(logPath, `${JSON.stringify(event('event-1'))}\n${JSON.stringify(event('event-2', 2))}\n`)

    const result = readActionLog({ logPath })
    expect(result).toMatchObject({ truncatedTail: false, archivedTailPath: null })
    expect(result.events.map((entry) => entry.event_id)).toEqual(['event-1', 'event-2'])
  })

  it('仅截断并归档最后一行损坏 JSON', () => {
    const logPath = createLogPath()
    writeFileSync(logPath, `${JSON.stringify(event('event-1'))}\n{bad-tail`)

    const result = readActionLog({ logPath })
    expect(result.events.map((entry) => entry.event_id)).toEqual(['event-1'])
    expect(result.truncatedTail).toBe(true)
    expect(result.archivedTailPath).toBeTruthy()
    expect(readFileSync(result.archivedTailPath!, 'utf8')).toBe('{bad-tail')
    expect(readFileSync(logPath, 'utf8')).toBe(`${JSON.stringify(event('event-1'))}\n`)
  })

  it('中间行损坏时失败关闭', () => {
    const logPath = createLogPath()
    writeFileSync(logPath, `${JSON.stringify(event('event-1'))}\n{bad-middle\n${JSON.stringify(event('event-2', 2))}\n`)

    try {
      readActionLog({ logPath })
      throw new Error('expected recovery log error')
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryLogError)
      expect((error as RecoveryLogError).code).toBe('LOG_MALFORMED')
      expect((error as RecoveryLogError).lineNumber).toBe(2)
    }
  })

  it('checksum 不符时失败关闭', () => {
    const logPath = createLogPath()
    const bad = event('event-1')
    bad.checksum = 'invalid'
    writeFileSync(logPath, `${JSON.stringify(bad)}\n`)

    try {
      readActionLog({ logPath })
      throw new Error('expected recovery log error')
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryLogError)
      expect((error as RecoveryLogError).code).toBe('CHECKSUM_MISMATCH')
      expect((error as RecoveryLogError).lineNumber).toBe(1)
    }
  })

  it('聚合内事件序号跳跃时失败关闭', () => {
    const logPath = createLogPath()
    writeFileSync(logPath, `${JSON.stringify(event('event-1', 2))}\n`)

    try {
      readActionLog({ logPath })
      throw new Error('expected recovery log error')
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryLogError)
      expect((error as RecoveryLogError).code).toBe('EVENT_SEQUENCE_INVALID')
    }
  })
})

describe('reconcileActionLog', () => {
  it('补写缺失事件投影并恢复训练会话，重复执行保持幂等', async () => {
    const db = await createTestDb()
    try {
      const logPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const trainingSessionId = uuidv4()
      const businessSessionId = uuidv4()
      const payload = {
        training_session_id: trainingSessionId,
        business_session_id: businessSessionId,
        student_id: studentId,
        strategy_id: 'strategy_training_shelver_v1',
        strategy_type: 'TRAINING_PRACTICE',
        strategy_version: 1,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK',
        total_steps: 4,
        step_order: ['WATCH', 'LEARN', 'PRACTICE', 'DO'],
        module_type: 'FINE_MOTOR'
      }
      const trainingEvent: ActionLogEntry = {
        event_id: uuidv4(),
        aggregate_type: 'TRAINING_SESSION',
        aggregate_id: trainingSessionId,
        event_type: 'TRAINING_STARTED',
        event_sequence: 1,
        payload,
        checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
        schema_version: 1,
        created_at: '2026-07-23T00:00:00.000Z',
        actor_id: teacherId,
        actor_role: 'TEACHER',
        app_version: '1.0.0'
      }
      writeFileSync(logPath, `${JSON.stringify(trainingEvent)}\n`)

      const first = reconcileActionLog(db, { logPath })
      expect(first).toMatchObject({ replayedEventCount: 1, skippedEventCount: 0 })
      expect(
        db.prepare('SELECT event_id FROM domain_event_projection WHERE event_id = ?').get(trainingEvent.event_id)
      ).toEqual({ event_id: trainingEvent.event_id })
      expect(
        db.prepare('SELECT status, business_session_id FROM training_session WHERE training_session_id = ?').get(trainingSessionId)
      ).toEqual({ status: 'INIT', business_session_id: businessSessionId })
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM training_step_record WHERE training_session_id = ?').get(trainingSessionId)
      ).toEqual({ count: 4 })

      const second = reconcileActionLog(db, { logPath })
      expect(second).toMatchObject({ replayedEventCount: 0, skippedEventCount: 1 })
    } finally {
      db.close()
    }
  })

  it('补写安全事件投影并恢复安全事件事实', async () => {
    const db = await createTestDb()
    try {
      const logPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const incidentId = uuidv4()
      const payload = {
        incident_id: incidentId,
        student_id: studentId,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK',
        reason_code: 'BLADE_TOWARD_SELF',
        context_phase: 'ONLINE_ASSESSMENT',
        occurred_at: '2026-07-23T00:00:00.000Z',
        reported_by: teacherId
      }
      const safetyEvent: ActionLogEntry = {
        event_id: uuidv4(),
        aggregate_type: 'SAFETY_INCIDENT',
        aggregate_id: incidentId,
        event_type: 'SAFETY_INCIDENT_CREATED',
        event_sequence: 1,
        payload,
        checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
        schema_version: 1,
        created_at: '2026-07-23T00:00:00.000Z',
        actor_id: teacherId,
        actor_role: 'TEACHER',
        app_version: '1.0.0'
      }
      writeFileSync(logPath, `${JSON.stringify(safetyEvent)}\n`)

      expect(reconcileActionLog(db, { logPath })).toMatchObject({ replayedEventCount: 1 })
      expect(
        db.prepare('SELECT trigger_event_id, status FROM safety_incident WHERE incident_id = ?').get(incidentId)
      ).toEqual({ trigger_event_id: safetyEvent.event_id, status: 'PENDING_DETAIL' })
    } finally {
      db.close()
    }
  })

  it('补写新版报告事件投影并恢复最终报告内容', async () => {
    const db = await createTestDb()
    try {
      const logPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const reportId = uuidv4()
      const payload = {
        report_id: reportId,
        student_id: studentId,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK',
        report_type: 'FULL_REPORT',
        source_aggregate_type: 'SYSTEM',
        source_aggregate_id: 'fixture-system-source',
        result_ids: [],
        report_title: '测试岗位报告',
        report_content: { report_version: '1.0', summary: '恢复验证' },
        generated_at: '2026-07-23T00:00:00.000Z',
        generated_by: teacherId
      }
      const reportEvent: ActionLogEntry = {
        event_id: uuidv4(),
        aggregate_type: 'TASK_REPORT',
        aggregate_id: reportId,
        event_type: 'REPORT_GENERATED',
        event_sequence: 1,
        payload,
        checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
        schema_version: 1,
        created_at: '2026-07-23T00:00:00.000Z',
        actor_id: teacherId,
        actor_role: 'TEACHER',
        app_version: '1.0.0'
      }
      writeFileSync(logPath, `${JSON.stringify(reportEvent)}\n`)

      expect(reconcileActionLog(db, { logPath })).toMatchObject({ replayedEventCount: 1 })
      expect(
        db.prepare('SELECT report_title, report_content_json, generated_event_id FROM task_report WHERE report_id = ?').get(reportId)
      ).toEqual({
        report_title: '测试岗位报告',
        report_content_json: JSON.stringify(payload.report_content),
        generated_event_id: reportEvent.event_id
      })
    } finally {
      db.close()
    }
  })

  it('旧版报告事件缺少完整内容时回滚事件投影并失败关闭', async () => {
    const db = await createTestDb()
    try {
      const logPath = createLogPath()
      const teacherId = seedCaller(db, 'TEACHER')
      const studentId = seedStudent(db)
      const reportId = uuidv4()
      const oldPayload = {
        report_id: reportId,
        student_id: studentId,
        job_code: 'SUPERMARKET_SHELVER',
        task_code: 'SHELVE_TASK',
        report_type: 'FULL_REPORT',
        result_ids: [],
        generated_at: '2026-07-23T00:00:00.000Z',
        generated_by: teacherId
      }
      const reportEvent: ActionLogEntry = {
        event_id: uuidv4(),
        aggregate_type: 'TASK_REPORT',
        aggregate_id: reportId,
        event_type: 'REPORT_GENERATED',
        event_sequence: 1,
        payload: oldPayload,
        checksum: createHash('sha256').update(JSON.stringify(oldPayload), 'utf8').digest('hex'),
        schema_version: 1,
        created_at: '2026-07-23T00:00:00.000Z',
        actor_id: teacherId,
        actor_role: 'TEACHER',
        app_version: '1.0.0'
      }
      writeFileSync(logPath, `${JSON.stringify(reportEvent)}\n`)

      try {
        reconcileActionLog(db, { logPath })
        throw new Error('expected recovery replay error')
      } catch (error) {
        expect(error).toBeInstanceOf(RecoveryReplayError)
        expect((error as RecoveryReplayError).code).toBe('UNRECOVERABLE_EVENT')
      }
      expect(
        db.prepare('SELECT 1 FROM domain_event_projection WHERE event_id = ?').get(reportEvent.event_id)
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('恢复审计事件已落盘后写入指向该事件的快照元数据', async () => {
    const db = await createTestDb()
    try {
      const logPath = createLogPath()
      const payload = { replayed_event_count: 1, skipped_event_count: 0, truncated_tail: false }
      const recoveryEvent: ActionLogEntry = {
        event_id: uuidv4(),
        aggregate_type: 'SYSTEM',
        aggregate_id: 'startup-recovery:fixture',
        event_type: 'RECOVERY_REPLAYED',
        event_sequence: 1,
        payload,
        checksum: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
        schema_version: 1,
        created_at: '2026-07-23T00:00:00.000Z',
        actor_id: 'SYSTEM',
        actor_role: 'SYSTEM',
        app_version: '1.0.0'
      }
      writeFileSync(logPath, `${JSON.stringify(recoveryEvent)}\n`)
      reconcileActionLog(db, { logPath })

      const snapshotId = writeRecoverySnapshot(db, {
        lastAppliedEvent: recoveryEvent,
        sqliteFileHash: 'fixture-sqlite-hash',
        actionLogPath: logPath,
        archivedLogPath: null,
        schemaVersion: 'fixture-schema',
        appVersion: '1.0.0'
      })
      expect(
        db.prepare('SELECT last_applied_event_id, last_applied_sequence, action_log_path FROM snapshot_meta WHERE snapshot_id = ?').get(snapshotId)
      ).toEqual({
        last_applied_event_id: recoveryEvent.event_id,
        last_applied_sequence: 1,
        action_log_path: logPath
      })
    } finally {
      db.close()
    }
  })
})
