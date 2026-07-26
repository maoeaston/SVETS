import { describe, expect, it } from 'vitest'
import {
  actionState,
  candidateActionLabel,
  candidateDescription,
  candidateTitle,
  errorMessage,
  hasActiveFilters,
  listEmptyMessage,
  readonlyReasonFor,
  stableReportSummary
} from '../report-page-state'
import type {
  ReportGenerationCandidate,
  ReportLifecycleCapabilities,
  ReportListItem
} from '@shared/types/report'

const noCapabilities: ReportLifecycleCapabilities = {
  canConfirmPlacementReview: false,
  canLock: false,
  canExport: false,
  placementAdviceEnabled: false
}

describe('report page state mapping', () => {
  it('keeps historical and repair reports read-only', () => {
    expect(readonlyReasonFor('SUPERSEDED', false)).toContain('历史报告')
    expect(readonlyReasonFor('ARCHIVED', false)).toContain('归档')
    expect(readonlyReasonFor('FAILED', false)).toContain('生成失败')
    expect(readonlyReasonFor('GENERATED', true)).toContain('合同需要修复')
    expect(readonlyReasonFor('LOCKED', false)).toBeNull()
  })

  it('derives lifecycle buttons only from main-process capabilities', () => {
    const active = actionState('GENERATED', 'VALID', {
      canConfirmPlacementReview: true,
      canLock: true,
      canExport: true,
      placementAdviceEnabled: true
    })
    expect(active).toMatchObject({
      canConfirmPlacementReview: true,
      canLock: true,
      canExport: true,
      readonlyReason: null,
      repairRequired: false
    })

    const repair = actionState('GENERATED', 'REPAIR_REQUIRED', {
      canConfirmPlacementReview: true,
      canLock: true,
      canExport: true,
      placementAdviceEnabled: true
    })
    expect(repair.canExport).toBe(false)
    expect(repair.repairRequired).toBe(true)

    expect(actionState('SUPERSEDED', 'VALID', {
      canConfirmPlacementReview: true,
      canLock: true,
      canExport: true,
      placementAdviceEnabled: true
    }).canLock).toBe(false)
  })

  it('maps forbidden, repair and conflict errors to stable page states', () => {
    expect(errorMessage('FORBIDDEN')).toMatchObject({ kind: 'forbidden' })
    expect(errorMessage('REPORT_CONTRACT_INVALID')).toMatchObject({ kind: 'blocked' })
    expect(errorMessage('REPORT_STATE_CONFLICT')).toMatchObject({ kind: 'blocked' })
    expect(errorMessage('REPORT_EXPORT_FAILED')).toMatchObject({ kind: 'error' })
  })

  it('distinguishes empty list states', () => {
    expect(listEmptyMessage(false, 0).description).toContain('候选')
    expect(listEmptyMessage(false, 2).description).toContain('下方')
    expect(listEmptyMessage(true, 2).title).toContain('筛选')
  })

  it('formats candidates without generating report field mappings', () => {
    const base: ReportGenerationCandidate = {
      kind: 'BASE_RESULTS',
      studentId: 'student-1',
      jobCode: 'SUPERMARKET_SHELVER',
      taskCode: 'SHELVE_TASK',
      results: [
        { resultId: 'r-a', resultType: 'ABILITY_SCORE', sourceAggregateId: 's-a', generatedAt: '2026-07-26T00:00:00.000Z' },
        { resultId: 'r-t', resultType: 'TRAINING_COMPLETION', sourceAggregateId: 's-t', generatedAt: '2026-07-26T00:00:00.000Z' },
        { resultId: 'r-o', resultType: 'OPERATION_PASS_RATE', sourceAggregateId: 's-o', generatedAt: '2026-07-26T00:00:00.000Z' }
      ]
    }
    const waiting: ReportGenerationCandidate = {
      kind: 'SAFETY_WAITING_CONFIRMATION',
      incidentId: 'incident-1',
      studentId: 'student-1'
    }

    expect(candidateTitle(base)).toBe('确认基础任务闭环')
    expect(candidateDescription(base)).toContain('ABILITY_SCORE:r-a')
    expect(candidateActionLabel(waiting)).toBe('查看安全事件')
  })

  it('detects active filters and stable report summaries', () => {
    expect(hasActiveFilters({ studentId: '', reportScope: '', reportType: '', status: '' })).toBe(false)
    expect(hasActiveFilters({ studentId: 'student-1', reportScope: '', reportType: '', status: '' })).toBe(true)

    const item: ReportListItem = {
      reportId: 'report-1',
      studentId: 'student-1',
      studentDisplayName: '学生一',
      reportTitle: '岗位技能报告',
      reportScope: 'JOB_SKILL',
      reportType: 'FULL_REPORT',
      status: 'LOCKED',
      contractValidationStatus: 'VALID',
      reportSchemaVersion: 'job-skill-report-v1.0',
      reportRevision: 2,
      generatedAt: '2026-07-26T00:00:00.000Z',
      canExport: true
    }
    expect(stableReportSummary(item)).toBe('岗位技能 · 已锁定 · 修订 2 · job-skill-report-v1.0')
    expect(actionState('LOCKED', 'VALID', noCapabilities).readonlyReason).toBeNull()
  })
})
