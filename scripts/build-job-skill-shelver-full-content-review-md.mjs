import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json')
const v2Path = resolve(root, 'doc/features/archive/job-skill-shelver-pilot-r0-v1-v2/job-skill-shelver-pilot-revision-candidates-v2.json')
const v3Path = resolve(root, 'doc/features/job-skill-shelver-pilot-revision-candidates-v3.json')
const outputPath = resolve(root, 'doc/features/job-skill-shelver-298-question-content-review-packet-remaining-274-v1.md')

const sourceQuestions = JSON.parse(readFileSync(sourcePath, 'utf8'))
const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))
const v3 = JSON.parse(readFileSync(v3Path, 'utf8'))

if (!Array.isArray(sourceQuestions) || sourceQuestions.length !== 298) {
  throw new Error(`Expected 298 source questions, received ${sourceQuestions?.length ?? 'invalid data'}`)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function escapeCell(value) {
  if (value === null || value === undefined || value === '') return '无'
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function inline(value) {
  if (value === null || value === undefined || value === '') return '无'
  return String(value).replaceAll('\n', '；')
}

function sourceText(value) {
  const text = inline(value).replaceAll('`', '\\`')
  return text === '无' ? text : `\`${text}\``
}

function parseJson(value, questionId, field) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${questionId} has invalid ${field}: ${error.message}`)
  }
}

const rawIds = new Set(sourceQuestions.map((question) => question.question_id))
const versionedQuestions = new Map(
  [...v2.questions, ...v3.questions].map((question) => [question.question_id, question])
)

function findRawSourceId(question) {
  const seen = new Set()
  let current = question

  while (current && !seen.has(current.question_id)) {
    seen.add(current.question_id)
    if (rawIds.has(current.question_id)) return current.question_id

    const parents = [current.previous_question_id, current.provenance?.based_on_question_id].filter(Boolean)
    const rawParent = parents.find((questionId) => rawIds.has(questionId))
    if (rawParent) return rawParent

    current = parents.map((questionId) => versionedQuestions.get(questionId)).find(Boolean)
  }

  return null
}

const exclusions = v3.questions.map((question) => ({
  currentQuestionId: question.question_id,
  rawSourceQuestionId: findRawSourceId(question)
}))
const excludedRawIds = new Set(exclusions.map((item) => item.rawSourceQuestionId).filter(Boolean))

if (v3.questions.length !== 24 || excludedRawIds.size !== 24 || exclusions.some((item) => !item.rawSourceQuestionId)) {
  throw new Error(`Expected 24 mapped Pilot exclusions, received ${excludedRawIds.size}`)
}

const reviewQuestions = sourceQuestions.filter((question) => !excludedRawIds.has(question.question_id))
if (reviewQuestions.length !== 274) {
  throw new Error(`Expected 274 review questions after exclusion, received ${reviewQuestions.length}`)
}

const typeLabels = {
  SINGLE_CHOICE: '单项选择',
  TRUE_FALSE: '判断题',
  DRAG: '拖拽排序',
  OFFLINE_OPERATION: '线下实操或观察'
}

function moduleOf(question) {
  return question.question_id.split('_')[0]
}

function renderOptions(content) {
  if (!Array.isArray(content.options) || content.options.length === 0) return '无'
  return content.options.map((option) => `- 选项 \`${option.key}\`：${sourceText(option.text)}`).join('\n')
}

function renderDrag(content) {
  if (!Array.isArray(content.drag_items) || !Array.isArray(content.drop_zones)) return '无'
  const labels = new Map(content.drag_items.map((item) => [item.item_id, item.label]))
  return content.drop_zones.map((zone) => {
    const accepted = (zone.accepts ?? []).map((itemId) => `${itemId}（${labels.get(itemId) ?? '未找到标签'}）`).join('、')
    return `- 位置 \`${zone.zone_id}\`，${sourceText(zone.label)}：${sourceText(accepted || '无')}`
  }).join('\n')
}

function renderRubric(content, scoring) {
  const criteria = Array.isArray(content.rubric_criteria)
    ? content.rubric_criteria.map((criterion) => `- 指标 \`${criterion.criterion_id ?? '未编号'}\`：${sourceText(criterion.description)}`).join('\n')
    : '无'
  const anchors = [0, 1, 2]
    .map((score) => scoring[`score_${score}_description`] ? `- ${score} 分：${sourceText(scoring[`score_${score}_description`])}` : null)
    .filter(Boolean)
    .join('\n')
  return `${criteria}\n\n评分描述：\n${anchors || '无'}`
}

