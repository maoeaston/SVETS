import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  effectiveAnswer,
  hashFile,
  hashRecord,
  questionSemanticHash,
  questionSemanticHashContract
} from './lib/job-skill-contract-hash.mjs'

const rootArgument = process.argv.find((argument) => argument.startsWith('--root='))
const root = rootArgument ? resolve(rootArgument.slice('--root='.length)) : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, `doc/features/${name}`)
const paths = {
  candidatesV3: feature('job-skill-shelver-298-question-revision-candidates-v3.json'),
  mergedGateV3: feature('job-skill-shelver-298-targeted-v3-rereview-merged-gate-v1.json'),
  onlineInput: feature('job-skill-shelver-298-v4-online-editorial-input.json'),
  dragInput: feature('job-skill-shelver-298-v4-drag-editorial-input.json'),
  offlineInput: feature('job-skill-shelver-298-v4-offline-editorial-input.json'),
  candidatesV4: feature('job-skill-shelver-298-question-revision-candidates-v4.json'),
  contentHtml: feature('job-skill-shelver-298-targeted-v4-content-rereview-packet-chen-xiaoqing-v1.html'),
  safetyHtml: feature('job-skill-shelver-298-targeted-v4-safety-technical-rereview-packet-he-dong-v1.html'),
  contentResultSchema: feature('job-skill-shelver-298-targeted-v4-content-rereview-result-v1.schema.json'),
  safetyResultSchema: feature('job-skill-shelver-298-targeted-v4-safety-technical-rereview-result-v1.schema.json'),
  pendingGate: feature('job-skill-shelver-298-targeted-v4-rereview-gate-v1.json')
}
const outputPaths = [paths.candidatesV4, paths.contentHtml, paths.safetyHtml, paths.contentResultSchema, paths.safetyResultSchema, paths.pendingGate]
const rel = (path) => path.slice(root.length + 1)
const generatedAt = '2026-07-20T17:00:00+08:00'
const expectedTypes = { SINGLE_CHOICE: 30, TRUE_FALSE: 12, DRAG: 16, OFFLINE_OPERATION: 83 }
const forbiddenStudentText = /(上述岗位要求|沿用原题|审核意见|应改为|应统一为|需补充|最低复审要求|退回复修|题目缺陷|r_review_boundary)/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readJson(path, label) {
  assert(existsSync(path), `${label} is not ready: ${rel(path)}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${rel(path)} (${error.message})`)
  }
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

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function countByType(records) {
  return Object.fromEntries(Object.keys(expectedTypes).map((type) => [type, records.filter((record) => record.question_type === type).length]))
}

function semanticStudentText(question) {
  const content = question.content ?? {}
  return [
    content.prompt,
    ...(content.options ?? []).flatMap((option) => [option.key, option.text]),
    ...(content.drag_items ?? []).flatMap((item) => [item.item_id, item.label]),
    ...(content.drop_zones ?? []).flatMap((zone) => [zone.zone_id, zone.label]),
    ...(content.rubric_criteria ?? []).flatMap((criterion) => [criterion.criterion_id, criterion.description]),
    ...Object.entries(question.scoring_rule ?? {}).filter(([key]) => key.includes('description')).map(([, value]) => value),
    question.safety_stop_conditions
  ].filter((value) => typeof value === 'string').join('\n')
}

function validateSingleChoice(record) {
  const options = record.proposed_question.content.options
  assert(Array.isArray(options) && options.length >= 2, `${record.question_id} SINGLE_CHOICE requires at least two options`)
  const keys = options.map((option) => option.key)
  assert(keys.every((key) => typeof key === 'string' && key.length > 0), `${record.question_id} has an empty option key`)
  assert(new Set(keys).size === keys.length, `${record.question_id} option keys must be unique`)
  const answer = effectiveAnswer(record.proposed_question)
  assert(typeof answer === 'string', `${record.question_id} SINGLE_CHOICE answer must be an option key`)
  assert(keys.filter((key) => key === answer).length === 1, `${record.question_id} must have exactly one answer option`)
}

