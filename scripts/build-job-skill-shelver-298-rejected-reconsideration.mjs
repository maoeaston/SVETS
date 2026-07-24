import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.SVETS_REJECTED_RECONSIDERATION_ROOT
  ? resolve(process.env.SVETS_REJECTED_RECONSIDERATION_ROOT)
  : resolve(import.meta.dirname, '..')
const checkOnly = process.argv.includes('--check')
const feature = (name) => resolve(root, 'doc/features', name)
const paths = {
  source: resolve(root, 'doc/reference/专业岗位能力测评题库-M1-M6-数据库导出-298条.json'),
  manifest: feature('job-skill-shelver-298-source-manifest-v1.json'),
  authority: feature('job-skill-shelver-298-disposition-authority-v1.json'),
  merged: feature('job-skill-shelver-298-merged-review-decisions-2026-07-19.json'),
  contentReview: feature('job-skill-shelver-298-content-review-result-2026-07-19.json'),
  safetyReview: feature('job-skill-shelver-298-safety-technical-review-result-2026-07-19.json'),
  cases: feature('job-skill-shelver-298-rejected-11-reconsideration-cases-v1.json'),
  gate: feature('job-skill-shelver-298-rejected-11-reconsideration-gate-v1.json'),
  contentHtml: feature('job-skill-shelver-298-rejected-11-content-reconsideration-packet-chen-xiaoqing-v1.html'),
  safetyHtml: feature('job-skill-shelver-298-rejected-11-safety-technical-reconsideration-packet-he-dong-v1.html'),
  contentSchema: feature('job-skill-shelver-298-rejected-11-content-reconsideration-result-v1.schema.json'),
  safetySchema: feature('job-skill-shelver-298-rejected-11-safety-technical-reconsideration-result-v1.schema.json')
}
const expectedIds = ['M1_OB_048', 'M1_OP_042', 'M3_OP_056', 'M4_OP_043', 'M4_OP_044', 'M4_OP_045', 'M4_OP_046', 'M4_OP_047', 'M4_OP_048', 'M5_OP_048', 'M5_OP_055']
const generatedAt = '2026-07-21T00:00:00+08:00'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
function hashText(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}` }
function hashRecord(value) { return hashText(JSON.stringify(canonical(value))) }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function assert(condition, message) { if (!condition) throw new Error(message) }
function exactSet(actual, expected, label) {
  assert(actual.length === expected.length, `${label} count mismatch`)
  assert(new Set(actual).size === actual.length, `${label} contains duplicate IDs`)
  assert([...actual].sort().join('\n') === [...expected].sort().join('\n'), `${label} coverage mismatch`)
}
function indexBy(records, label, key = 'question_id') {
  const map = new Map()
  for (const record of records) {
    assert(!map.has(record[key]), `${label} contains duplicate ${record[key]}`)
    map.set(record[key], record)
  }
  return map
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
function scriptJson(value) { return JSON.stringify(value).replaceAll('<', '\\u003c') }

const sourceText = readFileSync(paths.source, 'utf8')
const source = readJson(paths.source)
const manifest = readJson(paths.manifest)
const authority = readJson(paths.authority)
const priorCaseSet = existsSync(paths.cases) ? readJson(paths.cases) : null
const merged = readJson(paths.merged)
const contentReview = readJson(paths.contentReview)
const safetyReview = readJson(paths.safetyReview)
const sourceArtifact = manifest.artifacts.find((item) => item.artifact_id === 'source_snapshot_298')
assert(sourceArtifact?.sha256 === hashText(sourceText), '298 source snapshot bytes drifted from accepted manifest')
assert(source.length === 298, 'source snapshot must contain 298 questions')
const historicalAuthorityHash = priorCaseSet?.source_authority?.authority_hash ?? authority.authority_hash

const sourceById = indexBy(source, 'source snapshot')
const authorityById = indexBy(authority.questions, 'disposition authority', 'source_question_id')
const mergedById = indexBy(merged.questions, 'merged decisions')
const contentById = indexBy(contentReview.questions, 'content review')
const safetyById = indexBy(safetyReview.questions, 'safety review')
const historicalRejectedIds = authority.questions
  .filter((item) => item.disposition === 'REJECTED' || item.disposition === 'REPLACEMENT_REVIEW_PASSED_PENDING_ACTIVATION')
  .map((item) => item.source_question_id)
exactSet(historicalRejectedIds, expectedIds, 'historical rejected authority set')

const cases = expectedIds.map((questionId) => {
  const sourceQuestion = sourceById.get(questionId)
  const authorityQuestion = authorityById.get(questionId)
  const mergedDecision = mergedById.get(questionId)
  const content = contentById.get(questionId)
  const safety = safetyById.get(questionId)
  assert(sourceQuestion && authorityQuestion && mergedDecision && content && safety, `${questionId} is missing source review evidence`)
  assert(hashRecord(sourceQuestion) === authorityQuestion.source_record_hash, `${questionId} source_record_hash mismatch`)
  assert(mergedDecision.source_record_hash === authorityQuestion.source_record_hash, `${questionId} merged source hash mismatch`)
  assert(mergedDecision.merged_decision === 'REJECTED' && content.content_conclusion === 'REJECTED', `${questionId} is not an original rejected question`)
  const contentJson = JSON.parse(sourceQuestion.content_json)
  const scoringRule = JSON.parse(sourceQuestion.scoring_rule_json)
  const record = {
    question_id: questionId,
    question_version: sourceQuestion.version,
    source_record_hash: authorityQuestion.source_record_hash,
    module_type: sourceQuestion.module_type,
    question_type: sourceQuestion.question_type,
    difficulty_level: sourceQuestion.difficulty_level,
    original_status: sourceQuestion.status,
    original_question: {
      content: contentJson,
      scoring_rule: scoringRule,
      media_asset_id: sourceQuestion.media_asset_id,
      tool_asset_ids: sourceQuestion.tool_asset_ids_json ? JSON.parse(sourceQuestion.tool_asset_ids_json) : null,
      safety_sensitive: Boolean(sourceQuestion.safety_sensitive),
      sensory_tags: sourceQuestion.sensory_tags_json ? JSON.parse(sourceQuestion.sensory_tags_json) : null
    },
    prior_review: {
      content: {
        conclusion: content.content_conclusion,
        prompt_review: content.prompt_review,
        occupational_authenticity_review: content.occupational_authenticity_review,
        answer_or_rubric_review: content.answer_or_rubric_review,
        material_tool_review: content.material_tool_review,
        review_note: content.review_note,
        suggested_answer_or_behavior: content.suggested_answer_or_behavior,
        material_tool_requirement: content.material_tool_requirement
      },
      safety_technical: {
        safety_conclusion: safety.safety_conclusion,
        safety_note: safety.safety_note,
        technical_conclusion: safety.technical_conclusion,
        technical_note: safety.technical_note,
        activation_recommendation: safety.activation_recommendation,
        minimum_re_review_requirement: safety.minimum_re_review_requirement
      },
      merged_decision: mergedDecision.merged_decision,
      review_result_refs: mergedDecision.review_result_refs
    },
    current_authority: {
      // The packet is an immutable V1 reconsideration record. A later approved
      // replacement must not rewrite the original rejection captured here.
      disposition: 'REJECTED',
      review_gate_status: 'REJECTED',
      activation_authority: 'NOT_APPLICABLE'
    }
  }
  return { ...record, reconsideration_record_hash: hashRecord(record) }
})

const caseSetBody = {
  schema_version: 'job-skill-shelver-298-rejected-11-reconsideration-cases-v1',
  case_set_id: 'job-skill-shelver-298-rejected-11-reconsideration-cases-v1',
  status: 'READY_FOR_INDEPENDENT_RECONSIDERATION',
  generated_at: generatedAt,
  source_snapshot: { path: sourceArtifact.path, sha256: sourceArtifact.sha256 },
  source_authority: { path: 'doc/features/job-skill-shelver-298-disposition-authority-v1.json', authority_hash: historicalAuthorityHash },
  scope: {
    total: 11,
    question_ids: expectedIds,
    preserves_existing_passed_questions: 287,
    changes_existing_authority: false
  },
  decision_meanings: {
    PASS_AS_IS: '认为原始V1题目无需修改即可进入后续双人合并评估；本选择本身不恢复题目。',
    RETURN_FOR_REDESIGN: '维持原题淘汰，建议另建新版本或替代题后重新审核。',
    CONFIRM_REJECTED: '确认原题不应进入专业岗位训练题库，不建议继续复修。'
  },
  questions: cases
}
const caseSet = { ...caseSetBody, case_set_hash: hashRecord(caseSetBody) }

const gateBody = {
  schema_version: 'job-skill-shelver-298-rejected-11-reconsideration-gate-v1',
  gate_id: 'job-skill-shelver-298-rejected-11-reconsideration-gate-v1',
  status: 'PENDING_INDEPENDENT_RECONSIDERATION',
  generated_at: generatedAt,
  case_set: { path: 'doc/features/job-skill-shelver-298-rejected-11-reconsideration-cases-v1.json', case_set_hash: caseSet.case_set_hash },
  required_reviewers: [
    { name: '陈晓青', track: 'CONTENT_AND_OCCUPATIONAL_AUTHENTICITY' },
    { name: '赫东', track: 'SAFETY_AND_TECHNICAL' }
  ],
  merge_rule: 'Only PASS_AS_IS from content and technical plus PASS from safety may become eligible for a separate authority amendment; no reviewer export changes authority directly.',
  summary: { total: 11, pending: 11, eligible_for_authority_amendment: 0 },
  boundaries: {
    existing_passed_287_unchanged: true,
    original_rejected_v1_unchanged: true,
    runtime_database_unchanged: true,
    activation_sql_not_generated: true,
    phase4_authority_unchanged: true
  }
}
const gate = { ...gateBody, gate_hash: hashRecord(gateBody) }

function packageData(kind) {
  const content = kind === 'content'
  return {
    package_id: content ? 'job-skill-shelver-298-rejected-11-content-reconsideration-packet-chen-xiaoqing-v1' : 'job-skill-shelver-298-rejected-11-safety-technical-reconsideration-packet-he-dong-v1',
    schema_version: content ? 'job-skill-shelver-298-rejected-11-content-reconsideration-result-v1' : 'job-skill-shelver-298-rejected-11-safety-technical-reconsideration-result-v1',
    reviewer: content ? '陈晓青' : '赫东',
    track: content ? 'CONTENT_AND_OCCUPATIONAL_AUTHENTICITY' : 'SAFETY_AND_TECHNICAL',
    case_set_id: caseSet.case_set_id,
    case_set_hash: caseSet.case_set_hash,
    questions: cases
  }
}

function renderPacket(kind) {
  const data = packageData(kind)
  const content = kind === 'content'
  const cards = data.questions.map((item, index) => {
    const q = item.original_question.content
    const options = Array.isArray(q.options) ? `<ol>${q.options.map((option) => `<li>${escapeHtml(option.key ?? '')} ${escapeHtml(option.text ?? option)}</li>`).join('')}</ol>` : ''
    const old = content
      ? `<b>陈晓青上次意见</b><p>${escapeHtml(item.prior_review.content.review_note)}</p><p><b>建议答案/行为：</b>${escapeHtml(item.prior_review.content.suggested_answer_or_behavior)}</p><p><b>素材工具要求：</b>${escapeHtml(item.prior_review.content.material_tool_requirement)}</p>`
      : `<b>赫东上次意见</b><p><b>安全：</b>${escapeHtml(item.prior_review.safety_technical.safety_note)}</p><p><b>技术：</b>${escapeHtml(item.prior_review.safety_technical.technical_note)}</p><p><b>最低复审要求：</b>${escapeHtml(item.prior_review.safety_technical.minimum_re_review_requirement)}</p>`
    const safetyField = content ? '' : `<label>安全结论<select data-id="${item.question_id}" data-field="safety_conclusion"><option value="">请选择</option><option value="PASS">通过</option><option value="RETURN_FOR_REDESIGN">存在风险，需重设计</option></select></label>`
    return `<article id="q-${item.question_id}"><h2>${index + 1}. ${item.question_id}</h2><div class="meta">${escapeHtml(item.module_type)} · ${escapeHtml(item.question_type)} · V${item.question_version}<br><code>${item.source_record_hash}</code></div><h3>原题（未改字）</h3><p class="prompt">${escapeHtml(q.prompt)}</p>${options}<details><summary>查看原题完整结构</summary><pre>${escapeHtml(JSON.stringify(item.original_question, null, 2))}</pre></details><section class="old">${old}</section><div class="form">${safetyField}<label>${content ? '内容与职业真实性复议结论' : '技术复议结论'}<select data-id="${item.question_id}" data-field="decision"><option value="">请选择</option><option value="PASS_AS_IS">原题可不修改恢复</option><option value="RETURN_FOR_REDESIGN">维持淘汰，另做新版/替代题</option><option value="CONFIRM_REJECTED">确认淘汰，不再复修</option></select></label><label>复议意见<textarea data-id="${item.question_id}" data-field="review_note" placeholder="必须说明理由"></textarea></label></div></article>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>11道淘汰题复议 - ${data.reviewer}</title><style>:root{font-family:system-ui,"Noto Sans SC",sans-serif;color:#17202a;background:#f5f7f9}*{box-sizing:border-box}body{margin:0}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ccd1d1;padding:14px 20px;z-index:2}main{max-width:980px;margin:auto;padding:18px}article{background:#fff;border:1px solid #d5dbdb;border-radius:8px;padding:18px;margin-bottom:16px}h1{font-size:21px;margin:0 0 6px}h2{font-size:18px}.meta{color:#566573;font-size:13px}.prompt{font-size:18px;line-height:1.6}.old{background:#fff8e7;border-left:4px solid #d68910;padding:12px;margin:14px 0}.old p{white-space:pre-wrap}.form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form label{font-weight:650}.form select,.form textarea{display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #aeb6bf;border-radius:5px}.form textarea{min-height:90px}.form label:last-child{grid-column:1/-1}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9f9;padding:12px}button{padding:9px 14px}.notice{color:#7d3c0c}@media(max-width:700px){.form{grid-template-columns:1fr}}</style></head><body><header><h1>11 道淘汰题独立复议</h1><div>审核人：${data.reviewer} · 轨道：${data.track} · <span id="progress">0 / 11</span></div><button id="export">校验并导出 JSON</button></header><main><p class="notice">这些是原始 V1 题目，没有改题。上次意见仅供追溯，请独立判断。导出结果不会自动恢复题目、修改阶段四或写入数据库。</p>${cards}</main><script id="data" type="application/json">${scriptJson(data)}</script><script>(()=>{const p=JSON.parse(document.getElementById('data').textContent);const key='svets:'+p.package_id+':draft';const state=JSON.parse(localStorage.getItem(key)||'{}');const fields=[...document.querySelectorAll('[data-id][data-field]')];for(const el of fields){el.value=state[el.dataset.id]?.[el.dataset.field]||'';el.oninput=()=>{state[el.dataset.id]=state[el.dataset.id]||{};state[el.dataset.id][el.dataset.field]=el.value;localStorage.setItem(key,JSON.stringify(state));progress()}}function complete(id){const a=state[id]||{};return a.decision&&a.review_note.trim()${content ? '' : '&&a.safety_conclusion'}}function progress(){document.getElementById('progress').textContent=p.questions.filter(q=>complete(q.question_id)).length+' / '+p.questions.length}document.getElementById('export').onclick=()=>{const missing=p.questions.filter(q=>!complete(q.question_id));if(missing.length){alert('尚有 '+missing.length+' 题未填写完整');return}const questions=p.questions.map(q=>({question_id:q.question_id,question_version:q.question_version,source_record_hash:q.source_record_hash,reconsideration_record_hash:q.reconsideration_record_hash,${content ? '' : 'safety_conclusion:state[q.question_id].safety_conclusion,'}decision:state[q.question_id].decision,review_note:state[q.question_id].review_note.trim()}));const counts=Object.fromEntries(['PASS_AS_IS','RETURN_FOR_REDESIGN','CONFIRM_REJECTED'].map(x=>[x.toLowerCase(),questions.filter(q=>q.decision===x).length]));const result={schema_version:p.schema_version,package_id:p.package_id,case_set_id:p.case_set_id,case_set_hash:p.case_set_hash,reviewer:p.reviewer,submitted_at:new Date().toISOString(),summary:{total:questions.length,...counts},questions};const blob=new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=p.package_id+'-result.json';a.click();URL.revokeObjectURL(a.href)};progress()})()</script></body></html>`
}

