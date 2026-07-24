import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const generatedAt = '2026-07-20T00:00:00+08:00'

const paths = {
  sourceManifest: resolve(root, 'doc/features/job-skill-shelver-298-source-manifest-v1.json'),
  candidates: resolve(root, 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json'),
  contentMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md'),
  safetyMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md'),
  contentJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.json'),
  safetyJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.json'),
  mergedJson: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20.json'),
  ledgerMarkdown: resolve(root, 'doc/features/job-skill-shelver-298-semantic-change-rereview-ledger-2026-07-20.md')
}

const rel = {
  candidates: 'doc/features/job-skill-shelver-298-question-revision-candidates-v1.json',
  contentMarkdown: 'doc/features/job-skill-shelver-298-semantic-change-content-rereview-result-chen-xiaoqing-2026-07-20.md',
  safetyMarkdown: 'doc/features/job-skill-shelver-298-semantic-change-safety-technical-rereview-result-he-dong-2026-07-20.md'
}

const questionTypes = ['SINGLE_CHOICE', 'TRUE_FALSE', 'DRAG', 'OFFLINE_OPERATION']
const modules = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hashRecord(value) {
  return sha256(JSON.stringify(canonical(value)))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function splitBlocks(markdown) {
  const matches = [...markdown.matchAll(/^## (\d+)\. (M[1-6]_[A-Z]+_\d+_V2) \| ([A-Z_]+)/gm)]
  assert(matches.length === 232, `Expected 232 question blocks, received ${matches.length}`)
  return matches.map((match, index) => {
    const start = match.index
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length
    return {
      index: Number(match[1]),
      question_id: match[2],
      question_type: match[3],
      text: markdown.slice(start, end)
    }
  })
}

function checkedValue(block, label, pairs) {
  const line = block.text.split('\n').find((item) => item.startsWith(`- ${label}：`))
  assert(line, `${block.question_id} missing ${label}`)
  const checked = pairs.filter(([, text]) => line.includes(`[x] ${text}`)).map(([value]) => value)
  assert(checked.length === 1, `${block.question_id} ${label} must have one checked value`)
  return checked[0]
}

function field(block, pattern, label = pattern) {
  const match = block.text.match(pattern)
  assert(match, `${block.question_id} missing ${label}`)
  return match[1]
}

function quoteAfter(block, heading, nextHeadings = []) {
  const start = block.text.indexOf(`- ${heading}：`)
  assert(start >= 0, `${block.question_id} missing ${heading}`)
  let end = block.text.length
  for (const next of nextHeadings) {
    const nextIndex = block.text.indexOf(`- ${next}：`, start + heading.length)
    if (nextIndex >= 0 && nextIndex < end) end = nextIndex
  }
  const section = block.text.slice(start, end)
  const lines = section.split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^>\s?/, '').trim())
    .filter(Boolean)
  assert(lines.length > 0, `${block.question_id} ${heading} must include reviewer note`)
  return lines.join('\n')
}

function baseFromBlock(block, reviewer, reviewedDate, sourceFile) {
  return {
    question_id: block.question_id,
    previous_question_id: field(block, /- 原题目 ID：`(M[1-6]_[A-Z]+_\d+)`/, 'previous_question_id'),
    question_version: Number(field(block, /- 新题目 ID \/ 版本：`M[1-6]_[A-Z]+_\d+_V2` \/ v(\d+)/, 'question_version')),
    source_question_id: field(block, /- 原题目 ID：`(M[1-6]_[A-Z]+_\d+)`/, 'source_question_id'),
    source_record_hash: field(block, /- 原始记录 hash：`(sha256:[a-f0-9]{64})`/, 'source_record_hash'),
    candidate_record_hash: field(block, /- candidate_record_hash：`(sha256:[a-f0-9]{64})`/, 'candidate_record_hash'),
    reviewer,
    reviewed_date: reviewedDate,
    result_source_file: sourceFile
  }
}

function parseContent(markdown) {
  const reviewedDate = field({ question_id: 'content metadata', text: markdown }, /- 审核日期：(\d{4}-\d{2}-\d{2})/, 'reviewed_date')
  assert(markdown.includes('- 审核人：陈晓青'), 'content reviewer identity mismatch')
  return splitBlocks(markdown).map((block) => ({
    ...baseFromBlock(block, '陈晓青', reviewedDate, rel.contentMarkdown),
    question_type: block.question_type,
    content_conclusion: checkedValue(block, '内容复审结论', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回复修']]),
    prompt_review: checkedValue(block, '题干表达', [['PASS', '清楚自然'], ['RETURN_FOR_REVISION', '需要修改']]),
    occupational_authenticity_review: checkedValue(block, '职业真实性', [['PASS', '符合理货员实际'], ['RETURN_FOR_REVISION', '需要修改或补充边界']]),
    answer_or_rubric_review: checkedValue(block, '答案或 rubric', [['PASS', '唯一且可判定'], ['RETURN_FOR_REVISION', '需要修改']]),
    material_tool_review: checkedValue(block, '素材与工具', [['PASS', '足够制作和施测'], ['RETURN_FOR_REVISION', '需要补充'], ['NOT_REQUIRED', '本题不需要']]),
    safety_marker_decision: checkedValue(block, '安全敏感标记', [['KEEP', '保持当前标记'], ['ADD', '应标记为安全敏感'], ['REMOVE', '应取消安全敏感']]),
    review_note: quoteAfter(block, '复审意见', ['素材、工具或施测补充']),
    material_tool_requirement: quoteAfter(block, '素材、工具或施测补充')
  }))
}

function parseSafety(markdown) {
  const reviewedDate = field({ question_id: 'safety metadata', text: markdown }, /- 审核日期：(\d{4}-\d{2}-\d{2})/, 'reviewed_date')
  assert(markdown.includes('- 审核人：赫东'), 'safety reviewer identity mismatch')
  return splitBlocks(markdown).map((block) => ({
    ...baseFromBlock(block, '赫东', reviewedDate, rel.safetyMarkdown),
    question_type: block.question_type,
    rereview_conclusion: checkedValue(block, '复审最终结论', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回复修']]),
    safety_conclusion: checkedValue(block, '安全结论', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回复修']]),
    technical_conclusion: checkedValue(block, '技术结论', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回复修']]),
    renderer_review: checkedValue(block, 'Renderer 实际展示', [['PASS', '可展示'], ['RETURN_FOR_REVISION', '退回']]),
    data_contract_review: checkedValue(block, '数据合同与哈希', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回']]),
    material_tool_review: checkedValue(block, '素材与工具可执行性', [['PASS', '通过'], ['RETURN_FOR_REVISION', '退回']]),
    safety_sensitive_decision: checkedValue(block, '最终安全敏感标记', [['SENSITIVE', '安全敏感'], ['NOT_SENSITIVE', '非安全敏感']]),
    stop_conditions: quoteAfter(block, '停止条件', ['技术审核备注', '安全审核备注', 'Renderer 审核备注', '数据合同审核备注', '素材与工具审核备注', '最低复审要求']),
    technical_note: quoteAfter(block, '技术审核备注', ['安全审核备注', 'Renderer 审核备注', '数据合同审核备注', '素材与工具审核备注', '最低复审要求']),
    safety_note: quoteAfter(block, '安全审核备注', ['Renderer 审核备注', '数据合同审核备注', '素材与工具审核备注', '最低复审要求']),
    renderer_note: quoteAfter(block, 'Renderer 审核备注', ['数据合同审核备注', '素材与工具审核备注', '最低复审要求']),
    data_contract_note: quoteAfter(block, '数据合同审核备注', ['素材与工具审核备注', '最低复审要求']),
    material_tool_note: quoteAfter(block, '素材与工具审核备注', ['最低复审要求']),
    minimum_rereview_requirement: quoteAfter(block, '最低复审要求')
  }))
}

function countBy(items, values, select) {
  return Object.fromEntries(values.map((value) => [value, items.filter((item) => select(item) === value).length]))
}

function resultSummary(questions, conclusionKey) {
  const pass = questions.filter((question) => question[conclusionKey] === 'PASS').length
  const returnForRevision = questions.filter((question) => question[conclusionKey] === 'RETURN_FOR_REVISION').length
  return {
    total: questions.length,
    pass,
    return_for_revision: returnForRevision,
    by_type: Object.fromEntries(questionTypes.map((type) => {
      const rows = questions.filter((question) => question.question_type === type)
      return [type, { total: rows.length, pass: rows.filter((question) => question[conclusionKey] === 'PASS').length, return_for_revision: rows.filter((question) => question[conclusionKey] === 'RETURN_FOR_REVISION').length }]
    })),
    by_module: Object.fromEntries(modules.map((module) => {
      const rows = questions.filter((question) => question.question_id.startsWith(`${module}_`))
      return [module, { total: rows.length, pass: rows.filter((question) => question[conclusionKey] === 'PASS').length, return_for_revision: rows.filter((question) => question[conclusionKey] === 'RETURN_FOR_REVISION').length }]
    }))
  }
}

function sourceFiles(extra) {
  return [
    extra,
    { path: rel.candidates, sha256: fixed.candidatesHash, role: 'candidate_set' }
  ]
}

function validateAgainstCandidates(candidates, contentQuestions, safetyQuestions) {
  assert(candidates.summary.semantic_change_re_review_pending === 232, 'candidate summary must expect 232 re-review questions')
  const { candidate_set_hash: candidateSetHash, ...candidateSetBody } = candidates
  assert(candidateSetHash === hashRecord(candidateSetBody), 'candidate_set_hash drift')
  const expected = candidates.questions.filter((question) => question.revision_application.semantic_change_re_review_required)
  assert(expected.length === 232, `Expected 232 candidates, received ${expected.length}`)
  assert(new Set(expected.map((question) => question.question_id)).size === 232, 'candidate question_id duplicate')

  for (const question of expected) {
    const { candidate_record_hash: actual, ...record } = question
    assert(actual === hashRecord(record), `${question.question_id} candidate_record_hash mismatch`)
  }

  for (const [kind, rows] of [['content', contentQuestions], ['safety', safetyQuestions]]) {
    assert(rows.length === 232, `${kind} result must contain 232 questions`)
    assert(new Set(rows.map((row) => row.question_id)).size === 232, `${kind} question_id duplicate`)
    assert(JSON.stringify(rows.map((row) => row.question_id)) === JSON.stringify(expected.map((question) => question.question_id)), `${kind} question order or set mismatch`)
    for (let index = 0; index < expected.length; index += 1) {
      const row = rows[index]
      const candidate = expected[index]
      assert(row.question_id === candidate.question_id, `${kind} ${row.question_id} question_id mismatch`)
      assert(row.previous_question_id === candidate.previous_question_id, `${kind} ${row.question_id} previous_question_id mismatch`)
      assert(row.source_question_id === candidate.source_question_id, `${kind} ${row.question_id} source_question_id mismatch`)
      assert(row.question_version === candidate.question_version, `${kind} ${row.question_id} question_version mismatch`)
      assert(row.question_type === candidate.question_type, `${kind} ${row.question_id} question_type mismatch`)
      assert(row.source_record_hash === candidate.source_record_hash, `${kind} ${row.question_id} source_record_hash mismatch`)
      assert(row.candidate_record_hash === candidate.candidate_record_hash, `${kind} ${row.question_id} candidate_record_hash mismatch`)
    }
  }
}

const sourceManifest = readJson(paths.sourceManifest)
const acceptedArtifacts = new Map(sourceManifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]))
const candidatesText = readFileSync(paths.candidates, 'utf8')
const contentMarkdownText = readFileSync(paths.contentMarkdown, 'utf8')
const safetyMarkdownText = readFileSync(paths.safetyMarkdown, 'utf8')

const fixed = {
  candidatesHash: sha256(candidatesText),
  contentMarkdownHash: sha256(contentMarkdownText),
  safetyMarkdownHash: sha256(safetyMarkdownText)
}
assert(fixed.contentMarkdownHash === acceptedArtifacts.get('content_rereview_original')?.sha256, 'Content re-review original hash is not accepted by source manifest')
assert(fixed.safetyMarkdownHash === acceptedArtifacts.get('safety_rereview_original')?.sha256, 'Safety re-review original hash is not accepted by source manifest')

const candidates = JSON.parse(candidatesText)
const contentQuestions = parseContent(contentMarkdownText)
const safetyQuestions = parseSafety(safetyMarkdownText)

validateAgainstCandidates(candidates, contentQuestions, safetyQuestions)

const contentSummary = resultSummary(contentQuestions, 'content_conclusion')
const safetySummary = resultSummary(safetyQuestions, 'rereview_conclusion')
assert(contentSummary.pass === 22 && contentSummary.return_for_revision === 210, 'content summary mismatch')
assert(safetySummary.pass === 22 && safetySummary.return_for_revision === 210, 'safety summary mismatch')

const candidateSet = {
  candidate_set_id: candidates.candidate_set_id,
  candidate_set_hash: candidates.candidate_set_hash,
  candidate_set_file: rel.candidates,
  candidate_set_file_hash: fixed.candidatesHash
}

const contentResult = {
  schema_version: 'job-skill-shelver-298-semantic-change-content-rereview-result-v1',
  result_id: 'job-skill-shelver-298-semantic-change-content-rereview-chen-xiaoqing-2026-07-20',
  status: 'INGESTED_REVIEWER_MARKDOWN',
  package: {
    package_id: 'job-skill-shelver-298-semantic-change-content-rereview-packet-chen-xiaoqing-v1',
    package_version: 1
  },
  candidate_set: candidateSet,
  reviewer: {
    name: '陈晓青',
    role: '内容与职业真实性复审',
    reviewed_date: '2026-07-20',
    submitted_at: generatedAt
  },
  source_files: sourceFiles({ path: rel.contentMarkdown, sha256: fixed.contentMarkdownHash, role: 'reviewer_submitted_markdown' }),
  summary: contentSummary,
  questions: contentQuestions.map(({ question_type, ...question }) => question)
}

const safetyResult = {
  schema_version: 'job-skill-shelver-298-semantic-change-safety-technical-rereview-result-v1',
  result_id: 'job-skill-shelver-298-semantic-change-safety-technical-rereview-he-dong-2026-07-20',
  status: 'INGESTED_REVIEWER_MARKDOWN',
  package: {
    package_id: 'job-skill-shelver-298-semantic-change-safety-technical-rereview-packet-he-dong-v1',
    package_version: 1
  },
  candidate_set: candidateSet,
  reviewer: {
    name: '赫东',
    role: '安全与技术复审',
    reviewed_date: '2026-07-20',
    submitted_at: generatedAt
  },
  source_files: sourceFiles({ path: rel.safetyMarkdown, sha256: fixed.safetyMarkdownHash, role: 'reviewer_submitted_markdown' }),
  summary: safetySummary,
  questions: safetyQuestions.map(({ question_type, ...question }) => question)
}

const safetyById = new Map(safetyQuestions.map((question) => [question.question_id, question]))
const mergedQuestions = contentQuestions.map((contentQuestion) => {
  const safetyQuestion = safetyById.get(contentQuestion.question_id)
  assert(safetyQuestion, `${contentQuestion.question_id} missing safety result`)
  const passed = contentQuestion.content_conclusion === 'PASS' && safetyQuestion.rereview_conclusion === 'PASS'
  const blockingReasons = [
    contentQuestion.content_conclusion === 'PASS' ? null : 'CONTENT_RETURN_FOR_REVISION',
    safetyQuestion.safety_conclusion === 'PASS' ? null : 'SAFETY_RETURN_FOR_REVISION',
    safetyQuestion.technical_conclusion === 'PASS' ? null : 'TECHNICAL_RETURN_FOR_REVISION',
    safetyQuestion.renderer_review === 'PASS' ? null : 'RENDERER_RETURN_FOR_REVISION',
    safetyQuestion.data_contract_review === 'PASS' ? null : 'DATA_CONTRACT_RETURN_FOR_REVISION',
    safetyQuestion.material_tool_review === 'PASS' ? null : 'MATERIAL_TOOL_RETURN_FOR_REVISION'
  ].filter(Boolean)
  return {
    question_id: contentQuestion.question_id,
    previous_question_id: contentQuestion.previous_question_id,
    question_version: contentQuestion.question_version,
    source_question_id: contentQuestion.source_question_id,
    source_record_hash: contentQuestion.source_record_hash,
    candidate_record_hash: contentQuestion.candidate_record_hash,
    question_type: contentQuestion.question_type,
    content_conclusion: contentQuestion.content_conclusion,
    safety_rereview_conclusion: safetyQuestion.rereview_conclusion,
    safety_conclusion: safetyQuestion.safety_conclusion,
    technical_conclusion: safetyQuestion.technical_conclusion,
    renderer_review: safetyQuestion.renderer_review,
    data_contract_review: safetyQuestion.data_contract_review,
    material_tool_review: safetyQuestion.material_tool_review,
    rereview_gate_status: passed ? 'PASSED' : 'RETURN_FOR_REVISION',
    candidate_runtime_status: 'DRAFT',
    blocking_reasons: blockingReasons
  }
})

const mergedSummary = {
  total: mergedQuestions.length,
  passed: mergedQuestions.filter((question) => question.rereview_gate_status === 'PASSED').length,
  return_for_revision: mergedQuestions.filter((question) => question.rereview_gate_status === 'RETURN_FOR_REVISION').length,
  by_type: Object.fromEntries(questionTypes.map((type) => {
    const rows = mergedQuestions.filter((question) => question.question_type === type)
    return [type, {
      total: rows.length,
      passed: rows.filter((question) => question.rereview_gate_status === 'PASSED').length,
      return_for_revision: rows.filter((question) => question.rereview_gate_status === 'RETURN_FOR_REVISION').length
    }]
  })),
  blocking_reason_counts: Object.fromEntries(['CONTENT_RETURN_FOR_REVISION', 'SAFETY_RETURN_FOR_REVISION', 'TECHNICAL_RETURN_FOR_REVISION', 'RENDERER_RETURN_FOR_REVISION', 'DATA_CONTRACT_RETURN_FOR_REVISION', 'MATERIAL_TOOL_RETURN_FOR_REVISION'].map((reason) => [
    reason,
    mergedQuestions.filter((question) => question.blocking_reasons.includes(reason)).length
  ]))
}

const mergedGate = {
  schema_version: 'job-skill-shelver-298-semantic-change-rereview-merged-gate-v1',
  gate_id: 'job-skill-shelver-298-semantic-change-rereview-merged-gate-2026-07-20',
  status: 'REVIEW_RESULTS_RECEIVED',
  generated_at: generatedAt,
  candidate_set: candidateSet,
  source_result_ids: [contentResult.result_id, safetyResult.result_id],
  source_files: [
    ...contentResult.source_files,
    ...safetyResult.source_files.filter((file) => file.path !== rel.candidates)
  ],
  summary: mergedSummary,
  activation_authority: {
    may_activate: false,
    reason: '复审结果仅允许通过题进入下一轮候选处理；不得写运行库、不得生成激活 SQL。退回复修题继续保持 DRAFT。'
  },
  questions: mergedQuestions
}

function tableRows(summary) {
  return questionTypes.map((type) => {
    const row = summary.by_type[type]
    return `| ${type} | ${row.total} | ${row.passed ?? row.pass} | ${row.return_for_revision} |`
  }).join('\n')
}

const ledger = `# 232道语义变化候选复审结果接收留档

**生成时间：** ${generatedAt}  
**候选集：** \`${candidateSet.candidate_set_id}\`  
**候选集 hash：** \`${candidateSet.candidate_set_hash}\`  
**候选集文件 hash：** \`${candidateSet.candidate_set_file_hash}\`

## 原件

- 陈晓青：\`${rel.contentMarkdown}\`（${fixed.contentMarkdownHash}）
- 赫东：\`${rel.safetyMarkdown}\`（${fixed.safetyMarkdownHash}）

## 接收校验

- 覆盖题数：232 / 232
- 新题目 ID、原题目 ID、题型、原始记录 hash、\`candidate_record_hash\` 与候选集逐题一致
- 审核人身份与审核日期：陈晓青 / 赫东，2026-07-20
- 候选记录 hash 已按候选 JSON 规范化重算，无漂移
- 两份结果均为 Markdown 原件，已固化为 JSON；Markdown 不作为机器权威结果

## 陈晓青内容复审汇总

| 题型 | 总数 | 通过 | 退回复修 |
|---|---:|---:|---:|
${tableRows(contentSummary)}

## 赫东安全与技术复审汇总

| 题型 | 总数 | 通过 | 退回复修 |
|---|---:|---:|---:|
${tableRows(safetySummary)}

## 合并门禁

| 题型 | 总数 | 两方均通过 | 退回复修 |
|---|---:|---:|---:|
${tableRows(mergedSummary)}

**合并结论：** ${mergedSummary.passed} 题两方均通过，${mergedSummary.return_for_revision} 题继续退回复修。所有 232 题仍不得激活；退回题保持 \`DRAFT\`，通过题也只能进入下一步候选处理，不能直接写运行库或生成激活 SQL。
`

writeJson(paths.contentJson, contentResult)
writeJson(paths.safetyJson, safetyResult)
writeJson(paths.mergedJson, mergedGate)
writeFileSync(paths.ledgerMarkdown, ledger)

console.log(`[job-skill-298-rereview-results] content=${contentSummary.pass}/${contentSummary.return_for_revision}`)
console.log(`[job-skill-298-rereview-results] safety=${safetySummary.pass}/${safetySummary.return_for_revision}`)
console.log(`[job-skill-298-rereview-results] merged=${mergedSummary.passed}/${mergedSummary.return_for_revision}`)
