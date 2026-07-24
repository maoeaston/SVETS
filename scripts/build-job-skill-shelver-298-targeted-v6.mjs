import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { hashFile, hashRecord, questionSemanticHash, questionSemanticHashContract } from './lib/job-skill-contract-hash.mjs'

const rootArg = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidatesV5: feature('job-skill-shelver-298-question-revision-candidates-v5.json'),
  mergedGateV5: feature('job-skill-shelver-298-targeted-v5-rereview-merged-gate-v1.json'),
  editorialInput: feature('job-skill-shelver-298-v6-editorial-input.json'),
  candidatesV6: feature('job-skill-shelver-298-question-revision-candidates-v6.json'),
  contentHtml: feature('job-skill-shelver-298-targeted-v6-content-rereview-packet-chen-xiaoqing-v1.html'),
  contentResultSchema: feature('job-skill-shelver-298-targeted-v6-content-rereview-result-v1.schema.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v6-rereview-gate-v1.json')
}
const generatedAt = '2026-07-20T21:30:00+08:00'
const requiredPreviousIds = ['M2_OP_031_V5', 'M2_OP_038_V5', 'M2_OP_041_V5', 'M5_DG_034_V5']
const requiredEditorialFields = ['scenario_facts', 'answer', 'permissions', 'exception_branches', 'scoring_thresholds', 'safety_actions']
const rel = (path) => path.slice(root.length + 1)
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const sameValues = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected)
const readJson = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} missing: ${rel(path)}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

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

function validateEditorial(editorial, previous, gate) {
  assert(editorial.question_id === gate.next_question_id, `${editorial.question_id} does not match V5 gate next_question_id`)
  assert(editorial.previous_question_id === gate.question_id, `${editorial.question_id} previous_question_id mismatch`)
  assert(gate.version_chain?.current_question_id === gate.question_id, `${gate.question_id} V5 version chain mismatch`)
  assert(previous.question_id === gate.question_id, `${gate.question_id} V5 candidate mismatch`)
  assert(editorial.source_question_id === previous.source_question_id, `${editorial.question_id} source_question_id drift`)
  assert(editorial.question_type === previous.question_type, `${editorial.question_id} question_type drift`)
  assert(sameValues(editorial.failed_review_tracks, gate.failed_review_tracks), `${editorial.question_id} must retain exactly its failed review tracks`)
  assert(sameValues(editorial.failed_review_tracks, ['CONTENT']), `${editorial.question_id} may only enter content rereview`)
  for (const field of requiredEditorialFields) assert(editorial[field] !== undefined, `${editorial.question_id} missing structured field ${field}`)
  assert(Array.isArray(editorial.scenario_facts) && editorial.scenario_facts.length > 0, `${editorial.question_id} requires scenario facts`)
  assert(editorial.answer && typeof editorial.answer.expected_outcome === 'string' && editorial.answer.expected_outcome.trim(), `${editorial.question_id} requires an answer contract`)
  assert(Array.isArray(editorial.permissions) && editorial.permissions.length > 0, `${editorial.question_id} requires permission boundaries`)
  assert(Array.isArray(editorial.exception_branches) && editorial.exception_branches.length > 0, `${editorial.question_id} requires exception branches`)
  assert(['score_0', 'score_1', 'score_2'].every((key) => typeof editorial.scoring_thresholds?.[key] === 'string' && editorial.scoring_thresholds[key].trim()), `${editorial.question_id} requires score 0/1/2 thresholds`)
  assert(Array.isArray(editorial.safety_actions) && editorial.safety_actions.length > 0, `${editorial.question_id} requires safety actions`)
  assert(editorial.updates && typeof editorial.updates === 'object', `${editorial.question_id} requires deterministic updates`)
  assert(typeof editorial.revision_rationale === 'string' && editorial.revision_rationale.trim(), `${editorial.question_id} requires revision_rationale`)
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
    assert(Array.isArray(proposed.content.rubric_criteria) && proposed.content.rubric_criteria.length > 0, `${record.question_id} requires rubric criteria`)
    assert(/2次|两次/.test(proposed.scoring_rule.score_0_description), `${record.question_id} score 0 requires a prompt threshold`)
    assert(/1次|一次/.test(proposed.scoring_rule.score_1_description), `${record.question_id} score 1 requires a prompt threshold`)
    assert(/0次提示|无需提示|无提示/.test(proposed.scoring_rule.score_2_description), `${record.question_id} score 2 requires a prompt threshold`)
  } else if (record.question_type === 'DRAG') {
    const items = proposed.content.drag_items
    const zones = proposed.content.drop_zones
    assert(Array.isArray(items) && Array.isArray(zones) && items.length === zones.length, `${record.question_id} drag item/zone counts must match`)
    const accepted = zones.flatMap((zone) => zone.accepts)
    assert(items.every((item) => accepted.filter((id) => id === item.item_id).length === 1), `${record.question_id} drag items must map exactly once`)
  } else {
    assert(false, `${record.question_id} unsupported question type`)
  }
}

