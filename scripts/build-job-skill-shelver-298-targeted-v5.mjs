import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash, questionSemanticHashContract } from './lib/job-skill-contract-hash.mjs'

const rootArg = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidatesV4: feature('job-skill-shelver-298-question-revision-candidates-v4.json'),
  mergedGateV4: feature('job-skill-shelver-298-targeted-v4-rereview-merged-gate-v1.json'),
  editorialInput: feature('job-skill-shelver-298-v5-editorial-input.json'),
  candidatesV5: feature('job-skill-shelver-298-question-revision-candidates-v5.json'),
  contentHtml: feature('job-skill-shelver-298-targeted-v5-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyHtml: feature('job-skill-shelver-298-targeted-v5-safety-technical-rereview-packet-he-dong-v1.html'),
  contentResultSchema: feature('job-skill-shelver-298-targeted-v5-content-rereview-result-v1.schema.json'),
  safetyResultSchema: feature('job-skill-shelver-298-targeted-v5-safety-technical-rereview-result-v1.schema.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v5-rereview-gate-v1.json')
}
const generatedAt = '2026-07-20T19:30:00+08:00'
const rel = (path) => path.slice(root.length + 1)
const readJson = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} missing: ${rel(path)}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const requiredIds = ['M1_OP_037_V4', 'M1_OP_038_V4', 'M2_OP_031_V4', 'M2_OP_038_V4', 'M2_OP_041_V4', 'M5_DG_034_V4']
const requiredEditorialFields = ['scenario_facts', 'answer', 'permissions', 'exception_branches', 'scoring_thresholds', 'safety_actions']

function indexBy(records, label) {
  assert(Array.isArray(records), `${label} must be an array`)
  const result = new Map()
  for (const record of records) {
    assert(record && typeof record.question_id === 'string', `${label} contains a record without question_id`)
    assert(!result.has(record.question_id), `${label} duplicate question_id: ${record.question_id}`)
    result.set(record.question_id, record)
  }
  return result
}

