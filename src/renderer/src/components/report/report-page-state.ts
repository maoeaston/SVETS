import type {
  ReportContractValidationStatus,
  ReportErrorCode,
  ReportGenerationCandidate,
  ReportLifecycleCapabilities,
  ReportLifecycleStatus,
  ReportListItem
} from '@shared/types/report'
import type { ReportScope, ReportType } from '@shared/types/json-schemas'

export type ReportPageStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'forbidden'
  | 'blocked'
  | 'success'

export interface ReportStateMessage {
  kind: ReportPageStateKind
  title: string
  description: string
  actionLabel?: string
}

export interface ReportActionState {
  canConfirmPlacementReview: boolean
  canLock: boolean
  canExport: boolean
  readonlyReason: string | null
  repairRequired: boolean
}

export const REPORT_SCOPE_LABELS: Record<ReportScope, string> = {
  BASE_ABILITY: '基础能力',
  JOB_SKILL: '岗位技能',
  SAFETY: '安全终止'
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  FULL_REPORT: '完整报告',
  SAFETY_TERMINATION_REPORT: '安全终止报告'
}

export const REPORT_STATUS_LABELS: Record<ReportLifecycleStatus, string> = {
  GENERATED: '已生成',
  EXPORTED: '已导出',
  LOCKED: '已锁定',
  SUPERSEDED: '已被替换',
  ARCHIVED: '已归档',
  FAILED: '生成失败'
}

export function errorMessage(errorCode: ReportErrorCode): ReportStateMessage {
  if (errorCode === 'FORBIDDEN') {
    return {
      kind: 'forbidden',
      title: '当前账号不能查看报告',
      description: '报告内容只开放给有效教师账号，操作权限仍由主进程校验。'
    }
  }
  if (errorCode === 'REPORT_CONTRACT_INVALID') {
    return {
      kind: 'blocked',
      title: '报告合同需要修复',
      description: '当前快照没有通过运行时合同校验，页面不会猜测渲染内容。',
      actionLabel: '重新加载'
    }
  }
  if (errorCode === 'REPORT_STATE_CONFLICT' || errorCode === 'TASK_CLOSURE_INVALID' || errorCode === 'STALE_REPORT_SOURCE') {
    return {
      kind: 'blocked',
      title: '报告状态已变化',
      description: '主进程拒绝了这次操作，请重新读取最新状态后再处理。',
      actionLabel: '重新加载'
    }
  }
  if (errorCode === 'REPORT_GENERATION_FAILED' || errorCode === 'REPORT_EXPORT_FAILED') {
    return {
      kind: 'error',
      title: errorCode === 'REPORT_EXPORT_FAILED' ? '报告没有导出成功' : '报告没有生成成功',
      description: '来源事实不会被页面回滚，可以保留现场后重试。',
      actionLabel: '重新加载'
    }
  }
  if (errorCode === 'NOT_FOUND') {
    return {
      kind: 'empty',
      title: '没有找到这份报告',
      description: '报告可能已被归档、替换，或当前筛选条件不再包含它。'
    }
  }
  return {
    kind: 'error',
    title: '报告状态没有加载成功',
    description: '页面没有写入任何数据，可以原地重试。',
    actionLabel: '重新加载'
  }
}

export function listEmptyMessage(hasFilters: boolean, candidateCount: number): ReportStateMessage {
  if (hasFilters) {
    return {
      kind: 'empty',
      title: '没有符合筛选条件的报告',
      description: '可以清空筛选，或查看待生成候选。',
      actionLabel: '清空筛选'
    }
  }
  if (candidateCount > 0) {
    return {
      kind: 'empty',
      title: '还没有持久化报告',
      description: '下方有可处理候选，生成动作需要教师明确确认。'
    }
  }
  return {
    kind: 'empty',
    title: '当前没有报告快照',
    description: '完成测评、训练、安全事实确认后，候选会从主进程同步。'
  }
}

export function actionState(
  status: ReportLifecycleStatus,
  contractStatus: ReportContractValidationStatus,
  capabilities: ReportLifecycleCapabilities
): ReportActionState {
  const repairRequired = contractStatus === 'REPAIR_REQUIRED'
  const readonlyReason = readonlyReasonFor(status, repairRequired)
  return {
    canConfirmPlacementReview: !readonlyReason && capabilities.canConfirmPlacementReview,
    canLock: !readonlyReason && capabilities.canLock,
    canExport: !readonlyReason && capabilities.canExport,
    readonlyReason,
    repairRequired
  }
}

export function readonlyReasonFor(status: ReportLifecycleStatus, repairRequired: boolean): string | null {
  if (repairRequired) return '报告合同需要修复，生命周期操作已关闭。'
  if (status === 'SUPERSEDED') return '这是历史报告，已被新修订替换。'
  if (status === 'ARCHIVED') return '这是已归档报告，仅供追溯查看。'
  if (status === 'FAILED') return '这次报告生成失败，请从候选区重试。'
  return null
}

export function candidateTitle(candidate: ReportGenerationCandidate): string {
  if (candidate.kind === 'BASE_RESULTS') return '确认基础任务闭环'
  if (candidate.kind === 'BASE_CLOSURE') return '生成基础能力报告'
  if (candidate.kind === 'JOB_SKILL') return candidate.repairOfReportId ? '修复岗位技能报告' : '生成岗位技能报告'
  if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') return '安全事实待确认'
  return candidate.retryable ? '重试安全终止报告' : '生成安全终止报告'
}

export function candidateDescription(candidate: ReportGenerationCandidate): string {
  if (candidate.kind === 'BASE_RESULTS') {
    const ids = candidate.results.map((result) => `${result.resultType}:${result.resultId}`).join(' / ')
    return `学生 ${candidate.studentId} 的三类结果待教师确认：${ids}`
  }
  if (candidate.kind === 'BASE_CLOSURE') {
    return `学生 ${candidate.studentId}，第 ${candidate.cycleNo} 轮闭环，修订 ${candidate.closureRevision}。`
  }
  if (candidate.kind === 'JOB_SKILL') {
    return `学生 ${candidate.studentId}，来源结果 ${candidate.resultId}。`
  }
  if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') {
    return `学生 ${candidate.studentId} 的安全事件 ${candidate.incidentId} 需要先确认事实。`
  }
  return `学生 ${candidate.studentId}，安全事件 ${candidate.incidentId} 可生成或重试。`
}

export function candidateActionLabel(candidate: ReportGenerationCandidate): string {
  if (candidate.kind === 'BASE_RESULTS') return '确认闭环'
  if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') return '查看安全事件'
  return '生成报告'
}

export function hasActiveFilters(filters: {
  studentId?: string
  reportScope?: ReportScope | ''
  reportType?: ReportType | ''
  status?: ReportLifecycleStatus | ''
}): boolean {
  return Boolean(filters.studentId?.trim() || filters.reportScope || filters.reportType || filters.status)
}

export function stableReportSummary(item: ReportListItem): string {
  const scope = REPORT_SCOPE_LABELS[item.reportScope]
  const status = REPORT_STATUS_LABELS[item.status]
  const schema = item.reportSchemaVersion || '未知合同'
  return `${scope} · ${status} · 修订 ${item.reportRevision} · ${schema}`
}
