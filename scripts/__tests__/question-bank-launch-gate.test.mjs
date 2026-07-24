import { describe, expect, it } from 'vitest'
import { checkQuestionBankLaunchGate } from '../lib/question-bank-launch-gate.mjs'

const MODULE_TYPES = [
  'FINE_MOTOR',
  'COGNITION',
  'RULE_EXECUTION',
  'EMOTION_REGULATION',
  'BASIC_SOCIAL',
  'SAFETY_OPERATION'
]

function buildQuestionRow({
  questionId,
  moduleType,
  questionType,
  status = 'ACTIVE',
  jobCode = 'SUPERMARKET_SHELVER',
  abilityTags = [moduleType]
}) {
  return {
    question_id: questionId,
    job_code: jobCode,
    bank_domain: 'BASE_ABILITY',
    module_type: moduleType,
    question_type: questionType,
    status,
    content_json: JSON.stringify({
      question_type: questionType,
      prompt: `${questionId} prompt`,
      assessment_point: `${moduleType} assessment point`,
      ability_tags: abilityTags
    })
  }
}

function buildPassingRows() {
  const rows = []
  let onlineCounter = 1
  let offlineCounter = 1

  for (const moduleType of MODULE_TYPES) {
    for (let i = 0; i < 3; i += 1) {
      rows.push(
        buildQuestionRow({
          questionId: `Q_BASE_${moduleType}_TF_${String(onlineCounter).padStart(3, '0')}`,
          moduleType,
          questionType: 'TRUE_FALSE'
        })
      )
      onlineCounter += 1
    }

    for (let i = 0; i < 2; i += 1) {
      rows.push(
        buildQuestionRow({
          questionId: `Q_BASE_${moduleType}_SC_${String(onlineCounter).padStart(3, '0')}`,
          moduleType,
          questionType: 'SINGLE_CHOICE'
        })
      )
      onlineCounter += 1
    }

    for (let i = 0; i < 1; i += 1) {
      rows.push(
        buildQuestionRow({
          questionId: `Q_BASE_${moduleType}_DRAG_${String(onlineCounter).padStart(3, '0')}`,
          moduleType,
          questionType: 'DRAG'
        })
      )
      onlineCounter += 1
    }

    for (let i = 0; i < 1; i += 1) {
      rows.push(
        buildQuestionRow({
          questionId: `Q_BASE_${moduleType}_SOFTWARE_${String(onlineCounter).padStart(3, '0')}`,
          moduleType,
          questionType: 'SOFTWARE_TASK'
        })
      )
      onlineCounter += 1
    }
  }

  for (let i = 0; i < 8; i += 1) {
    const moduleType = MODULE_TYPES[i % MODULE_TYPES.length]
    rows.push(
      buildQuestionRow({
        questionId: `Q_BASE_${moduleType}_OFFLINE_${String(offlineCounter).padStart(3, '0')}`,
        moduleType,
        questionType: 'OFFLINE_OPERATION'
      })
    )
    offlineCounter += 1
  }

  return rows
}

function findIssue(report, code, predicate = () => true) {
  return report.issues.find((issue) => issue.code === code && predicate(issue))
}

