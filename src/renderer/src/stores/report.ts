import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useAuthStore } from './auth'
import type { ReportScope, ReportType } from '@shared/types/json-schemas'
import type {
  GenerateReportResult,
  ListReportGenerationCandidatesResult,
  ListReportsResult,
  ReportDetail,
  ReportErrorCode,
  ReportGenerationCandidate,
  ReportLifecycleMutationResult,
  ReportLifecycleStatus,
  ReportListItem,
  ReportsResult
} from '@shared/types/report'

type ReportFilterValue<T> = T | ''

export interface ReportFiltersState {
  studentId: string
  reportScope: ReportFilterValue<ReportScope>
  reportType: ReportFilterValue<ReportType>
  status: ReportFilterValue<ReportLifecycleStatus>
}

export const useReportStore = defineStore('report', () => {
  const auth = useAuthStore()
  const filters = reactive<ReportFiltersState>({
    studentId: '',
    reportScope: '',
    reportType: '',
    status: ''
  })
  const items = ref<ReportListItem[]>([])
  const total = ref(0)
  const candidates = ref<ReportGenerationCandidate[]>([])
  const candidateTotal = ref(0)
  const detail = ref<ReportDetail | null>(null)
  const loadingList = ref(false)
  const loadingDetail = ref(false)
  const listError = ref<ReportErrorCode | null>(null)
  const detailError = ref<ReportErrorCode | null>(null)
  const operationError = ref<ReportErrorCode | null>(null)
  const operationMessage = ref('')
  const operationKey = ref('')
  let listRequestId = 0
  let detailRequestId = 0

  const caller = computed(() => {
    if (!auth.userId || !auth.role) return null
    return { callerUserId: auth.userId, callerRole: auth.role }
  })

  function listParams() {
    if (!caller.value) return null
    return {
      ...caller.value,
      studentId: filters.studentId.trim() || undefined,
      reportScope: filters.reportScope || undefined,
      reportType: filters.reportType || undefined,
      status: filters.status || undefined,
      limit: 50,
      offset: 0
    }
  }

  async function loadList(): Promise<void> {
    const params = listParams()
    if (!params) {
      listError.value = 'FORBIDDEN'
      return
    }
    const requestId = ++listRequestId
    loadingList.value = true
    listError.value = null
    operationError.value = null
    try {
      const [reportsResult, candidatesResult] = await Promise.all([
        window.api.reports.list(params),
        window.api.reports.listGenerationCandidates({
          callerUserId: params.callerUserId,
          callerRole: params.callerRole,
          studentId: params.studentId,
          limit: 50,
          offset: 0
        })
      ])
      if (requestId !== listRequestId) return
      assignListResult(reportsResult)
      assignCandidateResult(candidatesResult)
    } catch (error) {
      console.error('[ReportStore] list failed:', error)
      if (requestId === listRequestId) listError.value = 'REPORT_SYSTEM_ERROR'
    } finally {
      if (requestId === listRequestId) loadingList.value = false
    }
  }

  async function loadDetail(reportId: string): Promise<void> {
    if (!caller.value) {
      detailError.value = 'FORBIDDEN'
      return
    }
    const requestId = ++detailRequestId
    loadingDetail.value = true
    detailError.value = null
    operationError.value = null
    try {
      const result = await window.api.reports.get({ ...caller.value, reportId })
      if (requestId !== detailRequestId) return
      if (!result.success) {
        detail.value = null
        detailError.value = result.errorCode
        return
      }
      detail.value = result.report
    } catch (error) {
      console.error('[ReportStore] detail failed:', error)
      if (requestId === detailRequestId) detailError.value = 'REPORT_SYSTEM_ERROR'
    } finally {
      if (requestId === detailRequestId) loadingDetail.value = false
    }
  }

  async function confirmBaseClosure(candidate: Extract<ReportGenerationCandidate, { kind: 'BASE_RESULTS' }>): Promise<string | null> {
    if (!caller.value) return failOperation('FORBIDDEN')
    return runOperation(`closure:${candidate.studentId}`, async () => {
      const result = await window.api.reports.confirmTaskClosure({
        ...caller.value!,
        resultIds: candidate.results.map((item) => item.resultId) as [string, string, string]
      })
      if (!result.success) return failOperation(result.errorCode)
      operationMessage.value = '基础任务闭环已确认。'
      await loadList()
      return result.taskClosure.taskClosureId
    })
  }

  async function generateFromCandidate(candidate: ReportGenerationCandidate): Promise<string | null> {
    if (!caller.value) return failOperation('FORBIDDEN')
    if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') return null
    if (candidate.kind === 'BASE_RESULTS') return confirmBaseClosure(candidate).then(() => null)
    return runOperation(`generate:${candidateKey(candidate)}`, async () => {
      let result: ReportsResult<GenerateReportResult>
      if (candidate.kind === 'BASE_CLOSURE') {
        result = await window.api.reports.generate({
          ...caller.value!,
          reportScope: 'BASE_ABILITY',
          taskClosureId: candidate.taskClosureId
        })
      } else if (candidate.kind === 'JOB_SKILL') {
        result = await window.api.reports.generate({
          ...caller.value!,
          reportScope: 'JOB_SKILL',
          resultId: candidate.resultId
        })
      } else {
        result = await window.api.reports.generate({
          ...caller.value!,
          reportScope: 'SAFETY',
          incidentId: candidate.incidentId
        })
      }
      if (!result.success) return failOperation(result.errorCode)
      operationMessage.value = result.generated ? '报告已生成。' : '已有活动报告，已读取当前状态。'
      await loadList()
      return result.reportId
    })
  }

  async function confirmPlacementReview(reportId: string): Promise<boolean> {
    return mutateDetail(`review:${reportId}`, reportId, () => window.api.reports.confirmPlacementReview({ ...caller.value!, reportId }), '安置建议已复核。')
  }

  async function lockReport(reportId: string): Promise<boolean> {
    return mutateDetail(`lock:${reportId}`, reportId, () => window.api.reports.lock({ ...caller.value!, reportId, lockReason: '教师在报告详情页确认锁定' }), '报告已锁定。')
  }

  async function exportReport(reportId: string): Promise<boolean> {
    if (!caller.value) return Boolean(failOperation('FORBIDDEN'))
    return runOperation(`export:${reportId}`, async () => {
      const result = await window.api.reports.export({ ...caller.value!, reportId })
      if (!result.success) return Boolean(failOperation(result.errorCode))
      if (result.canceled) {
        operationMessage.value = '已取消导出。'
        return true
      }
      operationMessage.value = '脱敏 HTML 已导出。'
      await loadDetail(reportId)
      await loadList()
      return true
    })
  }

  function resetFilters(): void {
    filters.studentId = ''
    filters.reportScope = ''
    filters.reportType = ''
    filters.status = ''
  }

  function assignListResult(result: ReportsResult<ListReportsResult>): void {
    if (!result.success) {
      items.value = []
      total.value = 0
      listError.value = result.errorCode
      return
    }
    items.value = result.items
    total.value = result.total
  }

  function assignCandidateResult(result: ReportsResult<ListReportGenerationCandidatesResult>): void {
    if (!result.success) {
      candidates.value = []
      candidateTotal.value = 0
      if (!listError.value) listError.value = result.errorCode
      return
    }
    candidates.value = result.items
    candidateTotal.value = result.total
  }

  async function mutateDetail(
    key: string,
    reportId: string,
    call: () => Promise<ReportsResult<ReportLifecycleMutationResult>>,
    successMessage: string
  ): Promise<boolean> {
    if (!caller.value) return Boolean(failOperation('FORBIDDEN'))
    return runOperation(key, async () => {
      const result = await call()
      if (!result.success) return Boolean(failOperation(result.errorCode))
      operationMessage.value = successMessage
      await loadDetail(reportId)
      await loadList()
      return true
    })
  }

  async function runOperation<T>(key: string, run: () => Promise<T>): Promise<T> {
    operationKey.value = key
    operationError.value = null
    operationMessage.value = ''
    try {
      return await run()
    } catch (error) {
      console.error('[ReportStore] operation failed:', error)
      operationError.value = 'REPORT_SYSTEM_ERROR'
      return null as T
    } finally {
      operationKey.value = ''
    }
  }

  function failOperation<T = null>(errorCode: ReportErrorCode): T {
    operationError.value = errorCode
    operationMessage.value = ''
    return null as T
  }

  return {
    filters,
    items,
    total,
    candidates,
    candidateTotal,
    detail,
    loadingList,
    loadingDetail,
    listError,
    detailError,
    operationError,
    operationMessage,
    operationKey,
    loadList,
    loadDetail,
    confirmBaseClosure,
    generateFromCandidate,
    confirmPlacementReview,
    lockReport,
    exportReport,
    resetFilters
  }
})

export function candidateKey(candidate: ReportGenerationCandidate): string {
  if (candidate.kind === 'BASE_RESULTS') return `base-results:${candidate.studentId}:${candidate.results.map((item) => item.resultId).join(',')}`
  if (candidate.kind === 'BASE_CLOSURE') return `base-closure:${candidate.taskClosureId}`
  if (candidate.kind === 'JOB_SKILL') return `job:${candidate.resultId}`
  if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') return `safety-waiting:${candidate.incidentId}`
  return `safety:${candidate.incidentId}`
}
