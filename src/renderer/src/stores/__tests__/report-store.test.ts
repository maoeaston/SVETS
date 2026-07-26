import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../auth'
import { useReportStore } from '../report'
import type { ReportGenerationCandidate } from '@shared/types/report'
import type { IpcApi } from '@shared/types/ipc-api'

const baseCandidate: ReportGenerationCandidate = {
  kind: 'BASE_RESULTS',
  studentId: 'seed-student-001',
  jobCode: 'SUPERMARKET_SHELVER',
  taskCode: 'SHELVE_TASK',
  results: [
    { resultId: 'ability-1', resultType: 'ABILITY_SCORE', sourceAggregateId: 'session-1', generatedAt: '2026-07-26T00:00:00.000Z' },
    { resultId: 'training-1', resultType: 'TRAINING_COMPLETION', sourceAggregateId: 'session-1', generatedAt: '2026-07-26T00:00:00.000Z' },
    { resultId: 'operation-1', resultType: 'OPERATION_PASS_RATE', sourceAggregateId: 'session-1', generatedAt: '2026-07-26T00:00:00.000Z' }
  ]
}

describe('report store candidate operations', () => {
  const reports = {
    list: vi.fn(),
    listGenerationCandidates: vi.fn(),
    get: vi.fn(),
    generate: vi.fn(),
    confirmTaskClosure: vi.fn(),
    replaceTaskClosure: vi.fn(),
    confirmPlacementReview: vi.fn(),
    lock: vi.fn(),
    export: vi.fn()
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    reports.list.mockResolvedValue({ success: true, items: [], total: 0 })
    reports.listGenerationCandidates.mockResolvedValue({ success: true, items: [], total: 0 })
    reports.confirmTaskClosure.mockResolvedValue({
      success: true,
      taskClosure: { taskClosureId: 'closure-1' }
    })
    vi.stubGlobal('window', { api: { reports } as Partial<IpcApi> })
  })

  it('confirms BASE_RESULTS closure without implicitly generating a report', async () => {
    const auth = useAuthStore()
    auth.setUser({
      success: true,
      authSessionId: 'auth-1',
      userId: 'seed-teacher-001',
      role: 'TEACHER',
      displayName: '教师账号',
      expiresAt: '2026-07-27T00:00:00.000Z'
    })

    const store = useReportStore()
    const reportId = await store.generateFromCandidate(baseCandidate)

    expect(reportId).toBeNull()
    expect(reports.confirmTaskClosure).toHaveBeenCalledTimes(1)
    expect(reports.confirmTaskClosure).toHaveBeenCalledWith({
      callerUserId: 'seed-teacher-001',
      callerRole: 'TEACHER',
      resultIds: ['ability-1', 'training-1', 'operation-1']
    })
    expect(reports.generate).not.toHaveBeenCalled()
    expect(store.operationMessage).toBe('基础任务闭环已确认。')
    expect(reports.list).toHaveBeenCalledTimes(1)
    expect(reports.listGenerationCandidates).toHaveBeenCalledTimes(1)
  })
})
