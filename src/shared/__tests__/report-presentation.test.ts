import { describe, expect, it } from 'vitest'
import {
  buildReportPresentation,
  buildReportExportPresentation,
  EXPORT_FIELD_ALLOWLIST,
  isExportAllowedField,
  pseudonymForStudentId,
  reportBaseLevelLabel,
  reportLevelLabel,
  reportRevisionLabel,
  reportTextLabel,
  reportTitleLabel
} from '../report-presentation'
import type { ReportPresentationDocument, ReportPresentationField } from '../types/report'
import type { ReportContentBaseAbility, ValidatedReportContentJobSkill } from '../types/json-schemas'

function field(
  fieldId: string,
  value: string,
  options: Partial<Pick<ReportPresentationField, 'sensitivity' | 'exportPolicy'>> = {}
): ReportPresentationField {
  return {
    fieldId,
    label: fieldId,
    value,
    sensitivity: options.sensitivity ?? 'PUBLIC',
    exportPolicy: options.exportPolicy ?? 'EXPORT_ALLOWED'
  }
}

function document(scope: ReportPresentationDocument['reportScope']): ReportPresentationDocument {
  return {
    documentId: `doc-${scope}`,
    reportScope: scope,
    reportType: scope === 'SAFETY' ? 'SAFETY_TERMINATION_REPORT' : 'FULL_REPORT',
    generatedAt: '2026-07-26T00:00:00.000Z',
    sections: [
      {
        sectionId: 'summary',
        title: '总览',
        fields: [
          field('summary.scope', scope),
          field('summary.real_student_name', '王小明', { sensitivity: 'PAGE_ONLY', exportPolicy: 'EXCLUDED' }),
          field('summary.teacher_note', '教师自由备注', { sensitivity: 'TEACHER_INTERNAL', exportPolicy: 'PAGE_ONLY' })
        ]
      },
      {
        sectionId: 'base_scores',
        title: '基础能力结果',
        fields: [
          field('base_scores.ability.level_result', 'LEVEL_CONDITIONAL'),
          field('base_scores.secret_extra', '不应导出')
        ]
      }
    ]
  }
}

function jobSkillContent(): ValidatedReportContentJobSkill {
  return {
    report_schema_version: 'job-skill-report-v1.0',
    report_scope: 'JOB_SKILL',
    report_type: 'FULL_REPORT',
    generated_at: '2026-07-26T00:00:00.000Z',
    assessment_meta: {
      job_code: 'SUPERMARKET_SHELVER',
      sitting_count: 2
    },
    overall_summary: {
      level_result: 'LEVEL_COMPETENT'
    },
    administration_summary: {
      report_usage: 'MVP_DEMO_PROFILE_ONLY'
    },
    validity_limitations: ['MVP_DEMO_PROFILE_ONLY'],
    placement_advice: {
      enabled: false,
      recommendation: null,
      reason_disabled: 'MVP_DEMO_PROFILE_ONLY'
    }
  } as unknown as ValidatedReportContentJobSkill
}

function baseAbilityContent(): ReportContentBaseAbility {
  return {
    report_schema_version: 'task-report-v1.1',
    report_scope: 'BASE_ABILITY',
    report_type: 'FULL_REPORT',
    generated_at: '2026-07-26T00:00:00.000Z',
    assessment_meta: { report_usage: 'PILOT_ONLY' },
    score_summary: {
      ability_score: { level_result: 'LEVEL_COMPETENT' },
      training_completion: { level_result: 'LEVEL_CONDITIONAL' },
      operation_pass_rate: { level_result: 'LEVEL_NOT_COMPETENT' }
    },
    validity_limitations: [],
    source_meta: { task_closure_id: 'closure-1', cycle_no: 1, closure_revision: 2 },
    placement_advice: { enabled: false, recommendation: null, reason_disabled: 'PILOT_ONLY' }
  } as unknown as ReportContentBaseAbility
}

