import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash, questionSemanticHashContract } from './lib/job-skill-contract-hash.mjs'

const rootArg = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  source: resolve(root, 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json'),
  cases: feature('job-skill-shelver-298-rejected-11-reconsideration-cases-v1.json'),
  authority: feature('job-skill-shelver-298-disposition-authority-v1.json'),
  result: feature('job-skill-shelver-298-rejected-11-content-reconsideration-result-chen-xiaoqing-2026-07-21.json'),
  candidates: feature('job-skill-shelver-298-rejected-replacement-candidates-v2.json'),
  markdown: feature('job-skill-shelver-298-rejected-replacement-candidates-v2.md'),
  gate: feature('job-skill-shelver-298-rejected-replacement-review-gate-v1.json'),
  contentPacket: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1.html'),
  safetyPacket: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1.html'),
  contentResultSchema: feature('job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1.schema.json'),
  safetyResultSchema: feature('job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1.schema.json')
}
const expectedIds = ['M1_OB_048', 'M1_OP_042', 'M3_OP_056', 'M4_OP_043', 'M4_OP_044', 'M4_OP_045', 'M4_OP_046', 'M4_OP_047', 'M4_OP_048', 'M5_OP_048', 'M5_OP_055']
const expectedResultBytes = 18396
const expectedResultHash = 'sha256:8260b89205a6893569aeff45954cdffdeaa5463d5cad49be95e1514fbbe0ac9e'
const generatedAt = '2026-07-21T10:30:00+08:00'
const safetySensitiveIds = new Set(['M1_OB_048', 'M1_OP_042', 'M4_OP_043', 'M4_OP_048', 'M5_OP_048', 'M5_OP_055'])
const rel = (path) => path.slice(root.length + 1)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function indexBy(records, key, label) {
  const map = new Map()
  for (const record of records) {
    assert(record && typeof record[key] === 'string', `${label} contains invalid record`)
    assert(!map.has(record[key]), `${label} duplicate ${record[key]}`)
    map.set(record[key], record)
  }
  return map
}
function exactSet(actual, expected, label) {
  assert(actual.length === expected.length, `${label} count mismatch`)
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert([...actual].sort().join('\n') === [...expected].sort().join('\n'), `${label} coverage mismatch`)
}
function countBy(records, selector) {
  const counts = {}
  for (const record of records) counts[selector(record)] = (counts[selector(record)] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}
function getLabeledLine(lines, labels, questionId) {
  for (const label of labels) {
    const prefix = `${label}：`
    const line = lines.find((item) => item.startsWith(prefix))
    if (line) return { label, value: line.slice(prefix.length).trim() }
  }
  throw new Error(`${questionId} missing ${labels.join('/')}`)
}
function parsePlan(review) {
  const lines = review.review_note.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const proposedIdMatch = review.review_note.match(/建议新版\s+(M[1-6]_[A-Z]+_\d+_V2)：/)
  assert(proposedIdMatch, `${review.question_id} missing proposed V2 ID`)
  const type = getLabeledLine(lines, ['题型'], review.question_id).value.replace(/。$/, '')
  const prompt = getLabeledLine(lines, ['题干'], review.question_id).value
  const materials = getLabeledLine(lines, ['现场材料'], review.question_id).value
  const outcome = getLabeledLine(lines, ['唯一达标行为', '唯一映射', '唯一达标结果', '唯一结果'], review.question_id)
  const score2 = getLabeledLine(lines, ['2分'], review.question_id).value
  const score1 = getLabeledLine(lines, ['1分'], review.question_id).value
  const score0 = getLabeledLine(lines, ['0分'], review.question_id).value
  const boundary = getLabeledLine(lines, ['停止条件', '设置异常', '安全边界', '用途边界', '异常分支'], review.question_id)
  assert(proposedIdMatch[1] === `${review.question_id}_V2`, `${review.question_id} proposed ID mismatch`)
  assert(type === 'OFFLINE_OPERATION', `${review.question_id} replacement must be OFFLINE_OPERATION`)
  assert(/0次提示/.test(score2), `${review.question_id} score 2 must require zero prompts`)
  assert(/1次非指向性提示/.test(score1), `${review.question_id} score 1 must define one non-directive prompt`)
  assert(/指向性提示/.test(score0) && /2次及以上提示/.test(score0), `${review.question_id} score 0 must define prompt redlines`)
  return {
    question_id: proposedIdMatch[1], question_type: type, prompt, materials,
    unique_outcome_label: outcome.label, unique_outcome: outcome.value,
    scoring_thresholds: { score_0: score0, score_1: score1, score_2: score2 },
    boundary_label: boundary.label, boundary: boundary.value
  }
}

assert(existsSync(paths.result), `reviewer result missing: ${rel(paths.result)}`)
assert(statSync(paths.result).size === expectedResultBytes, 'Chen Xiaoqing reconsideration result byte count changed')
assert(hashFile(paths.result) === expectedResultHash, 'Chen Xiaoqing reconsideration result bytes changed')
const source = readJson(paths.source)
const cases = readJson(paths.cases)
const authority = readJson(paths.authority)
const result = readJson(paths.result)
const priorCandidateSet = existsSync(paths.candidates) ? readJson(paths.candidates) : null
const { case_set_hash: actualCaseSetHash, ...caseSetBody } = cases
assert(hashRecord(caseSetBody) === actualCaseSetHash, 'reconsideration case_set_hash drift')
assert(result.schema_version === 'job-skill-shelver-298-rejected-11-content-reconsideration-result-v1', 'review result schema_version mismatch')
assert(result.package_id === 'job-skill-shelver-298-rejected-11-content-reconsideration-packet-chen-xiaoqing-v1', 'review result package_id mismatch')
assert(result.case_set_id === cases.case_set_id && result.case_set_hash === cases.case_set_hash, 'review result case set mismatch')
assert(result.reviewer === '陈晓青', 'unexpected reviewer')
assert(!Number.isNaN(Date.parse(result.submitted_at)), 'submitted_at must be a valid date-time')
assert(result.summary?.total === 11 && result.summary?.pass_as_is === 0 && result.summary?.return_for_redesign === 11 && result.summary?.confirm_rejected === 0, 'review summary must be exactly 11 redesign returns')
exactSet(result.questions.map((item) => item.question_id), expectedIds, 'review result')

const sourceById = indexBy(source, 'question_id', 'source')
const casesById = indexBy(cases.questions, 'question_id', 'cases')
const authorityById = indexBy(authority.questions, 'source_question_id', 'authority')
const reviewById = indexBy(result.questions, 'question_id', 'review result')
function historicalInputHash(path) {
  return priorCandidateSet?.sources?.find((source) => source.path === rel(path))?.sha256 ?? hashFile(path)
}
const replacementQuestions = expectedIds.map((sourceQuestionId) => {
  const sourceRow = sourceById.get(sourceQuestionId)
  const caseRecord = casesById.get(sourceQuestionId)
  const authorityRecord = authorityById.get(sourceQuestionId)
  const review = reviewById.get(sourceQuestionId)
  assert(sourceRow && caseRecord && authorityRecord && review, `${sourceQuestionId} evidence missing`)
  assert(review.decision === 'RETURN_FOR_REDESIGN', `${sourceQuestionId} must remain rejected and request redesign`)
  assert(review.question_version === 1, `${sourceQuestionId} review version mismatch`)
  assert(review.source_record_hash === caseRecord.source_record_hash && review.source_record_hash === authorityRecord.source_record_hash, `${sourceQuestionId} source hash mismatch`)
  assert(review.reconsideration_record_hash === caseRecord.reconsideration_record_hash, `${sourceQuestionId} reconsideration record hash mismatch`)
  const originalRejectionPreserved = authorityRecord.disposition === 'REJECTED' && authorityRecord.current_question_id === null
  const approvedReplacementRecorded = authorityRecord.disposition === 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION' &&
    authorityRecord.current_question_id && authorityRecord.activation_authority === 'NONE'
  assert(originalRejectionPreserved || approvedReplacementRecorded, `${sourceQuestionId} authority must preserve the rejected original or its review-only replacement`)
  const plan = parsePlan(review)
  const originalContent = JSON.parse(sourceRow.content_json)
  const originalScoring = JSON.parse(sourceRow.scoring_rule_json)
  const oldQuestion = {
    content: originalContent,
    scoring_rule: originalScoring,
    media_asset_id: sourceRow.media_asset_id,
    tool_asset_ids: sourceRow.tool_asset_ids_json ? JSON.parse(sourceRow.tool_asset_ids_json) : null,
    sensory_tags: sourceRow.sensory_tags_json ? JSON.parse(sourceRow.sensory_tags_json) : null,
    safety_sensitive: Boolean(sourceRow.safety_sensitive),
    safety_stop_conditions: null
  }
  const criteria = plan.unique_outcome.split('；').map((description, index) => ({ criterion_id: `r${index + 1}`, description: description.trim() })).filter((item) => item.description)
  const safetySensitive = safetySensitiveIds.has(sourceQuestionId)
  const proposedQuestion = {
    content: {
      question_type: 'OFFLINE_OPERATION',
      prompt: plan.prompt,
      assessment_point: `${sourceQuestionId}淘汰题替代岗位实操`,
      ability_tags: originalContent.ability_tags ?? ['RULE_EXECUTION'],
      note: `${plan.boundary_label}：${plan.boundary}`,
      source: originalContent.source,
      offline_tool_brief: plan.materials,
      rubric_criteria: criteria,
      professional_review: { required: true, status: 'PENDING', tracks: ['CONTENT', 'SAFETY_TECHNICAL'] },
      ...(sourceQuestionId === 'M5_OP_055' ? { administration: { variant_type: 'ROLE_PLAY', script_locked: true } } : {})
    },
    scoring_rule: {
      scoring_type: 'RUBRIC_BASED', max_score: 2,
      score_0_description: `0分：${plan.scoring_thresholds.score_0}`,
      score_1_description: `1分：${plan.scoring_thresholds.score_1}`,
      score_2_description: `2分：${plan.scoring_thresholds.score_2}`
    },
    media_asset_id: null, tool_asset_ids: null, sensory_tags: null,
    safety_sensitive: safetySensitive,
    safety_stop_conditions: safetySensitive ? `${plan.boundary_label}：${plan.boundary}` : null
  }
  const oldSemanticHash = questionSemanticHash(oldQuestion)
  const newSemanticHash = questionSemanticHash(proposedQuestion)
  assert(oldSemanticHash !== newSemanticHash, `${plan.question_id} must be semantically different from rejected V1`)
  const base = {
    question_id: plan.question_id,
    previous_question_id: sourceQuestionId,
    question_version: 2,
    source_question_id: sourceQuestionId,
    module: sourceQuestionId.slice(0, 2),
    question_type: 'OFFLINE_OPERATION',
    status: 'DRAFT_REPLACEMENT_REVIEW_REQUIRED',
    replacement_relationship: { rejected_original_remains_rejected: true, supersedes_original: false },
    structured_replacement_plan: plan,
    proposed_question: proposedQuestion,
    revision_rationale: `按陈晓青2026-07-21复议意见，将已淘汰的${sourceQuestionId}改为岗位真实、显性、可重复且可评分的新替代题。`,
    old_semantic_hash: oldSemanticHash,
    new_semantic_hash: newSemanticHash,
    source_record_hash: sourceRow ? hashRecord(sourceRow) : null,
    source_reconsideration_record_hash: caseRecord.reconsideration_record_hash,
    source_review_result_record_hash: hashRecord(review),
    required_review_tracks: ['CONTENT', 'SAFETY_TECHNICAL'],
    activation_authority: 'NONE'
  }
  assert(base.source_record_hash === authorityRecord.source_record_hash, `${sourceQuestionId} canonical source hash mismatch`)
  return { ...base, candidate_record_hash: hashRecord(base) }
}).sort((left, right) => left.question_id.localeCompare(right.question_id))

exactSet(replacementQuestions.map((item) => item.previous_question_id), expectedIds, 'replacement source set')
exactSet(replacementQuestions.map((item) => item.question_id), expectedIds.map((id) => `${id}_V2`), 'replacement candidate set')
assert(replacementQuestions.every((item) => item.proposed_question.content.rubric_criteria.length > 0), 'all replacements need rubric criteria')

const candidateSetBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-candidates-v2',
  candidate_set_id: 'job-skill-shelver-298-rejected-replacement-candidates-v2',
  status: 'DRAFT_REPLACEMENT_REVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.source, paths.cases, paths.authority, paths.result].map((path) => ({ path: rel(path), sha256: historicalInputHash(path) })),
  reviewer_result_original: { bytes: expectedResultBytes, sha256: expectedResultHash, reviewer: result.reviewer, submitted_at: result.submitted_at },
  semantic_hash_contract: questionSemanticHashContract,
  summary: { source_total: 298, current_retained_unchanged: 287, rejected_originals_unchanged: 11, replacement_v2_pending: 11, by_module: countBy(replacementQuestions, (item) => item.module), by_type: countBy(replacementQuestions, (item) => item.question_type) },
  authority: { changes_current_authority: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  questions: replacementQuestions
}
const candidateSet = { ...candidateSetBody, candidate_set_hash: hashRecord(candidateSetBody) }

const gateBody = {
  schema_version: 'job-skill-shelver-298-rejected-replacement-review-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-replacement-review-gate-v1',
  status: 'PENDING_REPLACEMENT_REVIEW', generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidates), candidate_set_hash: candidateSet.candidate_set_hash },
  required_review_tracks: ['CONTENT', 'SAFETY_TECHNICAL'],
  merge_rule: 'Each replacement V2 must pass content and safety-technical review before any separate authority amendment. Original V1 questions remain REJECTED.',
  summary: { total: 11, pending: 11, passed: 0, returned: 0 },
  boundaries: { existing_287_unchanged: true, rejected_originals_11_unchanged: true, phase4_authority_unchanged: true, runtime_database_unchanged: true, activation_sql_not_generated: true }
}
const gate = { ...gateBody, gate_hash: hashRecord(gateBody) }