function countBy(records, selector) {
  const result = {}
  for (const record of records) {
    const key = selector(record)
    result[key] = (result[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

function validateEditorial(record, previous, gate) {
  assert(record.editorial_question_id === gate.next_question_id, `${record.editorial_question_id} does not match V4 gate next_question_id`)
  assert(record.previous_question_id === gate.question_id, `${record.question_id} previous_question_id mismatch`)
  assert(record.source_question_id === previous.source_question_id, `${record.question_id} source_question_id drift`)
  assert(record.question_type === previous.question_type, `${record.question_id} question_type drift`)
  assert(sameValues(record.failed_review_tracks, gate.failed_review_tracks), `${record.question_id} must retain exactly its failed review tracks`)
  for (const field of requiredEditorialFields) {
    assert(record[field] !== undefined, `${record.question_id} missing structured field ${field}`)
  }
  assert(Array.isArray(record.scenario_facts) && record.scenario_facts.length > 0, `${record.question_id} requires scenario facts`)
  assert(record.answer && typeof record.answer.expected_outcome === 'string' && record.answer.expected_outcome.trim(), `${record.question_id} requires an answer contract`)
  assert(Array.isArray(record.permissions) && record.permissions.length > 0, `${record.question_id} requires permission boundaries`)
  assert(Array.isArray(record.exception_branches) && record.exception_branches.length > 0, `${record.question_id} requires exception branches`)
  assert(['score_0', 'score_1', 'score_2'].every((key) => typeof record.scoring_thresholds?.[key] === 'string' && record.scoring_thresholds[key].trim()), `${record.question_id} requires score 0/1/2 thresholds`)
  assert(Array.isArray(record.safety_actions) && record.safety_actions.length > 0, `${record.question_id} requires safety actions`)
  assert(record.updates && typeof record.updates === 'object', `${record.question_id} requires deterministic updates`)
  assert(typeof record.revision_rationale === 'string' && record.revision_rationale.trim(), `${record.question_id} requires revision_rationale`)
}

function applyUpdates(previous, editorial) {
  const proposed = structuredClone(previous.proposed_question)
  if (editorial.updates.content) Object.assign(proposed.content, editorial.updates.content)
  if (editorial.updates.scoring_rule) Object.assign(proposed.scoring_rule, editorial.updates.scoring_rule)
  for (const key of ['media_asset_id', 'tool_asset_ids', 'sensory_tags', 'safety_sensitive', 'safety_stop_conditions']) {
    if (Object.hasOwn(editorial.updates, key)) proposed[key] = editorial.updates[key]
  }
  return proposed
}

function validateCandidate(record) {
  const proposed = record.proposed_question
  assert(proposed?.content?.question_type === record.question_type, `${record.question_id} content.question_type drift`)
  assert(typeof proposed.content.prompt === 'string' && proposed.content.prompt.trim(), `${record.question_id} prompt is required`)
  if (record.question_type === 'OFFLINE_OPERATION') {
    const criteria = proposed.content.rubric_criteria
    assert(Array.isArray(criteria) && criteria.length > 0, `${record.question_id} requires rubric criteria`)
    assert(new Set(criteria.map((criterion) => criterion.criterion_id)).size === criteria.length, `${record.question_id} rubric criterion IDs must be unique`)
    assert(/2次|两次/.test(proposed.scoring_rule.score_0_description), `${record.question_id} score 0 requires a prompt threshold`)
    assert(/1次|一次/.test(proposed.scoring_rule.score_1_description), `${record.question_id} score 1 requires a prompt threshold`)
    assert(/0次提示|无需提示|无提示/.test(proposed.scoring_rule.score_2_description), `${record.question_id} score 2 requires a prompt threshold`)
  } else if (record.question_type === 'DRAG') {
    const items = proposed.content.drag_items
    const zones = proposed.content.drop_zones
    assert(Array.isArray(items) && Array.isArray(zones) && items.length === zones.length, `${record.question_id} drag item/zone counts must match`)
    const itemIds = items.map((item) => item.item_id)
    const accepted = zones.flatMap((zone) => zone.accepts)
    assert(itemIds.every((id) => accepted.filter((acceptedId) => acceptedId === id).length === 1), `${record.question_id} drag items must map exactly once`)
  } else {
    assert(false, `${record.question_id} unsupported question type`)
  }
  if (proposed.safety_sensitive) assert(typeof proposed.safety_stop_conditions === 'string' && proposed.safety_stop_conditions.trim(), `${record.question_id} safety stop conditions required`)
}

function validateReturnedFixes(byId) {
  const m1037 = byId.get('M1_OP_037_V5')
  assert(!JSON.stringify(m1037.proposed_question).includes('同一SKU连续成面'), 'M1_OP_037_V5 retains the impossible same-SKU facing requirement')
  assert(m1037.proposed_question.content.assessment_point === '排面图与价签归位实操', 'M1_OP_037_V5 assessment point remains misaligned')

  const m1038 = byId.get('M1_OP_038_V5')
  assert(m1038.proposed_question.content.rubric_criteria.length === 6, 'M1_OP_038_V5 must expose six observable steps')
  assert(m1038.proposed_question.safety_stop_conditions.includes('未确认层板干燥即复位商品'), 'M1_OP_038_V5 must make wet restocking a stop condition')

  for (const id of ['M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5']) {
    const score0 = byId.get(id).proposed_question.scoring_rule.score_0_description
    assert(!/干扰品|把过期|把异常/.test(score0), `${id} still scores a nonexistent distractor`)
  }

  const m5034 = byId.get('M5_DG_034_V5')
  assert(m5034.proposed_question.content.prompt.includes('无反应且无正常呼吸'), 'M5_DG_034_V5 must lock the AED branch premise')
  assert(m5034.proposed_question.content.drag_items.some((item) => item.label.includes('确认无反应且无正常呼吸')), 'M5_DG_034_V5 must make response/breathing observation explicit')
  assert(m5034.proposed_question.safety_stop_conditions.includes('有反应或有正常呼吸'), 'M5_DG_034_V5 must state the normal-breathing exception branch')
}

const candidatesV4 = readJson(paths.candidatesV4, 'V4 candidates')
const mergedGateV4 = readJson(paths.mergedGateV4, 'V4 merged gate')
const editorialInput = readJson(paths.editorialInput, 'V5 editorial input')
const { candidate_set_hash: v4CandidateHash, ...v4CandidateBody } = candidatesV4
const { gate_hash: v4GateHash, ...v4GateBody } = mergedGateV4
assert(hashRecord(v4CandidateBody) === v4CandidateHash, 'V4 candidate_set_hash drift')
assert(hashRecord(v4GateBody) === v4GateHash, 'V4 merged gate_hash drift')
assert(editorialInput.schema_version === 'job-skill-shelver-298-v5-editorial-input-v1', 'V5 editorial schema_version mismatch')
assert(editorialInput.source_gate_id === mergedGateV4.gate_id, 'V5 editorial input points to another gate')

const previousById = indexBy(candidatesV4.questions, 'V4 candidates')
const gateById = indexBy(mergedGateV4.questions, 'V4 merged gate')
const returned = mergedGateV4.questions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const passed = mergedGateV4.questions.filter((question) => ['PASSED', 'PASSED_V3_REFERENCE'].includes(question.status))
assert(returned.length === 6 && passed.length === 139, 'V4 merged gate must contain 6 returned and 139 passed questions')
assert(sameValues(returned.map((question) => question.question_id).sort(), requiredIds), 'V5 source return set drift')
assert(editorialInput.questions.length === 6, 'V5 editorial input must contain exactly 6 questions')
const editorialByPreviousId = indexBy(editorialInput.questions.map((record) => ({ ...record, question_id: record.previous_question_id, editorial_question_id: record.question_id })), 'V5 editorial previous IDs')
assert(sameValues([...editorialByPreviousId.keys()].sort(), requiredIds), 'V5 editorial input must cover exactly the six returned V4 questions')

const v5Questions = returned.map((gate) => {
  const previous = previousById.get(gate.question_id)
  const editorial = editorialByPreviousId.get(gate.question_id)
  assert(previous && editorial, `${gate.question_id} missing V4 candidate or V5 editorial input`)
  validateEditorial(editorial, previous, gate)
  const proposedQuestion = applyUpdates(previous, editorial)
  const oldHash = questionSemanticHash(previous.proposed_question)
  const newHash = questionSemanticHash(proposedQuestion)
  assert(oldHash === previous.new_semantic_hash, `${gate.question_id} V4 semantic hash drift`)
  assert(newHash !== oldHash, `${editorial.editorial_question_id} semantic hash must change from V4`)
  const base = {
    question_id: editorial.editorial_question_id,
    previous_question_id: gate.question_id,
    question_version: 5,
    source_question_id: previous.source_question_id,
    module: previous.module,
    question_type: previous.question_type,
    status: 'DRAFT_FAILED_TRACK_REREVIEW_REQUIRED',
    structured_edit: Object.fromEntries(requiredEditorialFields.map((field) => [field, editorial[field]])),
    proposed_question: proposedQuestion,
    revision_rationale: editorial.revision_rationale,
    old_semantic_hash: oldHash,
    new_semantic_hash: newHash,
    source_candidate_record_hash: previous.candidate_record_hash,
    source_merged_record_hash: gate.merged_record_hash,
    required_review_tracks: gate.failed_review_tracks,
    activation_authority: 'NONE'
  }
  const record = { ...base, candidate_record_hash: hashRecord(base) }
  validateCandidate(record)
  return record
}).sort((left, right) => left.question_id.localeCompare(right.question_id))
const v5ById = indexBy(v5Questions, 'V5 candidates')
validateReturnedFixes(v5ById)

const passedReferences = passed.map((question) => ({
  question_id: question.question_id,
  question_version: question.question_version,
  semantic_hash: question.new_semantic_hash,
  candidate_record_hash: question.candidate_record_hash,
  merged_record_hash: question.merged_record_hash,
  status: question.status === 'PASSED_V3_REFERENCE' ? 'PASSED_V3_REFERENCE' : 'PASSED_V4_REFERENCE'
})).sort((left, right) => left.question_id.localeCompare(right.question_id))
const contentQuestions = v5Questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
const safetyQuestions = v5Questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))
assert(contentQuestions.length === 5 && safetyQuestions.length === 2, 'V5 failed-track review counts must be content=5 and safety=2')

const candidateSetBase = {
  schema_version: 'job-skill-shelver-298-question-revision-candidates-v5',
  candidate_set_id: 'job-skill-shelver-298-failed-track-question-revision-candidates-v5',
  status: 'DRAFT_FAILED_TRACK_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.candidatesV4, paths.mergedGateV4, paths.editorialInput].map((path) => ({ path: rel(path), sha256: hashFile(path) })),
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    source_total: 145,
    passed_reference_total: passedReferences.length,
    v5_total: v5Questions.length,
    content_rereview_total: contentQuestions.length,
    safety_technical_rereview_total: safetyQuestions.length,
    by_type: countBy(v5Questions, (question) => question.question_type)
  },
  authority: { releaseable: false, phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  passed_question_references: passedReferences,
  questions: v5Questions
}
const candidateSet = { ...candidateSetBase, candidate_set_hash: hashRecord(candidateSetBase) }

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function packetHtml(track, reviewer, questions) {
  const slug = track === 'CONTENT' ? 'content' : 'safety-technical'
  const packageId = `job-skill-shelver-298-targeted-v5-${slug}-rereview-packet-v1`
  const packageData = { package_id: packageId, reviewer, track, candidate_set_hash: candidateSet.candidate_set_hash, questions }
  const cards = questions.map((question, index) => `<article data-id="${question.question_id}"><h2>${index + 1}. ${question.question_id}</h2><p><b>上一版：</b>${question.previous_question_id}</p><p><b>本包范围：</b>只复审 ${track === 'CONTENT' ? '内容' : '安全技术'}失败轨道，不重审已通过轨道。</p><p><b>修订说明：</b>${escapeHtml(question.revision_rationale)}</p><details open><summary>结构化编辑依据</summary><pre>${escapeHtml(JSON.stringify(question.structured_edit, null, 2))}</pre></details><details><summary>查看 V5 题目</summary><pre>${escapeHtml(JSON.stringify(question.proposed_question, null, 2))}</pre></details><fieldset><legend>复审结论 *</legend><label><input type="radio" name="${question.question_id}" value="PASS"> 通过</label><label><input type="radio" name="${question.question_id}" value="RETURN_FOR_REVISION"> 退回复修</label></fieldset><label>审核意见<textarea data-note="${question.question_id}" rows="3"></textarea></label></article>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>定点 V5 ${track === 'CONTENT' ? '内容' : '安全技术'}失败轨道复审</title><style>body{font-family:system-ui,sans-serif;margin:0;color:#17202a;background:#f4f6f7}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ccd1d1;padding:16px;z-index:2}main{max-width:960px;margin:auto;padding:16px}article{background:#fff;border:1px solid #d5dbdb;border-radius:6px;padding:18px;margin-bottom:14px}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9f9;padding:12px}fieldset{border:0;padding:10px 0;display:flex;gap:24px}textarea{box-sizing:border-box;width:100%;margin-top:6px}button{padding:9px 14px;margin-right:8px}.error{color:#a93226}</style></head><body><header><h1>${questions.length} 道定点 V5 ${track === 'CONTENT' ? '内容' : '安全技术'}失败轨道复审</h1><div>审核人：${reviewer}。其余139道通过题及本题已通过轨道均不在本包中。</div><button id="export">校验并导出 JSON</button><span id="status"></span></header><main>${cards}</main><script id="package-data" type="application/json">${JSON.stringify(packageData)}</script><script>(()=>{const p=JSON.parse(document.getElementById('package-data').textContent);const key=p.package_id+':draft';const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const q of p.questions){const v=saved[q.question_id];if(v?.conclusion)document.querySelector('input[name="'+q.question_id+'"][value="'+v.conclusion+'"]').checked=true;document.querySelector('[data-note="'+q.question_id+'"]').value=v?.review_note||''}function collect(){return p.questions.map(q=>({question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,conclusion:document.querySelector('input[name="'+q.question_id+'"]:checked')?.value||'',review_note:document.querySelector('[data-note="'+q.question_id+'"]').value.trim()}))}document.addEventListener('input',()=>localStorage.setItem(key,JSON.stringify(Object.fromEntries(collect().map(x=>[x.question_id,x])))));document.getElementById('export').onclick=()=>{const questions=collect();const missing=questions.filter(x=>!x.conclusion||(x.conclusion==='RETURN_FOR_REVISION'&&!x.review_note));const status=document.getElementById('status');if(missing.length){status.className='error';status.textContent=' 尚有 '+missing.length+' 题未完成';return}const pass=questions.filter(x=>x.conclusion==='PASS').length;const result={schema_version:'job-skill-shelver-298-targeted-v5-${slug}-rereview-result-v1',package_id:p.package_id,candidate_set_hash:p.candidate_set_hash,reviewer:p.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=p.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);status.className='';status.textContent=' 已导出'};})();</script></body></html>`
}

function resultSchema(track, reviewer, count) {
  const slug = track === 'CONTENT' ? 'content' : 'safety-technical'
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Job Skill Targeted V5 ${track} Failed-track Re-review Result`,
    type: 'object', additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'],
    properties: {
      schema_version: { const: `job-skill-shelver-298-targeted-v5-${slug}-rereview-result-v1` },
      package_id: { const: `job-skill-shelver-298-targeted-v5-${slug}-rereview-packet-v1` },
      candidate_set_hash: { const: candidateSet.candidate_set_hash }, reviewer: { const: reviewer }, submitted_at: { type: 'string', format: 'date-time' },
      summary: { type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'], properties: { total: { const: count }, pass: { type: 'integer', minimum: 0 }, return_for_revision: { type: 'integer', minimum: 0 } } },
      questions: { type: 'array', minItems: count, maxItems: count, items: { type: 'object', additionalProperties: false, required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'conclusion', 'review_note'], properties: { question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V5$' }, previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V4$' }, new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] }, review_note: { type: 'string' } } } }
    }
  }
}

const pendingGateBase = {
  schema_version: 'job-skill-shelver-298-targeted-v5-rereview-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v5-rereview-gate-v1',
  status: 'PENDING_FAILED_TRACK_REREVIEW', generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidatesV5), candidate_set_hash: candidateSet.candidate_set_hash },
  summary: { total: 145, passed_references: passedReferences.length, pending_v5: v5Questions.length, passed: passedReferences.length, return_for_revision: 0 },
  releaseable: false,
  authority: { phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  questions: [
    ...passedReferences.map((question) => ({ question_id: question.question_id, question_version: question.question_version, semantic_hash: question.semantic_hash, required_review_tracks: [], status: question.status })),
    ...v5Questions.map((question) => ({ question_id: question.question_id, previous_question_id: question.previous_question_id, question_version: 5, semantic_hash: question.new_semantic_hash, required_review_tracks: question.required_review_tracks, status: 'PENDING' }))
  ].sort((left, right) => left.question_id.localeCompare(right.question_id))
}
const pendingGate = { ...pendingGateBase, gate_hash: hashRecord(pendingGateBase) }
const outputs = new Map([
  [paths.candidatesV5, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.contentHtml, packetHtml('CONTENT', '陈晓青', contentQuestions)],
  [paths.safetyHtml, packetHtml('SAFETY_TECHNICAL', '赫东', safetyQuestions)],
  [paths.contentResultSchema, `${JSON.stringify(resultSchema('CONTENT', '陈晓青', contentQuestions.length), null, 2)}\n`],
  [paths.safetyResultSchema, `${JSON.stringify(resultSchema('SAFETY_TECHNICAL', '赫东', safetyQuestions.length), null, 2)}\n`],
  [paths.pendingGate, `${JSON.stringify(pendingGate, null, 2)}\n`]
])

for (const [path, value] of outputs) {
  if (checkOnly) assert(existsSync(path) && readFileSync(path, 'utf8') === value, `${rel(path)} is missing or stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V5 contract ${checkOnly ? 'verified' : 'built'}: 6 V5 revisions, 139 passed references, ${contentQuestions.length} content failed-track reviews, ${safetyQuestions.length} safety/technical failed-track reviews; releaseable=false.`)
