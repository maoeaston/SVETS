import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { DBAdapter, DBStatement } from '../../../db/interface'
import { createTestDb, seedCaller } from '../../../db/test-helpers'
import type { MemoryAdapter } from '../../../db/memory-adapter'
import { CommandBus } from '../../command/command-bus'
import {
  createM5AMutationDefinitions
} from '../../command/m5a-command-definitions'
import { CommandRegistry } from '../../command/command-registry'
import type { AcceptedCommandContext } from '../../command/command-types'
import {
  clearAuthSessionBinding,
  issuePasswordAuthSession,
  replaceSenderAuthSession
} from '../../../utils/auth-session'

const REPORT_MUTATIONS = [
  'reports:confirmPlacementReview',
  'reports:confirmTaskClosure',
  'reports:export',
  'reports:generate',
  'reports:lock',
  'reports:replaceTaskClosure'
] as const

const senderId = 7101
const resultIds = ['ability-result', 'training-result', 'operation-result'] as const
let db: MemoryAdapter
let teacherId: string

class ReportTargetFixtureAdapter implements DBAdapter {
  constructor(private readonly delegate: DBAdapter) {}

  prepare(sql: string): DBStatement {
    const normalized = sql.replace(/\s+/g, ' ').trim().toUpperCase()
    if (normalized.includes('FROM RESULT_RECORD R') && normalized.includes('WHERE R.RESULT_ID = ?')) {
      return {
        run: () => undefined,
        get: (resultId) => this.resultRow(String(resultId)),
        all: () => []
      }
    }
    if (normalized.includes('FROM TASK_REPORT R') && normalized.includes('WHERE R.REPORT_ID = ?')) {
      return {
        run: () => undefined,
        get: (reportId) => ({
          report_id: String(reportId),
          student_id: 'student-report',
          job_code: 'SUPERMARKET_SHELVER',
          task_code: 'SHELVE_TASK'
        }),
        all: () => []
      }
    }
    if (normalized.includes('SELECT INCIDENT_ID AS SOURCE_ID')) {
      return {
        run: () => undefined,
        get: (incidentId) => ({
          source_id: String(incidentId),
          student_id: 'student-report',
          job_code: 'SUPERMARKET_SHELVER',
          task_code: 'SHELVE_TASK'
        }),
        all: () => []
      }
    }
    if (normalized.includes('SELECT TASK_CLOSURE_ID, STUDENT_ID, JOB_CODE, TASK_CODE')) {
      return {
        run: () => undefined,
        get: (closureId) => ({
          task_closure_id: String(closureId),
          student_id: 'student-report',
          job_code: 'SUPERMARKET_SHELVER',
          task_code: 'SHELVE_TASK'
        }),
        all: () => []
      }
    }
    return this.delegate.prepare(sql)
  }

  transaction<T>(fn: () => T): () => T {
    return this.delegate.transaction(fn)
  }

  immediateTransaction<T>(fn: () => T): () => T {
    return this.delegate.immediateTransaction(fn)
  }

  exec(sql: string): void {
    this.delegate.exec(sql)
  }

  private resultRow(resultId: string) {
    const index = resultIds.indexOf(resultId as (typeof resultIds)[number])
    const resultType = index === 0
      ? 'ABILITY_SCORE'
      : index === 1
        ? 'TRAINING_COMPLETION'
        : 'OPERATION_PASS_RATE'
    return {
      result_id: resultId,
      student_id: 'student-report',
      result_type: resultType,
      source_aggregate_type: index === 1 ? 'TRAINING_SESSION' : 'ASSESSMENT_SESSION',
      source_aggregate_id: `${resultType.toLowerCase()}-source`,
      strategy_id: 'strategy-report-test',
      strategy_type: index === 1 ? 'TRAINING_PRACTICE' : 'BASELINE_ASSESSMENT',
      job_code: 'SUPERMARKET_SHELVER',
      raw_score: 80,
      max_score: 100,
      normalized_score: 80,
      completion_ratio: index === 1 ? 1 : null,
      level_result: 'PASS',
      safety_overridden: 0,
      redline_incident_id: null,
      result_payload_json: '{}',
      generated_at: '2026-07-29T00:00:00.000Z',
      is_current: 1,
      task_code: 'SHELVE_TASK',
      source_status: 'COMPLETED',
      source_started_at: '2026-07-29T00:00:00.000Z',
      source_completed_at: '2026-07-29T00:10:00.000Z',
      total_step_count: 1,
      completed_step_count: 1
    }
  }
}