function validateReturnedFixes(byId) {
  for (const id of ['M2_OP_031_V6', 'M2_OP_038_V6', 'M2_OP_041_V6']) {
    const record = byId.get(id)
    const score0 = record.proposed_question.scoring_rule.score_0_description
    assert(!/现场.*(?:设置|不符合)|设置不是|未按固定脚本/.test(score0), `${id} must keep setup failures outside learner scores`)
    assert(!record.structured_edit.scoring_thresholds.score_0.includes('设置异常'), `${id} structured score 0 still includes setup failure`)
    const exceptionAction = record.structured_edit.exception_branches[0]?.action ?? ''
    assert(/施测无效/.test(exceptionAction) && /复位.*重测/.test(exceptionAction), `${id} must invalidate, reset, and retest setup failures`)
  }
  const emergency = byId.get('M5_DG_034_V6')
  const prompt = emergency.proposed_question.content.prompt
  assert(prompt.includes('发现一名顾客倒地') && !prompt.includes('现场安全后') && !prompt.includes('确认其无反应且无正常呼吸'), 'M5_DG_034_V6 must start from discovery without duplicating confirmed premises')
  assert(emergency.proposed_question.content.drag_items.length === 4 && emergency.proposed_question.content.drop_zones.length === 4, 'M5_DG_034_V6 must retain one complete four-step order')
}

const candidatesV5 = readJson(paths.candidatesV5, 'V5 candidates')
const mergedGateV5 = readJson(paths.mergedGateV5, 'V5 merged gate')
const editorialInput = readJson(paths.editorialInput, 'V6 editorial input')
const { candidate_set_hash: v5CandidateHash, ...v5CandidateBody } = candidatesV5
const { gate_hash: v5GateHash, ...v5GateBody } = mergedGateV5
assert(hashRecord(v5CandidateBody) === v5CandidateHash, 'V5 candidate_set_hash drift')
assert(hashRecord(v5GateBody) === v5GateHash, 'V5 merged gate_hash drift')
assert(editorialInput.schema_version === 'job-skill-shelver-298-v6-editorial-input-v1', 'V6 editorial schema_version mismatch')
assert(editorialInput.source_gate_id === mergedGateV5.gate_id, 'V6 editorial input points to another gate')

const previousById = indexBy(candidatesV5.questions, 'V5 candidates')
const returned = mergedGateV5.questions.filter((question) => question.status === 'RETURN_FOR_REVISION')
const passed = mergedGateV5.questions.filter((question) => question.status !== 'RETURN_FOR_REVISION')
assert(returned.length === 4 && passed.length === 141, 'V5 merged gate must contain 4 returned and 141 passed questions')
assert(sameValues(returned.map((question) => question.question_id).sort(), requiredPreviousIds), 'V6 source return set drift')
assert(editorialInput.questions.length === 4, 'V6 editorial input must contain exactly 4 questions')
const editorialByPreviousId = indexBy(editorialInput.questions.map((record) => ({ ...record, question_id: record.previous_question_id, editorial_question_id: record.question_id })), 'V6 editorial previous IDs')
assert(sameValues([...editorialByPreviousId.keys()].sort(), requiredPreviousIds), 'V6 editorial input must cover exactly the four returned V5 questions')