function answerLabel(value) {
  if (value === true) return '正确（true）'
  if (value === false) return '错误（false）'
  return inline(value)
}

function renderQuestion(question, sequence) {
  const content = parseJson(question.content_json, question.question_id, 'content_json')
  const scoring = parseJson(question.scoring_rule_json, question.question_id, 'scoring_rule_json')
  const sensoryTags = question.sensory_tags_json
    ? parseJson(question.sensory_tags_json, question.question_id, 'sensory_tags_json')
    : null
  const toolAssetIds = question.tool_asset_ids_json
    ? parseJson(question.tool_asset_ids_json, question.question_id, 'tool_asset_ids_json')
    : null

  const parts = [
    `### ${sequence}. ${question.question_id} | ${typeLabels[question.question_type] ?? question.question_type}`,
    '',
    '| 项目 | 原始记录 |',
    '|---|---|',
    `| 原始题目 ID / 版本 | \`${question.question_id}\` / ${question.version} |`,
    `| 原始记录 hash | \`${hash(question)}\` |`,
    `| 模块 | ${moduleOf(question)} |`,
    `| 历史导出能力字段 | \`${escapeCell(question.module_type)}\` |`,
    `| 难度 | ${question.difficulty_level} |`,
    `| 原始导出状态 | ${question.status}，仅作来源记录，不代表当前可激活 |`,
    `| 安全敏感标记 | ${question.safety_sensitive === 1 ? '是，需重点检查' : '否，仍需人工判断是否漏标'} |`,
    `| 感官标签 | ${sourceText(Array.isArray(sensoryTags) ? sensoryTags.join('、') : sensoryTags)} |`,
    `| 素材 ID | ${sourceText(question.media_asset_id)} |`,
    `| 工具资产 ID | ${sourceText(Array.isArray(toolAssetIds) ? toolAssetIds.join('、') : toolAssetIds)} |`,
    `| 评分类型 / 最高分 | ${sourceText(scoring.scoring_type)} / ${escapeCell(scoring.max_score)} |`,
    '',
    '#### 题目内容',
    '',
    `> 原始题干：${sourceText(content.prompt)}`,
    '',
    `- 考查点：${sourceText(content.assessment_point)}`,
    `- 能力标签：${sourceText(Array.isArray(content.ability_tags) ? content.ability_tags.join('、') : content.ability_tags)}`,
    `- 素材说明：${sourceText(content.media_brief)}`,
    `- 线下工具：${sourceText(content.offline_tool_brief)}`,
    `- 原始备注：${sourceText(content.note)}`,
    ''
  ]

  if (question.question_type === 'SINGLE_CHOICE') {
    parts.push('选项：', '', renderOptions(content), '', `答案候选：${sourceText(answerLabel(content.expected_answer))}`, '')
  } else if (question.question_type === 'TRUE_FALSE') {
    parts.push(`答案候选：${sourceText(answerLabel(content.expected_answer))}`, '')
  } else if (question.question_type === 'DRAG') {
    parts.push('拖拽项：', '')
    parts.push(...(content.drag_items ?? []).map((item) => `- 拖拽项 \`${item.item_id}\`：${sourceText(item.label)}`))
    parts.push('', '目标位置与候选正确映射：', '', renderDrag(content), '', `原始评分模式：${sourceText(content.scoring_mode)}`, '')
  } else if (question.question_type === 'OFFLINE_OPERATION') {
    parts.push('观察指标与评分候选：', '', renderRubric(content, scoring), '')
  }

  parts.push(
    '#### 陈晓青填写区',
    '',
    '- 内容结论：[ ] 通过 / [ ] 退回修改 / [ ] 不纳入正式题库',
    '- 题干：[ ] 清楚、自然且适合学生 / [ ] 需要修改',
    '- 职业真实性：[ ] 符合理货员实际工作 / [ ] 需要修改或补充边界',
    '- 选项、答案或 rubric：[ ] 唯一且可判定 / [ ] 需要修改',
    '- 素材与工具说明：[ ] 足够制作和施测 / [ ] 需要补充 / [ ] 本题不需要',
    '- 安全内容：[ ] 标记正确 / [ ] 应增加安全敏感标记 / [ ] 应取消安全敏感标记',
    '- 建议答案或达标行为：',
    '',
    '  >',
    '',
    '- 修改意见或不纳入原因：',
    '',
    '  >',
    '',
    '- 素材、工具或施测补充要求：',
    '',
    '  >',
    '',
    '---',
    ''
  )

  return parts.join('\n')
}

