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
import { SAFETY_CONTEXT_PHASES, SAFETY_REASON_CODES } from './types/safety'

type FieldValue = ReportPresentationField['value']

const REPORT_JOB_LABELS: Record<string, string> = {
  SUPERMARKET_SHELVER: '超市理货员'
}

const REPORT_TASK_LABELS: Record<string, string> = {
  SHELVE_TASK: '拆箱与上架',
  UNBOX_AND_SHELVE: '拆箱与上架',
  UNBOXING_AND_SHELVING: '拆箱与上架'
}

const REPORT_LEVEL_LABELS: Record<string, string> = {
  LEVEL_COMPETENT: '当前示范任务表现较稳定',
  LEVEL_CONDITIONAL: '在明确支持或结构化提示下可完成',
  LEVEL_NOT_COMPETENT: '当前仍需专项训练和更多支持',
  LEVEL_FAIL_BY_SAFETY: '因安全红线终止，本次不形成普通能力结论'
}

const REPORT_BASE_LEVEL_LABELS: Record<string, string> = {
  LEVEL_COMPETENT: '达到要求',
  LEVEL_CONDITIONAL: '在支持下可完成',
  LEVEL_NOT_COMPETENT: '需要加强训练',
  LEVEL_FAIL_BY_SAFETY: '因安全红线终止，本次不形成普通能力结论'
}

const REPORT_USAGE_LABELS: Record<string, string> = {
  PILOT_ONLY: '仅供试点参考',
  FORMAL: '正式使用',
  MVP_DEMO_PROFILE_ONLY: '仅供学校演示参考'
}

const REPORT_SOURCE_SCOPE_LABELS: Record<string, string> = {
  BASE_ABILITY: '基础能力测评',
  JOB_SKILL: '岗位技能测评',
  TRAINING: '训练过程',
  MIXED: '多个业务环节',
  NO_BOUND_SESSION: '未绑定具体测评或训练过程'
}

const REPORT_TEXT_LABELS: Record<string, string> = {
  PILOT_ONLY: '仅供试点参考',
  MVP_DEMO_PROFILE_ONLY: '仅供学校演示参考',
  NO_BOUND_SESSION: '未绑定具体测评或训练过程',
  NOT_ELIGIBLE: '当前阶段暂不提供该建议',
  SAFETY_TERMINATION: '安全终止报告'
}

const REPORT_INTERNAL_TEXT_PATTERN = /^[A-Z][A-Z0-9_]+$/

const REPORT_SCHEMA_VERSION_LABELS: Record<string, string> = {
  'task-report-v1.1': '基础任务报告 1.1',
  'job-skill-report-v1.0': '岗位技能报告 1.0',
  'safety-termination-report-v1.0': '安全终止报告 1.0'
}

const REPORT_TITLE_REPLACEMENTS: readonly [string, string][] = [
  ['SUPERMARKET_SHELVER', '超市理货员'],
  ['SHELVE_TASK', '拆箱与上架'],
  ['UNBOX_AND_SHELVE', '拆箱与上架'],
  ['UNBOXING_AND_SHELVING', '拆箱与上架'],
  ['专业岗位测评报告', '岗位技能测评报告']
]

function lookupLabel(
  entries: readonly { value: string; label: string }[],
  value: string,
  fallback: string
): string {
  return entries.find((entry) => entry.value === value)?.label ?? fallback
}

export function reportJobLabel(value: string | null | undefined): string {
  return REPORT_JOB_LABELS[value?.trim() ?? ''] ?? '其他岗位'
}

export function reportTaskLabel(value: string | null | undefined): string {
  return REPORT_TASK_LABELS[value?.trim() ?? ''] ?? '其他任务'
}

export function reportLevelLabel(value: string | null | undefined): string {
  return REPORT_LEVEL_LABELS[value?.trim() ?? ''] ?? '等级待确认'
}

export function reportBaseLevelLabel(value: string | null | undefined): string {
  return REPORT_BASE_LEVEL_LABELS[value?.trim() ?? ''] ?? '等级待确认'
}

export function reportUsageLabel(value: string | null | undefined): string {
  return REPORT_USAGE_LABELS[value?.trim() ?? ''] ?? '使用范围待确认'
}

export function reportSourceScopeLabel(value: string | null | undefined): string {
  return REPORT_SOURCE_SCOPE_LABELS[value?.trim() ?? ''] ?? '来源范围待确认'
}

export function reportTextLabel(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) return '未说明'
  if (REPORT_TEXT_LABELS[normalized]) return REPORT_TEXT_LABELS[normalized]
  return REPORT_INTERNAL_TEXT_PATTERN.test(normalized) ? '内容说明待确认' : normalized
}

export function reportSafetyReasonLabel(value: string | null | undefined): string {
  return lookupLabel(SAFETY_REASON_CODES, value?.trim() ?? '', '安全原因待确认')
}

export function reportSafetyContextPhaseLabel(value: string | null | undefined): string {
  return lookupLabel(SAFETY_CONTEXT_PHASES, value?.trim() ?? '', '发生环节待确认')
}

export function reportSafetyStatusLabel(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    CONFIRMED: '已确认',
    RESOLVED: '已处理'
  }
  return labels[value?.trim() ?? ''] ?? '状态待确认'
}

export function reportSchemaVersionLabel(value: string | null | undefined): string {
  return REPORT_SCHEMA_VERSION_LABELS[value?.trim() ?? ''] ?? '报告版本待确认'
}