const v6Questions = returned.map((gate) => {
  const previous = previousById.get(gate.question_id)
  const editorialIndexed = editorialByPreviousId.get(gate.question_id)
  assert(previous && editorialIndexed, `${gate.question_id} missing V5 candidate or V6 editorial input`)
  const editorial = { ...editorialIndexed, question_id: editorialIndexed.editorial_question_id }
  validateEditorial(editorial, previous, gate)
  assert(previous.candidate_record_hash === gate.candidate_record_hash, `${gate.question_id} candidate_record_hash drift from merged gate`)
  assert(previous.new_semantic_hash === gate.semantic_hash, `${gate.question_id} semantic hash drift from merged gate`)
  const proposedQuestion = applyUpdates(previous, editorial)
  const oldHash = questionSemanticHash(previous.proposed_question)
  const newHash = questionSemanticHash(proposedQuestion)
  assert(oldHash === previous.new_semantic_hash, `${gate.question_id} V5 semantic hash drift`)
  assert(newHash !== oldHash, `${editorial.question_id} semantic hash must change from V5`)
  const base = {
    question_id: editorial.question_id,
    previous_question_id: gate.question_id,
    question_version: 6,
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
    required_review_tracks: ['CONTENT'],
    activation_authority: 'NONE'
  }
  const record = { ...base, candidate_record_hash: hashRecord(base) }
  validateCandidate(record)
  return record
}).sort((left, right) => left.question_id.localeCompare(right.question_id))
validateReturnedFixes(indexBy(v6Questions, 'V6 candidates'))

const passedReferences = passed.map((question) => ({
  question_id: question.question_id,
  question_version: question.question_version,
  semantic_hash: question.semantic_hash,
  candidate_record_hash: question.candidate_record_hash,
  merged_record_hash: question.merged_record_hash,
  status: 'PASSED_REFERENCE'
})).sort((left, right) => left.question_id.localeCompare(right.question_id))

const candidateSetBase = {
  schema_version: 'job-skill-shelver-298-question-revision-candidates-v6',
  candidate_set_id: 'job-skill-shelver-298-content-return-question-revision-candidates-v6',
  status: 'DRAFT_FAILED_TRACK_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.candidatesV5, paths.mergedGateV5, paths.editorialInput].map((path) => ({ path: rel(path), sha256: hashFile(path) })),
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    source_total: 145,
    passed_reference_total: passedReferences.length,
    v6_total: v6Questions.length,
    content_rereview_total: v6Questions.length,
    safety_technical_rereview_total: 0,
    by_type: countBy(v6Questions, (question) => question.question_type)
  },
  authority: { releaseable: false, phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  passed_question_references: passedReferences,
  questions: v6Questions
}
const candidateSet = { ...candidateSetBase, candidate_set_hash: hashRecord(candidateSetBase) }

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function packetHtml() {
  const packageId = 'job-skill-shelver-298-targeted-v6-content-rereview-packet-v1'
  const packageData = { package_id: packageId, reviewer: '陈晓青', track: 'CONTENT', candidate_set_hash: candidateSet.candidate_set_hash, questions: v6Questions }
  const cards = v6Questions.map((question, index) => `<article data-id="${question.question_id}"><h2>${index + 1}. ${question.question_id}</h2><p><b>上一版：</b>${question.previous_question_id}</p><p><b>本包范围：</b>只复审内容失败轨道，不重审已通过轨道。</p><p><b>修订说明：</b>${escapeHtml(question.revision_rationale)}</p><details open><summary>结构化编辑依据</summary><pre>${escapeHtml(JSON.stringify(question.structured_edit, null, 2))}</pre></details><details><summary>查看 V6 题目</summary><pre>${escapeHtml(JSON.stringify(question.proposed_question, null, 2))}</pre></details><fieldset><legend>复审结论 *</legend><label><input type="radio" name="${question.question_id}" value="PASS"> 通过</label><label><input type="radio" name="${question.question_id}" value="RETURN_FOR_REVISION"> 退回复修</label></fieldset><label>审核意见<textarea data-note="${question.question_id}" rows="3"></textarea></label></article>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>定点 V6 内容失败轨道复审</title><style>body{font-family:system-ui,sans-serif;margin:0;color:#17202a;background:#f4f6f7}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ccd1d1;padding:16px;z-index:2}main{max-width:960px;margin:auto;padding:16px}article{background:#fff;border:1px solid #d5dbdb;border-radius:6px;padding:18px;margin-bottom:14px}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9f9;padding:12px}fieldset{border:0;padding:10px 0;display:flex;gap:24px}textarea{box-sizing:border-box;width:100%;margin-top:6px}button{padding:9px 14px;margin-right:8px}.error{color:#a93226}</style></head><body><header><h1>4 道定点 V6 内容失败轨道复审</h1><div>审核人：陈晓青。其余141道通过题不在本包中。</div><button id="export">校验并导出 JSON</button><span id="status"></span></header><main>${cards}</main><script id="package-data" type="application/json">${JSON.stringify(packageData)}</script><script>(()=>{const p=JSON.parse(document.getElementById('package-data').textContent);const key=p.package_id+':draft';const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const q of p.questions){const v=saved[q.question_id];if(v?.conclusion)document.querySelector('input[name="'+q.question_id+'"][value="'+v.conclusion+'"]').checked=true;document.querySelector('[data-note="'+q.question_id+'"]').value=v?.review_note||''}function collect(){return p.questions.map(q=>({question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,conclusion:document.querySelector('input[name="'+q.question_id+'"]:checked')?.value||'',review_note:document.querySelector('[data-note="'+q.question_id+'"]').value.trim()}))}document.addEventListener('input',()=>localStorage.setItem(key,JSON.stringify(Object.fromEntries(collect().map(x=>[x.question_id,x])))));document.getElementById('export').onclick=()=>{const questions=collect();const missing=questions.filter(x=>!x.conclusion||(x.conclusion==='RETURN_FOR_REVISION'&&!x.review_note));const status=document.getElementById('status');if(missing.length){status.className='error';status.textContent=' 尚有 '+missing.length+' 题未完成';return}const pass=questions.filter(x=>x.conclusion==='PASS').length;const result={schema_version:'job-skill-shelver-298-targeted-v6-content-rereview-result-v1',package_id:p.package_id,candidate_set_hash:p.candidate_set_hash,reviewer:p.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=p.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);status.className='';status.textContent=' 已导出'};})();</script></body></html>`
}

const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Job Skill Targeted V6 Content Failed-track Re-review Result',
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'],
  properties: {
    schema_version: { const: 'job-skill-shelver-298-targeted-v6-content-rereview-result-v1' },
    package_id: { const: 'job-skill-shelver-298-targeted-v6-content-rereview-packet-v1' },
    candidate_set_hash: { const: candidateSet.candidate_set_hash },
    reviewer: { const: '陈晓青' },
    submitted_at: { type: 'string', format: 'date-time' },
    summary: { type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'], properties: { total: { const: 4 }, pass: { type: 'integer', minimum: 0 }, return_for_revision: { type: 'integer', minimum: 0 } } },
    questions: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'conclusion', 'review_note'], properties: { question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V6$' }, previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V5$' }, new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] }, review_note: { type: 'string' } } } }
  }
}