function validateTrueFalse(record) {
  const content = record.proposed_question.content
  assert(typeof effectiveAnswer(record.proposed_question) === 'boolean', `${record.question_id} TRUE_FALSE answer must be boolean`)
  assert(typeof content.media_brief === 'string' && content.media_brief.trim(), `${record.question_id} TRUE_FALSE requires a non-empty video description`)
}

function validateDrag(record) {
  const { drag_items: items, drop_zones: zones } = record.proposed_question.content
  assert(Array.isArray(items) && items.length > 0, `${record.question_id} DRAG requires items`)
  assert(Array.isArray(zones) && zones.length > 0, `${record.question_id} DRAG requires drop zones`)
  const itemIds = items.map((item) => item.item_id)
  const zoneIds = zones.map((zone) => zone.zone_id)
  assert(new Set(itemIds).size === itemIds.length, `${record.question_id} drag item IDs must be unique`)
  assert(new Set(zoneIds).size === zoneIds.length, `${record.question_id} drop zone IDs must be unique`)
  const accepted = zones.flatMap((zone) => {
    assert(Array.isArray(zone.accepts), `${record.question_id}/${zone.zone_id} accepts must be an array`)
    return zone.accepts
  })
  assert(accepted.every((itemId) => itemIds.includes(itemId)), `${record.question_id} maps an unknown drag item`)
  for (const itemId of itemIds) {
    assert(accepted.filter((acceptedId) => acceptedId === itemId).length === 1, `${record.question_id}/${itemId} must map to exactly one zone`)
  }
}

function validateOffline(record) {
  const criteria = record.proposed_question.content.rubric_criteria
  const scoring = record.proposed_question.scoring_rule
  assert(Array.isArray(criteria) && criteria.length > 0, `${record.question_id} OFFLINE_OPERATION requires rubric criteria`)
  const ids = criteria.map((criterion) => criterion.criterion_id)
  assert(ids.every((id) => typeof id === 'string' && id.trim()), `${record.question_id} has an empty rubric criterion ID`)
  assert(new Set(ids).size === ids.length, `${record.question_id} rubric criterion IDs must be unique`)
  const anchors = [scoring.score_0_description, scoring.score_1_description, scoring.score_2_description]
  assert(anchors.every((anchor) => typeof anchor === 'string' && anchor.trim()), `${record.question_id} requires score 0/1/2 anchors`)
  assert(/(?:2次|两次|多次|提示后仍|经提示仍|指向[^，。；]*提示)/.test(anchors[0]), `${record.question_id} score 0 must state an explicit prompt threshold`)
  assert(/(?:1次|一次|恰好1次)[^。；]*提示/.test(anchors[1]), `${record.question_id} score 1 must state an explicit prompt threshold`)
  assert(/(?:0次提示|无需提示|无提示|未接受提示)/.test(anchors[2]), `${record.question_id} score 2 must state an explicit prompt threshold`)
}

function validateQuestion(record, previous, gate) {
  assert(record.question_id === gate.next_question_id, `${record.question_id} does not match merged next_question_id`)
  assert(record.previous_question_id === gate.question_id, `${record.question_id} previous_question_id must be ${gate.question_id}`)
  assert(record.source_question_id === previous.source_question_id, `${record.question_id} source_question_id drift`)
  assert(record.question_type === previous.question_type, `${record.question_id} question_type drift`)
  assert(record.proposed_question?.content?.question_type === record.question_type, `${record.question_id} content.question_type drift`)
  assert(sameValues(record.required_review_tracks, gate.next_review_tracks), `${record.question_id} required_review_tracks must equal merged next_review_tracks`)
  assert(typeof record.revision_rationale === 'string' && record.revision_rationale.trim(), `${record.question_id} revision_rationale is required`)
  assert(typeof record.proposed_question?.content?.prompt === 'string' && record.proposed_question.content.prompt.trim(), `${record.question_id} prompt is required`)
  const oldHash = questionSemanticHash(previous.proposed_question)
  assert(oldHash === previous.new_semantic_hash, `${record.question_id} V3 semantic hash drift`)
  const newHash = questionSemanticHash(record.proposed_question)
  assert(newHash !== oldHash, `${record.question_id} semantic hash must change from V3`)
  assert(!forbiddenStudentText.test(semanticStudentText(record.proposed_question)), `${record.question_id} contains forbidden reviewer/meta wording in student-visible semantic fields`)
  if (record.question_type === 'SINGLE_CHOICE') validateSingleChoice(record)
  else if (record.question_type === 'TRUE_FALSE') validateTrueFalse(record)
  else if (record.question_type === 'DRAG') validateDrag(record)
  else if (record.question_type === 'OFFLINE_OPERATION') validateOffline(record)
  else assert(false, `${record.question_id} unsupported question_type: ${record.question_type}`)
  if (record.proposed_question.safety_sensitive) {
    assert(typeof record.proposed_question.safety_stop_conditions === 'string' && record.proposed_question.safety_stop_conditions.trim(), `${record.question_id} safety-sensitive question requires stop conditions`)
  }
  return { oldHash, newHash }
}

