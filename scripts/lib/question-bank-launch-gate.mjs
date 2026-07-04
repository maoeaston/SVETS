const MODULE_TYPES = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

const ONLINE_QUESTION_TYPES = ['TRUE_FALSE', 'SINGLE_CHOICE', 'DRAG']
const ALL_QUESTION_TYPES = [...ONLINE_QUESTION_TYPES, 'OFFLINE_OPERATION']
const DEFAULT_JOB_CODE = 'SUPERMARKET_SHELVER'
const REQUIRED_ONLINE_PER_MODULE = 7
const REQUIRED_OFFLINE_COUNT = 8

function buildModuleSummary() {
  return Object.fromEntries(
    MODULE_TYPES.map((moduleType) => [
      moduleType,
      {
        total: 0,
        active: 0,
        onlineActive: 0,
        offlineActive: 0
      }
    ])
  )
}

function buildQuestionTypeSummary() {
  return Object.fromEntries(ALL_QUESTION_TYPES.map((questionType) => [questionType, 0]))
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0
}

function parseContentJson(contentJsonText) {
  try {
    return { ok: true, value: JSON.parse(contentJsonText) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid JSON' }
  }
}

export function checkQuestionBankLaunchGate(rows, options = {}) {
  const jobCode = options.jobCode ?? DEFAULT_JOB_CODE
  const scopedRows = rows.filter((row) => row.job_code === jobCode)
  const summary = {
    totalRows: scopedRows.length,
    byModule: buildModuleSummary(),
    byQuestionType: buildQuestionTypeSummary(),
    byStatus: {},
    offlineActive: 0
  }
  const issues = []

  for (const row of scopedRows) {
    if (summary.byModule[row.module_type]) {
      summary.byModule[row.module_type].total += 1
      if (row.status === 'ACTIVE') {
        summary.byModule[row.module_type].active += 1
      }
    }

    if (summary.byQuestionType[row.question_type] != null) {
      summary.byQuestionType[row.question_type] += 1
    }

    summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1

    if (row.status !== 'ACTIVE') {
      continue
    }

    if (ONLINE_QUESTION_TYPES.includes(row.question_type)) {
      if (summary.byModule[row.module_type]) {
        summary.byModule[row.module_type].onlineActive += 1
      }
      continue
    }

    if (row.question_type !== 'OFFLINE_OPERATION') {
      continue
    }

    summary.offlineActive += 1
    if (summary.byModule[row.module_type]) {
      summary.byModule[row.module_type].offlineActive += 1
    }

    const parsed = parseContentJson(row.content_json)
    if (!parsed.ok) {
      issues.push({
        code: 'OFFLINE_CONTENT_JSON_INVALID',
        questionId: row.question_id,
        reason: parsed.reason
      })
      continue
    }

    if (!isNonEmptyArray(parsed.value?.ability_tags)) {
      issues.push({
        code: 'OFFLINE_ABILITY_TAGS_REQUIRED',
        questionId: row.question_id
      })
    }
  }

  for (const moduleType of MODULE_TYPES) {
    const actual = summary.byModule[moduleType].onlineActive
    if (actual < REQUIRED_ONLINE_PER_MODULE) {
      issues.push({
        code: 'ONLINE_MODULE_INSUFFICIENT',
        moduleType,
        actual,
        required: REQUIRED_ONLINE_PER_MODULE,
        missing: REQUIRED_ONLINE_PER_MODULE - actual
      })
    }
  }

  if (summary.offlineActive < REQUIRED_OFFLINE_COUNT) {
    issues.push({
      code: 'OFFLINE_OPERATION_INSUFFICIENT',
      actual: summary.offlineActive,
      required: REQUIRED_OFFLINE_COUNT,
      missing: REQUIRED_OFFLINE_COUNT - summary.offlineActive
    })
  }

  return {
    jobCode,
    passed: issues.length === 0,
    issues,
    summary
  }
}

