import type {
  ReportContentBaseAbility,
  ReportContentJson,
  ReportContentSafetyTermination,
  ValidatedReportContentJobSkill
} from './types/json-schemas'
import type {
  ReportPresentationDocument,
  ReportPresentationExportPolicy,
  ReportPresentationField,
  ReportPresentationSection,
  ReportPresentationSensitivity
} from './types/report'

type FieldValue = ReportPresentationField['value']

export const EXPORT_FIELD_ALLOWLIST = new Set<string>([
  'summary.student_display_name',
  'summary.scope',
  'summary.generated_at',
  'summary.usage',
  'summary.source_scope',
  'base_scores.ability.normalized_score',
  'base_scores.ability.level_result',
  'base_scores.training.normalized_score',
  'base_scores.training.level_result',
  'base_scores.operation.normalized_score',
  'base_scores.operation.level_result',
  'base_source.cycle_no',
  'base_source.closure_revision',
  'job_overall.raw_score',
  'job_overall.max_score',
  'job_overall.normalized_score',
  'job_overall.level_result',
  'job_overall.safety_overridden',
  'job_administration.completion_ratio',
  'job_administration.observation_completion_ratio',
  'job_administration.sitting_count',
  'safety_incident.reason_code',
  'safety_incident.context_phase',
  'safety_incident.occurred_at',
  'safety_incident.status_at_generation',
  'safety_result.level_result',
  'safety_result.ordinary_report_blocked',
  'placement_advice.enabled'
])

interface FieldOptions {
  sensitivity?: ReportPresentationSensitivity
  exportPolicy?: ReportPresentationExportPolicy
}

function field(fieldId: string, label: string, value: FieldValue, options: FieldOptions = {}): ReportPresentationField {
  return {
    fieldId,
    label,
    value,
    sensitivity: options.sensitivity ?? 'PUBLIC',
    exportPolicy: options.exportPolicy ?? 'EXPORT_ALLOWED'
  }
}