const candidatesV3 = readJson(paths.candidatesV3, 'V3 candidates')
const mergedGate = readJson(paths.mergedGateV3, 'V3 merged gate')
const { candidate_set_hash: candidateSetHashV3, ...candidateSetBodyV3 } = candidatesV3
const { gate_hash: gateHashV3, ...gateBodyV3 } = mergedGate
assert(hashRecord(candidateSetBodyV3) === candidateSetHashV3, 'V3 candidate_set_hash drift')
assert(hashRecord(gateBodyV3) === gateHashV3, 'V3 merged gate_hash drift')
assert(mergedGate.candidate_set?.candidate_set_hash === candidateSetHashV3, 'V3 merged gate points to a different candidate set')

const previousById = indexBy(candidatesV3.questions, 'V3 candidates')
const gateById = indexBy(mergedGate.questions, 'V3 merged gate')
assert(candidatesV3.questions.length === 145 && mergedGate.questions.length === 145, 'V3 source chain must contain exactly 145 questions')
for (const gate of mergedGate.questions) {
  const previous = previousById.get(gate.question_id)
  assert(previous, `${gate.question_id} missing from V3 candidates`)
  assert(hashRecord(Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'candidate_record_hash'))) === previous.candidate_record_hash, `${gate.question_id} candidate_record_hash drift`)
  assert(gate.candidate_record_hash === previous.candidate_record_hash, `${gate.question_id} merged candidate_record_hash mismatch`)
  assert(gate.new_semantic_hash === previous.new_semantic_hash, `${gate.question_id} merged semantic hash mismatch`)
}

const passedV3 = mergedGate.questions.filter((question) => question.status === 'PASSED')
const needsV4 = mergedGate.questions.filter((question) => question.status !== 'PASSED')
assert(passedV3.length === 4, `Expected 4 passed V3 questions, received ${passedV3.length}`)
assert(needsV4.length === 141, `Expected 141 non-PASSED questions, received ${needsV4.length}`)
assert(needsV4.every((question) => ['RETURN_FOR_REVISION', 'BLOCKED_CONTRACT_CONFLICT'].includes(question.status)), 'V4 source contains an unsupported merged status')
assert(needsV4.every((question) => Array.isArray(question.next_review_tracks) && question.next_review_tracks.length > 0), 'Every V4 question must have next_review_tracks')

const inputs = [
  readJson(paths.onlineInput, 'V4 online editorial input'),
  readJson(paths.dragInput, 'V4 drag editorial input'),
  readJson(paths.offlineInput, 'V4 offline editorial input')
]
const expectedSections = ['ONLINE', 'DRAG', 'OFFLINE_OPERATION']
inputs.forEach((input, index) => {
  assert(input.schema_version === 'job-skill-shelver-298-v4-editorial-input-v1', `${expectedSections[index]} input schema_version mismatch`)
  assert(input.section === expectedSections[index], `Expected editorial section ${expectedSections[index]}, received ${input.section}`)
  assert(Array.isArray(input.questions), `${expectedSections[index]} input questions must be an array`)
})
assert(inputs[0].questions.every((record) => ['SINGLE_CHOICE', 'TRUE_FALSE'].includes(record.question_type)), 'ONLINE input may only contain SINGLE_CHOICE and TRUE_FALSE questions')
assert(inputs[1].questions.every((record) => record.question_type === 'DRAG'), 'DRAG input contains another question type')
assert(inputs[2].questions.every((record) => record.question_type === 'OFFLINE_OPERATION'), 'OFFLINE_OPERATION input contains another question type')