function markdown() {
  const sections = replacementQuestions.map((item, index) => {
    const q = item.proposed_question
    return `## ${index + 1}. ${item.question_id}\n\n- 原淘汰题：\`${item.previous_question_id}\`（继续保持淘汰）\n- 题型：${item.question_type}\n- 新 semantic hash：\`${item.new_semantic_hash}\`\n- candidate record hash：\`${item.candidate_record_hash}\`\n\n**新题干**\n\n${q.content.prompt}\n\n**现场材料**\n\n${q.content.offline_tool_brief}\n\n**唯一达标行为或结果**\n\n${item.structured_replacement_plan.unique_outcome}\n\n**评分**\n\n- 2分：${item.structured_replacement_plan.scoring_thresholds.score_2}\n- 1分：${item.structured_replacement_plan.scoring_thresholds.score_1}\n- 0分：${item.structured_replacement_plan.scoring_thresholds.score_0}\n\n**异常或安全边界**\n\n${item.structured_replacement_plan.boundary_label}：${item.structured_replacement_plan.boundary}\n`
  })
  return `# 11道淘汰题的V2替代候选\n\n- 来源：陈晓青 2026-07-21 内容复议结果。\n- 当前状态：仅为DRAFT替代候选，原11道V1继续淘汰。\n- 生效条件：每道新题均需内容确认和安全技术审核；本文件不提供激活授权。\n- 保护边界：现有287道题、阶段四运行权威、数据库、激活SQL和delivery lock均未修改。\n\n${sections.join('\n---\n\n')}\n`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}