describe('report presentation export projection', () => {
  it('maps report machine values into school-facing text without changing the source contract', () => {
    const content = jobSkillContent()
    const page = buildReportPresentation(content, 'report-job-1')
    const pageText = JSON.stringify(page)
    const exported = buildReportExportPresentation(page, 'student-1')
    const exportedText = JSON.stringify(exported)

    expect(content.assessment_meta.job_code).toBe('SUPERMARKET_SHELVER')
    expect(content.overall_summary.level_result).toBe('LEVEL_COMPETENT')
    expect(pageText).toContain('超市理货员')
    expect(pageText).toContain('当前示范任务表现较稳定')
    expect(pageText).toContain('岗位技能报告 1.0')
    expect(pageText).not.toContain('SUPERMARKET_SHELVER')
    expect(pageText).not.toContain('LEVEL_COMPETENT')
    expect(pageText).not.toContain('MVP_DEMO_PROFILE_ONLY')
    expect(exportedText).toContain('超市理货员')
    expect(exportedText).toContain('当前示范任务表现较稳定')
    expect(exportedText).not.toContain('job-skill-report-v1.0')
  })

  it('uses Chinese labels for titles and lifecycle versions', () => {
    expect(reportTitleLabel('SUPERMARKET_SHELVER 专业岗位测评报告')).toBe('超市理货员 岗位技能测评报告')
    expect(reportLevelLabel('LEVEL_CONDITIONAL')).toBe('在明确支持或结构化提示下可完成')
    expect(reportBaseLevelLabel('LEVEL_COMPETENT')).toBe('达到要求')
    expect(reportRevisionLabel(2)).toBe('第 2 版')
    expect(reportTextLabel('NOT_ELIGIBLE')).toBe('当前阶段暂不提供该建议')
    expect(reportTextLabel('NEW_INTERNAL_CODE')).toBe('内容说明待确认')
  })

  it('uses the base-ability wording for base reports', () => {
    const content = baseAbilityContent()
    const pageText = JSON.stringify(buildReportPresentation(content, 'report-base-1'))

    expect(pageText).toContain('达到要求')
    expect(pageText).toContain('在支持下可完成')
    expect(pageText).toContain('需要加强训练')
    expect(pageText).not.toContain('LEVEL_COMPETENT')
    expect(pageText).not.toContain('LEVEL_CONDITIONAL')
    expect(pageText).not.toContain('LEVEL_NOT_COMPETENT')
  })

  it('uses a static allowlist and keeps page/export field ids from the same document', () => {
    const page = document('BASE_ABILITY')
    const exported = buildReportExportPresentation(page, 'student-abcdef12')
    const ids = exported.sections.flatMap((section) => section.fields.map((item) => item.fieldId))

    expect(ids).toEqual([
      'summary.student_display_name',
      'summary.scope',
      'base_scores.ability.level_result'
    ])
    expect(ids.every((id) => EXPORT_FIELD_ALLOWLIST.has(id))).toBe(true)
    expect(JSON.stringify(exported)).not.toContain('王小明')
    expect(JSON.stringify(exported)).not.toContain('教师自由备注')
    expect(JSON.stringify(exported)).not.toContain('不应导出')
  })

  it('applies the same export policy for all report scopes', () => {
    for (const scope of ['BASE_ABILITY', 'JOB_SKILL', 'SAFETY'] as const) {
      const exported = buildReportExportPresentation(document(scope), 'abcd')
      expect(exported.reportScope).toBe(scope)
      expect(exported.sections[0].fields[0]).toMatchObject({
        fieldId: 'summary.student_display_name',
        value: '学生-abcd'
      })
    }
  })

  it('does not export PAGE_ONLY or non-allowlisted public fields', () => {
    expect(isExportAllowedField(field('summary.scope', '基础能力'))).toBe(true)
    expect(isExportAllowedField(field('summary.scope', '基础能力', { sensitivity: 'TEACHER_INTERNAL' }))).toBe(false)
    expect(isExportAllowedField(field('summary.scope', '基础能力', { exportPolicy: 'PAGE_ONLY' }))).toBe(false)
    expect(isExportAllowedField(field('summary.unlisted', '公开但未审核'))).toBe(false)
    expect(pseudonymForStudentId('student-12345678')).toBe('学生-5678')
  })
})