beforeEach(async () => {
  db = await createTestDb()
  teacherId = seedCaller(db, 'TEACHER')
  const session = issuePasswordAuthSession(db, {
    userId: teacherId,
    role: 'TEACHER',
    displayName: '报告教师'
  })
  replaceSenderAuthSession(db, senderId, session.rawToken, 'reports-command-bus-test')
})

afterEach(() => {
  clearAuthSessionBinding(senderId)
  db.close()
})

describe('M5A-10 report commands through CommandBus', () => {
  it('accepts all six registry-owned mutations and supplies canonical context with correlation', async () => {
    const fixtureDb = new ReportTargetFixtureAdapter(db)
    const captures = new Map<string, AcceptedCommandContext>()
    const event = { sender: { id: senderId } } as IpcMainInvokeEvent
    const definitions = createM5AMutationDefinitions({
      db: fixtureDb,
      eventForTransport: () => event,
      handlerForChannel: (channel) => (_event, ...args: unknown[]) => {
        const context = args[1] as AcceptedCommandContext | undefined
        if (!context) throw new Error(`missing accepted context for ${channel}`)
        captures.set(channel, context)
        return { success: true, channel }
      }
    }).filter((definition) => REPORT_MUTATIONS.includes(
      definition.commandType as (typeof REPORT_MUTATIONS)[number]
    ))
    const registry = new CommandRegistry()
    for (const definition of definitions) registry.registerMutation(definition)
    registry.seal(REPORT_MUTATIONS)
    const bus = new CommandBus({ registry })
    bus.open()

    const inputs = new Map<string, Record<string, unknown>>([
      ['reports:confirmPlacementReview', { reportId: 'report-1' }],
      ['reports:confirmTaskClosure', { resultIds: [...resultIds] }],
      ['reports:export', { reportId: 'report-1' }],
      ['reports:generate', { reportScope: 'SAFETY', incidentId: 'incident-1' }],
      ['reports:lock', { reportId: 'report-1', lockReason: '确认锁定' }],
      ['reports:replaceTaskClosure', {
        taskClosureId: 'closure-1',
        resultIds: [...resultIds],
        correctionReason: '修正来源'
      }]
    ])

    for (const channel of REPORT_MUTATIONS) {
      const outcome = await bus.dispatch({
        commandType: channel,
        rawInput: {
          ...inputs.get(channel),
          callerUserId: teacherId,
          callerRole: 'TEACHER'
        },
        transport: { source: 'IPC', transportId: `transport:${channel}` }
      })
      expect(outcome.status).toBe('COMPLETED')
    }

    expect(captures.size).toBe(6)
    for (const channel of REPORT_MUTATIONS) {
      const context = captures.get(channel)
      expect(context?.envelope.commandType).toBe(channel)
      expect(context?.envelope.correlationId).toMatch(/\S+/)
      expect(context?.envelope.actor).toMatchObject({
        kind: 'USER',
        userId: teacherId,
        role: 'TEACHER'
      })
      const definition = registry.requireMutation(channel)
      expect(definition.metadata.transactionOwner).toMatch(/^reports-service\./)
      expect(definition.metadata.sideEffects).toContain('RUNTIME_REPORT_COORDINATOR')
      expect(definition.metadata.testReferences).toContain(
        'src/main/application/services/__tests__/reports-command-bus.test.ts'
      )
    }
    expect(captures.get('reports:confirmTaskClosure')?.envelope.target).toMatchObject({
      student_id: 'student-report',
      job_code: 'SUPERMARKET_SHELVER',
      task_code: 'SHELVE_TASK',
      source_result_ids: [...resultIds]
    })
    expect(captures.get('reports:generate')?.envelope.target).toMatchObject({
      report_scope: 'SAFETY',
      source_id: 'incident-1',
      student_id: 'student-report'
    })
  })
})
