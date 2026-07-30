import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    getVersion: () => 'm5a8-test'
  }
}))

import type { MemoryAdapter } from '../../../db/memory-adapter'
import {
  createTestDb,
  seedAssessmentSessionFixture,
  seedCaller,
  seedStudent
} from '../../../db/test-helpers'
import { writeEvent } from '../../../domain/event-writer'
import type { ReportMutationPort } from '../../../domain/report-command-coordinator'
import { readActionLog, reconcileActionLog } from '../../../domain/recovery'
import { TASK_OPERATION_CODES } from '../../../../shared/types/operation-scoring'
import { submitOperationScores } from '../operation-scoring-service'
import { acceptedScoringTestContext } from './scoring-test-support'

const databases: MemoryAdapter[] = []
const tempDirectories: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('M5A-8 real JSONL multi-event failure boundary', () => {
  it('keeps an N-event legal prefix, rolls SQLite back, and recovers event-by-event', async () => {
    const db = await createTestDb()
    databases.push(db)
    const directory = mkdtempSync(join(tmpdir(), 'svets-m5a8-prefix-'))
    tempDirectories.push(directory)
    const actionLogPath = join(directory, 'action_log.jsonl')
    const teacherId = seedCaller(db, 'TEACHER')
    const studentId = seedStudent(db)
    const sessionId = seedAssessmentSessionFixture(db, {
      studentId,
      strategyId: 'strategy_baseline_shelver_v1',
      strategyType: 'BASELINE_ASSESSMENT',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'MULTI_EVENT_FAILURE_TASK',
      strategyVersion: 1,
      status: 'OFFLINE_PENDING',
      createdBy: teacherId
    })
    const correlationId = '11111111-2222-4333-8444-555555555555'
    const failOnCall = 4
    let callCount = 0
    const eventPort: Pick<ReportMutationPort, 'writeEvent'> = {
      writeEvent(params) {
        callCount += 1
        const event = writeEvent({
          ...params,
          database: db,
          actionLogPath
        })
        if (callCount === failOnCall) {
          throw new Error(`injected failure after JSONL append ${callCount}`)
        }
        return event
      }
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(submitOperationScores(db, {
      callerUserId: teacherId,
      callerRole: 'TEACHER',
      sessionId,
      toolChecklistConfirmed: true,
      scores: TASK_OPERATION_CODES.map((taskOperationCode) => ({
        taskOperationCode,
        score: 2
      }))
    }, {
      eventPort,
      context: acceptedScoringTestContext({
        commandType: 'assessment:submitOperationScores',
        callerUserId: teacherId,
        callerRole: 'TEACHER',
        sessionId,
        correlationId
      })
    })).toEqual({ success: false, errorCode: 'ASSESSMENT_SYSTEM_ERROR' })
    expect(callCount).toBe(failOnCall)

    expect((db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection WHERE aggregate_id = ?')
      .get(sessionId) as { count: number }).count).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?')
      .get(sessionId) as { count: number }).count).toBe(0)
    expect((db.prepare(
      `SELECT COUNT(*) AS count FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE'`
    ).get(sessionId) as { count: number }).count).toBe(0)

    const prefix = readActionLog({ logPath: actionLogPath })
    expect(prefix.truncatedTail).toBe(false)
    expect(prefix.events).toHaveLength(failOnCall)
    expect(prefix.events.map((event) => event.event_sequence)).toEqual([1, 2, 3, 4])
    expect(prefix.events.every((event) => event.event_type === 'OFFLINE_SCORE_SUBMITTED'))
      .toBe(true)
    expect(new Set(prefix.events.map((event) => event.correlation_id))).toEqual(
      new Set([correlationId])
    )

    const recovered = reconcileActionLog(db, { logPath: actionLogPath })
    expect(recovered.replayedEventCount).toBe(failOnCall)
    expect(recovered.skippedEventCount).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS count FROM domain_event_projection WHERE aggregate_id = ?')
      .get(sessionId) as { count: number }).count).toBe(failOnCall)
    expect((db.prepare('SELECT COUNT(*) AS count FROM offline_score_record WHERE session_id = ?')
      .get(sessionId) as { count: number }).count).toBe(failOnCall)
    expect((db.prepare(
      `SELECT COUNT(*) AS count FROM result_record
        WHERE source_aggregate_id = ? AND result_type = 'OPERATION_PASS_RATE'`
    ).get(sessionId) as { count: number }).count).toBe(0)
    expect((db.prepare('SELECT status FROM assessment_session WHERE session_id = ?')
      .get(sessionId) as { status: string }).status).toBe('OFFLINE_PENDING')

    const secondRecovery = reconcileActionLog(db, { logPath: actionLogPath })
    expect(secondRecovery.replayedEventCount).toBe(0)
    expect(secondRecovery.skippedEventCount).toBe(failOnCall)
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