export function reportRevisionLabel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? `第 ${value} 版`
    : '版本待确认'
}

export function reportTitleLabel(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) return '任务报告'
  return REPORT_TITLE_REPLACEMENTS.reduce(
    (title, [internalValue, displayValue]) => title.replaceAll(internalValue, displayValue),
    normalized
  )
}

export const EXPORT_FIELD_ALLOWLIST = new Set<string>([
  'summary.student_display_name',
  'summary.scope',
  'summary.job',
  'summary.task',
  'summary.report_version',
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
  return value && value.length > 0 ? value.map(reportTextLabel).join('；') : '无'
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
        field('summary.usage', '使用范围', reportUsageLabel(content.assessment_meta.report_usage)),
        field('summary.report_version', '报告版本', reportSchemaVersionLabel(content.report_schema_version)),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('base_scores', '基础能力结果', [
        field('base_scores.ability.normalized_score', '基础测评标准分', numberOrNull(content.score_summary.ability_score.normalized_score)),
        field('base_scores.ability.level_result', '基础测评等级', reportBaseLevelLabel(content.score_summary.ability_score.level_result)),
        field('base_scores.training.normalized_score', '训练完成标准分', numberOrNull(content.score_summary.training_completion.normalized_score)),
        field('base_scores.training.level_result', '训练完成等级', reportBaseLevelLabel(content.score_summary.training_completion.level_result)),
        field('base_scores.operation.normalized_score', '实操通过标准分', numberOrNull(content.score_summary.operation_pass_rate.normalized_score)),
        field('base_scores.operation.level_result', '实操通过等级', reportBaseLevelLabel(content.score_summary.operation_pass_rate.level_result))
      ]),
      section('base_source', '来源闭环', [
        field('base_source.task_closure_id', '闭环编号', content.source_meta.task_closure_id, {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        }),
        field('base_source.cycle_no', '教学轮次', content.source_meta.cycle_no),
        field('base_source.closure_revision', '闭环版本', reportRevisionLabel(content.source_meta.closure_revision))
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
        field('summary.job', '岗位', reportJobLabel(content.assessment_meta.job_code)),
        field('summary.generated_at', '生成时间', content.generated_at),
        field('summary.usage', '使用范围', reportUsageLabel(content.administration_summary.report_usage)),
        field('summary.report_version', '报告版本', reportSchemaVersionLabel(content.report_schema_version)),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('job_overall', '岗位技能结果', [
        field('job_overall.raw_score', '原始分', content.overall_summary.raw_score),
        field('job_overall.max_score', '满分', content.overall_summary.max_score),
        field('job_overall.normalized_score', '标准分', content.overall_summary.normalized_score),
        field('job_overall.level_result', '等级', reportLevelLabel(content.overall_summary.level_result)),
        field('job_overall.safety_overridden', '安全覆盖', content.overall_summary.safety_overridden)
      ]),
      section('job_administration', '施测摘要', [
        field('job_administration.completion_ratio', '完成度', content.administration_summary.completion_ratio),
        field('job_administration.observation_completion_ratio', '观察完成度', content.administration_summary.observation_completion_ratio),
        field('job_administration.sitting_count', '测评次数', content.assessment_meta.sitting_count)
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
        field('summary.job', '岗位', reportJobLabel(content.incident_snapshot.job_code)),
        field('summary.task', '任务', reportTaskLabel(content.incident_snapshot.task_code)),
        field('summary.source_scope', '来源范围', reportSourceScopeLabel(content.source_scope)),
        field('summary.report_version', '报告版本', reportSchemaVersionLabel(content.report_schema_version)),
        field('summary.validity_limitations', '有效性限制', textList(content.validity_limitations), {
          sensitivity: 'TEACHER_INTERNAL',
          exportPolicy: 'PAGE_ONLY'
        })
      ]),
      section('safety_incident', '安全事实', [
        field('safety_incident.reason_code', '安全原因', reportSafetyReasonLabel(content.incident_snapshot.reason_code)),
        field('safety_incident.context_phase', '发生环节', reportSafetyContextPhaseLabel(content.incident_snapshot.context_phase)),
        field('safety_incident.occurred_at', '发生时间', content.incident_snapshot.occurred_at),
        field('safety_incident.status_at_generation', '生成时状态', reportSafetyStatusLabel(content.incident_snapshot.status_at_generation)),
        field('safety_incident.description', '事实描述', content.incident_snapshot.description, {
          sensitivity: 'PAGE_ONLY',
          exportPolicy: 'EXCLUDED'
        })
      ]),
      section('safety_result', '安全结论', [
        field('safety_result.level_result', '安全结论', reportLevelLabel(content.safety_summary.level_result)),
        field('safety_result.ordinary_report_blocked', '普通报告阻断', content.safety_summary.ordinary_report_blocked)
      ]),
      placementSection(false, content.placement_advice.reason_disabled)
    ]
  }
}

function placementSection(enabled: boolean, reasonDisabled: string | null | undefined): ReportPresentationSection {
  return section('placement_advice', '安置建议', [
    field('placement_advice.enabled', '是否启用', enabled),
    field('placement_advice.reason_disabled', '未启用原因', reasonDisabled == null ? null : reportTextLabel(reasonDisabled), {
      sensitivity: 'TEACHER_INTERNAL',
      exportPolicy: 'PAGE_ONLY'
    })
  ])
}