function section(sectionId: string, title: string, fields: ReportPresentationField[]): ReportPresentationSection {
  return { sectionId, title, fields }
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textList(value: readonly string[] | undefined): string {
  return value && value.length > 0 ? value.join('；') : '无'
}

export function buildReportPresentation(content: ReportContentJson, documentId: string): ReportPresentationDocument {
  if (content.report_scope === 'BASE_ABILITY') return buildBasePresentation(content, documentId)
  if (content.report_scope === 'JOB_SKILL') return buildJobPresentation(content, documentId)
  return buildSafetyPresentation(content, documentId)
}

export function buildReportExportPresentation(
  document: ReportPresentationDocument,
  studentId: string
): ReportPresentationDocument {
  const identityField = field('summary.student_display_name', '学生显示名', pseudonymForStudentId(studentId))
  return {
    ...document,
    sections: document.sections
      .map((sourceSection) => {
        const fields = sourceSection.sectionId === 'summary'
          ? [identityField, ...sourceSection.fields]
          : sourceSection.fields
        return section(
          sourceSection.sectionId,
          sourceSection.title,
          fields.filter(isExportAllowedField)
        )
      })
      .filter((sourceSection) => sourceSection.fields.length > 0)
  }
}

export function isExportAllowedField(field: ReportPresentationField): boolean {
  return (
    field.exportPolicy === 'EXPORT_ALLOWED'
    && field.sensitivity === 'PUBLIC'
    && EXPORT_FIELD_ALLOWLIST.has(field.fieldId)
  )
}

export function pseudonymForStudentId(studentId: string): string {
  const trimmed = studentId.trim()
  const suffix = trimmed.length <= 4 ? trimmed : trimmed.slice(-4)
  return `学生-${suffix.padStart(4, '0')}`
}

function baseCommon(content: ReportContentJson, documentId: string): Pick<ReportPresentationDocument, 'documentId' | 'reportScope' | 'reportType' | 'generatedAt'> {
  return {
    documentId,
    reportScope: content.report_scope,
    reportType: content.report_type,
    generatedAt: content.generated_at
  }
}

function buildBasePresentation(content: ReportContentBaseAbility, documentId: string): ReportPresentationDocument {
  return {
    ...baseCommon(content, documentId),
    sections: [
      section('summary', '总览', [
        field('summary.scope', '报告范围', '基础能力'),
        field('summary.generated_at', '生成时间', content.generated_at),
        field('summary.usage', '使用范围', content.assessment_meta.report_usage),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('base_scores', '基础能力结果', [
        field('base_scores.ability.normalized_score', '基础测评标准分', numberOrNull(content.score_summary.ability_score.normalized_score)),
        field('base_scores.ability.level_result', '基础测评等级', content.score_summary.ability_score.level_result),
        field('base_scores.training.normalized_score', '训练完成标准分', numberOrNull(content.score_summary.training_completion.normalized_score)),
        field('base_scores.training.level_result', '训练完成等级', content.score_summary.training_completion.level_result),
        field('base_scores.operation.normalized_score', '实操通过标准分', numberOrNull(content.score_summary.operation_pass_rate.normalized_score)),
        field('base_scores.operation.level_result', '实操通过等级', content.score_summary.operation_pass_rate.level_result)
      ]),
      section('base_source', '来源闭环', [
        field('base_source.task_closure_id', '闭环 ID', content.source_meta.task_closure_id, {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        }),
        field('base_source.cycle_no', '教学轮次', content.source_meta.cycle_no),
        field('base_source.closure_revision', '闭环修订', content.source_meta.closure_revision)
      ]),
      placementSection(content.placement_advice.enabled, content.placement_advice.reason_disabled)
    ]
  }
}

function buildJobPresentation(content: ValidatedReportContentJobSkill, documentId: string): ReportPresentationDocument {
  return {
    ...baseCommon(content, documentId),
    sections: [
      section('summary', '总览', [
        field('summary.scope', '报告范围', '岗位技能'),
        field('summary.generated_at', '生成时间', content.generated_at),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('job_overall', '岗位技能结果', [
        field('job_overall.raw_score', '原始分', content.overall_summary.raw_score),
        field('job_overall.max_score', '满分', content.overall_summary.max_score),
        field('job_overall.normalized_score', '标准分', content.overall_summary.normalized_score),
        field('job_overall.level_result', '等级', content.overall_summary.level_result),
        field('job_overall.safety_overridden', '安全覆盖', content.overall_summary.safety_overridden)
      ]),
      section('job_administration', '施测摘要', [
        field('job_administration.completion_ratio', '完成度', content.administration_summary.completion_ratio),
        field('job_administration.observation_completion_ratio', '观察完成度', content.administration_summary.observation_completion_ratio),
        field('job_administration.sitting_count', '坐次数', content.assessment_meta.sitting_count)
      ]),
      placementSection(false, content.placement_advice.reason_disabled)
    ]
  }
}

function buildSafetyPresentation(content: ReportContentSafetyTermination, documentId: string): ReportPresentationDocument {
  return {
    ...baseCommon(content, documentId),
    sections: [
      section('summary', '总览', [
        field('summary.scope', '报告范围', '安全终止'),
        field('summary.generated_at', '生成时间', content.generated_at),
        field('summary.source_scope', '来源范围', content.source_scope),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('safety_incident', '安全事实', [
        field('safety_incident.reason_code', '安全原因', content.incident_snapshot.reason_code),
        field('safety_incident.context_phase', '发生环节', content.incident_snapshot.context_phase),
        field('safety_incident.occurred_at', '发生时间', content.incident_snapshot.occurred_at),
        field('safety_incident.status_at_generation', '生成时状态', content.incident_snapshot.status_at_generation),
        field('safety_incident.description', '事实描述', content.incident_snapshot.description, {
          sensitivity: 'PAGE_ONLY',
          exportPolicy: 'EXCLUDED'
        })
      ]),
      section('safety_result', '安全结论', [
        field('safety_result.level_result', '安全等级', content.safety_summary.level_result),
        field('safety_result.ordinary_report_blocked', '普通报告阻断', content.safety_summary.ordinary_report_blocked)
      ]),
      placementSection(false, content.placement_advice.reason_disabled)
    ]
  }
}

function placementSection(enabled: boolean, reasonDisabled: string | null | undefined): ReportPresentationSection {
  return section('placement_advice', '安置建议', [
    field('placement_advice.enabled', '是否启用', enabled),
    field('placement_advice.reason_disabled', '未启用原因', reasonDisabled ?? null, {
      sensitivity: 'TEACHER_INTERNAL',
      exportPolicy: 'PAGE_ONLY'
    })
  ])
}