const pendingGateBase = {
  schema_version: 'job-skill-shelver-298-targeted-v6-rereview-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v6-rereview-gate-v1',
  status: 'PENDING_FAILED_TRACK_REREVIEW',
  generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidatesV6), candidate_set_hash: candidateSet.candidate_set_hash },
  previous_merged_gate: { path: rel(paths.mergedGateV5), gate_id: mergedGateV5.gate_id, gate_hash: v5GateHash },
  summary: { total: 145, passed_references: passedReferences.length, pending_v6: v6Questions.length, passed: passedReferences.length, return_for_revision: 0 },
  releaseable: false,
  authority: { phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  questions: [
    ...passedReferences.map((question) => ({ question_id: question.question_id, question_version: question.question_version, semantic_hash: question.semantic_hash, candidate_record_hash: question.candidate_record_hash, merged_record_hash: question.merged_record_hash, required_review_tracks: [], status: 'PASSED_REFERENCE' })),
    ...v6Questions.map((question) => ({ question_id: question.question_id, previous_question_id: question.previous_question_id, question_version: 6, semantic_hash: question.new_semantic_hash, candidate_record_hash: question.candidate_record_hash, required_review_tracks: ['CONTENT'], status: 'PENDING' }))
  ].sort((left, right) => left.question_id.localeCompare(right.question_id))
}
const pendingGate = { ...pendingGateBase, gate_hash: hashRecord(pendingGateBase) }
const outputs = new Map([
  [paths.candidatesV6, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.contentHtml, packetHtml()],
  [paths.contentResultSchema, `${JSON.stringify(resultSchema, null, 2)}\n`],
  [paths.pendingGate, `${JSON.stringify(pendingGate, null, 2)}\n`]
])

for (const [path, value] of outputs) {
  if (checkOnly) assert(existsSync(path) && readFileSync(path, 'utf8') === value, `${rel(path)} is missing or stale`)
  else writeFileSync(path, value)
}

console.log(`Targeted V6 contract ${checkOnly ? 'verified' : 'built'}: 4 V6 content revisions, 141 passed references, releaseable=false.`)
