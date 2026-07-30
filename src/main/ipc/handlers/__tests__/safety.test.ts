import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v4 as uuidv4 } from 'uuid'

const { mockState } = vi.hoisted(() => ({
  mockState: { db: null as unknown as import('../../../db/interface').DBAdapter }
}))

vi.mock('../../../domain/event-writer', () => ({
  writeEvent: vi.fn((params: import('../../../domain/event-writer').WriteEventParams) => {
    const existing = mockState.db.prepare(
      'SELECT MAX(event_sequence) AS max_seq FROM domain_event_projection WHERE aggregate_type = ? AND aggregate_id = ?'
    ).get(params.aggregateType, params.aggregateId) as { max_seq: number | null }
    const event = {
      event_id: uuidv4(), aggregate_type: params.aggregateType, aggregate_id: params.aggregateId,
      event_type: params.eventType, event_sequence: (existing.max_seq ?? 0) + 1, payload: params.payload, checksum: 'test',
      schema_version: 1, created_at: '2026-07-23T00:00:00.000Z', actor_id: params.actorId,
      actor_role: params.actorRole, app_version: 'test'
    } as import('@shared/types/event-payloads').ActionLogEntry
    mockState.db.prepare(
      `INSERT INTO domain_event_projection
         (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?, ?)`
    ).run(event.event_id, event.aggregate_type, event.aggregate_id, event.event_type, event.event_sequence,
      JSON.stringify(event.payload), event.checksum, event.schema_version, event.created_at)
    return event
  })
}))

import {
  confirmSafetyIncident,
  resolveSafetyIncident,
  voidSafetyIncident,
  replaceSafetyIncidentForFactualCorrection,
  listSafetyIncidents,
  getSafetyIncident
} from '../../../application/services/__tests__/safety-test-support'
import { createTestDb, seedCaller, seedStudent } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'

let db: MemoryAdapter
let teacherId: string
let adminId: string
let studentId: string
let incidentId: string

function seedIncident(
  status: 'PENDING_DETAIL' | 'CONFIRMED' = 'PENDING_DETAIL',
  jobCode = 'SUPERMARKET_SHELVER'
): void {
  const triggerEventId = uuidv4()
  db.prepare(
    `INSERT INTO domain_event_projection
       (event_id, aggregate_type, aggregate_id, event_type, event_sequence, payload_json, checksum, source_log_path, schema_version, created_at)
     VALUES (?, 'SAFETY_INCIDENT', ?, 'SAFETY_INCIDENT_CREATED', 1, '{}', 'test', 'test', 1, '2026-07-23T00:00:00.000Z')`
  ).run(triggerEventId, incidentId)
  db.prepare(
    `INSERT INTO safety_incident
       (incident_id, student_id, job_code, task_code, trigger_event_id, reason_code, triggered_by,
        context_phase, status, confirmed_by)
     VALUES (?, ?, ?, 'SHELVE_TASK', ?, 'BLADE_TOWARD_SELF', ?,
             'ONLINE_ASSESSMENT', 'PENDING_DETAIL', NULL)`
  ).run(incidentId, studentId, jobCode, triggerEventId, teacherId)
  if (status === 'CONFIRMED') {
    db.prepare(
      `UPDATE safety_incident SET status = 'CONFIRMED', confirmed_by = ? WHERE incident_id = ?`
    ).run(teacherId, incidentId)
  }
}

beforeEach(async () => {
  db = await createTestDb()
  mockState.db = db
  teacherId = seedCaller(db, 'TEACHER')
  adminId = seedCaller(db, 'ADMIN')
  studentId = seedStudent(db)
  incidentId = uuidv4()
})

afterEach(() => db.close())