describe('question-bank launch gate', () => {
  it('6 大模块每模块 7 道线上题且线下题 8 道时通过', () => {
    const report = checkQuestionBankLaunchGate(buildPassingRows(), {
      jobCode: 'SUPERMARKET_SHELVER'
    })

    expect(report).toMatchObject({
      jobCode: 'SUPERMARKET_SHELVER',
      passed: true,
      issues: []
    })
    expect(report.summary.byModule.FINE_MOTOR.onlineActive).toBe(7)
    expect(report.summary.byModule.SAFETY_OPERATION.onlineActive).toBe(7)
    expect(report.summary.byQuestionType).toMatchObject({
      TRUE_FALSE: 18,
      SINGLE_CHOICE: 12,
      DRAG: 6,
      SOFTWARE_TASK: 6,
      OFFLINE_OPERATION: 8
    })
    expect(report.summary.byStatus).toMatchObject({
      ACTIVE: 50
    })
    expect(report.summary.offlineActive).toBe(8)
  })

  it('FINE_MOTOR 只有 6 道 ACTIVE 线上题时失败并指出缺口', () => {
    const rows = buildPassingRows().filter(
      (row) => !(row.module_type === 'FINE_MOTOR' && row.question_type === 'SOFTWARE_TASK' && row.question_id.endsWith('007'))
    )
    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: 'SUPERMARKET_SHELVER'
    })

    expect(report.passed).toBe(false)
    expect(findIssue(report, 'ONLINE_MODULE_INSUFFICIENT', (issue) => issue.moduleType === 'FINE_MOTOR')).toMatchObject({
      code: 'ONLINE_MODULE_INSUFFICIENT',
      moduleType: 'FINE_MOTOR',
      actual: 6,
      required: 7,
      missing: 1
    })
  })

  it('线下题只有 7 道时失败', () => {
    const rows = buildPassingRows().filter((row) => row.question_type !== 'OFFLINE_OPERATION' || !row.question_id.endsWith('008'))
    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: 'SUPERMARKET_SHELVER'
    })

    expect(report.passed).toBe(false)
    expect(findIssue(report, 'OFFLINE_OPERATION_INSUFFICIENT')).toMatchObject({
      code: 'OFFLINE_OPERATION_INSUFFICIENT',
      actual: 7,
      required: 8,
      missing: 1
    })
  })

  it('线下题 ability_tags 为空时失败', () => {
    const rows = buildPassingRows()
    const offlineIndex = rows.findIndex((row) => row.question_type === 'OFFLINE_OPERATION')
    rows[offlineIndex] = buildQuestionRow({
      questionId: rows[offlineIndex].question_id,
      moduleType: rows[offlineIndex].module_type,
      questionType: 'OFFLINE_OPERATION',
      abilityTags: []
    })

    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: 'SUPERMARKET_SHELVER'
    })

    expect(report.passed).toBe(false)
    expect(findIssue(report, 'OFFLINE_ABILITY_TAGS_REQUIRED')).toMatchObject({
      code: 'OFFLINE_ABILITY_TAGS_REQUIRED',
      questionId: rows[offlineIndex].question_id
    })
  })

  it('DRAFT 题不计入 ACTIVE 门禁统计', () => {
    const rows = buildPassingRows()
    const onlineIndex = rows.findIndex(
      (row) => row.module_type === 'FINE_MOTOR' && row.question_type === 'TRUE_FALSE'
    )
    rows[onlineIndex] = buildQuestionRow({
      questionId: rows[onlineIndex].question_id,
      moduleType: 'FINE_MOTOR',
      questionType: 'TRUE_FALSE',
      status: 'DRAFT'
    })

    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: 'SUPERMARKET_SHELVER'
    })

    expect(report.passed).toBe(false)
    expect(report.summary.byStatus).toMatchObject({
      ACTIVE: 49,
      DRAFT: 1
    })
    expect(findIssue(report, 'ONLINE_MODULE_INSUFFICIENT', (issue) => issue.moduleType === 'FINE_MOTOR')).toMatchObject({
      code: 'ONLINE_MODULE_INSUFFICIENT',
      moduleType: 'FINE_MOTOR',
      actual: 6,
      required: 7,
      missing: 1
    })
  })

  it('同一 job_code 的 JOB_SPECIFIC 题不会计入基础能力门禁', () => {
    const rows = buildPassingRows()
    rows.push({
      ...buildQuestionRow({
        questionId: 'M1_TF_999',
        moduleType: 'FINE_MOTOR',
        questionType: 'TRUE_FALSE'
      }),
      bank_domain: 'JOB_SPECIFIC'
    })

    const report = checkQuestionBankLaunchGate(rows, {
      jobCode: 'SUPERMARKET_SHELVER',
      bankDomain: 'BASE_ABILITY'
    })

    expect(report.passed).toBe(true)
    expect(report.summary.totalRows).toBe(50)
    expect(report.summary.byStatus).toMatchObject({
      ACTIVE: 50
    })
  })
})