const moduleStats = Object.fromEntries(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((module) => {
  const questions = reviewQuestions.filter((question) => moduleOf(question) === module)
  const byType = Object.fromEntries(Object.keys(typeLabels).map((type) => [type, questions.filter((question) => question.question_type === type).length]))
  return [module, { total: questions.length, ...byType }]
}))

const lines = [
  '# 超市理货员 298 题来源池内容全量审核包（剩余 274 题）',
  '',
  '- 审核人：陈晓青',
  '- 审核范围：298 题原始来源池中，排除 Pilot 已进入首轮审核流程的 24 个原始来源题后，剩余 274 题。',
  '- 来源文件：`doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json`',
  '- 生成日期：2026-07-19',
  '- 包状态：`CONTENT_REVIEW_INPUT_ONLY`，不是当前题目合同、激活清单或审核结论。',
  '',
  '## 填写说明',
  '',
  '请逐题勾选一项内容结论，并填写必要的修改意见。选择“通过”表示题干、职业真实性、答案或 rubric、素材工具说明和安全标记均可进入下一轮安全与技术审核；选择“退回修改”时，请写明需要修改的具体内容；选择“不纳入正式题库”时，请写明原因。',
  '',
  '本审核包保留原始导出内容，不会自动修正文案或答案。原始记录里的 `ACTIVE` 只是历史导出状态，不代表仓库当前题目已激活。陈晓青完成内容审核后，仍需赫东完成安全与技术审核，且任何题目只有绑定版本、hash 和正式审核结果后才能进入激活流程。',
  '',
  '本包排除的 24 个原始来源题已经进入 Pilot 首轮审核和后续版本修订流程。排除不表示 strategy v3 的 24 题已经全部复审通过，也不改变当前 fail-closed 激活门禁。',
  '',
  '## 数量核对',
  '',
  '| 模块 | 单项选择 | 判断题 | 拖拽排序 | 线下实操或观察 | 合计 |',
  '|---|---:|---:|---:|---:|---:|',
  ...Object.entries(moduleStats).map(([module, stats]) => `| ${module} | ${stats.SINGLE_CHOICE} | ${stats.TRUE_FALSE} | ${stats.DRAG} | ${stats.OFFLINE_OPERATION} | ${stats.total} |`),
  `| 合计 | ${reviewQuestions.filter((q) => q.question_type === 'SINGLE_CHOICE').length} | ${reviewQuestions.filter((q) => q.question_type === 'TRUE_FALSE').length} | ${reviewQuestions.filter((q) => q.question_type === 'DRAG').length} | ${reviewQuestions.filter((q) => q.question_type === 'OFFLINE_OPERATION').length} | ${reviewQuestions.length} |`,
  '',
  '## 已排除的 24 个原始来源题',
  '',
  '| 当前 Pilot 候选 | 298 题来源 ID |',
  '|---|---|',
  ...exclusions.map((item) => `| \`${item.currentQuestionId}\` | \`${item.rawSourceQuestionId}\` |`),
  '',
  '## 审核进度汇总（审核完成后填写）',
  '',
  '- 已审核：____ / 274',
  '- 通过：____',
  '- 退回修改：____',
  '- 不纳入正式题库：____',
  '- 审核日期：____年__月__日',
  '- 审核人签名：陈晓青 / ____________',
  '',
  ...['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].flatMap((module) => {
    const moduleQuestions = reviewQuestions.filter((question) => moduleOf(question) === module)
    return [
      `## ${module}（${moduleQuestions.length} 题）`,
      '',
      ...moduleQuestions.map((question, index) => renderQuestion(question, index + 1))
    ]
  })
]

writeFileSync(outputPath, `${lines.join('\n')}\n`)
console.log(`[job-skill-298-review] wrote ${outputPath}`)
console.log(`[job-skill-298-review] source=298 excluded=${excludedRawIds.size} review=${reviewQuestions.length}`)