const editorial = inputs.flatMap((input) => input.questions)
const editorialByPreviousId = indexBy(editorial.map((record) => ({ ...record, question_id: record.previous_question_id, editorial_question_id: record.question_id })), 'V4 editorial previous IDs')
assert(editorial.length === 141, `Editorial inputs must contain exactly 141 questions, received ${editorial.length}`)
assert(sameValues(countByType(editorial), expectedTypes), `Editorial type counts mismatch: ${JSON.stringify(countByType(editorial))}`)
const expectedV3Ids = new Set(needsV4.map((question) => question.question_id))
assert(editorialByPreviousId.size === expectedV3Ids.size && [...editorialByPreviousId.keys()].every((id) => expectedV3Ids.has(id)), 'Editorial inputs must exactly cover the 141 non-PASSED V3 questions')

const v4Questions = editorial.map((record) => {
  const gate = gateById.get(record.previous_question_id)
  const previous = previousById.get(record.previous_question_id)
  assert(gate && previous, `${record.question_id} has an unknown V3 predecessor`)
  const { oldHash, newHash } = validateQuestion(record, previous, gate)
  const base = {
    question_id: record.question_id,
    previous_question_id: record.previous_question_id,
    question_version: 4,
    source_question_id: record.source_question_id,
    module: previous.module,
    question_type: record.question_type,
    status: 'DRAFT_TARGETED_REREVIEW_REQUIRED',
    proposed_question: record.proposed_question,
    revision_rationale: record.revision_rationale,
    old_semantic_hash: oldHash,
    new_semantic_hash: newHash,
    source_candidate_record_hash: previous.candidate_record_hash,
    source_merged_record_hash: gate.merged_record_hash,
    required_review_tracks: record.required_review_tracks,
    activation_authority: 'NONE'
  }
  return { ...base, candidate_record_hash: hashRecord(base) }
}).sort((left, right) => left.question_id.localeCompare(right.question_id))

const passedV3References = passedV3.map((gate) => ({
  question_id: gate.question_id,
  question_version: 3,
  source_question_id: previousById.get(gate.question_id).source_question_id,
  semantic_hash: gate.new_semantic_hash,
  candidate_record_hash: gate.candidate_record_hash,
  merged_record_hash: gate.merged_record_hash,
  status: 'PASSED_V3_REFERENCE'
})).sort((left, right) => left.question_id.localeCompare(right.question_id))

const contentQuestions = v4Questions.filter((question) => question.required_review_tracks.includes('CONTENT'))
const safetyQuestions = v4Questions.filter((question) => question.required_review_tracks.includes('SAFETY_TECHNICAL'))
assert(contentQuestions.length === 140, `Expected 140 content reviews, received ${contentQuestions.length}`)
assert(safetyQuestions.length === 120, `Expected 120 safety/technical reviews, received ${safetyQuestions.length}`)