describe('F4 safety incident lifecycle', () => {
  it('教师只能将 PENDING_DETAIL 补录并确认', () => {
    seedIncident()
    expect(confirmSafetyIncident(db, {
      callerUserId: teacherId, callerRole: 'TEACHER', incidentId,
      reasonCode: 'THROWING_OBJECT', contextPhase: 'TRAINING_PRACTICE', description: '学生抛掷纸箱'
    })).toEqual({ success: true, incidentId })
    expect(db.prepare('SELECT status, reason_code, description FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'CONFIRMED', reason_code: 'THROWING_OBJECT', description: '学生抛掷纸箱' })
    expect(resolveSafetyIncident(db, {
      callerUserId: teacherId, callerRole: 'TEACHER', incidentId, resolutionNotes: '无权限', followUpRequired: false
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })

  it('管理员只能从 CONFIRMED 解除阻断或作废', () => {
    seedIncident('CONFIRMED')
    expect(resolveSafetyIncident(db, {
      callerUserId: adminId, callerRole: 'ADMIN', incidentId, resolutionNotes: '完成复盘', followUpRequired: true
    })).toEqual({ success: true, incidentId })
    expect(db.prepare('SELECT status, requires_review_before_next_session FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'RESOLVED', requires_review_before_next_session: 0 })
  })

  it('管理员可作废 PENDING_DETAIL，但事实修正必须建立替代事件', () => {
    seedIncident()
    expect(voidSafetyIncident(db, {
      callerUserId: adminId, callerRole: 'ADMIN', incidentId, voidReason: 'FALSE_TRIGGER'
    })).toEqual({ success: true, incidentId })

    incidentId = uuidv4()
    seedIncident('CONFIRMED')
    const replacement = replaceSafetyIncidentForFactualCorrection(db, {
      callerUserId: adminId, callerRole: 'ADMIN', incidentId,
      reasonCode: 'DANGEROUS_CLIMBING', contextPhase: 'TRAINING_DO', description: '修正后的事实', correctionReason: '原场景记录错误'
    })
    expect(replacement.success).toBe(true)
    if (!replacement.success) return
    expect(db.prepare('SELECT status, void_reason, replacement_incident_id FROM safety_incident WHERE incident_id = ?').get(incidentId))
      .toEqual({ status: 'VOIDED', void_reason: 'FACTUAL_CORRECTION', replacement_incident_id: replacement.incidentId })
  })

  it('重复记录作废必须指向同一学生同一任务的真实事件', () => {
    seedIncident()
    const duplicateId = incidentId
    incidentId = uuidv4()
    seedIncident('CONFIRMED')
    expect(voidSafetyIncident(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId: duplicateId,
      voidReason: 'DUPLICATE_RECORD',
      replacementIncidentId: incidentId
    })).toEqual({ success: true, incidentId: duplicateId })
    expect(db.prepare(
      'SELECT status, void_reason, replacement_incident_id FROM safety_incident WHERE incident_id = ?'
    ).get(duplicateId)).toEqual({
      status: 'VOIDED',
      void_reason: 'DUPLICATE_RECORD',
      replacement_incident_id: incidentId
    })
  })

  it('重复记录不得跨岗位关联 replacement，且不写入事件或 incident', () => {
    seedIncident()
    const duplicateId = incidentId
    incidentId = uuidv4()
    seedIncident('CONFIRMED', 'WAREHOUSE_PICKER')
    const replacementId = incidentId
    const eventsBefore = db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get() as { count: number }

    expect(voidSafetyIncident(db, {
      callerUserId: adminId,
      callerRole: 'ADMIN',
      incidentId: duplicateId,
      voidReason: 'DUPLICATE_RECORD',
      replacementIncidentId: replacementId
    })).toEqual({ success: false, errorCode: 'VALIDATION_ERROR' })

    expect(db.prepare('SELECT status, replacement_incident_id FROM safety_incident WHERE incident_id = ?').get(duplicateId))
      .toEqual({ status: 'PENDING_DETAIL', replacement_incident_id: null })
    expect(db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection').get()).toEqual(eventsBefore)
  })
})

describe('F5 safety incident read views', () => {
  it('教师和管理员可查看列表与详情，学生被拒绝', () => {
    seedIncident('CONFIRMED')
    const teacher = listSafetyIncidents(db, {
      callerUserId: teacherId, callerRole: 'TEACHER', status: 'CONFIRMED'
    })
    expect(teacher.success).toBe(true)
    if (!teacher.success) return
    expect(teacher.total).toBe(1)
    expect(teacher.items[0]).toMatchObject({ incidentId, studentId, status: 'CONFIRMED', bindingCount: 0 })

    const admin = getSafetyIncident(db, {
      callerUserId: adminId, callerRole: 'ADMIN', incidentId
    })
    expect(admin.success).toBe(true)
    if (admin.success) expect(admin.incident.studentName).toBe('测试学生')

    expect(listSafetyIncidents(db, {
      callerUserId: studentId, callerRole: 'STUDENT'
    })).toEqual({ success: false, errorCode: 'FORBIDDEN' })
  })
})
