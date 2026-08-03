import type {
  ReportContractValidationStatus,
  ReportErrorCode,
  ReportGenerationCandidate,
  ReportLifecycleCapabilities,
  ReportLifecycleStatus,
  ReportListItem
} from '@shared/types/report'
import type { ReportScope, ReportType } from '@shared/types/json-schemas'
import { reportRevisionLabel, reportSchemaVersionLabel } from '../../../../shared/report-presentation'

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
  SUPERSEDED: '已被新版本替代',
  ARCHIVED: '已归档',
  FAILED: '生成失败'
}

export const REPORT_CONTENT_STATUS_LABELS: Record<ReportContractValidationStatus, string> = {
  VALID: '内容完整',
  REPAIR_REQUIRED: '需要检查'
}

export function errorMessage(errorCode: ReportErrorCode): ReportStateMessage {
  if (errorCode === 'FORBIDDEN') {
    return {
      kind: 'forbidden',
      title: '当前账号不能查看报告',
      description: '报告内容只开放给有效教师账号，系统会根据账号权限控制查看范围。'
    }
  }
  if (errorCode === 'REPORT_CONTRACT_INVALID') {
    return {
      kind: 'blocked',
      title: '报告内容需要检查',
      description: '这份报告暂时无法安全展示，请重新加载或联系管理员。',
      actionLabel: '重新加载'
    }
  }
  if (errorCode === 'REPORT_STATE_CONFLICT' || errorCode === 'TASK_CLOSURE_INVALID' || errorCode === 'STALE_REPORT_SOURCE') {
    return {
      kind: 'blocked',
      title: '报告状态已变化',
      description: '报告状态发生了变化，请重新读取最新状态后再处理。',
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
      title: '还没有保存的报告',
      description: '下方有可处理候选，生成动作需要教师明确确认。'
    }
  }
  return {
    kind: 'empty',
    title: '当前没有报告记录',
    description: '完成测评、训练和安全事实确认后，系统会显示可处理的报告。'
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
  if (repairRequired) return '报告内容需要检查，生命周期操作已关闭。'
  if (status === 'SUPERSEDED') return '这是历史报告，已被新版本替代。'
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
    const resultLabels: Record<string, string> = {
      ABILITY_SCORE: '能力测评',
      TRAINING_COMPLETION: '训练完成度',
      OPERATION_PASS_RATE: '实操达标率'
    }
    const results = candidate.results.map((result) => resultLabels[result.resultType] ?? '测评结果').join('、')
    return `学生 ${candidate.studentId} 的${results}待教师确认。`
  }
  if (candidate.kind === 'BASE_CLOSURE') {
    return `学生 ${candidate.studentId}，第 ${candidate.cycleNo} 轮教学闭环，${reportRevisionLabel(candidate.closureRevision)}。`
  }
  if (candidate.kind === 'JOB_SKILL') {
    return `学生 ${candidate.studentId} 的岗位技能测评结果待生成报告。`
  }
  if (candidate.kind === 'SAFETY_WAITING_CONFIRMATION') {
    return `学生 ${candidate.studentId} 有一项安全事实待教师确认。`
  }
  return `学生 ${candidate.studentId} 有一项安全事实，可生成或重试报告。`
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
  const schema = reportSchemaVersionLabel(item.reportSchemaVersion)
  return `${scope} · ${status} · ${reportRevisionLabel(item.reportRevision)} · ${schema}`
}