function compactReviewQuestion(item) {
  const q = item.proposed_question
  return {
    question_id: item.question_id,
    previous_question_id: item.previous_question_id,
    question_version: item.question_version,
    module: item.module,
    question_type: item.question_type,
    status: item.status,
    activation_authority: item.activation_authority,
    candidate_record_hash: item.candidate_record_hash,
    old_semantic_hash: item.old_semantic_hash,
    new_semantic_hash: item.new_semantic_hash,
    required_review_tracks: item.required_review_tracks,
    replacement_relationship: item.replacement_relationship,
    revision_rationale: item.revision_rationale,
    structured_replacement_plan: item.structured_replacement_plan,
    proposed_question: q
  }
}
function packageData(kind) {
  const content = kind === 'CONTENT'
  return {
    package_id: content
      ? 'job-skill-shelver-298-rejected-replacement-content-confirmation-packet-chen-xiaoqing-v1'
      : 'job-skill-shelver-298-rejected-replacement-safety-technical-review-packet-he-dong-v1',
    package_version: 1,
    schema_version: content
      ? 'job-skill-shelver-298-rejected-replacement-content-confirmation-result-v1'
      : 'job-skill-shelver-298-rejected-replacement-safety-technical-review-result-v1',
    reviewer: content
      ? { name: '陈晓青', track: 'CONTENT_CONFIRMATION', role: '内容确认' }
      : { name: '赫东', track: 'SAFETY_TECHNICAL_REVIEW', role: '安全与技术审核' },
    source: {
      candidate_set_id: candidateSet.candidate_set_id,
      candidate_set_hash: candidateSet.candidate_set_hash,
      candidate_set_file: rel(paths.candidates),
      candidate_set_status: candidateSet.status,
      generated_at: generatedAt,
      total: replacementQuestions.length
    },
    authority: {
      activation_authority_granted: false,
      can_activate_questions: false,
      runtime_database_change_allowed: false,
      activation_sql_generated: false,
      original_v1_remains_rejected: true,
      existing_287_unchanged: true
    },
    questions: replacementQuestions.map(compactReviewQuestion)
  }
}
function reviewFields(kind, item) {
  const id = item.question_id
  if (kind === 'CONTENT') {
    return `
      ${selectField(id, 'content_conclusion', '内容确认结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(id, 'occupational_authenticity', '岗位真实性', ['PASS:符合理货员现场', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(id, 'prompt_and_boundary', '题干与边界', ['PASS:清楚且边界明确', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(id, 'rubric_observability', 'rubric 可观察性', ['PASS:可观察可评分', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(id, 'material_feasibility', '现场材料可行性', ['PASS:材料可准备', 'RETURN_FOR_REVISION:需要修改'])}
      ${textField(id, 'content_note', '内容确认意见', '通过写“通过”；退回需说明具体修改点')}
      ${textField(id, 'required_revision', '如退回，要求修改为', '通过可写“无”')}
    `
  }
  return `
      ${selectField(id, 'safety_conclusion', '安全结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(id, 'technical_conclusion', '技术结论', ['PASS:通过', 'RETURN_FOR_REVISION:退回复修'])}
      ${selectField(id, 'renderer_feasibility', '线下/渲染执行可行性', ['PASS:可执行', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(id, 'data_contract_integrity', '数据合同完整性', ['PASS:通过', 'RETURN_FOR_REVISION:需要修改'])}
      ${selectField(id, 'safety_sensitive_decision', '安全敏感标记', ['KEEP:保持当前标记', 'ADD:应改为安全敏感', 'REMOVE:应取消安全敏感'])}
      ${textField(id, 'stop_condition_note', '停止条件审核', '通过写“通过”；如需修改，写明停止条件')}
      ${textField(id, 'technical_note', '技术审核意见', '通过写“通过”；退回需说明具体缺口')}
    `
}
function selectField(questionId, name, label, options) {
  return `<label><span>${escapeHtml(label)} *</span><select data-q="${escapeHtml(questionId)}" data-field="${escapeHtml(name)}" required><option value="">未选择</option>${options.map((option) => {
    const [value, text] = option.split(':')
    return `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`
  }).join('')}</select></label>`
}
function textField(questionId, name, label, placeholder) {
  return `<label class="wide"><span>${escapeHtml(label)} *</span><textarea data-q="${escapeHtml(questionId)}" data-field="${escapeHtml(name)}" rows="3" placeholder="${escapeHtml(placeholder)}" required></textarea></label>`
}
function packetHtml(kind) {
  const content = kind === 'CONTENT'
  const data = packageData(kind)
  const title = content ? '11道V2替代候选内容确认包（陈晓青）' : '11道V2替代候选安全技术审核包（赫东）'
  const cards = data.questions.map((item, index) => {
    const plan = item.structured_replacement_plan
    const q = item.proposed_question
    const criteria = q.content.rubric_criteria.map((criterion) => `<li>${escapeHtml(criterion.criterion_id)}：${escapeHtml(criterion.description)}</li>`).join('')
    return `<article id="${escapeHtml(item.question_id)}">
      <header class="card-head"><div><b>${index + 1}. ${escapeHtml(item.question_id)}</b><small>原题 ${escapeHtml(item.previous_question_id)} 继续淘汰 · ${escapeHtml(item.question_type)} · 激活权 ${escapeHtml(item.activation_authority)}</small></div><span data-status="${escapeHtml(item.question_id)}">待填写</span></header>
      <section class="grid">
        <div><h3>新题干</h3><p>${escapeHtml(q.content.prompt)}</p></div>
        <div><h3>现场材料</h3><p>${escapeHtml(q.content.offline_tool_brief)}</p></div>
        <div><h3>唯一达标行为或结果</h3><p>${escapeHtml(plan.unique_outcome)}</p></div>
        <div><h3>异常或安全边界</h3><p>${escapeHtml(plan.boundary_label)}：${escapeHtml(plan.boundary)}</p></div>
        <div><h3>rubric criteria</h3><ol>${criteria}</ol></div>
        <div><h3>评分阈值</h3><ul><li>2分：${escapeHtml(plan.scoring_thresholds.score_2)}</li><li>1分：${escapeHtml(plan.scoring_thresholds.score_1)}</li><li>0分：${escapeHtml(plan.scoring_thresholds.score_0)}</li></ul></div>
        <div class="wide"><h3>哈希绑定</h3><p class="hash">candidate_record_hash: ${escapeHtml(item.candidate_record_hash)}<br>new_semantic_hash: ${escapeHtml(item.new_semantic_hash)}</p></div>
      </section>
      <section class="review">${reviewFields(kind, item)}</section>
    </article>`
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#f5f7fb;color:#17202a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",Arial,sans-serif}body>header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #d7dde7;padding:16px 22px}h1{font-size:21px;margin:0 0 6px}.meta{font-size:13px;color:#5f6b7a;line-height:1.6}main{max-width:1120px;margin:0 auto;padding:18px 18px 80px}.notice{border-left:4px solid #b45309;background:#fff7ed;color:#7c2d12;padding:10px 12px;margin-bottom:14px}article{background:#fff;border:1px solid #d7dde7;border-radius:8px;margin:0 0 14px;padding:16px}.card-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #edf0f4;margin:-16px -16px 14px;padding:14px 16px}.card-head small{display:block;color:#5f6b7a;margin-top:4px}.card-head span{height:24px;border:1px solid #cbd5e1;border-radius:999px;padding:3px 10px;font-size:12px;color:#64748b}.card-head span.done{color:#15803d;border-color:#86efac}.card-head span.return{color:#b45309;border-color:#fbbf24}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid>div{border:1px solid #e5e7eb;border-radius:6px;padding:10px}.wide{grid-column:1/-1}h3{font-size:14px;margin:0 0 6px}p,li{line-height:1.55}.hash{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.review{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.review label span{display:block;font-weight:650;margin-bottom:5px}.review select,.review textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px;padding:8px;background:#fff}.toolbar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #d7dde7;padding:12px 18px;display:flex;gap:10px;align-items:center}.toolbar button{border:0;border-radius:6px;background:#0f766e;color:white;padding:10px 14px;font-weight:700}.toolbar button.secondary{background:#475569}.error{color:#b91c1c}@media(max-width:850px){.grid,.review{grid-template-columns:1fr}.card-head{display:block}.card-head span{display:inline-block;margin-top:8px}}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><div class="meta">本包只覆盖 11 道新 V2 替代候选；原 11 道 V1 继续淘汰；现有 287 道运行题、数据库、激活 SQL、delivery lock 均不变；本包不得授予激活权。</div></header>
<main><div class="notice">请逐题填写。浏览器会自动保存草稿；点击“校验并导出 JSON”后得到机器可读审核结果。</div>${cards}</main>
<div class="toolbar"><button id="export">校验并导出 JSON</button><button class="secondary" id="clear">清除本地草稿</button><span id="status"></span></div>
<script id="package-data" type="application/json">${scriptJson(data)}</script>
<script>
const DATA=JSON.parse(document.getElementById('package-data').textContent);
const KEY='svets:'+DATA.package_id+':draft';
const saved=JSON.parse(localStorage.getItem(KEY)||'{}');
function fields(qid){return [...document.querySelectorAll('[data-q="'+qid+'"]')]}
function collectQuestion(q){
  const values={};
  for(const el of fields(q.question_id)) values[el.dataset.field]=el.value.trim();
  const conclusion=DATA.reviewer.track==='CONTENT_CONFIRMATION'
    ? values.content_conclusion||''
    : ['safety_conclusion','technical_conclusion','renderer_feasibility','data_contract_integrity'].some(field=>values[field]==='RETURN_FOR_REVISION')
      ? 'RETURN_FOR_REVISION'
      : ['safety_conclusion','technical_conclusion','renderer_feasibility','data_contract_integrity'].every(field=>values[field]==='PASS')?'PASS':'';
  return {question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,activation_authority:q.activation_authority,conclusion,review_fields:values};
}
function collect(){return DATA.questions.map(collectQuestion)}
function refresh(){
  let done=0;
  for(const q of DATA.questions){
    const item=collectQuestion(q);
    const filled=Object.values(item.review_fields).every(Boolean);
    if(filled) done++;
    const status=document.querySelector('[data-status="'+q.question_id+'"]');
    status.textContent=filled?(item.conclusion==='RETURN_FOR_REVISION'?'退回':'完成'):'待填写';
    status.className=filled?(item.conclusion==='RETURN_FOR_REVISION'?'return':'done'):'';
  }
  document.getElementById('status').textContent='已完成 '+done+' / '+DATA.questions.length;
}
for(const q of DATA.questions){const draft=saved[q.question_id]||{};for(const el of fields(q.question_id)) el.value=draft[el.dataset.field]||''}
document.addEventListener('input',()=>{const draft={};for(const q of DATA.questions){draft[q.question_id]={};for(const el of fields(q.question_id)) draft[q.question_id][el.dataset.field]=el.value.trim()}localStorage.setItem(KEY,JSON.stringify(draft));refresh()});
document.getElementById('clear').onclick=()=>{if(confirm('确认清除本地草稿？')){localStorage.removeItem(KEY);location.reload()}};
document.getElementById('export').onclick=()=>{
  const questions=collect();
  const missing=questions.filter(q=>!q.conclusion||Object.values(q.review_fields).some(v=>!v));
  if(missing.length){document.getElementById('status').className='error';document.getElementById('status').textContent='尚有 '+missing.length+' 题未完成';return}
  const pass=questions.filter(q=>q.conclusion==='PASS').length;
  const result={schema_version:DATA.schema_version,package_id:DATA.package_id,candidate_set_id:DATA.source.candidate_set_id,candidate_set_hash:DATA.source.candidate_set_hash,reviewer:DATA.reviewer,submitted_at:new Date().toISOString(),authority:{activation_authority_granted:false,can_activate_questions:false,runtime_database_change_allowed:false,activation_sql_generated:false},summary:{total:questions.length,pass,return_for_revision:questions.length-pass},questions};
  const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=DATA.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);
  document.getElementById('status').className='';document.getElementById('status').textContent='已导出 JSON';
};
refresh();
</script>
</body>
</html>
`
}
function resultSchema(kind) {
  const data = packageData(kind)
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: kind === 'CONTENT' ? 'Rejected Replacement V2 Content Confirmation Result' : 'Rejected Replacement V2 Safety Technical Review Result',
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'authority', 'summary', 'questions'],
    properties: {
      schema_version: { const: data.schema_version },
      package_id: { const: data.package_id },
      candidate_set_id: { const: candidateSet.candidate_set_id },
      candidate_set_hash: { const: candidateSet.candidate_set_hash },
      reviewer: {
        type: 'object', additionalProperties: false, required: ['name', 'track', 'role'],
        properties: {
          name: { const: data.reviewer.name },
          track: { const: data.reviewer.track },
          role: { const: data.reviewer.role }
        }
      },
      submitted_at: { type: 'string', format: 'date-time' },
      authority: {
        type: 'object', additionalProperties: false,
        required: ['activation_authority_granted', 'can_activate_questions', 'runtime_database_change_allowed', 'activation_sql_generated'],
        properties: {
          activation_authority_granted: { const: false },
          can_activate_questions: { const: false },
          runtime_database_change_allowed: { const: false },
          activation_sql_generated: { const: false }
        }
      },
      summary: {
        type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'],
        properties: { total: { const: 11 }, pass: { type: 'integer', minimum: 0, maximum: 11 }, return_for_revision: { type: 'integer', minimum: 0, maximum: 11 } }
      },
      questions: {
        type: 'array', minItems: 11, maxItems: 11,
        items: {
          type: 'object', additionalProperties: false,
          required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'activation_authority', 'conclusion', 'review_fields'],
          properties: {
            question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V2$' },
            previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+$' },
            new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
            activation_authority: { const: 'NONE' },
            conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] },
            review_fields: { type: 'object', minProperties: 1, additionalProperties: { type: 'string', minLength: 1 } }
          }
        }
      }
    }
  }
}

const outputs = [
  [paths.candidates, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.markdown, markdown()],
  [paths.gate, `${JSON.stringify(gate, null, 2)}\n`],
  [paths.contentPacket, packetHtml('CONTENT')],
  [paths.safetyPacket, packetHtml('SAFETY_TECHNICAL')],
  [paths.contentResultSchema, `${JSON.stringify(resultSchema('CONTENT'), null, 2)}\n`],
  [paths.safetyResultSchema, `${JSON.stringify(resultSchema('SAFETY_TECHNICAL'), null, 2)}\n`]
]
for (const [path, expected] of outputs) {
  if (checkOnly) {
    assert(existsSync(path), `missing generated artifact: ${rel(path)}`)
    assert(readFileSync(path, 'utf8') === expected, `generated artifact drift: ${rel(path)}`)
  } else writeFileSync(path, expected)
}
console.log(`Rejected replacements V2 ${checkOnly ? 'verified' : 'built'}: 11 new DRAFT candidates, 11 originals remain rejected, authority unchanged.`)