const candidateSetBase = {
  schema_version: 'job-skill-shelver-298-question-revision-candidates-v4',
  candidate_set_id: 'job-skill-shelver-298-targeted-question-revision-candidates-v4',
  status: 'DRAFT_TARGETED_REREVIEW_REQUIRED_NO_ACTIVATION_AUTHORITY',
  generated_at: generatedAt,
  sources: [paths.candidatesV3, paths.mergedGateV3, paths.onlineInput, paths.dragInput, paths.offlineInput].map((path) => ({ path: rel(path), sha256: hashFile(path) })),
  semantic_hash_contract: questionSemanticHashContract,
  summary: {
    source_v3_total: 145,
    v4_total: 141,
    passed_v3_reference_total: 4,
    content_rereview_total: contentQuestions.length,
    safety_technical_rereview_total: safetyQuestions.length,
    by_type: expectedTypes
  },
  authority: { releaseable: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  passed_v3_references: passedV3References,
  questions: v4Questions
}
const candidateSet = { ...candidateSetBase, candidate_set_hash: hashRecord(candidateSetBase) }

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function packetHtml(track, reviewer, questions) {
  const slug = track === 'CONTENT' ? 'content' : 'safety-technical'
  const packageId = `job-skill-shelver-298-targeted-v4-${slug}-rereview-packet-v1`
  const packageData = { package_id: packageId, reviewer, track, candidate_set_hash: candidateSet.candidate_set_hash, questions }
  const cards = questions.map((question, index) => `<article data-id="${question.question_id}"><h2>${index + 1}. ${question.question_id}</h2><p><b>上一版：</b>${question.previous_question_id}</p><p><b>定点修订：</b>${escapeHtml(question.revision_rationale)}</p><details><summary>查看 V4 题目</summary><pre>${escapeHtml(JSON.stringify(question.proposed_question, null, 2))}</pre></details><fieldset><legend>复审结论 *</legend><label><input type="radio" name="${question.question_id}" value="PASS"> 通过</label><label><input type="radio" name="${question.question_id}" value="RETURN_FOR_REVISION"> 退回复修</label></fieldset><label>审核意见<textarea data-note="${question.question_id}" rows="3"></textarea></label></article>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>定点 V4 复审 - ${reviewer}</title><style>body{font-family:system-ui,sans-serif;margin:0;color:#17202a;background:#f4f6f7}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ccd1d1;padding:16px;z-index:2}main{max-width:960px;margin:auto;padding:16px}article{background:#fff;border:1px solid #d5dbdb;border-radius:6px;padding:18px;margin-bottom:14px}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9f9;padding:12px}fieldset{border:0;padding:10px 0;display:flex;gap:24px}textarea{box-sizing:border-box;width:100%;margin-top:6px}button{padding:9px 14px;margin-right:8px}.error{color:#a93226}</style></head><body><header><h1>${questions.length} 道定点 V4 ${track === 'CONTENT' ? '内容' : '安全技术'}复审</h1><div>审核人：${reviewer}。仅复审本轮退回维度；4 道已通过 V3 不在本包中。</div><button id="export">校验并导出 JSON</button><span id="status"></span></header><main>${cards}</main><script id="package-data" type="application/json">${JSON.stringify(packageData)}</script><script>(()=>{const p=JSON.parse(document.getElementById('package-data').textContent);const key=p.package_id+':draft';const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const q of p.questions){const v=saved[q.question_id];if(v?.conclusion)document.querySelector('input[name="'+q.question_id+'"][value="'+v.conclusion+'"]').checked=true;document.querySelector('[data-note="'+q.question_id+'"]').value=v?.review_note||''}function collect(){return p.questions.map(q=>({question_id:q.question_id,previous_question_id:q.previous_question_id,new_semantic_hash:q.new_semantic_hash,candidate_record_hash:q.candidate_record_hash,conclusion:document.querySelector('input[name="'+q.question_id+'"]:checked')?.value||'',review_note:document.querySelector('[data-note="'+q.question_id+'"]').value.trim()}))}document.addEventListener('input',()=>localStorage.setItem(key,JSON.stringify(Object.fromEntries(collect().map(x=>[x.question_id,x])))));document.getElementById('export').onclick=()=>{const questions=collect();const missing=questions.filter(x=>!x.conclusion||(x.conclusion==='RETURN_FOR_REVISION'&&!x.review_note));const status=document.getElementById('status');if(missing.length){status.className='error';status.textContent=' 尚有 '+missing.length+' 题未完成';return}const pass=questions.filter(x=>x.conclusion==='PASS').length;const result={schema_version:'job-skill-shelver-298-targeted-v4-${slug}-rereview-result-v1',package_id:p.package_id,candidate_set_hash:p.candidate_set_hash,reviewer:p.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,pass,return_for_revision:questions.length-pass},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=p.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href);status.className='';status.textContent=' 已导出'};})();</script></body></html>`
}

function resultSchema(track, reviewer, count) {
  const slug = track === 'CONTENT' ? 'content' : 'safety-technical'
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Job Skill Targeted V4 ${track} Re-review Result`,
    type: 'object', additionalProperties: false,
    required: ['schema_version', 'package_id', 'candidate_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'],
    properties: {
      schema_version: { const: `job-skill-shelver-298-targeted-v4-${slug}-rereview-result-v1` },
      package_id: { const: `job-skill-shelver-298-targeted-v4-${slug}-rereview-packet-v1` },
      candidate_set_hash: { const: candidateSet.candidate_set_hash },
      reviewer: { const: reviewer }, submitted_at: { type: 'string', format: 'date-time' },
      summary: { type: 'object', additionalProperties: false, required: ['total', 'pass', 'return_for_revision'], properties: { total: { const: count }, pass: { type: 'integer', minimum: 0 }, return_for_revision: { type: 'integer', minimum: 0 } } },
      questions: { type: 'array', minItems: count, maxItems: count, items: { type: 'object', additionalProperties: false, required: ['question_id', 'previous_question_id', 'new_semantic_hash', 'candidate_record_hash', 'conclusion', 'review_note'], properties: { question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V4$' }, previous_question_id: { type: 'string', pattern: '^M[1-6]_[A-Z]+_\\d+_V3$' }, new_semantic_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, candidate_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, conclusion: { enum: ['PASS', 'RETURN_FOR_REVISION'] }, review_note: { type: 'string' } } } }
    }
  }
}

const pendingGateBase = {
  schema_version: 'job-skill-shelver-298-targeted-v4-rereview-gate-v1',
  gate_id: 'job-skill-shelver-298-targeted-v4-rereview-gate-v1',
  status: 'PENDING_REVIEW', generated_at: generatedAt,
  candidate_set: { path: rel(paths.candidatesV4), candidate_set_hash: candidateSet.candidate_set_hash },
  summary: { total: 145, pending_v4: 141, passed_v3_references: 4, passed: 4, return_for_revision: 0 },
  releaseable: false,
  authority: { phase_4_allowed: false, runtime_database_unchanged: true, activation_sql_generated: false, delivery_lock_unchanged: true },
  questions: [
    ...passedV3References.map((question) => ({ question_id: question.question_id, question_version: 3, semantic_hash: question.semantic_hash, required_review_tracks: [], status: 'PASSED_V3_REFERENCE' })),
    ...v4Questions.map((question) => ({ question_id: question.question_id, previous_question_id: question.previous_question_id, question_version: 4, semantic_hash: question.new_semantic_hash, required_review_tracks: question.required_review_tracks, status: 'PENDING' }))
  ].sort((left, right) => left.question_id.localeCompare(right.question_id))
}
const pendingGate = { ...pendingGateBase, gate_hash: hashRecord(pendingGateBase) }
const outputs = new Map([
  [paths.candidatesV4, `${JSON.stringify(candidateSet, null, 2)}\n`],
  [paths.contentHtml, packetHtml('CONTENT', '陈晓青', contentQuestions)],
  [paths.safetyHtml, packetHtml('SAFETY_TECHNICAL', '赫东', safetyQuestions)],
  [paths.contentResultSchema, `${JSON.stringify(resultSchema('CONTENT', '陈晓青', contentQuestions.length), null, 2)}\n`],
  [paths.safetyResultSchema, `${JSON.stringify(resultSchema('SAFETY_TECHNICAL', '赫东', safetyQuestions.length), null, 2)}\n`],
  [paths.pendingGate, `${JSON.stringify(pendingGate, null, 2)}\n`]
])

for (const path of outputPaths) assert(outputs.has(path), `Missing planned output: ${rel(path)}`)
for (const [path, value] of outputs) {
  if (checkOnly) {
    assert(existsSync(path) && readFileSync(path, 'utf8') === value, `${rel(path)} is missing or stale`)
  } else {
    writeFileSync(path, value)
  }
}

console.log(`Targeted V4 contract ${checkOnly ? 'verified' : 'built'}: 141 V4 revisions, 4 passed V3 references, ${contentQuestions.length} content reviews, ${safetyQuestions.length} safety/technical reviews; releaseable=false.`)