function resultSchema(kind) {
  const content = kind === 'content'
  const questionProperties = {
    question_id: { enum: expectedIds }, question_version: { const: 1 },
    source_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    reconsideration_record_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    ...(content ? {} : { safety_conclusion: { enum: ['PASS', 'RETURN_FOR_REDESIGN'] } }),
    decision: { enum: ['PASS_AS_IS', 'RETURN_FOR_REDESIGN', 'CONFIRM_REJECTED'] },
    review_note: { type: 'string', minLength: 1 }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
    required: ['schema_version', 'package_id', 'case_set_id', 'case_set_hash', 'reviewer', 'submitted_at', 'summary', 'questions'],
    properties: {
      schema_version: { const: content ? 'job-skill-shelver-298-rejected-11-content-reconsideration-result-v1' : 'job-skill-shelver-298-rejected-11-safety-technical-reconsideration-result-v1' },
      package_id: { const: content ? 'job-skill-shelver-298-rejected-11-content-reconsideration-packet-chen-xiaoqing-v1' : 'job-skill-shelver-298-rejected-11-safety-technical-reconsideration-packet-he-dong-v1' },
      case_set_id: { const: caseSet.case_set_id }, case_set_hash: { const: caseSet.case_set_hash }, reviewer: { const: content ? '陈晓青' : '赫东' }, submitted_at: { type: 'string', format: 'date-time' },
      summary: { type: 'object', additionalProperties: false, required: ['total', 'pass_as_is', 'return_for_redesign', 'confirm_rejected'], properties: { total: { const: 11 }, pass_as_is: { type: 'integer', minimum: 0, maximum: 11 }, return_for_redesign: { type: 'integer', minimum: 0, maximum: 11 }, confirm_rejected: { type: 'integer', minimum: 0, maximum: 11 } } },
      questions: { type: 'array', minItems: 11, maxItems: 11, items: { type: 'object', additionalProperties: false, required: ['question_id', 'question_version', 'source_record_hash', 'reconsideration_record_hash', ...(content ? [] : ['safety_conclusion']), 'decision', 'review_note'], properties: questionProperties } }
    }
  }
}

const outputs = [
  [paths.cases, `${JSON.stringify(caseSet, null, 2)}\n`],
  [paths.gate, `${JSON.stringify(gate, null, 2)}\n`],
  [paths.contentHtml, renderPacket('content')],
  [paths.safetyHtml, renderPacket('safety')],
  [paths.contentSchema, `${JSON.stringify(resultSchema('content'), null, 2)}\n`],
  [paths.safetySchema, `${JSON.stringify(resultSchema('safety'), null, 2)}\n`]
]
for (const [path, expected] of outputs) {
  if (checkOnly) {
    assert(existsSync(path), `missing generated artifact: ${path}`)
    assert(readFileSync(path, 'utf8') === expected, `generated artifact drift: ${path}`)
  } else writeFileSync(path, expected)
}
console.log(`Rejected 11 reconsideration contract ${checkOnly ? 'verified' : 'built'}: 11 cases, two independent reviewer packets, authority unchanged.`)
