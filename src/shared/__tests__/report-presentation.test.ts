import { describe, expect, it } from 'vitest'
import {
  buildReportExportPresentation,
  EXPORT_FIELD_ALLOWLIST,
  isExportAllowedField,
  pseudonymForStudentId
} from '../report-presentation'
import type { ReportPresentationDocument, ReportPresentationField } from '../types/report'

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

describe('report presentation export projection', () => {
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
